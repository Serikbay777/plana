"""FastAPI-приложение `plana-engine`.

Эндпоинты:
- `GET  /health`         — статус сервиса
- `GET  /presets`        — список 5 целевых функций
- `GET  /catalog`        — каталог тайлов (12 шт.)
- `POST /generate`       — generate from explicit `GenerateRequest`
- `POST /generate/rect`  — generate from rect dims (удобный вход для UI)
- `POST /generate/dxf`   — generate from uploaded DXF file
"""

from __future__ import annotations

import uuid
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import Response

from .. import __version__
from ..algo import generate_all_variants
from ..catalog import get_catalog
from ..exporters import build_delivery_package, dxf_bytes
from ..norms import get_norms, reload_norms
from ..parser import parse_dxf, parse_rect
from ..presets import PRESET_DESCRIPTIONS, PRESET_LABELS
from ..types import (
    BuildingPurpose, GenerateRequest, GenerateResponse, PresetKey, TargetMix,
)
from ..visualizer import (
    GenerationOptions, MarketingInputs, build_exterior_prompt,
    build_floorplan_furniture_prompt, build_interior_prompt,
    build_marketing_prompt, build_prompt, build_site_placement_prompt,
    enhance_prompt, generate_image, has_llm_key,
)
from ..visualizer.openai_client import (
    MissingAPIKey, OpenAIError, has_api_key, generate_image_edit_with_meta,
    generate_image_with_meta,
)
from pydantic import BaseModel

from .schemas import (
    CatalogResponse, GenerateAPIResponse, GenerateRectRequest, HealthResponse,
    PresetMeta, PresetsResponse, TileSpecMeta,
)


# In-memory cache последних сгенерированных response для экспорта.
# Для прода надо заменить на Redis / Postgres (этап 3 ТЗ).
_RESPONSE_CACHE: dict[str, tuple[GenerateRequest, GenerateResponse]] = {}
_CACHE_LIMIT = 64


def _cache_response(rid: str, req: GenerateRequest, resp: GenerateResponse) -> None:
    """Положить ответ в кэш для последующего экспорта по `request_id`."""
    if len(_RESPONSE_CACHE) >= _CACHE_LIMIT:
        _RESPONSE_CACHE.pop(next(iter(_RESPONSE_CACHE)))
    _RESPONSE_CACHE[rid] = (req, resp)


app = FastAPI(
    title="Plana Engine API",
    version=__version__,
    description="Алгоритмическое ядро генерации планировок (Plana).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Здоровье / справочники
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    norms = get_norms()
    cat = get_catalog()
    return HealthResponse(
        status="ok",
        version=__version__,
        norms_version=norms.version,
        catalog_size=len(cat),
    )


@app.get("/presets", response_model=PresetsResponse)
def list_presets() -> PresetsResponse:
    return PresetsResponse(
        presets=[
            PresetMeta(
                key=k,
                label=PRESET_LABELS[k],
                description=PRESET_DESCRIPTIONS[k],
            )
            for k in PresetKey
        ]
    )


@app.get("/catalog", response_model=CatalogResponse)
def list_catalog() -> CatalogResponse:
    cat = get_catalog()
    return CatalogResponse(
        version="0.1.0",
        tiles=[
            TileSpecMeta(
                code=t.code,
                apt_type=t.apt_type,
                label=t.label,
                area=t.area,
                width=t.width,
                depth=t.depth,
            )
            for t in cat
        ],
    )


@app.post("/admin/reload-norms", response_model=HealthResponse)
def admin_reload_norms() -> HealthResponse:
    """Сбросить кэш `norms.yaml` и перечитать.
    Удобно при правке файла норм без перезапуска сервиса.
    """
    reload_norms()
    return health()


# ---------------------------------------------------------------------------
# Генерация
# ---------------------------------------------------------------------------


@app.post("/generate", response_model=GenerateAPIResponse)
def generate(request: GenerateRequest) -> GenerateAPIResponse:
    """Сгенерировать 5 вариантов планировки этажа.

    Принимает явный `floor_polygon` или `source_file_id` (последнее — TODO,
    после интеграции файлового хранилища).
    """
    if request.source_file_id is not None:
        raise HTTPException(
            status_code=501,
            detail="source_file_id not yet wired to file storage; use /generate/dxf",
        )
    plans, elapsed = generate_all_variants(request)
    return GenerateAPIResponse(
        request_id=uuid.uuid4().hex,
        variants=plans,
        elapsed_ms=elapsed,
    )


@app.post("/generate/rect", response_model=GenerateAPIResponse)
def generate_rect(req: GenerateRectRequest) -> GenerateAPIResponse:
    """Удобный вход для UI: контур = прямоугольник за вычетом отступов ГПЗУ."""
    inner_w = req.site_width_m - req.setback_side_m * 2
    inner_h = req.site_depth_m - req.setback_front_m - req.setback_rear_m
    if inner_w <= 0 or inner_h <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"effective contour {inner_w}×{inner_h} m is non-positive after setbacks",
        )
    contour = parse_rect(inner_w, inner_h)
    gen_req = GenerateRequest(
        floor_polygon=contour,
        purpose=req.purpose,
        floors=req.floors,
        target_mix=req.target_mix,
    )
    plans, elapsed = generate_all_variants(gen_req)
    rid = uuid.uuid4().hex
    resp = GenerateAPIResponse(request_id=rid, variants=plans, elapsed_ms=elapsed)
    _cache_response(rid, gen_req, resp)
    return resp


