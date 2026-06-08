"""FastAPI-приложение `plana-engine` (prompt-driven edition).

Эндпоинты:
- `GET  /health`                              — статус сервиса
- `POST /visualize/exterior`                  — экстерьер ЖК (text-to-image)
- `POST /visualize/floorplan-furniture`       — план с мебелью (text-to-image)
- `POST /visualize/site-placement`            — посадка на участок (image-edit)
- `POST /visualize/site-placement-variants`   — 3 стратегии посадки (image-edit × 3)
- `POST /visualize/floor-variants`            — 5 AI-чертежей (text-to-image × 5)
- `POST /visualize/interior-gallery`          — интерьер по типам квартир (text-to-image × N)
- `POST /validate/project`                    — проверка норм РК + ГПЗУ (domain model + shapely)
- `POST /export/floorplan-dxf`                — DXF плана типового этажа
- `POST /export/floorplan-ifc`                — IFC4 (BIM) плана типового этажа
- `POST /export/floorplan-metrics`            — только метрики этажа (быстрый расчёт)
- `POST /import/floorplan-dxf`                — DXF пользователя → summary/preview JSON
- `POST /import/floorplan-dwg`                — DWG пользователя → DXF → summary/preview JSON
- `POST /import/gpzu`                         — ГПЗУ-PDF → JSON через Vision

Ничего алгоритмического: параметры → промпт → gpt-image.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import __version__
from ..auth import init_db, router as auth_router
from ..auth.jwt_utils import verify_token
from ..projects import router as projects_router
from ..projects.storage import ASSETS_DIR
from ..cad import (
    build_floorplan_dxf, build_floorplan_ifc, compute_floorplan_metrics,
    FloorPlanDxfBuilder,
)
from ..cad.layout_schema import LayoutFloor
from ..cad.floorplan_ifc import build_ifc_from_layout
from ..cost import (
    AggregateCostEstimate, CostBuildupConfig, estimate_aggregate_cost,
)
from ..cost.input_extractor import (
    CostInputExtractionRequest,
    CostInputExtractionResponse,
    extract_cost_inputs_from_brief,
)
from ..cost.analyst_explainer import (
    CostAnalystExplanationRequest,
    CostAnalystExplanationResponse,
    explain_cost_snapshot,
)
from ..cost.site_image_analyzer import (
    SiteImageRiskAnalysisResponse,
    analyze_site_image_risks,
)
from ..types import BuildingPurpose
from ..visualizer import (
    DEFAULT_EXTERIOR_VIEWS, EXTERIOR_VIEWS,
    GenerationOptions, MarketingInputs, build_exterior_prompt,
    build_floorplan_furniture_prompt, build_floorplan_furniture_edit_prompt,
    build_interior_prompt,
    build_marketing_prompt, build_site_placement_prompt,
    enhance_prompt, enhance_with_kz_norms, has_llm_key,
)
from ..visualizer.openai_client import (
    MissingAPIKey, OpenAIError,
    has_api_key as has_openai_key,
    generate_image_edit_with_meta,
    generate_image_inpaint_with_meta,
)
# Text→image листов альбома — через xAI Grok (см. grok_client.py).
# Image-edit и inpaint остаются на OpenAI gpt-image.
from ..visualizer.grok_client import (
    generate_image_with_meta,
    has_api_key as has_grok_key,
)

# Регистрируем HEIF/HEIC-декодер, чтобы PIL открывал фото с айфона (.heic).
try:
    from pillow_heif import register_heif_opener as _register_heif_opener
    _register_heif_opener()
except Exception:  # noqa: BLE001
    pass


def has_api_key() -> bool:
    """True если есть ХОТЯ БЫ один image-провайдер (OpenAI или xAI)."""
    return has_openai_key() or has_grok_key()


@asynccontextmanager
async def _lifespan(application: FastAPI):
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    application.mount("/static", StaticFiles(directory=str(ASSETS_DIR)), name="static")
    init_db()
    yield


app = FastAPI(
    title="Plana Engine API",
    version=__version__,
    description="Prompt-driven визуализатор планировок (Plana).",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Публичные пути — не требуют токена
_PUBLIC_PATHS = {"/health", "/auth/login", "/auth/register", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next: Any) -> Any:
    # CORS preflight (OPTIONS) пропускаем — CORSMiddleware ответит сам.
    if request.method == "OPTIONS":
        return await call_next(request)
    if request.url.path in _PUBLIC_PATHS or request.url.path.startswith("/static/"):
        return await call_next(request)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return Response(
            content='{"detail":"Not authenticated"}',
            status_code=401,
            media_type="application/json",
        )
    try:
        payload = verify_token(auth_header[7:])
        request.state.user = payload
    except ValueError:
        return Response(
            content='{"detail":"Invalid or expired token"}',
            status_code=401,
            media_type="application/json",
        )
    return await call_next(request)


app.include_router(auth_router)
app.include_router(projects_router)



# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: str
    version: str
    has_image_key: bool
    has_llm_key: bool
    build_commit: str | None = None
    routes_version: str = "cad-import-v1"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        has_image_key=has_api_key(),
        has_llm_key=has_llm_key(),
        build_commit=(
            os.getenv("RENDER_GIT_COMMIT")
            or os.getenv("VERCEL_GIT_COMMIT_SHA")
            or os.getenv("GIT_COMMIT")
        ),
    )


# ---------------------------------------------------------------------------
# Запрос с параметрами формы — общий для большинства /visualize эндпоинтов
# ---------------------------------------------------------------------------


class VisualizeFromInputsRequest(BaseModel):
    # габариты
    site_width_m: float
    site_depth_m: float
    setback_front_m: float = 0.0
    setback_side_m: float = 0.0
    setback_rear_m: float = 0.0
    # объект
    floors: int = 1
    purpose: BuildingPurpose = BuildingPurpose.RESIDENTIAL
    # Типология здания: single_family (без подъезда/лифтов/коридора) /
    # multi_family (секционка, default — старое поведение) / commercial / mixed.
    building_type: str = "multi_family"
    # квартирография
    studio_pct: float = 0.0
    k1_pct: float = 0.0
    k2_pct: float = 0.0
    k3_pct: float = 0.0
    k4_pct: float = 0.0
    # подъездность (количество секций — важно для жилых)
    sections: int = 1
    # паркинг
    parking_spaces_per_apt: float = 1.0
    parking_underground_levels: int = 1
    # пожарка
    fire_evacuation_max_m: float = 25.0
    fire_evacuation_exits_per_section: int = 2
    fire_dead_end_corridor_max_m: float = 12.0
    # лифты
    lifts_passenger: int = 2
    lifts_freight: int = 1
    # инсоляция
    insolation_priority: bool = True
    insolation_min_hours: float = 2.0
    # ГПЗУ
    max_coverage_pct: float = 0.0
    max_height_m: float = 30.0
    # рендер
    quality: str = "medium"
    # свободный контур участка [[x, y], ...] в метрах. None = прямоугольник.
    site_polygon: list[list[float]] | None = None
    # single_family параметры — для multi_family игнорируются
    bedrooms: int = 2
    bathrooms: int = 1
    has_garage: bool = False
    # multi_family типология этажа — "symmetric" (default) или "t_shape"
    floor_typology: str = "symmetric"


class ExportIfcRequest(VisualizeFromInputsRequest):
    """Расширение для /export/floorplan-ifc: опциональная AI-планировка."""
    layout: LayoutFloor | None = None


def _inputs_from_req(req: VisualizeFromInputsRequest) -> MarketingInputs:
    return MarketingInputs(
        site_width_m=req.site_width_m,
        site_depth_m=req.site_depth_m,
        setback_front_m=req.setback_front_m,
        setback_side_m=req.setback_side_m,
        setback_rear_m=req.setback_rear_m,
        floors=req.floors,
        purpose=req.purpose.value,
        building_type=req.building_type,
        studio_pct=req.studio_pct,
        k1_pct=req.k1_pct,
        k2_pct=req.k2_pct,
        k3_pct=req.k3_pct,
        k4_pct=req.k4_pct,
        sections=req.sections,
        parking_spaces_per_apt=req.parking_spaces_per_apt,
        parking_underground_levels=req.parking_underground_levels,
        fire_evacuation_max_m=req.fire_evacuation_max_m,
        fire_evacuation_exits_per_section=req.fire_evacuation_exits_per_section,
        fire_dead_end_corridor_max_m=req.fire_dead_end_corridor_max_m,
        lifts_passenger=req.lifts_passenger,
        lifts_freight=req.lifts_freight,
        insolation_priority=req.insolation_priority,
        insolation_min_hours=req.insolation_min_hours,
        max_coverage_pct=req.max_coverage_pct,
        max_height_m=req.max_height_m,
        site_polygon=tuple((p[0], p[1]) for p in req.site_polygon) if req.site_polygon else None,
        bedrooms=req.bedrooms,
        bathrooms=req.bathrooms,
        has_garage=req.has_garage,
        floor_typology=req.floor_typology,
    )


def _run_text_to_image(
    prompt: str, quality: str,
    *, inputs: MarketingInputs | None = None,
) -> Response:
    """Генерация text-to-image с обогащением промпта.

    Если передан `inputs` — используется агентный enhancer с базой норм РК
    (двухстадийный: Architect Critic → Prompt Composer). Иначе — старый
    атмосферный enhancer (Gemma 4 без знаний о нормах).
    """
    norms_used: list[str] = []
    if inputs is not None:
        result_enh = enhance_with_kz_norms(prompt, inputs)
        enhanced = result_enh.enhanced_prompt
        enhancer_source = f"agent-kz-norms:{result_enh.source}"
        norms_used = result_enh.norms_used
    else:
        enhanced, src = enhance_prompt(prompt)
        enhancer_source = src

    try:
        result = generate_image_with_meta(
            enhanced,
            GenerationOptions(quality=quality),  # type: ignore[arg-type]
        )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    headers = {
        "Cache-Control": "public, max-age=86400",
        "X-Model-Used": result.model_used,
        "X-Enhancer-Used": enhancer_source,
        "Access-Control-Expose-Headers":
            "X-Model-Used, X-Enhancer-Used, X-Norms-Used",
    }
    if norms_used:
        headers["X-Norms-Used"] = ",".join(norms_used)

    return Response(
        content=result.png,
        media_type="image/png",
        headers=headers,
    )


def _validate_quality(quality: str) -> None:
    if quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")


# ---------------------------------------------------------------------------
# Single-image визуализации
# ---------------------------------------------------------------------------


@app.post("/visualize/exterior")
def visualize_exterior(req: VisualizeFromInputsRequest) -> Response:
    """Внешний вид ЖК — 3/4 перспектива здания в окружении."""
    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    return _run_text_to_image(
        build_exterior_prompt(inputs), req.quality, inputs=inputs,
    )


class ExteriorGalleryRequest(VisualizeFromInputsRequest):
    """Расширение запроса экстерьера: список ракурсов для галереи.

    `views=None` → DEFAULT_EXTERIOR_VIEWS (hero, entrance, aerial, courtyard).
    """
    views: list[str] | None = None


class ExteriorGalleryItem(BaseModel):
    view:          str
    label:         str
    image_b64:     str
    model_used:    str
    enhancer_used: str


class ExteriorGalleryResponse(BaseModel):
    items:      list[ExteriorGalleryItem]
    elapsed_ms: float


@app.post("/visualize/exterior-gallery", response_model=ExteriorGalleryResponse)
def visualize_exterior_gallery(req: ExteriorGalleryRequest) -> ExteriorGalleryResponse:
    """Несколько ракурсов экстерьера (параллельно), 1 картинка на ракурс."""
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)

    # Дедуп + фильтр известных ракурсов с сохранением порядка.
    requested = req.views or DEFAULT_EXTERIOR_VIEWS
    seen: set[str] = set()
    views: list[str] = []
    for v in requested:
        if v in EXTERIOR_VIEWS and v not in seen:
            seen.add(v)
            views.append(v)
    if not views:
        views = list(DEFAULT_EXTERIOR_VIEWS)

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, view: str) -> tuple[int, ExteriorGalleryItem]:
        prompt = build_exterior_prompt(inputs, view)
        enhanced, enhancer_src = enhance_prompt(prompt)
        result = generate_image_with_meta(enhanced, opts, use_cache=True)
        return idx, ExteriorGalleryItem(
            view=view,
            label=EXTERIOR_VIEWS[view]["label"],
            image_b64=_b64.b64encode(result.png).decode(),
            model_used=result.model_used,
            enhancer_used=enhancer_src,
        )

    t0 = time.time()
    ordered: list[ExteriorGalleryItem | None] = [None] * len(views)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=min(4, len(views))) as pool:
            futures = {pool.submit(_one, i, v): i for i, v in enumerate(views)}
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception as exc:
                    last_exc = exc
    except MissingAPIKey as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = [it for it in ordered if it is not None]
    if not items:
        detail = f"All renders failed: {last_exc}" if last_exc else "No items generated"
        raise HTTPException(status_code=502, detail=detail)

    return ExteriorGalleryResponse(
        items=items,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
    )


@app.post("/visualize/floorplan-furniture")
def visualize_floorplan_furniture(req: VisualizeFromInputsRequest) -> Response:
    """Pinterest-grade top-down планировка с мебелью (для брошюр)."""
    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    return _run_text_to_image(
        build_floorplan_furniture_prompt(inputs), req.quality, inputs=inputs,
    )


@app.post("/visualize/floorplan-furniture-edit")
async def visualize_floorplan_furniture_edit(
    plan_image: UploadFile = File(...),
    req_json: str = Form(...),
    source_prompt: str = Form(""),
) -> Response:
    """image-edit: обставляет мебелью РЕАЛЬНЫЙ план-чертёж (PNG), сохраняя
    геометрию — согласовано с чертежом.

    `req_json` — JSON тела VisualizeFromInputsRequest (для микса/качества);
    `source_prompt` — исходный промпт чертежа (доп. контекст «то же здание»).
    """
    image_bytes = await plan_image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty plan_image")
    try:
        req = VisualizeFromInputsRequest.model_validate_json(req_json)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"bad req_json: {e}")

    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    prompt = build_floorplan_furniture_edit_prompt(inputs, source_prompt)
    enhanced, enhancer_source = enhance_prompt(prompt)

    try:
        result = generate_image_edit_with_meta(
            enhanced,
            image_bytes,
            GenerationOptions(quality=req.quality),  # type: ignore[arg-type]
        )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Model-Used": result.model_used,
            "X-Enhancer-Used": enhancer_source,
            "Access-Control-Expose-Headers": "X-Model-Used, X-Enhancer-Used",
        },
    )


@app.post("/visualize/interior")
def visualize_interior(req: VisualizeFromInputsRequest) -> Response:
    """Интерьер одной комнаты — для самой крупной типологии."""
    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    return _run_text_to_image(
        build_interior_prompt(inputs), req.quality, inputs=inputs,
    )


# ---------------------------------------------------------------------------
# Image-to-image: посадка на участок (одна картинка)
# ---------------------------------------------------------------------------


@app.post("/visualize/site-placement")
async def visualize_site_placement(
    site_image: UploadFile = File(...),
    building_image: UploadFile | None = File(default=None),
    site_width_m: float = Form(...),
    site_depth_m: float = Form(...),
    setback_front_m: float = Form(0.0),
    setback_side_m: float = Form(0.0),
    setback_rear_m: float = Form(0.0),
    floors: int = Form(1),
    purpose: BuildingPurpose = Form(BuildingPurpose.RESIDENTIAL),
    studio_pct: float = Form(0.0),
    k1_pct: float = Form(0.0),
    k2_pct: float = Form(0.0),
    k3_pct: float = Form(0.0),
    parking_spaces_per_apt: float = Form(1.0),
    parking_underground_levels: int = Form(1),
    max_coverage_pct: float = Form(50.0),
    max_height_m: float = Form(30.0),
    quality: str = Form("medium"),
) -> Response:
    """Image-to-image: впишет здание в загруженное аэрофото участка."""
    _validate_quality(quality)

    image_bytes = await site_image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    if building_image is not None:
        bld_bytes = await building_image.read()
        if bld_bytes:
            try:
                image_bytes = _composite_images(image_bytes, bld_bytes)
            except Exception:
                pass  # если не получилось — используем только участок

    # Нормализуем в PNG (gpt-image edit капризен к формату/режиму входа).
    image_bytes = _ensure_png(image_bytes)

    inputs = MarketingInputs(
        site_width_m=site_width_m,
        site_depth_m=site_depth_m,
        setback_front_m=setback_front_m,
        setback_side_m=setback_side_m,
        setback_rear_m=setback_rear_m,
        floors=floors,
        purpose=purpose.value,
        studio_pct=studio_pct,
        k1_pct=k1_pct,
        k2_pct=k2_pct,
        k3_pct=k3_pct,
        parking_spaces_per_apt=parking_spaces_per_apt,
        parking_underground_levels=parking_underground_levels,
        max_coverage_pct=max_coverage_pct,
        max_height_m=max_height_m,
    )
    prompt = build_site_placement_prompt(inputs)
    enhanced, enhancer_source = enhance_prompt(prompt)

    try:
        result = generate_image_edit_with_meta(
            enhanced,
            image_bytes,
            GenerationOptions(quality=quality),  # type: ignore[arg-type]
        )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Model-Used": result.model_used,
            "X-Enhancer-Used": enhancer_source,
            "Access-Control-Expose-Headers": "X-Model-Used, X-Enhancer-Used",
        },
    )


# ---------------------------------------------------------------------------
# Image-to-image: 3 варианта посадки (composite + 3 стратегии параллельно)
# ---------------------------------------------------------------------------

_PLACEMENT_VARIANTS = [
    {
        "key": "linear_north",
        "label": "Линейное (север)",
        "description": (
            "PLACEMENT STRATEGY 1 — LINEAR NORTH:\n"
            "Place the residential building as a straight linear block along the NORTHERN boundary of the site. "
            "Building occupies the full northern width. Parking zones in the southern half. "
            "Green recreational zones on east and west sides. Main entrance faces south. "
            "Show setback lines as dashed red borders. Label: «Вариант 1: Линейное северное размещение»."
        ),
    },
    {
        "key": "central",
        "label": "Центральное",
        "description": (
            "PLACEMENT STRATEGY 2 — CENTRAL:\n"
            "Place the residential building in the CENTER of the site with equal green zones on all sides. "
            "Parking distributed around the perimeter. Pedestrian paths from all four sides to the building. "
            "Green landscaping surrounds the building on all sides. "
            "Show setback lines as dashed red borders. Label: «Вариант 2: Центральное размещение»."
        ),
    },
    {
        "key": "l_shape",
        "label": "Г-образное (угловое)",
        "description": (
            "PLACEMENT STRATEGY 3 — L-SHAPE CORNER:\n"
            "Place the residential building in an L-shape along the NORTHERN and EASTERN boundaries. "
            "The L-shape creates a sheltered courtyard in the south-western corner — "
            "this becomes a private green courtyard for residents. "
            "Parking along the western boundary. Main entrance at the L-shape corner. "
            "Show setback lines as dashed red borders. Label: «Вариант 3: Г-образное угловое размещение»."
        ),
    },
]


def _ensure_png(image_bytes: bytes) -> bytes:
    """Нормализуем любое изображение в RGB PNG для gpt-image edit.

    gpt-image отклоняет неподдерживаемые форматы/режимы (HEIC, CMYK, битые файлы)
    с invalid_image_file. Прогоняем через PIL → PNG. Если не открывается —
    отдаём понятную 400, а не 502 от OpenAI.
    """
    from PIL import Image
    import io as _io
    try:
        img = Image.open(_io.BytesIO(image_bytes)).convert("RGB")
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Не удалось прочитать изображение. Загрузите корректный файл (JPG, PNG или HEIC).",
        )


def _composite_images(site_bytes: bytes, building_bytes: bytes) -> bytes:
    """Компонует аэрофото участка (слева 65%) + фото ЖК (справа 35%) в одно изображение.

    Это нужно потому что gpt-image edit принимает ОДИН файл.
    """
    from PIL import Image, ImageDraw, ImageFont
    import io as _io

    TARGET_W, TARGET_H = 1536, 1024
    SITE_W = int(TARGET_W * 0.65)
    BLD_W  = TARGET_W - SITE_W

    site_img = Image.open(_io.BytesIO(site_bytes)).convert("RGB")
    scale = TARGET_H / site_img.height
    site_resized = site_img.resize(
        (max(1, int(site_img.width * scale)), TARGET_H), Image.Resampling.LANCZOS
    )
    if site_resized.width >= SITE_W:
        ox = (site_resized.width - SITE_W) // 2
        site_cropped = site_resized.crop((ox, 0, ox + SITE_W, TARGET_H))
    else:
        site_cropped = Image.new("RGB", (SITE_W, TARGET_H), (20, 20, 30))
        site_cropped.paste(site_resized, (0, 0))

    bld_img = Image.open(_io.BytesIO(building_bytes)).convert("RGB")
    scale_b = BLD_W / bld_img.width
    bld_h = int(bld_img.height * scale_b)
    bld_resized = bld_img.resize((BLD_W, max(1, bld_h)), Image.Resampling.LANCZOS)
    bld_panel = Image.new("RGB", (BLD_W, TARGET_H), (15, 15, 20))
    bld_y = (TARGET_H - min(bld_h, TARGET_H)) // 2
    bld_panel.paste(bld_resized.crop((0, 0, BLD_W, min(bld_h, TARGET_H))), (0, bld_y))

    composite = Image.new("RGB", (TARGET_W, TARGET_H), (10, 10, 15))
    composite.paste(site_cropped, (0, 0))

    draw = ImageDraw.Draw(composite)
    draw.rectangle([SITE_W - 2, 0, SITE_W + 2, TARGET_H], fill=(80, 80, 100))
    composite.paste(bld_panel, (SITE_W, 0))

    try:
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc", 22
        )
    except Exception:
        font = ImageFont.load_default()
    draw.text((16, 16), "УЧАСТОК (аэрофото)", fill=(255, 255, 100), font=font)
    draw.text((SITE_W + 12, 16), "РЕФЕРЕНС ЖК", fill=(100, 220, 255), font=font)

    buf = _io.BytesIO()
    composite.save(buf, format="PNG")
    return buf.getvalue()


@app.post("/visualize/site-placement-variants")
async def visualize_site_placement_variants(
    site_image: UploadFile = File(...),
    building_image: UploadFile = File(...),
    site_width_m: float = Form(...),
    site_depth_m: float = Form(...),
    setback_front_m: float = Form(0.0),
    setback_side_m: float = Form(0.0),
    setback_rear_m: float = Form(0.0),
    floors: int = Form(1),
    purpose: BuildingPurpose = Form(BuildingPurpose.RESIDENTIAL),
    quality: str = Form("medium"),
) -> Response:
    """Аэрофото участка + фото ЖК → 3 варианта посадки (image-edit × 3 параллельно)."""
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
    import json as _json

    _validate_quality(quality)

    site_bytes = await site_image.read()
    bld_bytes  = await building_image.read()
    if not site_bytes or not bld_bytes:
        raise HTTPException(status_code=400, detail="both images are required")

    try:
        composite_bytes = _composite_images(site_bytes, bld_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"image processing failed: {e}")

    inner_w = site_width_m - 2 * setback_side_m
    inner_h = site_depth_m - setback_front_m - setback_rear_m
    base_context = (
        f"Aerial top-down architectural site plan. "
        f"Site dimensions: {site_width_m:.0f}×{site_depth_m:.0f} m. "
        f"After setbacks: {inner_w:.0f}×{inner_h:.0f} m buildable area. "
        f"Building: {floors}-storey {purpose.value} complex (shown in right panel as reference). "
        f"LEFT PANEL = aerial photo of the actual site. RIGHT PANEL = reference building image. "
        f"Task: generate a realistic top-down architectural site plan showing the PLACEMENT of the building "
        f"(matching the style from the reference) on the site. Show roads, parking, green zones, paths. "
        f"Setback lines as red dashed borders. North arrow in top-right corner. "
        f"Scale bar. Cyrillic labels. AutoCAD-style technical drawing on white background.\n\n"
    )

    opts = GenerationOptions(quality=quality)  # type: ignore[arg-type]

    def _one(idx: int, variant: dict) -> tuple[int, dict]:
        prompt = base_context + variant["description"]
        result = generate_image_edit_with_meta(
            prompt,
            composite_bytes,
            opts,
            use_cache=True,
        )
        return idx, {
            "key":        variant["key"],
            "label":      variant["label"],
            "model_used": result.model_used,
            "image_b64":  _b64.b64encode(result.png).decode(),
        }

    t0 = time.time()
    ordered: list[dict | None] = [None] * len(_PLACEMENT_VARIANTS)

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(_one, i, v): i
                for i, v in enumerate(_PLACEMENT_VARIANTS)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception:
                    pass
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    results = [v for v in ordered if v is not None]
    if not results:
        raise HTTPException(status_code=502, detail="All placement variants failed")

    elapsed = round((time.time() - t0) * 1000, 1)
    return Response(
        content=_json.dumps({"variants": results, "elapsed_ms": elapsed}),
        media_type="application/json",
        headers={"Access-Control-Expose-Headers": "*"},
    )


# ---------------------------------------------------------------------------
# 5 AI-чертежей планировки параллельно (text-to-image × 5)
# ---------------------------------------------------------------------------

_FLOOR_VARIANTS = [
    {
        "key": "max_useful_area",
        "label": "Макс. жилая площадь",
        "suffix": (
            "\n\n═══ ПЛАНИРОВОЧНАЯ СТРАТЕГИЯ: МАКСИМАЛЬНАЯ ЖИЛАЯ ПЛОЩАДЬ ═══\n"
            "IMPORTANT: Keep EXACTLY the apartment count and mix specified above — do NOT change them.\n"
            "Layout strategy: compact engineering core (≤15% of floor area). "
            "Apartments span the full building depth (two-facade orientation). "
            "Minimize interior load-bearing walls — only perimeter and core walls. "
            "Maximize net living area per apartment."
        ),
    },
    {
        "key": "max_apt_count",
        "label": "Макс. кол-во квартир",
        "suffix": (
            "\n\n═══ ПЛАНИРОВОЧНАЯ СТРАТЕГИЯ: КОМПАКТНАЯ ПЛАНИРОВКА ═══\n"
            "IMPORTANT: Keep EXACTLY the apartment count and mix specified above — do NOT change them.\n"
            "Layout strategy: central double-loaded corridor. "
            "Compact lift core. Efficient use of every square metre. "
            "Short section lengths to maximize unit count per floor area."
        ),
    },
    {
        "key": "balanced_mix",
        "label": "Классическая секция",
        "suffix": (
            "\n\n═══ ПЛАНИРОВОЧНАЯ СТРАТЕГИЯ: КЛАССИЧЕСКАЯ СЕКЦИЯ ═══\n"
            "IMPORTANT: Keep EXACTLY the apartment count, core, and room programs specified above — do NOT change them.\n"
            "Layout strategy: traditional Kazakh/Soviet section layout. "
            "Central staircase-lift core (exact count as specified in CORE above), "
            "short dead-end corridors (≤12 m). "
            "Apartments on both sides of the core. Standard СНиП room proportions."
        ),
    },
    {
        "key": "max_insolation",
        "label": "Инсоляция (юг)",
        "suffix": (
            "\n\n═══ ПЛАНИРОВОЧНАЯ СТРАТЕГИЯ: МАКСИМАЛЬНАЯ ИНСОЛЯЦИЯ ═══\n"
            "IMPORTANT: Keep EXACTLY the apartment count and mix specified above — do NOT change them.\n"
            "Layout strategy: all living rooms and bedrooms face SOUTH (bottom of sheet = SOUTH). "
            "Service spaces (bathrooms, kitchens, hallways) face north. "
            "Wide south facade with large glazing. Add orientation arrow «☀ ЮГ» on plan. "
            "Apartments elongated in N-S direction."
        ),
    },
    {
        "key": "open_plan",
        "label": "Евроформат",
        "suffix": (
            "\n\n═══ ПЛАНИРОВОЧНАЯ СТРАТЕГИЯ: ЕВРОФОРМАТ / OPEN PLAN ═══\n"
            "IMPORTANT: Keep EXACTLY the apartment count and mix specified above — do NOT change them.\n"
            "Layout strategy: European open-plan kitchens. "
            "Kitchen-living room ≥ 22 м² as unified social space. "
            "Master bedroom ≥ 18 м², bathroom ≥ 6 м². "
            "Panoramic south glazing. Minimal load-bearing partitions inside apartments."
        ),
    },
]


class FloorVariantItem(BaseModel):
    key: str
    label: str
    model_used: str
    enhancer_used: str
    image_b64: str
    prompt_used: str = ""


class CritiqueNumericalConstraint(BaseModel):
    parameter: str
    value: str
    source: str


class CritiqueRecommendation(BaseModel):
    title: str
    detail: str
    priority: str


class CritiqueRisk(BaseModel):
    description: str
    severity: str


class CritiquePayload(BaseModel):
    """Архитектурная критика от Stage 1 агентного enhancer'а."""
    summary: str = ""
    numerical_constraints: list[CritiqueNumericalConstraint] = []
    design_recommendations: list[CritiqueRecommendation] = []
    risks: list[CritiqueRisk] = []
    norms_used: list[str] = []


