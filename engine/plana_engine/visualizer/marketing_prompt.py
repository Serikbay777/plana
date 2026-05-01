"""Marketing-grade prompt-builder, purpose-aware.

Принцип: каждый выбор юзера на форме реально меняет содержание промпта.
Назначение здания (жилой / коммерческий / mixed / hotel) переключает не только
заголовок, а блоки про единицы (квартиры/офисы/номера), мебель, подписи.

Структура промпта:
  1. COMMON HEADER         — STRICT AutoCAD intro + drafting standards (всегда одно)
  2. SUBJECT BLOCK         — варьируется по purpose (контент)
  3. UNITS BLOCK           — что внутри здания (квартиры/офисы/номера)
  4. FURNITURE BLOCK       — что в каждой единице (мебель)
  5. ANNOTATIONS BLOCK     — какие подписи внутри плана
  6. ENGINEERING BLOCK     — лифты/пожарка/инсоляция/паркинг/ГПЗУ (общее)
  7. COMMON FOOTER         — цвета, NEGATIVES, REFERENCE (всегда одно)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketingInputs:
    """Все поля формы, которые становятся частями промпта."""

    site_width_m: float
    site_depth_m: float
    setback_front_m: float = 0.0
    setback_side_m: float = 0.0
    setback_rear_m: float = 0.0

    floors: int = 1
    purpose: str = "residential"

    studio_pct: float = 0.0
    k1_pct: float = 0.0
    k2_pct: float = 0.0
    k3_pct: float = 0.0

    parking_spaces_per_apt: float = 1.0
    parking_underground_levels: int = 1

    fire_evacuation_max_m: float = 25.0
    fire_evacuation_exits_per_section: int = 2
    fire_dead_end_corridor_max_m: float = 12.0

    lifts_passenger: int = 2
    lifts_freight: int = 1

    insolation_priority: bool = True
    insolation_min_hours: float = 2.0

    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0


# ---------------------------------------------------------------------------
# Универсальные хелперы
# ---------------------------------------------------------------------------


def _approx_unit_count(inputs: MarketingInputs) -> int:
    """Грубая оценка кол-ва «единиц» (квартир/офисов/номеров) на этаже."""
    inner_w = max(0.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_h = max(0.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    floor_area = inner_w * inner_h
    if floor_area <= 0:
        return 6
    saleable = floor_area * 0.55
    if inputs.purpose == "residential" or inputs.purpose == "mixed_use":
        avg = (
            25 * inputs.studio_pct +
            45 * inputs.k1_pct +
            65 * inputs.k2_pct +
            90 * inputs.k3_pct
        ) or 50
    elif inputs.purpose == "hotel":
        avg = 28        # типовой гостиничный номер
    elif inputs.purpose == "commercial":
        avg = 30        # типовой офисный блок
    else:
        avg = 50
    return max(2, min(round(saleable / avg), 30))


# ---------------------------------------------------------------------------
# 1+7. ОБЩИЕ ШАПКА И ПОДВАЛ
# ---------------------------------------------------------------------------


def _common_header() -> str:
    return """STRICT AutoCAD architectural floor plan, technical engineering drawing on white paper.
NOT a marketing brochure. NOT a Pinterest illustration. NOT watercolor.
Pure CAD-grade vector line work: thin black ink lines on white, like a real .dwg printout from a Russian architectural firm. Sheet format A1, scale 1:100. Top-down orthographic view ONLY.

═══════════════════════════════════════════════════════════════════
LINE WEIGHTS (CRITICAL — like real CAD)
═══════════════════════════════════════════════════════════════════
• EXTERIOR BEARING WALLS: 0.7 mm thick black lines, twin parallel = 400 mm wall, with diagonal hatching (ANSI31, СНиП «огнестойкая»)
• INTERIOR PARTITIONS: 0.35 mm twin parallel lines, 120 mm thickness
• DOORS: 0.18 mm — door leaf as 45° solid line + quarter-arc swing
• WINDOWS: triple parallel lines on facade (frame–glass–frame), 1500 mm typical
• FURNITURE & FIXTURES: 0.13 mm SIMPLE BLOCK SHAPES, no photorealism, no shading"""


def _common_footer() -> str:
    return """═══════════════════════════════════════════════════════════════════