@app.get("/visualize/{request_id}/{preset}.png")
def visualize(request_id: str, preset: PresetKey, quality: str = "medium") -> Response:
    """Сгенерировать marketing-визуализацию плана через gpt-image-1.

    Параметры:
        request_id: id из предыдущего /generate
        preset: какой из 5 вариантов рисуем
        quality: low | medium | high (стоимость $0.04 / $0.07 / $0.17)

    Возвращает PNG. Кэшируется по prompt hash, повторные запросы — мгновенно.
    """
    cached = _RESPONSE_CACHE.get(request_id)
    if not cached:
        raise HTTPException(status_code=404, detail="request_id not found")
    _, resp = cached
    plan = next((p for p in resp.variants if p.preset == preset), None)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"preset {preset.value} not found")

    if quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")

    prompt = build_prompt(plan)
    try:
        result = generate_image_with_meta(
            prompt,
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
            "Access-Control-Expose-Headers": "X-Model-Used",
        },
    )


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
    # квартирография
    studio_pct: float = 0.0
    k1_pct: float = 0.0
    k2_pct: float = 0.0
    k3_pct: float = 0.0
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
    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0
    # рендер
    quality: str = "medium"


@app.post("/visualize/from-inputs")
def visualize_from_inputs(req: VisualizeFromInputsRequest) -> Response:
    """Сгенерировать marketing-визуализацию ИЗ ФОРМЕННЫХ ВХОДНЫХ ДАННЫХ
    (без предварительного /generate). Это «АХУЕЛИ»-режим для demo: юзер
    меняет ползунки → жмёт кнопку → получает красивый рендер за 15–30 сек.

    Картинка кэшируется по hash параметров — повторный запрос мгновенно.
    """
    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")

    inputs = MarketingInputs(
        site_width_m=req.site_width_m,
        site_depth_m=req.site_depth_m,
        setback_front_m=req.setback_front_m,
        setback_side_m=req.setback_side_m,
        setback_rear_m=req.setback_rear_m,
        floors=req.floors,
        purpose=req.purpose.value,
        studio_pct=req.studio_pct,
        k1_pct=req.k1_pct,
        k2_pct=req.k2_pct,
        k3_pct=req.k3_pct,
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
    )
    base_prompt = build_marketing_prompt(inputs)

    # ENHANCE через Gemma 4 (если LLM_API_KEY задан)
    enhanced_prompt, enhancer_source = enhance_prompt(base_prompt)

    try:
        result = generate_image_with_meta(
            enhanced_prompt,
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


def _inputs_from_req(req: VisualizeFromInputsRequest) -> MarketingInputs:
    return MarketingInputs(
        site_width_m=req.site_width_m,
        site_depth_m=req.site_depth_m,
        setback_front_m=req.setback_front_m,
        setback_side_m=req.setback_side_m,
        setback_rear_m=req.setback_rear_m,
        floors=req.floors,
        purpose=req.purpose.value,
        studio_pct=req.studio_pct,
        k1_pct=req.k1_pct,
        k2_pct=req.k2_pct,
        k3_pct=req.k3_pct,
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
    )


def _run_text_to_image(prompt: str, quality: str) -> Response:
    enhanced, enhancer_source = enhance_prompt(prompt)
    try:
        result = generate_image_with_meta(
            enhanced,
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


@app.post("/visualize/exterior")
def visualize_exterior(req: VisualizeFromInputsRequest) -> Response:
    """Внешний вид ЖК — 3/4 перспектива здания в окружении."""
    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")
    inputs = _inputs_from_req(req)
    prompt = build_exterior_prompt(inputs)
    return _run_text_to_image(prompt, req.quality)


@app.post("/visualize/floorplan-furniture")
def visualize_floorplan_furniture(req: VisualizeFromInputsRequest) -> Response:
    """Pinterest-grade top-down планировка с мебелью (для брошюр)."""
    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")
    inputs = _inputs_from_req(req)
    prompt = build_floorplan_furniture_prompt(inputs)
    return _run_text_to_image(prompt, req.quality)


@app.post("/visualize/interior")
def visualize_interior(req: VisualizeFromInputsRequest) -> Response:
    """Интерьер одной комнаты — для самой крупной типологии."""
    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")
    inputs = _inputs_from_req(req)
    prompt = build_interior_prompt(inputs)
    return _run_text_to_image(prompt, req.quality)


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
    if quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")

    image_bytes = await site_image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    # Если передано фото здания — компонуем с аэрофото участка
    if building_image is not None:
        bld_bytes = await building_image.read()
        if bld_bytes:
            try:
                image_bytes = _composite_images(image_bytes, bld_bytes)
            except Exception:
                pass  # если не получилось — используем только участок

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


@app.post("/visualize/from-inputs/prompt")
def visualize_from_inputs_prompt(req: VisualizeFromInputsRequest) -> dict:
    """Просто вернуть готовый промпт без вызова OpenAI — для отладки."""
    inputs = MarketingInputs(
        site_width_m=req.site_width_m,
        site_depth_m=req.site_depth_m,
        setback_front_m=req.setback_front_m,
        setback_side_m=req.setback_side_m,
        setback_rear_m=req.setback_rear_m,
        floors=req.floors,
        purpose=req.purpose.value,
        studio_pct=req.studio_pct,
        k1_pct=req.k1_pct,
        k2_pct=req.k2_pct,
        k3_pct=req.k3_pct,
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
    )
    base = build_marketing_prompt(inputs)
    enhanced, source = enhance_prompt(base)
    return {
        "prompt": base,
        "enhanced_prompt": enhanced if source != "fallback" else None,
        "enhancer_source": source,
        "has_api_key": has_api_key(),
        "has_llm_key": has_llm_key(),
    }


@app.get("/visualize/{request_id}/{preset}/prompt")
def visualize_prompt(request_id: str, preset: PresetKey) -> dict:
    """Вернуть готовый prompt без вызова OpenAI — для отладки и для UI,
    чтобы пользователь мог посмотреть/отредактировать перед генерацией."""
    cached = _RESPONSE_CACHE.get(request_id)
    if not cached:
        raise HTTPException(status_code=404, detail="request_id not found")
    _, resp = cached
    plan = next((p for p in resp.variants if p.preset == preset), None)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"preset {preset.value} not found")
    return {"prompt": build_prompt(plan), "has_api_key": has_api_key()}


@app.get("/export/{request_id}/{preset}.dxf")
def export_dxf(request_id: str, preset: PresetKey) -> Response:
    """Скачать один DXF по `request_id` + preset key. Cache-only, без БД."""
    cached = _RESPONSE_CACHE.get(request_id)
    if not cached:
        raise HTTPException(status_code=404, detail="request_id not found in cache")
    _, resp = cached
    plan = next((p for p in resp.variants if p.preset == preset), None)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"preset {preset.value} not in this response")
    return Response(
        content=dxf_bytes(plan),
        media_type="application/dxf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="plana-{preset.value}.dxf"'
            ),
        },
    )