class FloorVariantsResponse(BaseModel):
    variants: list[FloorVariantItem]
    elapsed_ms: float
    critique: CritiquePayload | None = None


@app.post("/visualize/floor-variants", response_model=FloorVariantsResponse)
def visualize_floor_variants(req: VisualizeFromInputsRequest) -> FloorVariantsResponse:
    """5 PNG-вариантов архитектурной планировки через gpt-image (параллельно)."""
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    _validate_quality(req.quality)

    inputs = _inputs_from_req(req)
    base_prompt = build_marketing_prompt(inputs)

    # Агентный enhancer — двухстадийный (Architect Critic + Prompt Composer)
    # с базой казахстанских строительных норм (research/kz-norms/).
    enh = enhance_with_kz_norms(base_prompt, inputs)
    enhanced_base = enh.enhanced_prompt
    enhancer_source = f"agent-kz-norms:{enh.source}"

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, variant: dict) -> tuple[int, FloorVariantItem]:
        prompt = enhanced_base + variant["suffix"]
        result = generate_image_with_meta(prompt, opts, use_cache=True)
        return idx, FloorVariantItem(
            key=variant["key"],
            label=variant["label"],
            model_used=result.model_used,
            enhancer_used=enhancer_source,
            image_b64=_b64.b64encode(result.png).decode(),
            prompt_used=prompt,
        )

    t0 = time.time()
    ordered: list[FloorVariantItem | None] = [None] * len(_FLOOR_VARIANTS)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {
                pool.submit(_one, i, v): i
                for i, v in enumerate(_FLOOR_VARIANTS)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception as e:
                    last_exc = e
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    results = [v for v in ordered if v is not None]
    if not results:
        detail = f"All variants failed: {last_exc}" if last_exc else "No variants generated"
        raise HTTPException(status_code=502, detail=detail)

    # Упаковываем критику для фронта (если есть)
    crit_payload: CritiquePayload | None = None
    if enh.critique is not None:
        crit_payload = CritiquePayload(
            summary=enh.critique.summary,
            numerical_constraints=[
                CritiqueNumericalConstraint(
                    parameter=n.parameter, value=n.value, source=n.source,
                ) for n in enh.critique.numerical_constraints
            ],
            design_recommendations=[
                CritiqueRecommendation(
                    title=r.title, detail=r.detail, priority=r.priority,
                ) for r in enh.critique.design_recommendations
            ],
            risks=[
                CritiqueRisk(description=r.description, severity=r.severity)
                for r in enh.critique.risks
            ],
            norms_used=enh.norms_used,
        )

    return FloorVariantsResponse(
        variants=results,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
        critique=crit_payload,
    )


# ---------------------------------------------------------------------------
# Поэтажные схемы: 5 вариантов для конкретного этажа здания (P1.3)
# ---------------------------------------------------------------------------

_FLOOR_LEVEL_SUFFIXES: dict[str, str] = {
    "ground": (
        "\n\n═══ ТИП ЭТАЖА: ПЕРВЫЙ / ЦОКОЛЬНЫЙ (LOBBY FLOOR) ═══\n"
        "Это ПЕРВЫЙ этаж здания — вестибюль и общественные зоны, НЕ жилые квартиры.\n"
        "Обязательные элементы: парадный вестибюль (lobby) с пунктом консьержа, "
        "почтовые ящики секций, велосипедное хранилище, колясочная, "
        "мусорокамера, электрощитовая/ИТП, пандус въезда в подземный паркинг. "
        "Если commercial_pct > 0 — торговые помещения вдоль уличного фасада. "
        "Высота потолков 4–5 м. Крупные витражные входные группы. "
        "Нет жилых квартир — только общедомовые помещения и нежилой фонд."
    ),
    "typical": (
        "\n\n═══ ТИП ЭТАЖА: ТИПОВОЙ ЖИЛОЙ ЭТАЖ ═══\n"
        "Стандартный жилой этаж здания. Максимальное число квартир на секцию. "
        "Все квартиры рабочие: студии, 1-комн., 2-комн., 3-комн. согласно mix-у. "
        "Двусторонний коридор с лифтами и лестницей в ядре. "
        "Стандартная высота потолков 2.8–3.0 м."
    ),
    "penthouse": (
        "\n\n═══ ТИП ЭТАЖА: ПОСЛЕДНИЙ ЭТАЖ (PENTHOUSE / ТЕХНИЧЕСКИЙ) ═══\n"
        "Последний этаж здания. Комбинация: крупные пентхаус-квартиры с террасами "
        "и возможными высокими потолками (4–5 м), плюс технический машинный зал "
        "для лифтов в ядре, выход на кровлю. "
        "Меньше единиц, зато большие премиальные планировки с панорамными террасами. "
        "Техпомещения: лифтовая машинная комната, АХУ, вентцентр."
    ),
}


class FloorByLevelRequest(VisualizeFromInputsRequest):
    floor_number: int = 1


@app.post("/visualize/floor-by-level", response_model=FloorVariantsResponse)
def visualize_floor_by_level(req: FloorByLevelRequest) -> FloorVariantsResponse:
    """5 PNG-вариантов планировки для конкретного этажа (lobby / typical / penthouse)."""
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    _validate_quality(req.quality)

    # определяем тип этажа
    if req.floor_number == 1:
        level_type = "ground"
    elif req.floor_number >= req.floors:
        level_type = "penthouse"
    else:
        level_type = "typical"

    level_suffix = _FLOOR_LEVEL_SUFFIXES[level_type]

    inputs = _inputs_from_req(req)
    base_prompt = build_marketing_prompt(inputs)
    enh = enhance_with_kz_norms(base_prompt, inputs)
    enhanced_base = enh.enhanced_prompt
    enhancer_source = f"agent-kz-norms:{enh.source}"

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, variant: dict) -> tuple[int, FloorVariantItem]:
        prompt = enhanced_base + level_suffix + variant["suffix"]
        result = generate_image_with_meta(prompt, opts, use_cache=True)
        return idx, FloorVariantItem(
            key=variant["key"],
            label=variant["label"],
            model_used=result.model_used,
            enhancer_used=enhancer_source,
            image_b64=_b64.b64encode(result.png).decode(),
            prompt_used=prompt,
        )

    t0 = time.time()
    ordered: list[FloorVariantItem | None] = [None] * len(_FLOOR_VARIANTS)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {
                pool.submit(_one, i, v): i
                for i, v in enumerate(_FLOOR_VARIANTS)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception as e:
                    last_exc = e
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    results = [v for v in ordered if v is not None]
    if not results:
        detail = f"All variants failed: {last_exc}" if last_exc else "No variants generated"
        raise HTTPException(status_code=502, detail=detail)

    return FloorVariantsResponse(
        variants=results,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
    )


# ---------------------------------------------------------------------------
# P2.2 — Подземный паркинг: план одного уровня (text-to-image)
# ---------------------------------------------------------------------------

def _build_parking_prompt(inputs: MarketingInputs, level: int, total_levels: int) -> str:
    from ..cad import compute_floorplan_metrics
    m = compute_floorplan_metrics(inputs)
    total_spaces = max(1, round(m.apartments_count * inputs.parking_spaces_per_apt))
    spaces_per_level = max(1, round(total_spaces / max(1, total_levels)))
    col_count = max(2, round((inputs.site_width_m - 6) / 8))
    row_count = max(2, round((inputs.site_depth_m - 6) / 8))
    disabled = max(1, round(spaces_per_level * 0.03))

    return (
        f"AutoCAD-style underground parking plan. Top-down orthographic view, white background, "
        f"thin black ink lines on white. Scale 1:200. Cyrillic labels.\n\n"
        f"SUBJECT: Underground parking level {level} of {total_levels}. "
        f"Building footprint {inputs.site_width_m:.0f}×{inputs.site_depth_m:.0f} m. "
        f"Capacity: {spaces_per_level} car spaces on this level ({total_spaces} total in {total_levels} levels).\n\n"
        f"COLUMN GRID: {col_count}×{row_count} columns, 8.0×8.0 m spacing. "
        f"Columns shown as solid squares 400×400 mm, labelled A–{chr(65+col_count-1)} horizontally and 1–{row_count} vertically.\n\n"
        f"CAR SPACES: 2.5×5.0 m each, 90° herringbone layout. Dashed outlines. "
        f"Numbered sequentially. {disabled} disabled spaces near elevators (wheelchair symbol ♿).\n\n"
        f"DRIVE AISLES: 6.0 m wide two-way central aisle + 5.5 m one-way perimeter aisles. "
        f"Traffic direction arrows.\n\n"
        f"RAMP: 5.5 m wide, gradient 15%, located at south-west corner. "
        f"Ramp direction arrows + ВЪЕЗД / ВЫЕЗД labels.\n\n"
        f"UTILITIES: 2 pedestrian stair/elevator cores marked ЛЕСТН/ЛИФТ. "
        f"Fire hydrant symbols every 30 m. Ventilation shaft hatched areas.\n\n"
        f"DIMENSIONS: Dimension chains on all walls, aisles, ramp. Overall building perimeter dimensions.\n\n"
        f"TITLE BLOCK bottom-right: «ПОДЗЕМНЫЙ ПАРКИНГ Б{level}», scale 1:200, north arrow top-right.\n\n"
        f"NEGATIVE: no 3D, no perspective, no photorealism, no colour fills, no shadows."
    )


class ParkingRequest(VisualizeFromInputsRequest):
    parking_level: int = 1


@app.post("/visualize/parking")
def visualize_parking(req: ParkingRequest) -> Response:
    """Plan of one underground parking level (text-to-image, CAD style)."""
    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    level = max(1, min(req.parking_level, req.parking_underground_levels or 1))
    prompt = _build_parking_prompt(inputs, level, req.parking_underground_levels or 1)
    enhanced, enhancer_source = enhance_prompt(prompt)
    try:
        result = generate_image_with_meta(enhanced, GenerationOptions(quality=req.quality))  # type: ignore[arg-type]
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Model-Used": result.model_used,
            "X-Enhancer-Used": enhancer_source,
            "X-Parking-Level": str(level),
            "Access-Control-Expose-Headers": "X-Model-Used, X-Enhancer-Used, X-Parking-Level",
        },
    )