COLOR (very restrained — AutoCAD layers, NOT marketing)
═══════════════════════════════════════════════════════════════════
• Background: pure white #ffffff (paper)
• All lines: black #000000
• Wall hatching: dark grey #555555 or dark sienna #8b4513 for bearing walls
• Unit fills: VERY LIGHT pastel tints, ~10% opacity:
  - Pale yellow, pale blue, pale green, pale pink — rotated per unit
• NO wood floor textures. NO parquet. NO realistic furniture. NO gradients. NO shadows.

═══════════════════════════════════════════════════════════════════
ABSOLUTE NEGATIVES (must NOT appear)
═══════════════════════════════════════════════════════════════════
× NO watercolor, painted illustration, Pinterest interior overlay
× NO photorealistic furniture (everything is line-drawing block diagrams)
× NO wood grain, parquet, marble textures
× NO 3D, isometric, perspective — strict 2D top-down only
× NO shadows, gradients, soft lighting effects
× NO Latin/English labels — все надписи на русском кириллицей
× NO marketing brochure aesthetic

═══════════════════════════════════════════════════════════════════
REFERENCE
═══════════════════════════════════════════════════════════════════
Real architectural plans printed from AutoCAD by Russian / Kazakh design institutes (Моспроект, ГипроНИИ, КазГОР). Black ink on white paper, axis grid, dimension chains, hatching, technical Cyrillic font (Arial/Tehnix). The drawing should look like it could be stamped «УТВЕРЖДАЮ» by a chief architect tomorrow.

Ratio 16:10, ultra-high resolution, every line crisp, every dimension legible. Pure engineering, no artistic interpretation."""


# ---------------------------------------------------------------------------
# 2-5. PURPOSE-AWARE БЛОКИ
# ---------------------------------------------------------------------------


def _residential_blocks(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Квартиры — что внутри жилого этажа."""
    mix_parts = []
    if inputs.studio_pct > 0.01:
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios (~30 м²)")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom (~45 м²)")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom (~65 м²)")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom (~90 м²)")
    mix = ", ".join(mix_parts) if mix_parts else "balanced typology"

    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — RESIDENTIAL FLOOR
═══════════════════════════════════════════════════════════════════
Title block (Cyrillic): «ПЛАН ЭТАЖА · Жилое здание · М 1:100». Footprint {inner_w:.0f} × {inner_h:.0f} м (after setbacks). One typical floor of a {inputs.floors}-storey residential building. Approximately {n_units} apartments per floor (~{n_units * inputs.floors} apartments total).

UNITS: apartments, mix — {mix}.

FURNITURE inside each apartment (simple top-down block icons):
  • Bedrooms: rectangle bed with «X» for pillow, bedside table, wardrobe long thin rectangle
  • Living rooms: L-shape sofa, round table, armchair circle
  • Kitchens: counter L along wall with sink + stove (square with 4 burner circles), fridge rectangle
  • Bathrooms: oval tub OR shower square, oval toilet, vanity rectangle
  • Hallways: built-in wardrobe rectangle, shoe storage
  • Loggias: small rectangles outside facade wall

ANNOTATIONS inside the plan:
  • «Кв. №1», «Кв. №2»…«Кв. №{n_units}» — apartment numbers
  • «S общ. = 45.20 м²», «S жил. = 32.10 м²» — areas under each apartment number
  • Room labels above each room: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая»
  • Room areas inside each room: «18.4 м²», «12.6 м²», «7.2 м²»"""


def _commercial_blocks(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Офисы — что внутри коммерческого этажа."""
    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — COMMERCIAL OFFICE FLOOR
═══════════════════════════════════════════════════════════════════
Title block (Cyrillic): «ПЛАН ЭТАЖА · Бизнес-центр · М 1:100». Footprint {inner_w:.0f} × {inner_h:.0f} м (after setbacks). One typical floor of a {inputs.floors}-storey office building. Approximately {n_units} office blocks per floor.

UNITS: open-spaces (40%), private offices (30%), meeting rooms (15%), break/kitchen zones (10%), restrooms+utilities (5%).

FURNITURE inside the floor (simple top-down block icons):
  • Open-space areas: workstation desks in rows (rectangles with chair circles), partitions as thin lines
  • Private offices: single executive desk, 1-2 visitor chairs, bookcase rectangle along wall
  • Meeting rooms: oval/rectangular conference table with 6-12 chair circles, screen rectangle on wall
  • Break/kitchen zone: counter with sink + microwave + coffee machine, dining table with 4-6 chairs
  • Restrooms (М/Ж): sinks, toilet stalls (small rectangles)
  • Reception (near main entrance): curved counter, waiting sofa, plants
  • Server room: rack rectangles in a row, labeled «СЕРВЕРНАЯ»
  • Archive: tall shelving rectangles, labeled «АРХИВ»