@app.get("/export/{request_id}/package.zip")
def export_package(request_id: str) -> Response:
    """Скачать ZIP-пакет сдачи: 5 DXF + норм-отчёт + метрики + входные параметры
    (см. `exporters/package.py`).
    """
    cached = _RESPONSE_CACHE.get(request_id)
    if not cached:
        raise HTTPException(status_code=404, detail="request_id not found in cache")
    req, resp = cached
    payload = build_delivery_package(resp, req)
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="plana-{request_id[:8]}.zip"'
            ),
        },
    )


# ---------------------------------------------------------------------------
# Размещение ЖК на участке: 2 фото → 3 варианта посадки
# ---------------------------------------------------------------------------

# 3 стратегии размещения здания на участке
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


def _composite_images(site_bytes: bytes, building_bytes: bytes) -> bytes:
    """Компонует аэрофото участка (слева 65%) + фото ЖК (справа 35%) в одно изображение.

    Это нужно потому что gpt-image edit принимает ОДИН файл.
    Мы показываем модели оба референса в одном кадре.
    """
    from PIL import Image, ImageDraw, ImageFont
    import io as _io

    TARGET_W, TARGET_H = 1536, 1024
    SITE_W = int(TARGET_W * 0.65)
    BLD_W  = TARGET_W - SITE_W

    # --- Участок (слева) ---
    site_img = Image.open(_io.BytesIO(site_bytes)).convert("RGB")
    # Масштабируем по высоте, потом кропаем по ширине
    scale = TARGET_H / site_img.height
    site_resized = site_img.resize(
        (max(1, int(site_img.width * scale)), TARGET_H), Image.LANCZOS
    )
    if site_resized.width >= SITE_W:
        ox = (site_resized.width - SITE_W) // 2
        site_cropped = site_resized.crop((ox, 0, ox + SITE_W, TARGET_H))
    else:
        site_cropped = Image.new("RGB", (SITE_W, TARGET_H), (20, 20, 30))
        site_cropped.paste(site_resized, (0, 0))

    # --- ЖК (справа) ---
    bld_img = Image.open(_io.BytesIO(building_bytes)).convert("RGB")
    scale_b = BLD_W / bld_img.width
    bld_h = int(bld_img.height * scale_b)
    bld_resized = bld_img.resize((BLD_W, max(1, bld_h)), Image.LANCZOS)
    bld_panel = Image.new("RGB", (BLD_W, TARGET_H), (15, 15, 20))
    bld_y = (TARGET_H - min(bld_h, TARGET_H)) // 2
    bld_panel.paste(bld_resized.crop((0, 0, BLD_W, min(bld_h, TARGET_H))), (0, bld_y))

    # --- Компонуем ---
    composite = Image.new("RGB", (TARGET_W, TARGET_H), (10, 10, 15))
    composite.paste(site_cropped, (0, 0))

    # Разделитель
    draw = ImageDraw.Draw(composite)
    draw.rectangle([SITE_W - 2, 0, SITE_W + 2, TARGET_H], fill=(80, 80, 100))
    composite.paste(bld_panel, (SITE_W, 0))

    # Подписи
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
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
    """Разместить ЖК на участке: аэрофото участка + фото ЖК → 3 варианта посадки.

    Pipeline:
    1. Компонуем оба изображения в одно (участок слева, ЖК справа)
    2. Создаём 3 промпта с разными стратегиями размещения
    3. Запускаем gpt-image-edit 3 раза параллельно
    4. Возвращаем JSON с 3 × base64 PNG
    """
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    if quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")

    site_bytes = await site_image.read()
    bld_bytes  = await building_image.read()
    if not site_bytes or not bld_bytes:
        raise HTTPException(status_code=400, detail="both images are required")

    # Компонуем в одно изображение
    try:
        composite_bytes = _composite_images(site_bytes, bld_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"image processing failed: {e}")

    # Базовый контекст участка
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
    import json as _json
    return Response(
        content=_json.dumps({"variants": results, "elapsed_ms": elapsed}),
        media_type="application/json",
        headers={"Access-Control-Expose-Headers": "*"},
    )