# ---------------------------------------------------------------------------
# Интерьер-галерея: 1 рендер на уникальный тип квартиры
# ---------------------------------------------------------------------------


_APT_TYPE_RU: dict[str, str] = {
    "studio": "Студия",
    "k1":     "1-комн.",
    "euro1":  "Евро-1",
    "k2":     "2-комн.",
    "euro2":  "Евро-2",
    "k3":     "3-комн.",
    "euro3":  "Евро-3",
    "k4":     "4-комн.",
}

_APT_FURNITURE: dict[str, str] = {
    "studio": (
        "Murphy bed or high-quality sofa-bed, floating shelves, compact kitchen island "
        "with 2 bar stools, small round dining table for 2, wall-mounted TV unit"
    ),
    "k1": (
        "Queen bed with upholstered headboard, walk-in wardrobe, two-seat sofa facing TV, "
        "dining table for 4, kitchen with peninsula"
    ),
    "euro1": (
        "Sofa-bed or pull-out sofa in living zone, integrated kitchen with island, "
        "fold-down desk, storage wall with sliding doors, dining table for 4"
    ),
    "k2": (
        "King bed in master, twin beds in second room, sectional sofa, "
        "glass dining table for 6, kitchen island with bar stools"
    ),
    "euro2": (
        "King master bedroom, children's bunk bed in second room, "
        "open-plan kitchen island, sofa with chaise longue, dining table for 6"
    ),
    "k3": (
        "King master with dressing room, two bedrooms with desks, "
        "large L-shaped sectional sofa, dining table for 8, chef's kitchen island"
    ),
    "euro3": (
        "Three distinct bedrooms, statement living room with fireplace TV wall, "
        "large open kitchen island, dining table for 8, home office corner"
    ),
    "k4": (
        "Four bedrooms, grand living room, chef's kitchen, "
        "dining table for 10, home office, dressing room in master"
    ),
}


class AptTypeInput(BaseModel):
    apt_type:   str
    area:       float
    width:      float
    depth:      float
    zone_kinds: list[str]
    count:      int = 1


class InteriorGalleryRequest(BaseModel):
    floors:    int   = 9
    purpose:   str   = "residential"
    quality:   str   = "medium"
    apt_types: list[AptTypeInput]


class InteriorGalleryItem(BaseModel):
    apt_type:      str
    label:         str
    area:          float
    count:         int
    image_b64:     str
    model_used:    str
    enhancer_used: str
    # Ракурс по комнате (см. _ROOM_FOCUS). Пусто = общий композит.
    room_focus:    str = ""
    view_label:    str = ""


class InteriorGalleryResponse(BaseModel):
    items:      list[InteriorGalleryItem]
    elapsed_ms: float


# Ракурсы интерьера: камера фокусируется на одной комнате. `scene` — что в
# кадре, `zone` — короткое имя для строки «Featured room», `label` — подпись UI.
_ROOM_FOCUS: dict[str, dict[str, str]] = {
    "living_kitchen": {
        "label": "Гостиная-кухня",
        "zone": "open-plan living-kitchen",
        "scene": "the OPEN-PLAN LIVING-KITCHEN — lounge sofa zone merging into a kitchen island with bar stools, a dining table set between them",
    },
    "living": {
        "label": "Гостиная",
        "zone": "living room",
        "scene": "the LIVING ROOM — sectional sofa, coffee table, media/TV wall, area rug, floor-to-ceiling windows",
    },
    "kitchen": {
        "label": "Кухня",
        "zone": "kitchen",
        "scene": "the KITCHEN — full cabinetry, island or peninsula with bar stools, integrated appliances, tiled backsplash",
    },
    "bedroom": {
        "label": "Спальня",
        "zone": "master bedroom",
        "scene": "the MASTER BEDROOM — double bed with upholstered headboard, bedside tables with lamps, wardrobe, soft layered textiles",
    },
    "bedroom2": {
        "label": "Спальня 2",
        "zone": "second bedroom",
        "scene": "the SECOND BEDROOM — single or twin bed, study desk with chair, compact wardrobe, lighter palette",
    },
    "bathroom": {
        "label": "Санузел",
        "zone": "bathroom",
        "scene": "the BATHROOM — vanity with backlit mirror, walk-in glass shower or bathtub, large-format tiles, brass fixtures",
    },
}

