"""FastAPI-приложение `plana-engine` (prompt-driven edition).

Эндпоинты:
- `GET  /health`                              — статус сервиса
- `POST /visualize/exterior`                  — экстерьер ЖК (text-to-image)
- `POST /visualize/floorplan-furniture`       — план с мебелью (text-to-image)
- `POST /visualize/site-placement`            — посадка на участок (image-edit)
- `POST /visualize/site-placement-variants`   — 3 стратегии посадки (image-edit × 3)
- `POST /visualize/floor-variants`            — 5 AI-чертежей (text-to-image × 5)
- `POST /visualize/interior-gallery`          — интерьер по типам квартир (text-to-image × N)
- `POST /import/gpzu`                         — ГПЗУ-PDF → JSON через Vision

Ничего алгоритмического: параметры → промпт → gpt-image.
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .. import __version__
from ..cad import build_floorplan_dxf, compute_floorplan_metrics
from ..types import BuildingPurpose
from ..visualizer import (
    GenerationOptions, MarketingInputs, build_exterior_prompt,
    build_floorplan_furniture_prompt, build_interior_prompt,
    build_marketing_prompt, build_site_placement_prompt,
    enhance_prompt, enhance_with_kz_norms, has_llm_key,
)
from ..visualizer.openai_client import (
    MissingAPIKey, OpenAIError, has_api_key,
    generate_image_edit_with_meta, generate_image_with_meta,
)


app = FastAPI(
    title="Plana Engine API",
    version=__version__,
    description="Prompt-driven визуализатор планировок (Plana).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: str
    version: str
    has_image_key: bool
    has_llm_key: bool


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        has_image_key=has_api_key(),
        has_llm_key=has_llm_key(),
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
    # квартирография
    studio_pct: float = 0.0
    k1_pct: float = 0.0
    k2_pct: float = 0.0
    k3_pct: float = 0.0
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
    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0
    # рендер
    quality: str = "medium"


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


@app.post("/visualize/floorplan-furniture")
def visualize_floorplan_furniture(req: VisualizeFromInputsRequest) -> Response:
    """Pinterest-grade top-down планировка с мебелью (для брошюр)."""
    _validate_quality(req.quality)
    inputs = _inputs_from_req(req)
    return _run_text_to_image(
        build_floorplan_furniture_prompt(inputs), req.quality, inputs=inputs,
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
        (max(1, int(site_img.width * scale)), TARGET_H), Image.LANCZOS
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
    bld_resized = bld_img.resize((BLD_W, max(1, bld_h)), Image.LANCZOS)
    bld_panel = Image.new("RGB", (BLD_W, TARGET_H), (15, 15, 20))
    bld_y = (TARGET_H - min(bld_h, TARGET_H)) // 2
    bld_panel.paste(bld_resized.crop((0, 0, BLD_W, min(bld_h, TARGET_H))), (0, bld_y))

    composite = Image.new("RGB", (TARGET_W, TARGET_H), (10, 10, 15))
    composite.paste(site_cropped, (0, 0))

    draw = ImageDraw.Draw(composite)
    draw.rectangle([SITE_W - 2, 0, SITE_W + 2, TARGET_H], fill=(80, 80, 100))
    composite.paste(bld_panel, (SITE_W, 0))

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


class InteriorGalleryResponse(BaseModel):
    items:      list[InteriorGalleryItem]
    elapsed_ms: float


def _build_apt_interior_prompt(apt: AptTypeInput, floors: int, purpose: str) -> str:
    """Точный интерьерный промпт на основе реальных данных тайла."""
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
    """1 фотореалистичный интерьер на уникальный тип квартиры (параллельно)."""
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