# ---------------------------------------------------------------------------
# 5 AI-чертежей планировки параллельно (gpt-image)
# ---------------------------------------------------------------------------

# 5 вариантов оптимизации — добавляются суффиксом к базовому промпту
_FLOOR_VARIANTS = [
    {
        "key": "max_useful_area",
        "label": "Макс. жилая площадь",
        "suffix": (
            "\n\n═══ ВАРИАНТ ОПТИМИЗАЦИИ: МАКСИМАЛЬНАЯ ЖИЛАЯ ПЛОЩАДЬ ═══\n"
            "Компактное инженерное ядро (≤15% площади этажа). Минимальная ширина коридора 1.4 м. "
            "Квартиры пронизывают всю глубину здания. Меньше, но крупнее квартир. "
            "Несущих стен минимум — стараемся поставить только торцевые и стену ядра."
        ),
    },
    {
        "key": "max_apt_count",
        "label": "Макс. кол-во квартир",
        "suffix": (
            "\n\n═══ ВАРИАНТ ОПТИМИЗАЦИИ: МАКСИМУМ КВАРТИР ═══\n"
            "Цель — максимум единиц жилья. Преимущественно студии (25–32 м²) и однокомнатные (38–48 м²). "
            "Центральный двусторонний коридор. 8–12 квартир на этаже в этом пятне. "
            "Лифтовое ядро компактное, секции короткие."
        ),
    },
    {
        "key": "balanced_mix",
        "label": "Классическая секция",
        "suffix": (
            "\n\n═══ ВАРИАНТ ОПТИМИЗАЦИИ: КЛАССИЧЕСКАЯ ЖИЛАЯ СЕКЦИЯ ═══\n"
            "Советский/российский жилой микс — 20% студий, 30% однокомнатных, "
            "35% двухкомнатных, 15% трёхкомнатных. Стандартная секция с двусторонним коридором. "
            "Планировочные решения по СНиП. Традиционная российская жилая типология."
        ),
    },
    {
        "key": "max_insolation",
        "label": "Инсоляция (юг)",
        "suffix": (
            "\n\n═══ ВАРИАНТ ОПТИМИЗАЦИИ: МАКСИМАЛЬНАЯ ИНСОЛЯЦИЯ ═══\n"
            "Все жилые комнаты и спальни ориентированы НА ЮГ (нижняя сторона листа = ЮГ). "
            "Технические помещения (ванная, кухня, прихожая) — на север. "
            "Широкий южный фасад с крупным остеклением. "
            "Добавить на план стрелку ориентации «☀ ЮГ». "
            "Квартиры вытянуты в направлении С-Ю."
        ),
    },
    {
        "key": "open_plan",
        "label": "Евроформат",
        "suffix": (
            "\n\n═══ ВАРИАНТ ОПТИМИЗАЦИИ: ЕВРОФОРМАТ / OPEN PLAN ═══\n"
            "Европейские квартиры с открытой планировкой. "
            "Кухня-гостиная ≥ 22 м² как единое социальное пространство. "
            "3–5 просторных премиальных квартир на этаже. "
            "Спальня-мастер ≥ 18 м², ванная ≥ 6 м². "
            "Панорамное остекление южного фасада. Минимум несущих перегородок."
        ),
    },
]