# Студии и «евро»-форматы — открытая планировка: гостиную и кухню снимаем
# одним кадром, а не двумя.
_OPEN_PLAN_TYPES = {"studio", "euro1", "euro2", "euro3"}


def _apt_room_foci(apt: AptTypeInput) -> list[str]:
    """Список ракурсов по комнатам квартиры на основе zone_kinds.

    Открытая планировка → living+kitchen одним кадром. Спальни: master + (если
    есть вторая) second, без размножения почти одинаковых кадров. Прихожую и
    лоджию не снимаем — малоинформативны и раздувают стоимость.
    """
    counts: dict[str, int] = {}
    for z in apt.zone_kinds:
        counts[z] = counts.get(z, 0) + 1

    foci: list[str] = []
    has_living = counts.get("living", 0) > 0
    has_kitchen = counts.get("kitchen", 0) > 0
    if apt.apt_type in _OPEN_PLAN_TYPES and has_living and has_kitchen:
        foci.append("living_kitchen")
    else:
        if has_living:
            foci.append("living")
        if has_kitchen:
            foci.append("kitchen")
    n_bed = counts.get("bedroom", 0)
    if n_bed >= 1:
        foci.append("bedroom")
    if n_bed >= 2:
        foci.append("bedroom2")
    if counts.get("bathroom", 0) > 0:
        foci.append("bathroom")
    return foci or ["living"]


def _build_apt_interior_prompt(
    apt: AptTypeInput, floors: int, purpose: str, room_focus: str | None = None,
) -> str:
    """Точный интерьерный промпт на основе реальных данных тайла.

    `room_focus` (см. _ROOM_FOCUS) фокусирует кадр на одной комнате; без него —
    общий композит по всем зонам (старое поведение).
    """
    type_desc_map: dict[str, str] = {
        "studio": f"studio apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — open-plan living, kitchen and sleeping zone in one space",
        "k1":     f"1-bedroom apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — separate bedroom, combined living-dining room, separate kitchen",
        "euro1":  f"euro-1 apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — open-plan kitchen-living, separate sleeping nook with pocket door",
        "k2":     f"2-bedroom apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — master bedroom, children's bedroom, spacious living room, separate kitchen",
        "euro2":  f"euro-2 apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — open kitchen island merging with living, master bedroom, second bedroom",
        "k3":     f"3-bedroom apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — large living room with dining area, master bedroom, two additional bedrooms",
        "euro3":  f"euro-3 apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — grand open kitchen-living, three bedrooms, two bathrooms",
        "k4":     f"4-bedroom apartment ({apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m) — grand living-dining, chef's kitchen, four bedrooms, master with dressing room",
    }
    apt_desc = type_desc_map.get(apt.apt_type, f"apartment {apt.area:.0f} m², {apt.width:.1f}×{apt.depth:.1f} m")

    zone_counter: dict[str, int] = {}
    for z in apt.zone_kinds:
        zone_counter[z] = zone_counter.get(z, 0) + 1

    zone_parts: list[str] = []
    if zone_counter.get("living"):
        zone_parts.append("living room")
    if zone_counter.get("bedroom"):
        n = zone_counter["bedroom"]
        zone_parts.append(f"{n} bedroom{'s' if n > 1 else ''}")
    if zone_counter.get("kitchen"):
        zone_parts.append("kitchen")
    if zone_counter.get("bathroom"):
        n = zone_counter["bathroom"]
        zone_parts.append(f"{n} bathroom{'s' if n > 1 else ''}")
    if zone_counter.get("hall"):
        zone_parts.append("entrance hall")
    if zone_counter.get("loggia"):
        zone_parts.append("loggia/balcony")
    zones_str = ", ".join(zone_parts) if zone_parts else "living space"

    furniture = _APT_FURNITURE.get(apt.apt_type, "modern furniture")

    rf = _ROOM_FOCUS.get(room_focus) if room_focus else None
    if rf is not None:
        rooms_line = (
            f"Featured room: {rf['zone']}, part of the {apt_desc}.\n"
            f"FRAME AND COMPOSE the photo entirely around {rf['scene']}. "
            f"Show only this room (adjacent spaces may be hinted through an opening)."
        )
    else:
        rooms_line = f"Rooms visible: {zones_str}."

    return f"""Photorealistic interior architectural rendering, residential magazine quality.
Eye-level perspective view, camera at 1.5 m height, wide-angle (28 mm equivalent), no fish-eye distortion.

SUBJECT: {apt_desc}, in a newly built {floors}-storey residential building in Kazakhstan.
{rooms_line}
Modern Kazakh/Russian residential interior — contemporary Scandinavian-minimalist style with warm Central Asian accents.
Keep the SAME apartment identity across views — consistent flooring, wall colors, style and finishes.

FURNITURE & FURNISHINGS:
{furniture}
• Indoor plants: monstera, fiddle leaf fig, sansevieria in matte ceramic pots
• Wall art: large abstract canvas or framed architectural prints
• Books on open shelves, decorative vases, candles, woven throws

MATERIALS:
• Flooring: light oak engineered hardwood parquet, visible grain
• Walls: warm off-white matte plaster; ONE accent wall — deep sage-green or muted terracotta
• Ceiling: plain white with integrated LED strip lighting, 2.8 m ceiling height
• Windows: floor-to-ceiling, thin black aluminum frame, city/landscape view with soft bokeh

LIGHTING:
• Primary: natural daylight, golden-hour bias (afternoon sun), soft directional rays
• Secondary: warm pendant light over dining table, concealed LED strips
• Color temperature ≈ 3 200 K, slight atmospheric haze for depth

ATMOSPHERE:
• Daytime, calm and lived-in — one coffee cup on table, folded throw on sofa, open book
• No people in frame, no clutter, no construction dust

NEGATIVE: no cartoonish style, no fish-eye, no nighttime, no over-saturated colors, no industrial/loft aesthetic, no watermarks.

OUTPUT: ultra-high-resolution photorealistic render, 16:10 aspect ratio, Architectural Digest / Elle Decor quality."""