ANNOTATIONS inside the plan:
  • «Офис №1», «Офис №2»…«Офис №{n_units}» — office block numbers
  • «S = 28.5 м²» — area under each office number
  • Zone labels: «Open-space», «Переговорная», «Кабинет», «Кухня», «С/у М», «С/у Ж», «Ресепшен», «Серверная», «Архив»
  • Workstation count in open-space: «12 рабочих мест»"""


def _hotel_blocks(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Гостиничные номера — что внутри этажа отеля."""
    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — HOTEL FLOOR
═══════════════════════════════════════════════════════════════════
Title block (Cyrillic): «ПЛАН ЭТАЖА · Гостиница · М 1:100». Footprint {inner_w:.0f} × {inner_h:.0f} м (after setbacks). One typical floor of a {inputs.floors}-storey hotel. Approximately {n_units} hotel rooms per floor.

UNITS: hotel rooms, mix — 60% Standard (single king bed), 25% Twin (two beds), 10% Junior Suite, 5% Suite.

FURNITURE inside each room (simple top-down block icons):
  • Standard / Suite: large bed (rectangle with «X» for pillows), bedside tables, work desk + chair, armchair, wardrobe rectangle, TV thin rectangle on wall, mini-bar
  • Twin: two single beds parallel, single bedside table between, same desk/chair/wardrobe
  • Junior Suite & Suite: + small lounge area with sofa and coffee table
  • Bathroom (compact in standard, larger in suite): oval tub or shower square, oval toilet, vanity rectangle
  • Each room's entrance has a short hallway with wardrobe and luggage zone

ANNOTATIONS inside the plan:
  • «Номер 101», «Номер 102»…«Номер 1{n_units:02d}» (Cyrillic «Номер»)
  • Room type label: «Standard», «Twin», «Junior Suite», «Suite»
  • «S = 28 м²», «S = 45 м²» — area under each room number
  • Common areas labels: «Лифтовый холл», «Сервисный коридор», «Кладовая горничных», «Лёд / Прачечная»"""


def _mixed_use_blocks(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """МФК — типовой этаж (как жилой, с пометкой про подиум)."""
    mix_parts = []
    if inputs.studio_pct > 0.01:
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom")
    mix = ", ".join(mix_parts) if mix_parts else "balanced typology"

    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — MIXED-USE FLOOR (TYPICAL)
═══════════════════════════════════════════════════════════════════
Title block (Cyrillic): «ПЛАН ЭТАЖА · МФК · М 1:100 · Типовой жилой этаж». Footprint {inner_w:.0f} × {inner_h:.0f} м. One typical RESIDENTIAL floor of a {inputs.floors}-storey mixed-use building (ground floor is retail/F&B, podium is parking, this is the typical residential level above podium).

UNITS: apartments, mix — {mix}.

FURNITURE inside each apartment (simple top-down block icons):
  • Bedrooms: rectangle bed with «X», bedside tables, wardrobe long thin rectangle
  • Living rooms: L-shape sofa, round/rectangular table, armchair
  • Kitchens: counter with sink + stove + fridge
  • Bathrooms: tub or shower, toilet, vanity
  • Hallways: built-in wardrobe, shoe storage
  • Loggias: small rectangles outside facade

ANNOTATIONS:
  • «Кв. №1»…«Кв. №{n_units}» — apartment numbers
  • «S общ. = 45.20 м²», «S жил. = 32.10 м²»
  • Room labels: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая»
  • Room areas inside each room: «18.4 м²», «12.6 м²»
  • Note in the corner: «На 1 этаже — коммерция (магазины, кафе, F&B). Подземный паркинг.»"""


# ---------------------------------------------------------------------------
# 6. ENGINEERING BLOCK — общий, но с покраской под назначение
# ---------------------------------------------------------------------------


