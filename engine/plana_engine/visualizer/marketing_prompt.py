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

    # Подъездность — количество секций на этаже (1=точечный, 2-4=линейный)
    sections: int = 1

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
Pure CAD-grade vector line work — IDENTICAL in style to drawings from leading Kazakh architectural design institutes. Sheet format A3 landscape, scale 1:100. Top-down orthographic view ONLY.

⚠️ STYLE REFERENCE (very specific Kazakh CAD aesthetic):
• Pure white paper background — NO color tints in rooms, NO pastel fills
• Walls drawn with TWO line weights: thin black outline + RED-ORANGE DIAGONAL HATCHING inside the wall thickness (ANSI31 pattern, color #c14d3d-ish, 30-45° angle, dense 4-5 mm spacing)
• Window openings rendered with PALE BLUE (#a8c5d4) parallel lines and light blue tinted glass area
• Bathroom/WC fixtures with subtle PALE BLUE (#cee0e8) accent on tubs, toilets, sinks
• All text in CAD-style Cyrillic font (ISOCPEUR / GOST / Arial Narrow), uppercase or capitalized, narrow letterforms
• Narrow black arrows for cut-section markers «1-1», «2-2» pointing inward from sides

⚠️ CRITICAL — DRAWING ASPECT RATIO: The plan MUST be drawn at the EXACT building footprint ratio specified below. If footprint is 60×40, the drawing rectangle must be 1.5:1 (wide). DO NOT draw a narrow vertical strip when a wide rectangle is requested. Use the FULL sheet area. Match the requested floor dimensions precisely.

═══════════════════════════════════════════════════════════════════
LINE WEIGHTS (CRITICAL — like real Kazakh CAD)
═══════════════════════════════════════════════════════════════════
• EXTERIOR BEARING WALLS: thin black outline 0.5 mm, wall thickness ~400 mm, FILLED with red-orange diagonal hatching (ANSI31, 45°, dense). The hatching is the signature of bearing walls in Kazakh CAD-style drawings.
• INTERIOR LOAD-BEARING PARTITIONS: same hatching but thinner wall (200 mm)
• NON-LOAD-BEARING PARTITIONS: 0.25 mm twin parallel lines, no hatching, 120 mm thickness
• DOORS: 0.18 mm thin lines — door leaf as 45° solid line + quarter-arc swing
• WINDOWS: pale-blue triple parallel lines on facade (frame–glass–frame), 1200-1800 mm typical, glass area filled with very light blue #d8e7ef
• FURNITURE & FIXTURES: 0.15 mm SIMPLE TOP-DOWN BLOCK ICONS like in real DWG — no photorealism, no shading
• AXIS GRID LINES: dashed thin grey, ends in 600-mm circles with letter (А-Б-В) or number (1-2-3)
• DIMENSION LINES: thin black 0.13 mm with arrowheads, numbers in mm (no decimals)"""


def _common_footer() -> str:
    return """═══════════════════════════════════════════════════════════════════
COLOR PALETTE (Kazakh CAD style — strict, NOT marketing)
═══════════════════════════════════════════════════════════════════
• Background: pure white #ffffff (paper)
• All structural lines: pure black #000000
• Wall diagonal hatching: red-orange #c14d3d / terracotta — this is the signature Kazakh CAD style for bearing walls
• Window glass: very pale blue #d8e7ef (wash effect, ~30% opacity)
• Window frames: pale steel blue #6b95b3 thin lines
• Bathroom fixtures (tub, toilet, sink): pale blue accent #b8d4e0 outlines
• Bathroom floors: very subtle pale blue tile pattern hatching
• Floor textures (kitchen, hallway): light grey #e8e8e8 simple square tile pattern (sparingly)
• ROOM INTERIORS: pure white background — NO pastel fills, NO color rotation between rooms
• NO wood grain, NO parquet, NO marble, NO photorealistic textures, NO gradients, NO shadows

TYPOGRAPHY (critical — must look like authentic Kazakh CAD):
• ALL labels in narrow CAD-style Cyrillic font: ISOCPEUR, GOST type A, or Arial Narrow as fallback
• Room names: bold-ish, e.g. «Гостиная», «Кухня», «Спальня», «С/у», «Тамбур», «Холл»
• Areas underneath room name: «32,7 м²», «80,1 м²» (comma as decimal separator, м² with superscript ²)
• Apartment numbers: «Кв. №14», «S общ. = 65,10 м²», «S жил. = 30,70 м²»
• Section labels: «СЕКЦИЯ 1», «СЕКЦИЯ 2» — bold, larger height
• Cut markers: small black thick arrow + circle with «1» or «2», double label like «1-1», «2-2»

═══════════════════════════════════════════════════════════════════
ABSOLUTE NEGATIVES (must NOT appear)
═══════════════════════════════════════════════════════════════════
× NO watercolor, painted illustration, Pinterest interior overlay
× NO photorealistic furniture (everything is line-drawing block diagrams)
× NO wood grain, parquet, marble textures, ceramic tile patterns
× NO 3D, isometric, perspective — strict 2D top-down only
× NO shadows, gradients, soft lighting effects, glow effects
× NO Latin/English labels — все надписи на русском кириллицей
× NO marketing brochure aesthetic, NO Pinterest pastel colors
× NO narrow vertical strip layout when wide footprint is requested
× NO single-corridor layout when multi-section is required
× NO unrealistically small rooms (kitchen 5 m², bedroom 4 m² — these violate СНиП РК)
× NO missing elevator/staircase core in the center of the section
× NO COLORED ROOM FILLS (pale yellow/green/pink/etc — these look amateur, real Kazakh CAD has white rooms)
× NO sans-serif modern fonts like Roboto, Inter — only narrow CAD fonts (ISOCPEUR/GOST/Arial Narrow)

═══════════════════════════════════════════════════════════════════
REFERENCE — exact visual style to match
═══════════════════════════════════════════════════════════════════
Reference: real architectural floor plans from Kazakh design institutes (Almaty/Astana firms). Key visual cues:

• White A3 sheet, landscape orientation
• Axis numbering circles (600 mm dia) at perimeter: «1»…«10» horizontal bottom, «А»-«Б»-«В»-«Г»-«Д»-«Е»-«Ж»-«И» vertical left
• External dimension chains (mm without units): «1500», «2100», «2700», «4500», «7200» — printed directly above the line
• Bearing walls with red-orange diagonal hatching (signature feature)
• Pale blue tinted glass in window openings
• Pale blue accent in bathroom fixtures
• Inside each room: room name + area beneath, e.g. «Гостиная / 80,1 м²», «Кухня / 32,7 м²»
• Cut-section markers «1—1» and «2—2» as small thick arrows pointing inward
• Standard Cyrillic title block bottom-right with EMPTY/BLANK fields (no real firm or person names): «Изм. / Кол.уч. / Лист / N.док. / Подпись / Дата | Стадия / Лист / Листов | Разработал / [пусто] / [пусто] / [пусто]» and «Строительство [пусто] / г.Астана / План [N]-го этажа / [пусто] / Лицензия [пусто]» — render the cells visually but leave content empty or with placeholder dashes «—»
• Overall feeling: official, technical, ready to be stamped «УТВЕРЖДАЮ»

The drawing should look indistinguishable from a real Kazakh DWG printout printed at A3.
Ratio 16:10, ultra-high resolution, every line crisp, every dimension legible. Pure engineering aesthetic."""


# ---------------------------------------------------------------------------
# 2-5. PURPOSE-AWARE БЛОКИ
# ---------------------------------------------------------------------------


def _residential_blocks(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Квартиры — что внутри жилого этажа.

    Учитывает секционность: если sections > 1, рисуется N подъездов
    разделённых противопожарными стенами, каждый со своим лифтовым узлом.
    """
    mix_parts = []
    if inputs.studio_pct > 0.01:
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios (28-32 м²)")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom (40-50 м²)")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom (55-70 м²)")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom (80-95 м²)")
    mix = ", ".join(mix_parts) if mix_parts else "balanced typology"

    # ── секционная декомпозиция ────────────────────────────────────────────
    n_sections = max(1, inputs.sections)
    apts_per_section = n_units // n_sections
    section_width_m = inner_w / n_sections

    if n_sections > 1:
        # многосекционный дом — рисуем явно
        section_breakdown = (
            f"\n\n⚠️ CRITICAL — SECTIONAL LAYOUT (важнейшее требование):\n"
            f"This is a {n_sections}-SECTION residential building "
            f"(многосекционный жилой дом, {n_sections} подъезда). "
            f"The {inner_w:.0f}×{inner_h:.0f} м floor plate is divided "
            f"horizontally into {n_sections} EQUAL sections, each "
            f"approximately {section_width_m:.1f} × {inner_h:.0f} м.\n\n"
            f"SECTION BOUNDARIES: between sections — THICK FIRE-RATED WALLS "
            f"(REI 60), drawn as DOUBLE PARALLEL LINES (≥ 0.7 mm thick) "
            f"with diagonal hatching, NO doorways or corridors crossing "
            f"these walls. Sections are completely independent.\n\n"
            f"EACH SECTION CONTAINS:\n"
            f"  • Central core in the middle of the section: "
            f"{inputs.lifts_passenger} passenger elevator(s) + "
            f"{inputs.lifts_freight} freight elevator + 1 staircase Л-1 "
            f"(U-shape, parallel tread lines), all inside a reinforced-concrete shaft\n"
            f"  • A short central corridor (≤ 12 м tupik / dead-end) "
            f"connecting the core with apartments\n"
            f"  • {apts_per_section} apartments arranged AROUND the core "
            f"(2-4 per side, total {apts_per_section}/section)\n"
            f"  • Section number visibly marked: «СЕКЦИЯ 1», «СЕКЦИЯ 2»"
            f"{'…«СЕКЦИЯ ' + str(n_sections) + '»' if n_sections > 2 else ''}\n\n"
            f"APARTMENT NUMBERING (per section):\n"
        )
        # Поэтажный номер: 1.1, 1.2... для секции 1; 2.1, 2.2... для секции 2
        for s in range(1, n_sections + 1):
            section_breakdown += (
                f"  • Section {s}: «Кв. {s}-1», «Кв. {s}-2»…"
                f"«Кв. {s}-{apts_per_section}»\n"
            )
        sectional_intro = (
            f" Building consists of {n_sections} sections side-by-side, "
            f"~{apts_per_section} apartments per section "
            f"(total ~{n_units} apartments per floor)."
        )
    else:
        # односекционный (точечный)
        section_breakdown = (
            "\n\nPOINT-TOWER LAYOUT (1 section): central reinforced-concrete "
            f"core with {inputs.lifts_passenger} passenger + "
            f"{inputs.lifts_freight} freight elevator + Л-1 staircase. "
            f"All {n_units} apartments arranged AROUND the central core."
        )
        sectional_intro = (
            f" Single-section point tower with {n_units} apartments per floor."
        )

    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — RESIDENTIAL FLOOR (типовой этаж жилого здания)
═══════════════════════════════════════════════════════════════════
Standard Kazakh CAD title block in BOTTOM-RIGHT corner (small rectangular frame with subdivisions, ALL NAME/COMPANY CELLS EMPTY OR DASHED «—»):
  Top row fields (header labels only, body empty): «Изм. | Кол.уч. | Лист | N.док. | Подпись | Дата»
  Middle row: «Разработал | — | — | —»  (empty cells, NO real names)
  Right side: «Стадия: ЭП | Лист: — | Листов: —»
  Bottom rows: «Строительство [—]», «г.Астана», «План типового этажа», «[—]», «Лицензия [—]»
  IMPORTANT: leave personal-name and company-name cells BLANK or with dash «—» placeholders — do NOT invent firm names, do NOT insert «ТОО ...», do NOT add signatures or specific person names. The block is for layout demonstration only.

Building footprint EXACTLY {inner_w:.0f} × {inner_h:.0f} м — DRAW THE PLAN AT THIS EXACT ASPECT RATIO with the entire plan filling the sheet.
One typical floor of a {inputs.floors}-storey residential building.
~{n_units} apartments per floor (~{n_units * inputs.floors} total).{sectional_intro}{section_breakdown}

UNITS: apartments, mix — {mix}.

⚠️ MINIMUM ROOM SIZES (СНиП РК 3.02-43-2007 — STRICT):
  • Living room (гостиная): ≥ 16 м² for 2-3-room apts, ≥ 15 м² for 1-room
  • Master bedroom (спальня на 2 человека): ≥ 10 м²
  • Single bedroom: ≥ 8 м²
  • Kitchen: ≥ 9 м² for 2+ room apts (≥ 6 м² only for studios as kitchen-niche)
  • Bathroom (ванная): width ≥ 1.5 м
  • Combined WC (с/у совмещённый): ≥ 1.7 м wide
  • Hallway (прихожая): width ≥ 1.4 м
  • Internal corridor: ≥ 1.0 м

FURNITURE inside each apartment (simple top-down block icons, NOT photoreal):
  • Bedrooms: rectangle bed with «X» for pillow, bedside table, wardrobe long thin rectangle
  • Living rooms: L-shape sofa, round table, armchair circle, TV thin rectangle on wall
  • Kitchens: counter L along wall with sink + stove (square with 4 burner circles), fridge rectangle
  • Bathrooms: oval tub OR shower square, oval toilet, vanity rectangle
  • Hallways: built-in wardrobe rectangle, shoe storage
  • Loggias: small rectangles outside facade wall, labeled «Лоджия», 3-6 м²

ANNOTATIONS inside the plan:
  • Apartment numbers (per section if sectional, else sequential)
  • «S общ. = 45.20 м²», «S жил. = 32.10 м²» — areas under each apartment number
  • Room labels above each room: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая», «Лоджия»
  • Room areas inside each room: «18.4 м²», «12.6 м²», «7.2 м²» — REALISTIC values, not too small
  • Section labels «СЕКЦИЯ 1», «СЕКЦИЯ 2»… in BOLD if multi-section"""


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
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios (28-32 м²)")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom (40-50 м²)")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom (55-70 м²)")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom (80-95 м²)")
    mix = ", ".join(mix_parts) if mix_parts else "balanced typology"

    n_sections = max(1, inputs.sections)
    apts_per_section = n_units // n_sections
    section_width_m = inner_w / n_sections

    if n_sections > 1:
        section_block = (
            f"\n\n⚠️ SECTIONAL LAYOUT: {n_sections} sections side-by-side, each "
            f"~{section_width_m:.1f} × {inner_h:.0f} м with own central core "
            f"({inputs.lifts_passenger} pass + {inputs.lifts_freight} freight elevator "
            f"+ Л-1 staircase). Sections separated by FIRE-RATED WALLS "
            f"(thick double parallel lines with diagonal hatching). "
            f"~{apts_per_section} apartments per section."
        )
    else:
        section_block = (
            "\n\nPOINT-TOWER LAYOUT (1 section): central core with elevators+staircase, "
            f"{n_units} apartments around it."
        )

    return f"""═══════════════════════════════════════════════════════════════════
SUBJECT — MIXED-USE FLOOR (TYPICAL)
═══════════════════════════════════════════════════════════════════
Title block (Cyrillic): «ПЛАН ЭТАЖА · МФК · М 1:100 · Типовой жилой этаж».
Building footprint EXACTLY {inner_w:.0f} × {inner_h:.0f} м — DRAW AT THIS EXACT ASPECT RATIO.
One typical RESIDENTIAL floor of a {inputs.floors}-storey mixed-use building (ground floor is retail/F&B, podium is parking, this is the typical residential level above podium).{section_block}

UNITS: apartments, mix — {mix}.

⚠️ MINIMUM ROOM SIZES (СНиП РК 3.02-43-2007 — STRICT):
  • Living room: ≥ 16 м² for 2-3-room, ≥ 15 м² for 1-room
  • Bedroom: ≥ 8 м² (single), ≥ 10 м² (double)
  • Kitchen: ≥ 9 м² for 2+ room apts
  • Bathroom width: ≥ 1.5 м, combined WC: ≥ 1.7 м wide
  • Hallway: ≥ 1.4 м wide

FURNITURE inside each apartment (simple top-down block icons):
  • Bedrooms: rectangle bed with «X», bedside tables, wardrobe long thin rectangle
  • Living rooms: L-shape sofa, round/rectangular table, armchair, TV
  • Kitchens: counter with sink + stove + fridge
  • Bathrooms: tub or shower, toilet, vanity
  • Hallways: built-in wardrobe, shoe storage
  • Loggias: small rectangles outside facade, labeled «Лоджия»

ANNOTATIONS:
  • Apartment numbers (per section: «Кв. 1-1»…«Кв. {n_sections}-{apts_per_section}» if sectional)
  • «S общ. = 45.20 м²», «S жил. = 32.10 м²»
  • Room labels: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая», «Лоджия»
  • Realistic room areas — NOT too small (kitchen ≥ 9 m², not 5 m²)
  • Section labels «СЕКЦИЯ 1»…«СЕКЦИЯ {n_sections}» if multi-section
  • Note in the corner: «На 1 этаже — коммерция. Подземный паркинг.»"""


# ---------------------------------------------------------------------------
# 6. ENGINEERING BLOCK — общий, но с покраской под назначение
# ---------------------------------------------------------------------------


def _engineering_block(inputs: MarketingInputs) -> str:
    """Лифты, пожарка, инсоляция, паркинг, ГПЗУ — универсально по форме."""
    purpose_unit = "apartment" if inputs.purpose in ("residential", "mixed_use") else (
        "hotel room" if inputs.purpose == "hotel" else "office block"
    )

    # Секционность (важно для жилых)
    is_sectional = inputs.purpose in ("residential", "mixed_use") and inputs.sections > 1
    if is_sectional:
        section_block = (
            f"\n\nSECTIONAL LAYOUT: building consists of {inputs.sections} SECTIONS "
            f"(подъезды) divided by FIRE-RATED PARTITIONS (REI 60 walls, drawn as "
            f"thick double lines with diagonal hatching). Each section has its OWN "
            f"central lift-stair core: {inputs.lifts_passenger} passenger elevator(s) + "
            f"{inputs.lifts_freight} freight elevator + a U-shaped staircase (Л-1). "
            f"Section borders are clearly marked on the plan with section numbers «Секция 1», "
            f"«Секция 2»…«Секция {inputs.sections}». No through-corridor between sections."
        )
        total_pass = inputs.lifts_passenger * inputs.sections
        total_freight = inputs.lifts_freight * inputs.sections
        lift_summary = (
            f"{inputs.lifts_passenger} passenger + {inputs.lifts_freight} freight "
            f"PER SECTION (total in building: {total_pass} passenger + {total_freight} freight)"
        )
    else:
        section_block = ""
        lift_summary = (
            f"{inputs.lifts_passenger} passenger elevators + "
            f"{inputs.lifts_freight} freight elevator"
        )

    return f"""═══════════════════════════════════════════════════════════════════
ENGINEERING & SAFETY (visible on the plan)
═══════════════════════════════════════════════════════════════════
LIFT GROUP: {lift_summary} (rectangles with diagonal cross «×», labeled «ЛИФТ») + U-shaped staircase (parallel tread lines 300 mm apart, upward arrow «↑», labeled «Л-1»). Concentrated in central reinforced-concrete core(s).{section_block}

FIRE SAFETY: maximum evacuation distance from any {purpose_unit} door to staircase ≤ {inputs.fire_evacuation_max_m:.0f} м (evacuation distance counted PER SECTION when sectional). {inputs.fire_evacuation_exits_per_section} evacuation exits per section. Dead-end corridor segments ≤ {inputs.fire_dead_end_corridor_max_m:.0f} м. Show evacuation arrows from each unit toward the staircase.

INSOLATION: {"large units (suites, 2-3 bedroom apartments) face south or south-west, smaller units face north" if inputs.insolation_priority else f"all units receive at least {inputs.insolation_min_hours:.1f} h of direct sunlight at equinox, no preferential orientation"}.

PARKING: {inputs.parking_underground_levels} underground level(s), approximately {int(_approx_unit_count(inputs) * inputs.floors * inputs.parking_spaces_per_apt)} parking spaces total ({inputs.parking_spaces_per_apt:.1f} per {purpose_unit}). Parking layout NOT shown on this floor (typical level), but the engineering shaft from the underground garage rises through the central core.

GPZU CONSTRAINTS: maximum site coverage {inputs.max_coverage_pct:.0f}%, height regulation up to {inputs.max_height_m:.0f} м. Setbacks shown as red dashed lines: {inputs.setback_front_m:.1f} м front, {inputs.setback_rear_m:.1f} м rear, {inputs.setback_side_m:.1f} м on each side.

TECH ZONES (mark on plan): «ВЕНТ» (vent shaft, 0.6×0.6 м, near core), «ЭЩ» (electrical, ~1.5×1.5 м, near core), «СС» (weak-current), «МСП» (trash chute, 0.4×0.4 м, near core, residential only), «ВКР» (water riser, 0.3×0.3 м, near each wet zone)."""


def _common_annotations() -> str:
    """Универсальные аннотации в стиле Kazakh CAD.

    Соответствует визуальному стилю эскизных проектов казахстанских
    проектных фирм (Алматы/Астана). Все personal-name и company-name
    поля штампа оставляются пустыми.
    """
    return """═══════════════════════════════════════════════════════════════════
UNIVERSAL ANNOTATIONS (Kazakh CAD style)
═══════════════════════════════════════════════════════════════════
• AXIS GRID:
  - Dashed thin grey lines extending beyond the plan
  - Each axis ends in a CIRCLE (~600 mm dia, drawn as 12-15 mm on sheet) with letter or number inside
  - Vertical axes (left/right of plan): «А», «Б», «В», «Г», «Д», «Е», «Ж», «И» (avoid «З» — looks like 3)
  - Horizontal axes (top/bottom): «1», «2», «3»… up to «10»

• DIMENSION CHAINS (very specific Kazakh format):
  - Outer chain along ENTIRE bottom and left facades
  - Numbers in mm WITHOUT unit symbol: «1500», «2100», «2700», «4500», «7200»
  - Total building dimension in larger text below: «25 200» or «60 000»
  - Inner chains along walls for individual room dimensions
  - All dimension text in narrow CAD font (ISOCPEUR/GOST), horizontal regardless of line orientation

• CUT-SECTION MARKERS «1—1» and «2—2»:
  - Small thick black arrow (12 mm) pointing INWARD to the plan from outside
  - Adjacent to arrow: small numbered tag «1» or «2»
  - Place 2 sets at strategic locations (across long axis and short axis)

• ELEVATION MARKS: triangle markers «±0.000» at main floor level, «-0.150» at entrance steps

• COMPASS «С» (north arrow) in top-right corner — small thin black arrow pointing up with «С» label, NOT decorative

• ROOM LABELS (inside each room):
  - Room name first line: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая», «Тамбур», «Холл», «Гардеробная», «Терраса»
  - Area below: «80,1 м²», «32,7 м²» (Russian comma decimal, м² with superscript)
  - Stack vertically, centered in room
  - Use narrow Cyrillic CAD font (ISOCPEUR/Arial Narrow), all-caps optional

• TITLE BLOCK (bottom-right corner — Kazakh standard format):
  Tabular box subdivided into cells. RENDER FIELD LABELS but LEAVE NAME/COMPANY CELLS EMPTY (placeholder «—» or blank):
  Top row (header labels): «Изм.» | «Кол.уч.» | «Лист» | «N.док.» | «Подпись» | «Дата»
  Below: «Разработал» | «—» | «—» | «—»  ← DO NOT invent personal names
  Right column: «Стадия | Лист | Листов»
  Body: «Строительство [—]», «г.Астана район [—]», «План типового этажа»
  Bottom-right small: «[—]», «Лицензия [—]»  ← DO NOT invent firm names or license numbers
  IMPORTANT: never insert real-looking names like «Анферов», «Иванов», never insert real firm acronyms like «ТОО ASTETIKA» or «КазГОР» — keep the block as a TEMPLATE with empty fields.

• AREA SUMMARY (right side or bottom):
  «Общая площадь — XXX м²»
  «Площадь застройки — XXX м²»
  «Жилая площадь — XXX м²» (right-aligned, narrow font)"""


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