@app.post("/visualize/interior-gallery", response_model=InteriorGalleryResponse)
def visualize_interior_gallery(req: InteriorGalleryRequest) -> InteriorGalleryResponse:
    """Несколько ракурсов по комнатам на уникальный тип квартиры (параллельно)."""
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    _validate_quality(req.quality)
    if not req.apt_types:
        raise HTTPException(status_code=400, detail="apt_types must not be empty")

    seen: set[str] = set()
    unique: list[AptTypeInput] = []
    for apt in req.apt_types:
        if apt.apt_type not in seen:
            seen.add(apt.apt_type)
            unique.append(apt)

    # Разворачиваем каждый тип в набор ракурсов по комнатам.
    jobs: list[tuple[AptTypeInput, str]] = [
        (apt, focus) for apt in unique for focus in _apt_room_foci(apt)
    ]

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, apt: AptTypeInput, focus: str) -> tuple[int, InteriorGalleryItem]:
        prompt = _build_apt_interior_prompt(apt, req.floors, req.purpose, room_focus=focus)
        enhanced, enhancer_src = enhance_prompt(prompt)
        result = generate_image_with_meta(enhanced, opts, use_cache=True)
        rf = _ROOM_FOCUS.get(focus, {})
        return idx, InteriorGalleryItem(
            apt_type=apt.apt_type,
            label=_APT_TYPE_RU.get(apt.apt_type, apt.apt_type),
            area=apt.area,
            count=apt.count,
            image_b64=_b64.b64encode(result.png).decode(),
            model_used=result.model_used,
            enhancer_used=enhancer_src,
            room_focus=focus,
            view_label=rf.get("label", focus),
        )

    t0 = time.time()
    ordered: list[InteriorGalleryItem | None] = [None] * len(jobs)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
            futures = {
                pool.submit(_one, i, apt, focus): i
                for i, (apt, focus) in enumerate(jobs)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception as exc:
                    last_exc = exc
    except MissingAPIKey as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = [it for it in ordered if it is not None]
    if not items:
        detail = f"All renders failed: {last_exc}" if last_exc else "No items generated"
        raise HTTPException(status_code=502, detail=detail)

    return InteriorGalleryResponse(
        items=items,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
    )


def _interior_edit_prompt(
    apt: AptTypeInput, floors: int, purpose: str, focus: str, source_prompt: str = "",
) -> str:
    """Интерьер через image-edit: top-down мебельный план как референс → перспектива."""
    base = _build_apt_interior_prompt(apt, floors, purpose, room_focus=focus)
    ctx = ""
    if source_prompt.strip():
        brief = source_prompt.strip().replace("\n", " ")[:400]
        ctx = f"\nReference-plan brief (same building): {brief}"
    return (
        "You are given a TOP-DOWN furnished floor plan of a residential building as a STYLE & LAYOUT "
        "REFERENCE ONLY. Produce a NEW photorealistic EYE-LEVEL INTERIOR photograph (perspective, camera "
        "at ~1.5 m height) of the apartment described below. Do NOT output a top-down or plan view — output "
        "a normal photo taken from inside the room. Match the furniture style, materials, colours and "
        "approximate room proportions implied by the reference plan."
        f"{ctx}\n\n{base}"
    )


@app.post("/visualize/interior-gallery-edit", response_model=InteriorGalleryResponse)
async def visualize_interior_gallery_edit(
    plan_image: UploadFile = File(...),
    req_json: str = Form(...),
    source_prompt: str = Form(""),
) -> InteriorGalleryResponse:
    """Интерьеры через image-edit: сид — мебельный план (top-down), выход — перспектива.

    Стиль/состав привязан к плану → «примерное» представление, согласованное с
    чертежом. Картинок: по комнатам на каждый уникальный тип квартиры (параллельно).
    """
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    image_bytes = await plan_image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty plan_image")
    try:
        req = InteriorGalleryRequest.model_validate_json(req_json)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"bad req_json: {e}")

    _validate_quality(req.quality)
    if not req.apt_types:
        raise HTTPException(status_code=400, detail="apt_types must not be empty")

    seen: set[str] = set()
    unique: list[AptTypeInput] = []
    for apt in req.apt_types:
        if apt.apt_type not in seen:
            seen.add(apt.apt_type)
            unique.append(apt)
    jobs: list[tuple[AptTypeInput, str]] = [
        (apt, focus) for apt in unique for focus in _apt_room_foci(apt)
    ]

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, apt: AptTypeInput, focus: str) -> tuple[int, InteriorGalleryItem]:
        prompt = _interior_edit_prompt(apt, req.floors, req.purpose, focus, source_prompt)
        enhanced, enhancer_src = enhance_prompt(prompt)
        result = generate_image_edit_with_meta(enhanced, image_bytes, opts)
        rf = _ROOM_FOCUS.get(focus, {})
        return idx, InteriorGalleryItem(
            apt_type=apt.apt_type,
            label=_APT_TYPE_RU.get(apt.apt_type, apt.apt_type),
            area=apt.area,
            count=apt.count,
            image_b64=_b64.b64encode(result.png).decode(),
            model_used=result.model_used,
            enhancer_used=enhancer_src,
            room_focus=focus,
            view_label=rf.get("label", focus),
        )

    t0 = time.time()
    ordered: list[InteriorGalleryItem | None] = [None] * len(jobs)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
            futures = {
                pool.submit(_one, i, apt, focus): i
                for i, (apt, focus) in enumerate(jobs)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item = fut.result()
                    ordered[idx] = item
                except (MissingAPIKey, OpenAIError):
                    raise
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
    except MissingAPIKey as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    items = [it for it in ordered if it is not None]
    if not items:
        detail = f"All renders failed: {last_exc}" if last_exc else "No items generated"
        raise HTTPException(status_code=502, detail=detail)

    return InteriorGalleryResponse(
        items=items,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
    )


# ---------------------------------------------------------------------------
# Vision-анализ контура / участка (Этап 2 ТЗ — «AI-анализ пространства»)
# ---------------------------------------------------------------------------


class ContourRecommendation(BaseModel):
    title: str
    detail: str
    priority: str       # high | medium | low
    tag: str            # geometry | insolation | access | fire | landscape | context


class ContourAnalysisResponse(BaseModel):
    """Ответ /analyze/contour — структурированный анализ изображения участка/контура."""
    shape_summary: str
    estimated_width_m: float | None = None
    estimated_depth_m: float | None = None
    estimated_orientation_deg: float | None = None
    context_features: list[str] = []
    suggested_purpose: str | None = None
    recommendations: list[ContourRecommendation] = []
    notes: str = ""
    confidence: str = "low"


@app.post("/analyze/contour", response_model=ContourAnalysisResponse)
async def analyze_contour_endpoint(file: UploadFile = File(...)) -> ContourAnalysisResponse:
    """Vision-анализ загруженного изображения участка / контура / эскиза.

    Принимает JPG / PNG / PDF, возвращает структурированный архитектурный
    разбор: форма, габариты, контекст, ранжированные рекомендации.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    from ..importers.contour import ContourAnalysisError, analyze_contour

    try:
        a = analyze_contour(image_bytes, mime=file.content_type)
    except ContourAnalysisError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return ContourAnalysisResponse(
        shape_summary=             a.shape_summary,
        estimated_width_m=         a.estimated_width_m,
        estimated_depth_m=         a.estimated_depth_m,
        estimated_orientation_deg= a.estimated_orientation_deg,
        context_features=          a.context_features,
        suggested_purpose=         a.suggested_purpose,
        recommendations=           [
            ContourRecommendation(**r.to_dict()) for r in a.recommendations
        ],
        notes=                     a.notes,
        confidence=                a.confidence,
    )


# ---------------------------------------------------------------------------
# Интерактивная корректировка чертежа: фото + текстовая инструкция
# (Этап 4 ТЗ — «Интерактивная корректировка проекта»)
# ---------------------------------------------------------------------------


def _wrap_edit_instruction(instruction: str) -> str:
    """Обернуть пользовательскую инструкцию в строгий архитектурный контекст,
    чтобы сохранить стиль исходного чертежа (CAD, без 3D и фотореализма).

    Юзер вводит «сделай гостиную больше» — мы добавляем границы:
    стиль, линии, кириллица, no photoreal, etc.
    """
    return f"""STRICT AutoCAD architectural floor plan, technical engineering drawing on white paper.
Pure CAD-grade vector line work: thin black ink lines on white, scale 1:100, top-down orthographic view ONLY.

PRESERVE everything about the input drawing — architectural style, line weights, hatching patterns,
color palette (very light pastel unit fills, dark grey hatching for bearing walls), typography,
dimension chains, axis grid, room labels, title block, north arrow.

ONLY APPLY THE FOLLOWING CHANGE (translate the user's intent into the drawing):

USER REQUEST: «{instruction.strip()}»

CONSTRAINTS:
• Output is the SAME architectural drawing with the requested change applied
• Walls, dimensions, room labels, and CAD aesthetics remain consistent with the original
• All Russian/Cyrillic labels stay Cyrillic — do not translate to English
• NO photorealistic textures, NO 3D, NO isometric, NO marketing aesthetics
• NO gradients, NO shadows, NO perspective, NO fish-eye
• Keep the same sheet format and orientation as the input

Produce a clean engineering drawing as if a chief architect updated one detail by hand.
"""


@app.post("/visualize/edit-instruction")
async def visualize_edit_instruction(
    image: UploadFile = File(...),
    instruction: str = Form(...),
    quality: str = Form("medium"),
) -> Response:
    """Image-edit с текстовой инструкцией пользователя.

    Вход: исходный AI-чертёж (PNG) + русская инструкция «сделай гостиную больше».
    Выход: новый PNG с применённой правкой.
    """
    _validate_quality(quality)

    if not instruction or not instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is required")
    if len(instruction) > 1000:
        raise HTTPException(status_code=400, detail="instruction is too long (≤ 1000 chars)")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    prompt = _wrap_edit_instruction(instruction)

    try:
        result = generate_image_edit_with_meta(
            prompt,
            image_bytes,
            GenerationOptions(quality=quality),  # type: ignore[arg-type]
        )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store",
            "X-Model-Used": result.model_used,
            "X-Edit-Instruction": instruction[:120],
            "Access-Control-Expose-Headers": "X-Model-Used, X-Edit-Instruction",
        },
    )


@app.post("/visualize/inpaint")
async def visualize_inpaint(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    instruction: str = Form(...),
    quality: str = Form("medium"),
) -> Response:
    """Inpainting: перерисовать только закрашенные маской области чертежа.

    mask — PNG с альфа-каналом: прозрачные пиксели = перерисовать, непрозрачные = оставить.
    Pillow ресайзит маску до размеров изображения перед отправкой в OpenAI.
    """
    _validate_quality(quality)

    if not instruction or not instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is required")
    if len(instruction) > 1000:
        raise HTTPException(status_code=400, detail="instruction is too long (≤ 1000 chars)")

    image_bytes = await image.read()
    mask_bytes = await mask.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")
    if not mask_bytes:
        raise HTTPException(status_code=400, detail="empty mask")

    # Ресайзим маску под размер изображения с помощью Pillow
    try:
        from PIL import Image as PILImage
        import io as _io
        with PILImage.open(_io.BytesIO(image_bytes)) as img:
            img_size = img.size  # (width, height)
        with PILImage.open(_io.BytesIO(mask_bytes)) as msk:
            if msk.size != img_size:
                msk = msk.resize(img_size, PILImage.Resampling.LANCZOS)
            if msk.mode != "RGBA":
                msk = msk.convert("RGBA")
            buf = _io.BytesIO()
            msk.save(buf, format="PNG")
            mask_bytes = buf.getvalue()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"mask processing error: {e}")

    prompt = _wrap_edit_instruction(instruction)

    try:
        result = generate_image_inpaint_with_meta(
            prompt,
            image_bytes,
            mask_bytes,
            GenerationOptions(quality=quality),  # type: ignore[arg-type]
        )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store",
            "X-Model-Used": result.model_used,
            "Access-Control-Expose-Headers": "X-Model-Used",
        },
    )


# ---------------------------------------------------------------------------
# CAD-импорт: DXF пользователя → summary/preview JSON
# ---------------------------------------------------------------------------


class DxfBoundsResponse(BaseModel):
    min_x: float
    min_y: float
    max_x: float
    max_y: float
    width: float
    height: float


class DxfLayerResponse(BaseModel):
    name: str
    entity_count: int
    color: int | None = None
    linetype: str | None = None
    is_off: bool = False
    is_frozen: bool = False


class DxfImportResponse(BaseModel):
    """Ответ /import/floorplan-dxf — metadata + упрощённый preview."""
    filename: str
    source_format: str = "dxf"
    converted_from: str | None = None
    converter: str | None = None
    dxf_version: str
    units: int | None = None
    units_name: str
    entity_count: int
    layer_count: int
    layers: list[DxfLayerResponse]
    entity_types: dict[str, int]
    bounds: DxfBoundsResponse | None = None
    preview_entities: list[dict[str, Any]]
    warnings: list[str]
    site_polygon: list[list[float]] | None = None


@app.post("/import/floorplan-dxf", response_model=DxfImportResponse)
async def import_floorplan_dxf(file: UploadFile = File(...)) -> DxfImportResponse:
    """Прочитать загруженный DXF и вернуть summary для P2 CAD-import MVP.

    На этом шаге не конвертируем CAD в semantic Project. Возвращаем то, что
    нужно фронту для первого "загрузил свой файл": слои, типы entities, bbox и
    лёгкий SVG-preview payload.
    """
    filename = file.filename or "upload.dxf"
    if not filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="only .dxf is supported")

    dxf_bytes = await file.read()
    if not dxf_bytes:
        raise HTTPException(status_code=400, detail="empty DXF")
    if len(dxf_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="DXF is too large for P2 MVP (max 25 MB)")

    from ..importers.dxf import DxfImportError, inspect_dxf

    try:
        summary = inspect_dxf(dxf_bytes, filename=filename)
    except DxfImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return DxfImportResponse(**summary.to_dict(), source_format="dxf")


@app.post("/import/floorplan-dwg", response_model=DxfImportResponse)
async def import_floorplan_dwg(file: UploadFile = File(...)) -> DxfImportResponse:
    """Конвертировать DWG в DXF и вернуть тот же summary/preview, что у DXF import."""
    filename = file.filename or "upload.dwg"
    if not filename.lower().endswith(".dwg"):
        raise HTTPException(status_code=400, detail="only .dwg is supported")

    dwg_bytes = await file.read()
    if not dwg_bytes:
        raise HTTPException(status_code=400, detail="empty DWG")
    if len(dwg_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="DWG is too large for P2 MVP (max 50 MB)")

    from ..importers.dwg import DwgConversionError, dwg_to_dxf
    from ..importers.dxf import DxfImportError, inspect_dxf

    try:
        converted = dwg_to_dxf(dwg_bytes, filename=filename)
        summary = inspect_dxf(
            converted.dxf_bytes,
            filename=f"{filename.rsplit('.', 1)[0]}.dxf",
        )
    except DwgConversionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except DxfImportError as e:
        raise HTTPException(status_code=400, detail=f"converted DXF is not readable: {e}")

    return DxfImportResponse(
        **summary.to_dict(),
        source_format="dwg",
        converted_from=filename,
        converter=converted.converter,
    )


# ---------------------------------------------------------------------------
# ГПЗУ-импорт через OpenAI Vision
# ---------------------------------------------------------------------------


class GpzuImportResponse(BaseModel):
    """Ответ /import/gpzu — извлечённые поля из ГПЗУ-PDF."""
    site_area_m2: float | None = None
    site_width_m: float | None = None
    site_depth_m: float | None = None
    setback_front_m: float | None = None
    setback_side_m: float | None = None
    setback_rear_m: float | None = None
    max_height_m: float | None = None
    max_floors: int | None = None
    max_coverage_pct: float | None = None
    max_far: float | None = None
    purpose_allowed: list[str] = []
    notes: str = ""
    confidence: str = "low"


@app.post("/import/gpzu", response_model=GpzuImportResponse)
async def import_gpzu(file: UploadFile = File(...)) -> GpzuImportResponse:
    """Распознать ГПЗУ-PDF через OpenAI Vision и вернуть извлечённые поля."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only .pdf is supported")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="empty PDF")

    from ..importers.gpzu import GpzuParseError, extract_gpzu

    try:
        ext = extract_gpzu(pdf_bytes)
    except GpzuParseError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return GpzuImportResponse(
        site_area_m2=ext.site_area_m2,
        site_width_m=ext.site_width_m,
        site_depth_m=ext.site_depth_m,
        setback_front_m=ext.setback_front_m,
        setback_side_m=ext.setback_side_m,
        setback_rear_m=ext.setback_rear_m,
        max_height_m=ext.max_height_m,
        max_floors=ext.max_floors,
        max_coverage_pct=ext.max_coverage_pct,
        max_far=ext.max_far,
        purpose_allowed=ext.purpose_allowed,
        notes=ext.notes,
        confidence=ext.confidence,
    )


# ---------------------------------------------------------------------------
# Валидация проекта по KZ-нормам и ГПЗУ
# Закрывает ТЗ-пункт 2.2 «Проверка архитектурных ограничений и нормативов»
# ---------------------------------------------------------------------------


class ProjectValidationViolation(BaseModel):
    """Одно зафиксированное нарушение / предупреждение."""
    rule: str
    severity: str           # "error" | "warning" | "info"
    message: str
    norm: str = ""
    actual: float | None = None
    expected: float | None = None
    target: str = ""


class ProjectValidationSummary(BaseModel):
    """Геометрические метрики проекта, посчитанные через shapely."""
    site_area_m2: float
    total_footprint_m2: float
    coverage_pct: float
    buildings_count: int


class ProjectValidationResponse(BaseModel):
    """Ответ /validate/project — сводка + список нарушений."""
    summary: ProjectValidationSummary
    violations: list[ProjectValidationViolation]
    errors_count: int
    warnings_count: int
    infos_count: int


class ValidateProjectRequest(VisualizeFromInputsRequest):
    """Расширение для /validate/project: опциональная AI-планировка.

    Если layout передан (правки редактора) — валидаторы работают на РЕАЛЬНОЙ
    геометрии комнат через layout_to_project; без него — прежний путь
    marketing_to_project (floors=[], комнатные проверки молчат). Совместимо
    со старыми клиентами, которые layout не шлют (precedent: ExportIfcRequest).
    """
    layout: LayoutFloor | None = None


@app.post("/validate/project", response_model=ProjectValidationResponse)
def validate_project_endpoint(
    req: ValidateProjectRequest,
) -> ProjectValidationResponse:
    """Прогнать форму через доменную модель и KZ-валидаторы.

    Возвращает геометрическую сводку (site_area, footprint, coverage) +
    список нарушений с разбивкой по severity. Базируется на:
        • shapely 2.x для real-area расчётов
        • research/kz-norms/ для ссылок на СН/СП РК
        • ГПЗУ-параметрах формы (max_coverage_pct, max_height_m, ...)

    Если в запросе есть layout — комнатные валидаторы работают на реальной
    геометрии; иначе прежний путь без вложенной геометрии квартир.
    """
    from ..domain import layout_to_project, marketing_to_project
    from ..validators import validate_project

    inputs = _inputs_from_req(req)
    if req.layout is not None:
        project = layout_to_project(req.layout, inputs)
    else:
        project = marketing_to_project(inputs)
    violations = validate_project(project)

    summary = ProjectValidationSummary(
        site_area_m2=round(project.site_area_m2, 1),
        total_footprint_m2=round(project.total_footprint_m2, 1),
        coverage_pct=project.coverage_pct,
        buildings_count=len(project.buildings),
    )

    items = [
        ProjectValidationViolation(
            rule=v.rule,
            severity=v.severity,
            message=v.message,
            norm=v.norm,
            actual=v.actual,
            expected=v.expected,
            target=v.target,
        )
        for v in violations
    ]
    return ProjectValidationResponse(
        summary=summary,
        violations=items,
        errors_count=sum(1 for v in violations if v.severity == "error"),
        warnings_count=sum(1 for v in violations if v.severity == "warning"),
        infos_count=sum(1 for v in violations if v.severity == "info"),
    )


# ---------------------------------------------------------------------------
# Валидация инсоляции (нормы освещения)  КМК 2.04.01-2017 / СанПиН РК
# ---------------------------------------------------------------------------


class FacadeInsolationItem(BaseModel):
    name: str
    azimuth_deg: float
    hours: float
    required: float
    compliant: bool


class InsolationValidationResponse(BaseModel):
    latitude: float
    building_azimuth: float
    required_hours: float
    lat_zone: str
    facades: list[FacadeInsolationItem]
    compliant: bool


@app.post("/validate/insolation", response_model=InsolationValidationResponse)
def validate_insolation_endpoint(
    latitude: float = Query(43.3, ge=-90.0, le=90.0, description="Широта объекта (°N)"),
    building_azimuth: float = Query(0.0, ge=0.0, lt=360.0, description="Азимут северного фасада от Севера (°)"),
) -> InsolationValidationResponse:
    """Расчёт инсоляции четырёх фасадов здания на 22 марта.

    Нормативный минимум определяется широтой (КМК 2.04.01-2017):
    - φ < 48°: 2.0 ч (южная зона — Алматы, Шымкент)
    - 48–58°:  2.5 ч (центральная — Астана, Актобе)
    - φ ≥ 58°: 3.0 ч (северная)
    """
    from ..validators.insolation import check_insolation

    report = check_insolation(latitude=latitude, building_azimuth=building_azimuth)
    return InsolationValidationResponse(
        latitude=report.latitude,
        building_azimuth=report.building_azimuth,
        required_hours=report.required_hours,
        lat_zone=report.lat_zone,
        facades=[
            FacadeInsolationItem(
                name=f.name,
                azimuth_deg=f.azimuth_deg,
                hours=f.hours,
                required=f.required,
                compliant=f.compliant,
            )
            for f in report.facades
        ],
        compliant=report.compliant,
    )


# ---------------------------------------------------------------------------
# CAD-экспорт (DXF) — параллельный пайплайн рядом с AI-чертежами
# Закрывает ТЗ-пункты 2.4, 2.6, 2.8, 5.2, 5.7
# ---------------------------------------------------------------------------


class FloorPlanMetricsResponse(BaseModel):
    """Реальные метрики, посчитанные из геометрии (не из промпта)."""
    total_floor_area_m2: float
    apartments_count: int
    avg_apartment_area_m2: float
    sections_count: int
    units_per_section: int
    living_area_estimate_m2: float
    efficiency_pct: float