def _engineering_block(inputs: MarketingInputs) -> str:
    """Лифты, пожарка, инсоляция, паркинг, ГПЗУ — универсально по форме."""
    purpose_unit = "apartment" if inputs.purpose in ("residential", "mixed_use") else (
        "hotel room" if inputs.purpose == "hotel" else "office block"
    )
    return f"""═══════════════════════════════════════════════════════════════════
ENGINEERING & SAFETY (visible on the plan)
═══════════════════════════════════════════════════════════════════
LIFT GROUP: {inputs.lifts_passenger} passenger elevators (rectangles with diagonal cross «×», labeled «ЛИФТ») + {inputs.lifts_freight} freight elevator + U-shaped staircase (parallel tread lines 300 mm apart, upward arrow «↑», labeled «Л-1»). Concentrated in a central reinforced-concrete core.

FIRE SAFETY: maximum evacuation distance from any {purpose_unit} door to staircase ≤ {inputs.fire_evacuation_max_m:.0f} м. {inputs.fire_evacuation_exits_per_section} evacuation exits per section. Dead-end corridor segments ≤ {inputs.fire_dead_end_corridor_max_m:.0f} м. Show evacuation arrows from each unit toward the staircase.

INSOLATION: {"large units (suites, 2-3 bedroom apartments) face south or south-west, smaller units face north" if inputs.insolation_priority else f"all units receive at least {inputs.insolation_min_hours:.1f} h of direct sunlight at equinox, no preferential orientation"}.

PARKING: {inputs.parking_underground_levels} underground level(s), approximately {int(_approx_unit_count(inputs) * inputs.floors * inputs.parking_spaces_per_apt)} parking spaces total ({inputs.parking_spaces_per_apt:.1f} per {purpose_unit}). Parking layout NOT shown on this floor (typical level), but the engineering shaft from the underground garage rises through the central core.

GPZU CONSTRAINTS: maximum site coverage {inputs.max_coverage_pct:.0f}%, height regulation up to {inputs.max_height_m:.0f} м. Setbacks shown as red dashed lines: {inputs.setback_front_m:.1f} м front, {inputs.setback_rear_m:.1f} м rear, {inputs.setback_side_m:.1f} м on each side.

TECH ZONES (mark on plan): «ВЕНТ» (vent shaft, 0.6×0.6 м, near core), «ЭЩ» (electrical, ~1.5×1.5 м, near core), «СС» (weak-current), «МСП» (trash chute, 0.4×0.4 м, near core, residential only), «ВКР» (water riser, 0.3×0.3 м, near each wet zone)."""


def _common_annotations() -> str:
    """Универсальные аннотации, не зависят от назначения."""
    return """═══════════════════════════════════════════════════════════════════
UNIVERSAL ANNOTATIONS
═══════════════════════════════════════════════════════════════════
• AXIS GRID: dashed lines with circles at the ends, labeled «А», «Б», «В»… (vertical) and «1», «2», «3»… (horizontal)
• DIMENSION LINES: outer chain along south facade with extension lines, arrows, numbers in mm («6 850», «4 200»…). Total building length and width as final outer dimensions.
• ELEVATION MARKS: triangle markers «±0.000» on the floor, «-0.150» at staircase or entrance
• COMPASS «С» (north arrow) in top-right corner — small simple north arrow, not decorative
• TITLE BLOCK in bottom-right (rectangular bordered box):
   ┌─────────────────────────────────────┐
   │ ПЛАН ТИПОВОГО ЭТАЖА                 │
   │ Масштаб: 1:100                       │
   │ Лист 1                       PLANA   │
   └─────────────────────────────────────┘"""


# ---------------------------------------------------------------------------
# Главный билдер
# ---------------------------------------------------------------------------


def build_marketing_prompt(inputs: MarketingInputs) -> str:
    inner_w = inputs.site_width_m - 2 * inputs.setback_side_m
    inner_h = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m
    n_units = _approx_unit_count(inputs)

    # — выбираем purpose-specific блок
    if inputs.purpose == "commercial":
        purpose_block = _commercial_blocks(inputs, n_units, inner_w, inner_h)
    elif inputs.purpose == "hotel":
        purpose_block = _hotel_blocks(inputs, n_units, inner_w, inner_h)
    elif inputs.purpose == "mixed_use":
        purpose_block = _mixed_use_blocks(inputs, n_units, inner_w, inner_h)
    else:
        purpose_block = _residential_blocks(inputs, n_units, inner_w, inner_h)

    return "\n\n".join([
        _common_header(),
        purpose_block,
        _common_annotations(),
        _engineering_block(inputs),
        _common_footer(),
    ])