class FloorVariantItem(BaseModel):
    key: str
    label: str
    model_used: str
    enhancer_used: str
    image_b64: str


class FloorVariantsResponse(BaseModel):
    variants: list[FloorVariantItem]
    elapsed_ms: float


@app.post("/visualize/floor-variants", response_model=FloorVariantsResponse)
def visualize_floor_variants(req: VisualizeFromInputsRequest) -> FloorVariantsResponse:
    """Сгенерировать 5 PNG-вариантов архитектурной планировки через gpt-image.

    Pipeline:
    1. MarketingInputs из параметров формы
    2. Базовый промпт через build_marketing_prompt
    3. Один вызов Gemma 4 (enhance_prompt) — результат переиспользуется для всех 5
    4. Суффикс-оптимизация × 5 вариантов
    5. ThreadPoolExecutor × 5 параллельных вызовов generate_image_with_meta
    6. JSON: {variants: [{key, label, model_used, enhancer_used, image_b64}], elapsed_ms}
    """
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")

    inputs = _inputs_from_req(req)
    base_prompt = build_marketing_prompt(inputs)

    # Один вызов Gemma — результат переиспользуем для всех вариантов
    enhanced_base, enhancer_source = enhance_prompt(base_prompt)

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
                    last_exc = e  # один вариант упал — продолжаем остальные
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
# Интерьер-галерея: 1 рендер на уникальный тип квартиры в плане
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
    apt_type:   str        # "studio" | "k1" | "euro1" | "k2" | "euro2" | "k3" | "euro3" | "k4"
    area:       float      # общая площадь, м²
    width:      float      # ширина, м
    depth:      float      # глубина, м
    zone_kinds: list[str]  # ["living","bedroom","bedroom","kitchen","bathroom","hall", ...]
    count:      int = 1    # сколько таких квартир в плане


class InteriorGalleryRequest(BaseModel):
    floors:    int   = 9
    purpose:   str   = "residential"
    quality:   str   = "medium"
    apt_types: list[AptTypeInput]


class InteriorGalleryItem(BaseModel):
    apt_type:     str
    label:        str
    area:         float
    count:        int
    image_b64:    str
    model_used:   str
    enhancer_used: str


class InteriorGalleryResponse(BaseModel):
    items:      list[InteriorGalleryItem]
    elapsed_ms: float