@app.post("/generate/floor-layout")
def generate_floor_layout_endpoint(req: VisualizeFromInputsRequest) -> LayoutFloor:
    """Сгенерировать структурированную планировку этажа (параметрически + AI).

    Возвращает LayoutFloor JSON с точными координатами секций, ядер, коридоров
    и комнат каждой квартиры. Используется фронтендом перед скачиванием IFC/DXF
    чтобы передать реальную геометрию в экспортный эндпоинт.
    """
    from ..visualizer.layout_generator import generate_floor_layout
    inputs = _inputs_from_req(req)
    try:
        return generate_floor_layout(inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layout generation failed: {e}")


# ---------------------------------------------------------------------------
# Архитектурные чертежи: свободное ТЗ → структурированный план этажа
# Этап 1 фичи «мини-CAD на платформе».
# ---------------------------------------------------------------------------


class BriefRequest(BaseModel):
    brief: str


class BriefLayoutResponse(BaseModel):
    layout: LayoutFloor
    inputs: VisualizeFromInputsRequest
    used_defaults: list[str]
    notes: str


class EnhanceBriefResponse(BaseModel):
    enhanced_brief: str


class AlbumRequest(BaseModel):
    brief: str


class AlbumResponse(BaseModel):
    album: "LayoutAlbumOut"
    inputs: VisualizeFromInputsRequest
    used_defaults: list[str]
    notes: str


class LayoutAlbumOut(BaseModel):
    """Pydantic-обёртка LayoutAlbum для FastAPI (имя без префикса)."""
    project_name: str
    layout: LayoutFloor
    floors_total: int
    sheets: list[dict]   # AlbumSheet — простой dict для гибкости JSON


def _build_album_sheets(layout: LayoutFloor, floors_total: int) -> list[dict]:
    """Сборка списка листов для MVP Sprint 1.

    Фиксированный набор: титул + общие данные + плановые листы по этажам +
    три таблицы (экспликация / двери / окна).
    """
    sheets: list[dict] = [
        {"kind": "title",         "title": "Титульный лист"},
        {"kind": "general_data",  "title": "Общие данные"},
    ]
    # План на каждый этаж (для MVP — все этажи рисуются одинаковым layout,
    # как «план типового этажа»). Подвал и кровля придут в Sprint 2.
    for fl in range(1, max(1, floors_total) + 1):
        sheets.append({
            "kind": "floor_plan",
            "title": f"План {fl}-го этажа",
            "floor_number": fl,
        })
    # Таблицы
    sheets.extend([
        {"kind": "room_explication", "title": "Экспликация помещений"},
        {"kind": "doors_spec",       "title": "Спецификация дверных блоков"},
        {"kind": "windows_spec",     "title": "Спецификация оконных блоков"},
    ])
    return sheets


@app.post("/generate/album-from-brief", response_model=AlbumResponse)
def generate_album_from_brief_endpoint(req: AlbumRequest) -> AlbumResponse:
    """Свободное ТЗ → альбом чертежей (MVP: 5-9 листов).

    Обёртка над /generate/layout-from-brief: парсит ТЗ через GPT, строит
    layout, и собирает фиксированный набор листов:
      • Титул
      • Общие данные (таблица параметров)
      • План каждого этажа
      • Экспликация помещений
      • Спецификация дверей
      • Спецификация окон

    Sprint 2 добавит: подвал, кровлю, разрезы, фасады.
    Sprint 3 добавит: hero-render, мастерплан.
    """
    if not req.brief or not req.brief.strip():
        raise HTTPException(status_code=400, detail="brief is empty")

    from ..visualizer.brief_parser import BriefParseError, parse_brief
    from ..visualizer.layout_generator import generate_floor_layout

    try:
        derived = parse_brief(req.brief)
    except BriefParseError as e:
        raise HTTPException(status_code=502, detail=str(e))

    inputs_req, used_defaults = _request_from_brief_inputs(derived)
    _validate_layout_feasibility(inputs_req)

    marketing_inputs = _inputs_from_req(inputs_req)
    try:
        layout = generate_floor_layout(marketing_inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layout generation failed: {e}")

    floors_total = max(1, inputs_req.floors)
    sheets = _build_album_sheets(layout, floors_total)
    project_name = f"ЖК {floors_total}эт {layout.width_m:.0f}×{layout.depth_m:.0f}"

    album = LayoutAlbumOut(
        project_name=project_name,
        layout=layout,
        floors_total=floors_total,
        sheets=sheets,
    )

    return AlbumResponse(
        album=album,
        inputs=inputs_req,
        used_defaults=used_defaults,
        notes=derived.notes,
    )


class AlbumImage(BaseModel):
    """Один сгенерированный лист альбома: PNG из gpt-image + метаданные."""
    kind: str
    title: str
    label: str
    image_b64: str
    model_used: str
    extra: dict[str, Any] = {}


class AlbumImagesResponse(BaseModel):
    """Ответ /generate/album-images — все сгенерированные листы + meta."""
    images: list[AlbumImage]
    project_name: str
    elapsed_ms: float
    failed_count: int = 0


@app.post("/generate/album-images", response_model=AlbumImagesResponse)
def generate_album_images_endpoint(req: VisualizeFromInputsRequest) -> AlbumImagesResponse:
    """Сгенерировать полный gpt-image альбом по параметрам формы.

    Пайплайн (Sprint 1a — 8 базовых типов листов):
      1. Из VisualizeFromInputsRequest строим MarketingInputs.
      2. Из MarketingInputs строим базовые params (build_base_params).
      3. Определяем список листов исходя из параметров (этажность,
         количество секций — влияет на сколько планов этажей).
      4. Для каждого листа: подставляем params в template, отправляем
         в gpt-image-1. Пул 5 параллельных.
      5. Возвращаем массив PNG + метаданных.

    На MVP 8 типов: title, general_data, basement_plan, floor_plan (×N),
    roof_plan, section (×2), facade (×4), windows_spec, doors_spec.
    Для 4-этажного дома получится ~13-15 листов.

    Sprint 1b добавит остальные 22 типа (узлы, эвакуация, интерьеры,
    hero-render, мастерплан).
    """
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
    from ..visualizer.album_prompts import (
        SHEET_KIND_BASEMENT_PLAN, SHEET_KIND_DOORS_SPEC, SHEET_KIND_FACADE,
        SHEET_KIND_FLOOR_PLAN, SHEET_KIND_GENERAL_DATA, SHEET_KIND_ROOF_PLAN,
        SHEET_KIND_SECTION, SHEET_KIND_TITLE, SHEET_KIND_WINDOWS_SPEC,
        build_base_params, get_album_sheet_spec, render_album_sheet,
    )

    _validate_quality(req.quality)
    _validate_layout_feasibility(req)
    inputs = _inputs_from_req(req)

    base_params = build_base_params(inputs)
    project_name = base_params["project_name"]

    # ── Сборка списка задач ──────────────────────────────────────────
    tasks: list[tuple[str, str, dict[str, Any]]] = []
    # (kind, title, extra_params)
    tasks.append((SHEET_KIND_TITLE, "Титульный лист", {}))
    tasks.append((SHEET_KIND_GENERAL_DATA, "Общие данные", {}))
    tasks.append((SHEET_KIND_BASEMENT_PLAN, "План подвала", {}))
    for fl in range(1, max(1, inputs.floors) + 1):
        level_desc = (
            "Ground floor with main entrance lobby" if fl == 1 else
            "Top floor (penthouse level)" if fl >= inputs.floors else
            "Typical floor layout"
        )
        tasks.append((
            SHEET_KIND_FLOOR_PLAN,
            f"План {fl}-го этажа",
            {"floor_number": fl, "level_description": level_desc},
        ))
    tasks.append((SHEET_KIND_ROOF_PLAN, "План кровли", {}))
    # 2 разреза (1-1 продольный, 2-2 поперечный)
    tasks.append((
        SHEET_KIND_SECTION, "Разрез 1-1",
        {"section_label": "1-1", "section_axis_description": "Продольный разрез по длинной стороне здания"},
    ))
    tasks.append((
        SHEET_KIND_SECTION, "Разрез 2-2",
        {"section_label": "2-2", "section_axis_description": "Поперечный разрез по короткой стороне здания"},
    ))
    # 4 фасада
    facade_sides = [
        ("S", "Главный фасад (юг)", "Южный фасад — главная фронтальная сторона"),
        ("N", "Дворовый фасад (север)", "Северный фасад — сторона двора"),
        ("E", "Боковой фасад (восток)", "Восточный торец здания"),
        ("W", "Боковой фасад (запад)", "Западный торец здания"),
    ]
    for side, facade_title, side_desc in facade_sides:
        tasks.append((
            SHEET_KIND_FACADE, facade_title,
            {
                "facade_title": facade_title,
                "facade_side_description": side_desc,
                "facade_length_m": int(inputs.site_width_m) if side in ("S", "N") else int(inputs.site_depth_m),
                "window_width": 1500,
                "balcony_description": "Балконы с остеклением" if side in ("E", "W") else "Лоджии в каждой квартире",
                "entrance_description": "Главный вход с навесом spider-system" if side == "S" else "Аварийные выходы",
            },
        ))
    # 2 спецификации
    tasks.append((SHEET_KIND_WINDOWS_SPEC, "Спецификация оконных блоков", {}))
    tasks.append((SHEET_KIND_DOORS_SPEC, "Спецификация дверных блоков", {}))

    # ── Параллельная генерация ────────────────────────────────────────
    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]
    t0 = time.time()
    results: list[AlbumImage | None] = [None] * len(tasks)
    failed_count = 0
    errors: list[str] = []  # реальные сообщения провайдеров — для дебага

    def _one(idx: int, kind: str, title: str, extras: dict[str, Any]) -> tuple[int, AlbumImage | None, str | None]:
        spec = get_album_sheet_spec(kind)
        if spec is None:
            return idx, None, f"[{kind}] нет spec"
        params = {**base_params, **extras}
        prompt = render_album_sheet(spec, params)
        try:
            res = generate_image_with_meta(prompt, opts, use_cache=False)
            return idx, AlbumImage(
                kind=kind, title=title, label=spec.label,
                image_b64=_b64.b64encode(res.png).decode(),
                model_used=res.model_used,
                extra=extras,
            ), None
        except MissingAPIKey:
            raise
        except OpenAIError as e:
            return idx, None, f"[{kind}] {e}"
        except Exception as e:
            return idx, None, f"[{kind}] {type(e).__name__}: {e}"

    # max_workers=3 — компромисс между скоростью и rate-limit провайдера.
    # OOM на 4GB VPS при 14 параллельных base64 PNG ~30-60MB суммарно.
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(_one, i, kind, title, extras): i
                for i, (kind, title, extras) in enumerate(tasks)
            }
            for fut in _as_completed(futures):
                try:
                    idx, item, err = fut.result()
                    if item is None:
                        failed_count += 1
                        if err:
                            errors.append(err)
                    else:
                        results[idx] = item
                except MissingAPIKey:
                    raise
                except Exception as e:
                    failed_count += 1
                    errors.append(f"executor: {type(e).__name__}: {e}")
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))

    images = [r for r in results if r is not None]
    if not images:
        # Логируем все ошибки в stdout (Render/docker logs), а в UI отдаём
        # первую — обычно она же причина для всех 14 листов.
        import logging
        for err in errors:
            logging.warning("album generation failed: %s", err)
        first = errors[0] if errors else "unknown"
        raise HTTPException(
            status_code=502,
            detail=f"Все листы не сгенерированы. Первая ошибка: {first}",
        )

    return AlbumImagesResponse(
        images=images,
        project_name=project_name,
        elapsed_ms=round((time.time() - t0) * 1000, 1),
        failed_count=failed_count,
    )


@app.post("/generate/album-from-inputs", response_model=AlbumResponse)
def generate_album_from_inputs_endpoint(req: VisualizeFromInputsRequest) -> AlbumResponse:
    """Альбом из готовой формы (PromptForm), без GPT-парсинга текста.

    Используется когда параметры уже структурированы (вкладка AI Чертежи).
    Возвращает тот же AlbumResponse что и /album-from-brief.
    """
    from ..visualizer.layout_generator import generate_floor_layout

    _validate_layout_feasibility(req)
    marketing_inputs = _inputs_from_req(req)
    try:
        layout = generate_floor_layout(marketing_inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layout generation failed: {e}")

    floors_total = max(1, req.floors)
    sheets = _build_album_sheets(layout, floors_total)
    project_name = f"ЖК {floors_total}эт {layout.width_m:.0f}×{layout.depth_m:.0f}"

    return AlbumResponse(
        album=LayoutAlbumOut(
            project_name=project_name,
            layout=layout,
            floors_total=floors_total,
            sheets=sheets,
        ),
        inputs=req,
        used_defaults=[],
        notes="",
    )


class ChatEditRequest(BaseModel):
    layout: LayoutFloor
    message: str


class ChatEditResponse(BaseModel):
    layout: LayoutFloor


@app.post("/edit/layout-with-chat", response_model=ChatEditResponse)
def edit_layout_with_chat_endpoint(req: ChatEditRequest) -> ChatEditResponse:
    """Применить пользовательскую правку к layout через GPT-4 в чат-режиме.

    Юзер пишет «увеличь спальню на 2 м» → GPT возвращает обновлённый
    LayoutFloor. Геометрия секций/коридоров/ядер сохраняется.
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    from ..visualizer.layout_chat_editor import LayoutChatError, edit_layout_with_chat

    try:
        new_layout = edit_layout_with_chat(req.layout, req.message)
    except LayoutChatError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return ChatEditResponse(layout=new_layout)


@app.post("/enhance/brief", response_model=EnhanceBriefResponse)
def enhance_brief_endpoint(req: BriefRequest) -> EnhanceBriefResponse:
    """Улучшить ТЗ через GPT-архитектора (отступы, микс, лифты, нормы).

    Возвращает переписанный текст — фронт подставит его в textarea.
    """
    if not req.brief or not req.brief.strip():
        raise HTTPException(status_code=400, detail="brief is empty")

    from ..visualizer.brief_enhancer import BriefEnhanceError, enhance_brief

    try:
        improved = enhance_brief(req.brief)
    except BriefEnhanceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return EnhanceBriefResponse(enhanced_brief=improved)


def _request_from_brief_inputs(b: Any) -> tuple[VisualizeFromInputsRequest, list[str]]:
    """Заполнить VisualizeFromInputsRequest из BriefDerivedInputs + дефолты.

    Возвращает (request, used_defaults) — список полей, для которых
    GPT не нашёл значение в ТЗ и мы подставили дефолт.

    Логика по габаритам:
      1. Если GPT извлёк building_width_m / building_depth_m — это пятно
         застройки. Берём отступы (из ТЗ или дефолты) и считаем
         site = building + 2*setback. Footprint получится ровно тот, что
         просил юзер.
      2. Иначе если GPT извлёк site_*_m — берём как есть.
      3. Иначе дефолт 24×14 м (с отступами 3 м даёт 18×8 — рабочее
         секционное здание средней этажности).
    """
    used: list[str] = []

    def _or(value: Any, default: Any, name: str) -> Any:
        if value is None:
            used.append(name)
            return default
        return value

    purpose_raw = b.purpose
    try:
        purpose = BuildingPurpose(purpose_raw) if purpose_raw else BuildingPurpose.RESIDENTIAL
    except ValueError:
        purpose = BuildingPurpose.RESIDENTIAL
        used.append("purpose")
    if purpose_raw is None:
        used.append("purpose")

    # building_type: GPT обязан вернуть, но добавляем sane fallback.
    bt_raw = getattr(b, "building_type", None)
    if bt_raw in ("single_family", "multi_family", "commercial", "mixed"):
        building_type = bt_raw
    else:
        # Эвристика: ≤2 этажа + площадь застройки < 300 м² → частный дом
        floors_v = b.floors or 4
        bw = b.building_width_m
        bd = b.building_depth_m
        area = (bw or 0) * (bd or 0)
        if floors_v <= 2 and 0 < area < 300:
            building_type = "single_family"
        else:
            building_type = "multi_family"
        used.append("building_type")

    # Если GPT не дал процентного микса вообще — ставим разумный по умолчанию
    # (25/40/25/10/0 = студии/1к/2к/3к/4к). Если дал хотя бы одно — уважаем выбор.
    k4_in = getattr(b, "k4_pct", None)
    mix_given = any(v is not None for v in (b.studio_pct, b.k1_pct, b.k2_pct, b.k3_pct, k4_in))
    if not mix_given:
        used.extend(["studio_pct", "k1_pct", "k2_pct", "k3_pct", "k4_pct"])
        studio_pct, k1_pct, k2_pct, k3_pct, k4_pct = 25.0, 40.0, 25.0, 10.0, 0.0
    else:
        studio_pct = b.studio_pct or 0.0
        k1_pct     = b.k1_pct     or 0.0
        k2_pct     = b.k2_pct     or 0.0
        k3_pct     = b.k3_pct     or 0.0
        k4_pct     = k4_in        or 0.0

    setback_front = _or(b.setback_front_m, 3.0, "setback_front_m")
    setback_side  = _or(b.setback_side_m,  3.0, "setback_side_m")
    setback_rear  = _or(b.setback_rear_m,  3.0, "setback_rear_m")

    # Резолвинг габаритов: building + setbacks → site, либо прямо site
    if b.building_width_m is not None or b.building_depth_m is not None:
        bw = b.building_width_m if b.building_width_m is not None else 24.0
        bd = b.building_depth_m if b.building_depth_m is not None else 14.0
        if b.building_width_m is None:
            used.append("building_width_m")
        if b.building_depth_m is None:
            used.append("building_depth_m")
        site_w = bw + 2 * setback_side
        site_d = bd + setback_front + setback_rear
    else:
        site_w = _or(b.site_width_m, 24.0 + 2 * setback_side,                 "site_width_m")
        site_d = _or(b.site_depth_m, 14.0 + setback_front + setback_rear,     "site_depth_m")

    # Для single_family жёстко зануляем подъездные параметры — даже если
    # GPT ошибся и поставил >0 лифтов или >1 секции.
    if building_type == "single_family":
        lifts_p = 0
        lifts_f = 0
        n_sections = 1
    else:
        lifts_p = _or(b.lifts_passenger, 1, "lifts_passenger")
        lifts_f = _or(b.lifts_freight,   0, "lifts_freight")
        n_sections = _or(b.sections,     1, "sections")

    return VisualizeFromInputsRequest(
        site_width_m=    site_w,
        site_depth_m=    site_d,
        setback_front_m= setback_front,
        setback_side_m=  setback_side,
        setback_rear_m=  setback_rear,
        floors=          _or(b.floors,          4,    "floors"),
        purpose=         purpose,
        building_type=   building_type,
        sections=        n_sections,
        studio_pct=      studio_pct,
        k1_pct=          k1_pct,
        k2_pct=          k2_pct,
        k3_pct=          k3_pct,
        k4_pct=          k4_pct,
        lifts_passenger= lifts_p,
        lifts_freight=   lifts_f,
        max_height_m=    _or(b.max_height_m,    30.0, "max_height_m"),
        bedrooms=        _or(getattr(b, "bedrooms",  None), 2,     "bedrooms"),
        bathrooms=       _or(getattr(b, "bathrooms", None), 1,     "bathrooms"),
        has_garage=      _or(getattr(b, "has_garage", None), False, "has_garage"),
        floor_typology=  _or(getattr(b, "floor_typology", None), "symmetric", "floor_typology"),
    ), used


def _validate_layout_feasibility(req: VisualizeFromInputsRequest) -> None:
    """Sanity-check: достаточно ли места внутри отступов для нормального плана.

    Два режима:
      depth >= 12 м → секционный (квартиры с двух сторон коридора)
      depth >= 7 м  → галерейный (квартиры только с одной стороны)
      depth < 7 м   → 400, слишком узко даже для галереи.

    Алгоритм сам выбирает режим по глубине; здесь только грубая защита.
    """
    inner_w = req.site_width_m - 2 * req.setback_side_m
    inner_d = req.site_depth_m - req.setback_front_m - req.setback_rear_m

    if inner_w < 8:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Внутренняя ширина {inner_w:.1f} м < 8 м — слишком тесно "
                f"даже для одной квартиры. Увеличь site_width_m или уменьши "
                f"setback_side_m."
            ),
        )
    if inner_d < 7:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Внутренняя глубина {inner_d:.1f} м < 7 м — недостаточно даже "
                f"для галерейного корпуса (коридор 1.4 + квартиры 4.0 + стены 0.8). "
                f"Увеличь site_depth_m или уменьши setback_front_m + setback_rear_m."
            ),
        )
    if inner_w * inner_d < 70:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Полезная площадь этажа {inner_w * inner_d:.0f} м² < 70 м² — "
                f"мало для жилой секции. Уточни габариты здания."
            ),
        )


@app.post("/generate/layout-from-brief", response_model=BriefLayoutResponse)
def generate_layout_from_brief_endpoint(req: BriefRequest) -> BriefLayoutResponse:
    """Свободное ТЗ → GPT-4 → MarketingInputs → детерминированный layout.

    Возвращает layout + восстановленный VisualizeFromInputsRequest
    (фронт хранит его для последующих /export/floorplan-dxf, /visualize/sheet
    и т.д.) + список полей, заполненных дефолтами.
    """
    if not req.brief or not req.brief.strip():
        raise HTTPException(status_code=400, detail="brief is empty")

    from ..visualizer.brief_parser import BriefParseError, parse_brief
    from ..visualizer.layout_generator import generate_floor_layout

    try:
        derived = parse_brief(req.brief)
    except BriefParseError as e:
        raise HTTPException(status_code=502, detail=str(e))

    inputs_req, used_defaults = _request_from_brief_inputs(derived)

    # Sanity-check: не пускаем явно вырожденную геометрию в генератор
    _validate_layout_feasibility(inputs_req)

    marketing_inputs = _inputs_from_req(inputs_req)

    try:
        layout = generate_floor_layout(marketing_inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layout generation failed: {e}")

    return BriefLayoutResponse(
        layout=layout,
        inputs=inputs_req,
        used_defaults=used_defaults,
        notes=derived.notes,
    )


@app.post("/export/floorplan-dxf")
def export_floorplan_dxf(req: VisualizeFromInputsRequest) -> Response:
    """Сгенерировать DXF плана типового этажа (для AutoCAD/ArchiCAD/Revit).

    В отличие от /visualize/floor-variants (картинка от gpt-image), здесь
    создаётся РЕАЛЬНАЯ геометрия с точными координатами, слоями
    (СТЕНЫ_НЕСУЩИЕ, ПРОТИВОПОЖАРНЫЕ, ЛИФТЫ_ЛЕСТНИЦЫ, ОСИ, РАЗМЕРЫ и т.д.),
    размерными цепочками и штампом.

    Архитектор открывает результат в AutoCAD и сразу работает.
    """
    inputs = _inputs_from_req(req)
    try:
        dxf_bytes = build_floorplan_dxf(inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DXF build failed: {e}")

    metrics = compute_floorplan_metrics(inputs)
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={
            "Content-Disposition": "attachment; filename=plana-floorplan.dxf",
            "X-Apartments-Count": str(metrics.apartments_count),
            "X-Floor-Area": f"{metrics.total_floor_area_m2}",
            "X-Living-Area": f"{metrics.living_area_estimate_m2}",
            "X-Efficiency-Pct": f"{metrics.efficiency_pct}",
            "X-Sections": str(metrics.sections_count),
            "Access-Control-Expose-Headers":
                "X-Apartments-Count, X-Floor-Area, X-Living-Area, "
                "X-Efficiency-Pct, X-Sections",
        },
    )


@app.post("/export/floorplan-ifc")
def export_floorplan_ifc(req: ExportIfcRequest) -> Response:
    """Сгенерировать IFC4 плана этажа (для Revit / ArchiCAD / BIMcollab).

    Если в запросе передан layout (из /generate/floor-layout), используется
    build_ifc_from_layout() — каждая комната становится отдельным IfcSpace
    с реальными координатами. Без layout — параметрическая модель (fallback).
    """
    from ..domain import marketing_to_project

    inputs = _inputs_from_req(req)
    project = marketing_to_project(inputs)

    if req.layout is not None:
        try:
            ifc_bytes = build_ifc_from_layout(req.layout, n_floors=inputs.floors)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"IFC from layout failed: {e}")
    else:
        try:
            ifc_bytes = build_floorplan_ifc(project)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"IFC build failed: {e}")

    return Response(
        content=ifc_bytes,
        media_type="application/x-step",  # формально STEP-based; some viewers ждут "application/ifc"
        headers={
            "Content-Disposition": "attachment; filename=plana-floorplan.ifc",
            "X-Buildings-Count": str(len(project.buildings)),
            "X-Site-Area": f"{project.site_area_m2:.1f}",
            "X-Footprint-Area": f"{project.total_footprint_m2:.1f}",
            "X-Coverage-Pct": f"{project.coverage_pct}",
            "Access-Control-Expose-Headers":
                "X-Buildings-Count, X-Site-Area, X-Footprint-Area, X-Coverage-Pct",
        },
    )


# ---------------------------------------------------------------------------
# Стоимость (Высота-1: укрупнённая расчётная стоимость стадии посадки)
# ---------------------------------------------------------------------------


class AggregateCostRequest(BaseModel):
    """Вход для /cost/aggregate.

    Либо задаётся gfa_m2 напрямую, либо передаётся layout (+n_floors) — тогда
    GFA выводится как площадь контура этажа × число этажей.
    """
    gfa_m2: float | None = None
    region: str = "default"
    building_type: str = "residential"
    n_floors: int = 1
    layout: LayoutFloor | None = None
    config: CostBuildupConfig | None = None


@app.post("/cost/aggregate", response_model=AggregateCostEstimate)
def cost_aggregate(req: AggregateCostRequest) -> AggregateCostEstimate:
    """Укрупнённая РАСЧЁТНАЯ стоимость стадии посадки (НДЦС РК 8.01-08 п.6.3).

    Возвращает диапазон (AACE Class 5) и прозрачный Сводный-сметный-расчёт-стек.
    Это индикатор go/no-go, НЕ сметная стоимость и НЕ сертифицированная смета
    (см. поля is_certified_smeta / disclaimer / warnings в ответе).
    """
    gfa = req.gfa_m2
    if gfa is None:
        if req.layout is None:
            raise HTTPException(
                status_code=422, detail="Нужен gfa_m2 либо layout для расчёта GFA",
            )
        lay = req.layout
        if lay.outline and len(lay.outline) >= 3:
            from shapely.geometry import Polygon as _ShPoly
            footprint = float(
                _ShPoly([(float(x), float(y)) for x, y in lay.outline]).area
            )
        else:
            footprint = float(lay.width_m) * float(lay.depth_m)
        gfa = footprint * max(1, req.n_floors)

    if gfa <= 0:
        raise HTTPException(status_code=422, detail="GFA должна быть > 0")

    return estimate_aggregate_cost(
        gfa_m2=gfa,
        region=req.region,
        building_type=req.building_type,
        config=req.config,
    )


@app.post("/cost/extract-inputs", response_model=CostInputExtractionResponse)
def cost_extract_inputs(req: CostInputExtractionRequest) -> CostInputExtractionResponse:
    """Extract cost-placement inputs from a free-form brief via OpenAI.

    The model only returns structured assumptions. It does not calculate cost
    totals; deterministic cost formulas remain the only source of totals.
    """
    try:
        return extract_cost_inputs_from_brief(req.brief)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/cost/analyze-site-image", response_model=SiteImageRiskAnalysisResponse)
async def cost_analyze_site_image(site_image: UploadFile = File(...)) -> SiteImageRiskAnalysisResponse:
    """Analyze a site photo for non-authoritative visual risk flags.

    Vision output only suggests risks. It does not calculate costs and must be
    confirmed by the user before affecting the deterministic cost model.
    """
    image_bytes = await site_image.read()
    try:
        return analyze_site_image_risks(image_bytes, content_type=site_image.content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/cost/explain-snapshot", response_model=CostAnalystExplanationResponse)
def cost_explain_snapshot(req: CostAnalystExplanationRequest) -> CostAnalystExplanationResponse:
    """Explain a deterministic Class 5 cost snapshot via OpenAI.

    The model only writes analyst commentary. It does not calculate or override
    the cost totals.
    """
    try:
        return explain_cost_snapshot(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Квартирография + ТЭП
# ---------------------------------------------------------------------------

# Нормативные площади типов (м²) — ГОСТ 51929-2002 / СНиП РК 3.02-43-2007
_APT_AREAS: dict[str, tuple[float, float, str]] = {
    # Values: (total_m2, living_m2, label)
    "studio": (30.0, 16.0, "Студия"),
    "k1":     (45.0, 18.0, "1-комн."),
    "k2":     (65.0, 36.0, "2-комн."),
    "k3":     (90.0, 54.0, "3-комн."),
}

# Рыночные нормы КЗ: доля типа в общем количестве квартир (%, min–max)
_MARKET_NORMS: dict[str, tuple[float, float]] = {
    "studio": (5.0,  15.0),
    "k1":     (25.0, 40.0),
    "k2":     (30.0, 45.0),
    "k3":     (10.0, 25.0),
}


class AptTypeRow(BaseModel):
    type_code: str
    label: str
    pct_input: float        # введённый % из формы
    count_per_floor: int
    total_count: int        # × этажи
    area_m2: float          # нормативная площадь 1 квартиры
    living_m2: float        # жилая площадь 1 квартиры
    total_area_m2: float    # total_count × area_m2
    total_living_m2: float  # total_count × living_m2
    share_pct: float        # фактический % от всех квартир
    norm_min: float
    norm_max: float
    norm_ok: bool


class TepSummary(BaseModel):
    total_floors: int
    total_apartments: int
    total_floor_area_m2: float      # W × H × floors
    total_apt_area_m2: float        # сумма площадей всех квартир
    total_living_area_m2: float     # только жилые комнаты
    efficiency_pct: float           # apt_area / floor_area × 100
    avg_apt_area_m2: float
    apt_per_1000m2: float           # насыщенность (рыночный показатель)


class KvartirografiyaResponse(BaseModel):
    rows: list[AptTypeRow]
    tep: TepSummary
    recommendations: list[str]


@app.post("/analytics/kvartirografiya", response_model=KvartirografiyaResponse)
def analytics_kvartirografiya(req: VisualizeFromInputsRequest) -> KvartirografiyaResponse:
    """Квартирография + ТЭП здания.

    Рассчитывает полную поквартирную сводку по типам (студия/1К/2К/3К),
    ТЭП на всё здание и рекомендации по оптимизации микса под рынок РК.
    """
    inputs = _inputs_from_req(req)
    floors  = max(1, inputs.floors)
    floor_area = inputs.site_width_m * inputs.site_depth_m

    # Считаем n_floor через РЕАЛЬНЫЙ генератор, чтобы analytics совпадал
    # с тем что юзер видит на чертеже. Раньше использовали грубую формулу
    # FloorPlanDxfBuilder._approx_unit_count = floor_area * 0.55 / avg_apt
    # — но она давала систематически меньше чем реальный _pack_side
    # (например, для 29×14 формула 3 vs реальный layout 5).
    try:
        from ..visualizer.layout_generator import generate_floor_layout
        _layout = generate_floor_layout(inputs)
        n_floor = sum(len(s.apartments) for s in _layout.sections)
        n_floor = max(1, n_floor)
    except Exception:
        # Fallback на старую формулу если генератор упал
        builder = FloorPlanDxfBuilder(inputs)
        n_floor = builder._approx_unit_count()

    # Нормируем проценты ввода
    pct_map = {
        "studio": inputs.studio_pct,
        "k1":     inputs.k1_pct,
        "k2":     inputs.k2_pct,
        "k3":     inputs.k3_pct,
    }
    total_pct = sum(pct_map.values())
    if total_pct < 0.01:
        pct_map = {"studio": 10, "k1": 30, "k2": 40, "k3": 20}
        total_pct = 100.0

    rows: list[AptTypeRow] = []
    total_count = 0
    total_apt_area = 0.0
    total_living_area = 0.0

    for code, (area, living, label) in _APT_AREAS.items():
        frac = pct_map.get(code, 0.0) / total_pct
        count_per_floor = max(0, round(n_floor * frac))
        total = count_per_floor * floors
        norm_min, norm_max = _MARKET_NORMS[code]
        actual_share = frac * 100

        rows.append(AptTypeRow(
            type_code=code,
            label=label,
            pct_input=round(pct_map.get(code, 0.0), 1),
            count_per_floor=count_per_floor,
            total_count=total,
            area_m2=area,
            living_m2=living,
            total_area_m2=round(total * area, 1),
            total_living_m2=round(total * living, 1),
            share_pct=round(actual_share, 1),
            norm_min=norm_min,
            norm_max=norm_max,
            norm_ok=(norm_min <= actual_share <= norm_max),
        ))
        total_count += total
        total_apt_area += total * area
        total_living_area += total * living

    total_floor_area = floor_area * floors
    efficiency = round(total_apt_area / total_floor_area * 100, 1) if total_floor_area > 0 else 0.0
    avg_area = round(total_apt_area / total_count, 1) if total_count > 0 else 0.0
    density = round(total_count / total_floor_area * 1000, 1) if total_floor_area > 0 else 0.0

    tep = TepSummary(
        total_floors=floors,
        total_apartments=total_count,
        total_floor_area_m2=round(total_floor_area, 1),
        total_apt_area_m2=round(total_apt_area, 1),
        total_living_area_m2=round(total_living_area, 1),
        efficiency_pct=efficiency,
        avg_apt_area_m2=avg_area,
        apt_per_1000m2=density,
    )

    # Рекомендации
    recs: list[str] = []
    for row in rows:
        if not row.norm_ok and row.pct_input > 0.01:
            if row.share_pct < row.norm_min:
                recs.append(
                    f"{row.label}: доля {row.share_pct:.0f}% ниже рыночной нормы "
                    f"({row.norm_min:.0f}–{row.norm_max:.0f}%). Рекомендуется увеличить."
                )
            elif row.share_pct > row.norm_max:
                recs.append(
                    f"{row.label}: доля {row.share_pct:.0f}% выше нормы "
                    f"({row.norm_min:.0f}–{row.norm_max:.0f}%). Рекомендуется снизить."
                )
    if efficiency < 55:
        recs.append(
            f"Эффективность {efficiency}% ниже рекомендуемого минимума 55%. "
            "Проверьте отступы или увеличьте секционность."
        )
    if density > 20:
        recs.append(
            f"Насыщенность {density} кв./1000 м² — возможно завышена. "
            "Среднее по РК: 12–18 кв./1000 м²."
        )

    return KvartirografiyaResponse(rows=rows, tep=tep, recommendations=recs)


@app.post("/export/floorplan-metrics", response_model=FloorPlanMetricsResponse)
def export_floorplan_metrics(req: VisualizeFromInputsRequest) -> FloorPlanMetricsResponse:
    """Только метрики (без генерации DXF) — быстрый расчёт по параметрам.

    Полезно для preview прямо в форме: пока юзер крутит слайдеры —
    видит сколько будет квартир, какая К_efficiency, сколько живой площади.
    """
    inputs = _inputs_from_req(req)
    m = compute_floorplan_metrics(inputs)
    return FloorPlanMetricsResponse(
        total_floor_area_m2=m.total_floor_area_m2,
        apartments_count=m.apartments_count,
        avg_apartment_area_m2=m.avg_apartment_area_m2,
        sections_count=m.sections_count,
        units_per_section=m.units_per_section,
        living_area_estimate_m2=m.living_area_estimate_m2,
        efficiency_pct=m.efficiency_pct,
    )


# ---------------------------------------------------------------------------
# PDF Визуализация (фича «загрузил альбом → получил красивый рендер»)
#
# Три эндпоинта работают вместе:
#   GET  /sheet-types         — справочник типов листов для UI
#   POST /pdf/render-pages    — PDF → массив превью-страниц (JPEG base64)
#   POST /visualize/sheet     — sheet_type → gpt-image (режим A, text-to-image)
# ---------------------------------------------------------------------------


class SheetTypeOut(BaseModel):
    key: str
    label: str
    aspect: str


class SheetTypesResponse(BaseModel):
    types: list[SheetTypeOut]


@app.get("/sheet-types", response_model=SheetTypesResponse)
def get_sheet_types() -> SheetTypesResponse:
    """Список доступных типов архитектурных листов для PDF-визуализации."""
    from ..visualizer.sheet_prompts import list_sheet_types
    return SheetTypesResponse(
        types=[
            SheetTypeOut(key=t.key, label=t.label, aspect=t.aspect)
            for t in list_sheet_types()
        ],
    )


class PdfPagePreview(BaseModel):
    index: int            # 0-based
    jpeg_b64: str         # data: безпрефиксный base64
    width: int
    height: int


class PdfRenderPagesResponse(BaseModel):
    pages: list[PdfPagePreview]
    truncated: bool       # True если в PDF было больше страниц, чем мы отрендерили


_PDF_RENDER_PAGE_LIMIT = 64    # защита от 200-страничных PDF


@app.post("/pdf/render-pages", response_model=PdfRenderPagesResponse)
async def pdf_render_pages(
    file: UploadFile = File(...),
    dpi: int = Form(110),
) -> PdfRenderPagesResponse:
    """Отрендерить страницы загруженного PDF в JPEG-превью.

    DPI 110 даёт ~1280px по длинной стороне для A4 — достаточно для UI-карточки
    и для последующей классификации/анализа через Vision.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only .pdf is supported")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="empty PDF")

    if dpi < 50 or dpi > 300:
        raise HTTPException(status_code=400, detail="dpi must be 50..300")

    # Считаем сначала общее число страниц — чтобы корректно вернуть truncated
    try:
        import pypdfium2 as pdfium  # type: ignore[import-untyped]
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"pypdfium2 missing: {e}")

    import base64 as _b64
    import io as _io

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF parse error: {e}")

    try:
        total_pages = len(pdf)
        n = min(total_pages, _PDF_RENDER_PAGE_LIMIT)
        scale = dpi / 72.0
        pages_out: list[PdfPagePreview] = []
        for i in range(n):
            page = pdf[i]
            try:
                bitmap = page.render(scale=scale, rotation=0)
                try:
                    pil = bitmap.to_pil().convert("RGB")
                    buf = _io.BytesIO()
                    pil.save(buf, format="JPEG", quality=82, optimize=True)
                    pages_out.append(PdfPagePreview(
                        index=i,
                        jpeg_b64=_b64.b64encode(buf.getvalue()).decode("ascii"),
                        width=pil.width,
                        height=pil.height,
                    ))
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        pdf.close()

    return PdfRenderPagesResponse(
        pages=pages_out,
        truncated=total_pages > _PDF_RENDER_PAGE_LIMIT,
    )