def _build_apt_interior_prompt(apt: AptTypeInput, floors: int, purpose: str) -> str:
    """Точный интерьерный промпт на основе реальных данных тайла."""
    # ---- описание квартиры
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

    # ---- зоны из реальных данных тайла
    zone_counter: dict[str, int] = {}
    for z in apt.zone_kinds:
        zone_counter[z] = zone_counter.get(z, 0) + 1

    zone_parts: list[str] = []
    if zone_counter.get("living"):     zone_parts.append("living room")
    if zone_counter.get("bedroom"):
        n = zone_counter["bedroom"]
        zone_parts.append(f"{n} bedroom{'s' if n > 1 else ''}")
    if zone_counter.get("kitchen"):    zone_parts.append("kitchen")
    if zone_counter.get("bathroom"):
        n = zone_counter["bathroom"]
        zone_parts.append(f"{n} bathroom{'s' if n > 1 else ''}")
    if zone_counter.get("hall"):       zone_parts.append("entrance hall")
    if zone_counter.get("loggia"):     zone_parts.append("loggia/balcony")
    zones_str = ", ".join(zone_parts) if zone_parts else "living space"

    furniture = _APT_FURNITURE.get(apt.apt_type, "modern furniture")

    return f"""Photorealistic interior architectural rendering, residential magazine quality.
Eye-level perspective view, camera at 1.5 m height, wide-angle (28 mm equivalent), no fish-eye distortion.

SUBJECT: {apt_desc}, in a newly built {floors}-storey residential building in Kazakhstan.
Rooms visible: {zones_str}.
Modern Kazakh/Russian residential interior — contemporary Scandinavian-minimalist style with warm Central Asian accents.

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
    """1 фотореалистичный интерьер на уникальный тип квартиры.

    Pipeline:
    1. Для каждого типа строим точный промпт из реальных размеров и зон
    2. enhance_prompt (Gemma 4) — свой вызов на каждый тип
    3. ThreadPoolExecutor (max_workers=4) — параллельные gpt-image
    4. JSON: {items: [{apt_type, label, area, count, image_b64, ...}], elapsed_ms}
    """
    import base64 as _b64
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    if req.quality not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="quality must be low/medium/high")
    if not req.apt_types:
        raise HTTPException(status_code=400, detail="apt_types must not be empty")

    # Дедупликация: если вдруг прислали несколько одного типа — берём первый
    seen: set[str] = set()
    unique: list[AptTypeInput] = []
    for apt in req.apt_types:
        if apt.apt_type not in seen:
            seen.add(apt.apt_type)
            unique.append(apt)

    opts = GenerationOptions(quality=req.quality)  # type: ignore[arg-type]

    def _one(idx: int, apt: AptTypeInput) -> tuple[int, InteriorGalleryItem]:
        prompt = _build_apt_interior_prompt(apt, req.floors, req.purpose)
        enhanced, enhancer_src = enhance_prompt(prompt)
        result = generate_image_with_meta(enhanced, opts, use_cache=True)
        return idx, InteriorGalleryItem(
            apt_type=apt.apt_type,
            label=_APT_TYPE_RU.get(apt.apt_type, apt.apt_type),
            area=apt.area,
            count=apt.count,
            image_b64=_b64.b64encode(result.png).decode(),
            model_used=result.model_used,
            enhancer_used=enhancer_src,
        )

    t0 = time.time()
    ordered: list[InteriorGalleryItem | None] = [None] * len(unique)
    last_exc: Exception | None = None

    try:
        with ThreadPoolExecutor(max_workers=min(4, len(unique))) as pool:
            futures = {
                pool.submit(_one, i, apt): i
                for i, apt in enumerate(unique)
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


@app.post("/generate/dxf", response_model=GenerateAPIResponse)
async def generate_dxf(
    file: UploadFile = File(...),
    floors: int = Form(1),
    purpose: BuildingPurpose = Form(BuildingPurpose.RESIDENTIAL),
) -> GenerateAPIResponse:
    """Загрузить DXF-контур и сгенерировать 5 вариантов."""
    if file.filename and not file.filename.lower().endswith((".dxf",)):
        raise HTTPException(status_code=400, detail="only .dxf is supported")

    with NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp.flush()
        tmp_path = Path(tmp.name)

    try:
        contour = parse_dxf(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DXF parse failed: {e}")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    gen_req = GenerateRequest(
        floor_polygon=contour,
        purpose=purpose,
        floors=floors,
    )
    plans, elapsed = generate_all_variants(gen_req)
    rid = uuid.uuid4().hex
    resp = GenerateAPIResponse(request_id=rid, variants=plans, elapsed_ms=elapsed)
    _cache_response(rid, gen_req, resp)
    return resp