class VisualizeSheetRequest(BaseModel):
    sheet_type: str               # ключ из /sheet-types
    quality: str = "medium"       # low | medium | high
    hint: str = ""                # опциональная пользовательская заметка
    mode: str = "A"               # "A" — text-to-image по типу
                                  # "B" — image-to-image edit с самой страницей как референсом
                                  # "C" — Vision-extract контекста → инжект в промпт → text-to-image
    page_jpeg_b64: str = ""       # обязательно для режимов B/C (base64 без data:-префикса)


@app.post("/visualize/sheet")
def visualize_sheet(req: VisualizeSheetRequest) -> Response:
    """Сгенерировать рендер для одной страницы PDF-альбома.

    Режимы:
      A — text-to-image по фиксированному шаблону из ``sheet_prompts.py``
          (быстро, дёшево, никак не связано с самим чертежом юзера)
      B — gpt-image edit: страница идёт как референс + промпт
          (сохраняет композицию, но текст и мелкие детали плывут)
      C — Vision-extract: gpt-4.1 читает страницу, возвращает 3–5 предложений
          с реальными параметрами здания, они добавляются в промпт →
          text-to-image. Результат соответствует исходному чертежу.
    """
    _validate_quality(req.quality)
    mode = (req.mode or "A").upper()
    if mode not in ("A", "B", "C"):
        raise HTTPException(status_code=400, detail="mode must be A, B or C")

    from ..visualizer.sheet_prompts import get_sheet_template

    tpl = get_sheet_template(req.sheet_type)
    prompt = tpl.prompt
    hint = (req.hint or "").strip()
    if hint:
        prompt = f"{prompt}\n\nUser hint: {hint}"

    # Декодируем страницу один раз — нужна и для B, и для C
    page_bytes: bytes = b""
    if mode in ("B", "C"):
        if not req.page_jpeg_b64:
            raise HTTPException(
                status_code=400,
                detail=f"mode {mode} requires page_jpeg_b64",
            )
        import base64 as _b64
        try:
            page_bytes = _b64.b64decode(req.page_jpeg_b64)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"bad page_jpeg_b64: {e}")
        if not page_bytes:
            raise HTTPException(status_code=400, detail="page_jpeg_b64 is empty")

    context_used = ""    # для X-Sheet-Context header (отладка)

    # Режим C — Vision-extract до основной генерации
    if mode == "C":
        from ..visualizer.sheet_vision import extract_sheet_context
        context_used = extract_sheet_context(page_bytes)
        if context_used:
            prompt = f"{prompt}\n\nReal building context from source sheet: {context_used}"

    try:
        if mode == "B":
            result = generate_image_edit_with_meta(
                prompt,
                page_bytes,
                GenerationOptions(quality=req.quality),  # type: ignore[arg-type]
            )
        else:
            # A и C — text-to-image (разница только в промпте)
            result = generate_image_with_meta(
                prompt,
                GenerationOptions(quality=req.quality),  # type: ignore[arg-type]
            )
    except MissingAPIKey as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # HTTP-заголовки должны быть latin-1; русский label сюда класть нельзя —
    # фронт берёт его из /sheet-types по ключу X-Sheet-Type.
    headers = {
        "Cache-Control": "public, max-age=86400",
        "X-Model-Used": result.model_used,
        "X-Sheet-Type": tpl.key,
        "X-Sheet-Mode": mode,
        "Access-Control-Expose-Headers":
            "X-Model-Used, X-Sheet-Type, X-Sheet-Mode, X-Sheet-Context",
    }
    if context_used:
        # ASCII-safe: вырезаем переносы и режем длину для заголовка
        safe_ctx = " ".join(context_used.split())[:512]
        try:
            safe_ctx.encode("latin-1")
            headers["X-Sheet-Context"] = safe_ctx
        except UnicodeEncodeError:
            # context может содержать не-ASCII — не пихаем в header
            pass

    return Response(
        content=result.png,
        media_type="image/png",
        headers=headers,
    )


class ClassifySheetRequest(BaseModel):
    page_jpeg_b64: str


class ClassifySheetResponse(BaseModel):
    sheet_type: str
    confidence: str


@app.post("/pdf/classify-page", response_model=ClassifySheetResponse)
def classify_pdf_page(req: ClassifySheetRequest) -> ClassifySheetResponse:
    """Vision-классификация одной страницы PDF — определить тип листа."""
    if not req.page_jpeg_b64:
        raise HTTPException(status_code=400, detail="page_jpeg_b64 is required")
    import base64 as _b64
    try:
        page_bytes = _b64.b64decode(req.page_jpeg_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"bad page_jpeg_b64: {e}")

    from ..visualizer.sheet_vision import SheetVisionError, classify_sheet
    try:
        cls = classify_sheet(page_bytes)
    except SheetVisionError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return ClassifySheetResponse(
        sheet_type=cls.sheet_type,
        confidence=cls.confidence,
    )
