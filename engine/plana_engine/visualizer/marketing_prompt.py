"""Prompt-builder на основе master-prompt-kz-v2 (templated edition).

Принцип: ПРИЛОЖЕНИЕ считает → ПРОМПТ описывает готовый результат без if/then.
Вся условная логика (лифты по этажности, нормировка %, проверка секций,
плотность) — в _prepare(). В промпт уходят только финальные числа.
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Входные параметры (то, что приходит из формы)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MarketingInputs:
    site_width_m: float
    site_depth_m: float
    setback_front_m: float = 0.0
    setback_side_m: float = 0.0
    setback_rear_m: float = 0.0

    floors: int = 1
    purpose: str = "residential"
    building_type: str = "multi_family"

    studio_pct: float = 0.0
    k1_pct: float = 0.0
    k2_pct: float = 0.0
    k3_pct: float = 0.0

    sections: int = 1

    parking_spaces_per_apt: float = 1.0
    parking_underground_levels: int = 1

    fire_evacuation_max_m: float = 25.0
    fire_evacuation_exits_per_section: int = 2
    fire_dead_end_corridor_max_m: float = 12.0

    # Слайдеры лифтов — используются agent_enhancer'ом для контекста.
    # Промпт их ИГНОРИРУЕТ и всегда использует _lifts_by_floors(floors).
    lifts_passenger: int = 2
    lifts_freight: int = 1

    insolation_priority: bool = True
    insolation_min_hours: float = 2.0

    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0

    site_polygon: tuple[tuple[float, float], ...] | None = None

    # Параметры для single_family (для multi_family игнорируются — там
    # типология задаётся через studio/k1/k2/k3 проценты).
    bedrooms: int = 2
    bathrooms: int = 1
    has_garage: bool = False


# ---------------------------------------------------------------------------
# Вычисленные факты (промпт читает только это — никаких if/then)
# ---------------------------------------------------------------------------

@dataclass
class PromptData:
    # Пятно
    inner_w: float
    inner_h: float
    footprint_area: float
    floors: int

    # Лифты (решены кодом, не промптом)
    lifts_passenger: int   # 0 если floors < 5
    lifts_freight: int     # 0 если floors < 5
    core_label: str        # готовое описание ядра

    # Секции (после проверки ratio ≥ 3)
    effective_sections: int
    apts_per_section: int

    # Квартирография
    n_units: int
    apartment_programs: list[str]   # готовые блоки на каждую кв.
    apt_summary: str                # "1-комн.: 1 шт. (33%), 2-комн.: 2 шт. (67%)"

    # Инженерия
    total_parking: int
    fire_evac_max_m: float
    fire_exits: int
    fire_dead_end_m: float
    parking_levels: int
    parking_per_apt: float
    max_coverage_pct: float
    max_height_m: float
    setback_front: float
    setback_rear: float
    setback_side: float


# ---------------------------------------------------------------------------
# Статические блоки (правила рисования — без условной логики)
# ---------------------------------------------------------------------------

_STATIC_HEADER = """\
STRICT AutoCAD architectural floor plan, technical engineering drawing on white paper.
NOT a marketing brochure. NOT a Pinterest illustration. NOT watercolor.
Pure CAD-grade vector line work — IDENTICAL in style to drawings from leading Kazakh architectural design institutes. Sheet format A3 landscape, scale 1:100. Top-down orthographic view ONLY.

⚠️ STYLE REFERENCE (very specific Kazakh CAD aesthetic):
• Pure white paper background — NO color tints in rooms, NO pastel fills
• Walls drawn with TWO line weights: thin black outline + RED-ORANGE DIAGONAL HATCHING inside the wall thickness (ANSI31 pattern, color #c14d3d-ish, 30-45° angle, dense 4-5 mm spacing)
• Window openings rendered with PALE BLUE (#a8c5d4) parallel lines and light blue tinted glass area
• Bathroom/WC fixtures with subtle PALE BLUE (#cee0e8) accent on tubs, toilets, sinks
• All text in CAD-style Cyrillic font (ISOCPEUR / GOST / Arial Narrow), uppercase or capitalized, narrow letterforms
• Narrow black arrows for cut-section markers «1-1», «2-2» pointing inward from sides

⚠️ CRITICAL — DRAWING ASPECT RATIO: The plan MUST be drawn at the EXACT building footprint ratio specified below. If footprint is 60×40, the drawing rectangle must be 1.5:1 (wide). DO NOT draw a narrow vertical strip when a wide rectangle is requested. Use the FULL sheet area."""

_STATIC_ROOM_DEFINITION = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ ОПРЕДЕЛЕНИЕ КОМНАТНОСТИ КВАРТИР (КАЗАХСТАНСКИЙ / ПОСТСОВЕТСКИЙ СТАНДАРТ)
═══════════════════════════════════════════════════════════════════
В Казахстане «N-комнатная квартира» = N ЖИЛЫХ комнат.

ЖИЛЫЕ комнаты (считаются в N): Гостиная, Спальни, Детская, Кабинет,
«Жилая комната» (для 1-комнатных).

НЕ ЯВЛЯЮТСЯ КОМНАТАМИ (никогда): Кухня, Санузел/С/у, Прихожая, Коридор,
Холл, Гардеробная, Кладовая, Лоджия, Балкон, Тамбур.

ОБЯЗАТЕЛЬНЫЙ СОСТАВ (каждая жилая комната — ОТДЕЛЬНОЕ помещение
со своей подписью и площадью; ничего не «подразумевать»):
  → Студия       = единая жилая зона ≥22 м² + кухня-ниша + с/у совмещённый + прихожая
  → 1-комнатная  = 1 ЖИЛАЯ КОМНАТА + кухня + с/у + прихожая (+ лоджия)
  → 2-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ + кухня + с/у + прихожая (+ лоджия)
  → 3-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 (ОБЕ подписаны ОТДЕЛЬНО:
                   «Спальня 1» И «Спальня 2») + кухня + с/у + прихожая (+ лоджия)
  → 4-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 + СПАЛЬНЯ-3 + кухня + 2 с/у + прихожая

❌ «гостиная + кухня» (без спальни) — это 1-КОМНАТНАЯ, не 2-комнатная.
❌ «3-комнатная» с одной спальней — это ОШИБКА. Подпись «Спальня 1» без
   парной «Спальня 2» запрещена. S жил. = сумма площадей ВСЕХ жилых комнат.
═══════════════════════════════════════════════════════════════════"""

_STATIC_LINE_WEIGHTS = """\
═══════════════════════════════════════════════════════════════════
LINE WEIGHTS (CRITICAL — like real Kazakh CAD)
═══════════════════════════════════════════════════════════════════
• EXTERIOR BEARING WALLS: thin black outline 0.5 mm, thickness ~400 mm,
  red-orange diagonal hatching (ANSI31, 45°, dense) — signature of bearing walls.
• INTERIOR LOAD-BEARING PARTITIONS: same hatching, thinner wall (200 mm)
• NON-LOAD-BEARING PARTITIONS: 0.25 mm twin parallel lines, no hatching, 120 mm
• DOORS: 0.18 mm — door leaf as 45° solid line + quarter-arc swing
• WINDOWS: pale-blue triple parallel lines (frame–glass–frame), 1200-1800 mm, glass #d8e7ef
• FURNITURE & FIXTURES: 0.15 mm SIMPLE TOP-DOWN BLOCK ICONS — no photorealism
• AXIS GRID LINES: dashed thin grey, ends in 600-mm circles with letter/number
• DIMENSION LINES: thin black 0.13 mm, numbers in mm (no decimals)
═══════════════════════════════════════════════════════════════════"""

_STATIC_TAIMAS = """\
═══════════════════════════════════════════════════════════════════
TAIMAS-STANDARD CHECKLIST — обязательные элементы (GOST/SPDS)
═══════════════════════════════════════════════════════════════════
1. ✓ AXIS GRID — letter circles (А..Ж/И) on TOP, number circles (1..N) on LEFT,
   Ø ~600mm, dashed grey lines extending past the walls. Avoid «З» (looks like 3).
2. ✓ TRIPLE DIMENSION CHAINS along TOP and LEFT edges (inner wall-to-wall,
   middle axis-to-axis, outer total). Numbers in mm without unit, ticks at 45°.
   СУММА пролётов по каждому фасаду ОБЯЗАНА равняться итоговому числу над цепочкой.
3. ✓ ROOM NUMBERS in small circles (Ø500mm) referencing the explication table.
4. ✓ EXPLICATION TABLE (Экспликация помещений): «№ | Наименование | Площадь, м²».
5. ✓ DOOR/WINDOW SPECS — «Д-1»,«Д-2»… for doors, «В-1»,«В-2»… for windows.
6. ✓ SECTION CUT ARROWS «1—1», «2—2» — thick black arrows on plan edges.
7. ✓ NORTH ARROW — thin black ARROW (not a filled blob) with «С», TOP-RIGHT outside the plan.
8. ✓ SCALE «М 1:100» under title or in title block.
9. ✓ SHEET TITLE «ПЛАН ТИПОВОГО ЭТАЖА» — bold uppercase, large narrow CAD font.
CRITICAL — без этих элементов чертёж выглядит «AI-нарисованным».
═══════════════════════════════════════════════════════════════════"""

_STATIC_ANNOTATIONS = """\
═══════════════════════════════════════════════════════════════════
UNIVERSAL ANNOTATIONS (Kazakh CAD style)
═══════════════════════════════════════════════════════════════════
• AXIS GRID: dashed grey lines past the plan; circles Ø~600mm; vertical «А…И»
  (без «З»), horizontal «1…N».
• DIMENSION CHAINS: numbers in mm без единиц; сумма пролётов = итогу здания;
  narrow CAD font, horizontal.
• CUT-SECTION MARKERS «1—1», «2—2»: small thick arrows inward, 2 sets.
• ELEVATION MARKS: «±0.000» main floor, «-0.150» entrance steps.
• COMPASS «С»: thin black ARROW pointing up with «С», top-right (NOT a filled blob).
• ROOM LABELS: имя + площадь под ним; narrow Cyrillic CAD font.
• TITLE BLOCK (bottom-right) — RENDER LABELS, leave name/firm cells EMPTY/«—»:
  «Изм.|Кол.уч.|Лист|N.док.|Подпись|Дата» / «Разработал|—|—|—» /
  «Стадия: ЭП|Лист: —|Листов: —» / «Строительство [—]» / «г.Астана» /
  «План типового этажа» / «Лицензия [—]». NEVER insert real firm/person names.
• AREA SUMMARY: «Общая площадь — XXX м²», «Площадь застройки — XXX м²», «Жилая площадь — XXX м²».
═══════════════════════════════════════════════════════════════════"""

_STATIC_COLOR = """\
═══════════════════════════════════════════════════════════════════
COLOR PALETTE (Kazakh CAD — strict)
═══════════════════════════════════════════════════════════════════
Фон #ffffff; линии #000000; штриховка стен red-orange #c14d3d; стекло #d8e7ef;
рамы окон #6b95b3; сантехника #b8d4e0. КОМНАТЫ БЕЛЫЕ — без пастельных заливок,
без ротации цветов. NO wood/parquet/marble textures, NO gradients, NO shadows.

TYPOGRAPHY: narrow CAD Cyrillic (ISOCPEUR/GOST/Arial Narrow); площади «32,7 м²»;
«Кв. №14», «S общ. = 65,10 м²», «S жил. = 30,70 м²»;
section labels bold (только если секций > 1).
═══════════════════════════════════════════════════════════════════"""

_STATIC_NEGATIVES = """\
═══════════════════════════════════════════════════════════════════
ABSOLUTE NEGATIVES (must NOT appear)
═══════════════════════════════════════════════════════════════════
× NO counting kitchen/с-у/прихожая/коридор/лоджия as жилая комната
× NO «2-комнатная» = гостиная + кухня (это 1-комнатная)
× NO «3-комнатная» with fewer than THREE жилые комнаты
× NO «Спальня 1» without paired «Спальня 2» (and «Спальня 3» for 4-room)
× NO apartments drawn with area outside their realistic range (see APARTMENT MIX below)
× NO dimension chain whose bay sum ≠ building total (числа обязаны складываться)
× NO площадь застройки ≠ длина×ширина (number specified in SUBJECT below)
× NO compass drawn as a filled black blob — it must be a thin arrow with «С»
× NO watercolor, photorealistic furniture, wood/parquet/marble, 3D/isometric, shadows
× NO Latin/English labels (только кириллица), NO Pinterest pastel, NO colored room fills
× NO narrow vertical strip when a wide footprint is requested
× NO sans-serif modern fonts (Roboto/Inter) — only narrow CAD fonts
× NO more or fewer lifts/staircases than specified in CORE below
× NO more or fewer apartments than the exact count specified in SUBJECT below
═══════════════════════════════════════════════════════════════════"""

_STATIC_REFERENCE = """\
═══════════════════════════════════════════════════════════════════
REFERENCE — exact visual style to match
═══════════════════════════════════════════════════════════════════
Real Kazakh design-institute plans (Almaty/Astana): white A3 landscape; axis
circles «1…N»/«А…И»; external dimension chains (mm, no units) above the line with
sums that add up; bearing walls with red-orange hatching; pale-blue glass; pale-blue
bath fixtures; room name + area inside each room; cut markers «1—1»,«2—2»; Cyrillic
title block bottom-right with EMPTY fields; official, ready to be stamped «УТВЕРЖДАЮ».
Indistinguishable from a real Kazakh DWG printout at A3. Ratio 16:10, ultra-high res,
every line crisp, every dimension legible. Pure engineering aesthetic.
═══════════════════════════════════════════════════════════════════"""

_STATIC_FURNITURE = """\
FURNITURE (simple top-down block icons, NOT photoreal):
  Bedrooms: bed rectangle with «X» pillow, bedside table, wardrobe strip.
  Living: L-sofa, round table, armchair circle, TV strip on wall.
  Kitchens: L-counter with sink + stove (square, 4 burner circles), fridge.
  Bathrooms: oval tub OR shower square, oval toilet, vanity.
  Hallways: built-in wardrobe; Loggias: small rect outside facade, «Лоджия» 3-6 м²."""

_STATIC_MIN_ROOMS = """\
⚠️ MINIMUM ROOM SIZES (СНиП РК 3.02-43-2007):
  Гостиная ≥16 (2-3-комн) / ≥15 (1-комн); Спальня (2 чел.) ≥10; одиночная ≥8;
  Кухня ≥9 (2+комн); Ванная ширина ≥1,5; С/у совмещ. ≥1,7; Прихожая ≥1,4; Коридор ≥1,0."""


# ---------------------------------------------------------------------------
# Функция подготовки данных (ВСЯ логика здесь, промпт её не видит)
# ---------------------------------------------------------------------------

def _lifts_by_floors(floors: int) -> tuple[int, int, str]:
    """Возвращает (passenger, freight, core_label) по этажности."""
    if floors < 5:
        return 0, 0, f"ТОЛЬКО лестница Л-1 (U-shape, «↑», «Л-1») — лифтов нет ({floors} эт. < 5)"
    elif floors <= 9:
        return 1, 0, f"1 пассажирский лифт (прямоугольник с «×», «ЛИФТ») + лестница Л-1 ({floors} эт.)"
    else:
        return 2, 1, f"2 пасс. лифта + 1 грузовой («×», «ЛИФТ») + лестница Л-1 ({floors} эт.)"


def _normalize_pcts(inputs: MarketingInputs) -> tuple[float, float, float, float]:
    """Нормирует проценты к сумме 1.0. Если всё 0 → 100% k2."""
    total = inputs.studio_pct + inputs.k1_pct + inputs.k2_pct + inputs.k3_pct
    if total <= 0:
        return 0.0, 0.0, 1.0, 0.0
    return (
        inputs.studio_pct / total,
        inputs.k1_pct / total,
        inputs.k2_pct / total,
        inputs.k3_pct / total,
    )


def _approx_unit_count(inputs: MarketingInputs, inner_w: float, inner_h: float) -> int:
    """Оценка числа квартир по площади и нормированному миксу."""
    floor_area = inner_w * inner_h
    if floor_area <= 0:
        return 4
    s_pct, k1_pct, k2_pct, k3_pct = _normalize_pcts(inputs)
    avg = (28 * s_pct + 45 * k1_pct + 65 * k2_pct + 90 * k3_pct) or 58
    saleable = floor_area * 0.55
    return max(2, min(round(saleable / avg), 30))


def _distribute(n_units: int, s_pct: float, k1_pct: float, k2_pct: float) -> list[str]:
    """Разбивает n_units на конкретные типы по нормированным процентам."""
    n_s  = round(s_pct  * n_units)
    n_k1 = round(k1_pct * n_units)
    n_k2 = round(k2_pct * n_units)
    n_k3 = n_units - n_s - n_k1 - n_k2
    if n_k3 < 0:
        n_k2 = max(0, n_k2 + n_k3)
        n_k3 = 0
    types = ["studio"] * n_s + ["k1"] * n_k1 + ["k2"] * n_k2 + ["k3"] * n_k3
    while len(types) < n_units:
        types.append("k2")
    return types[:n_units]


def _apt_program(apt_type: str, apt_num: int) -> str:
    if apt_type == "studio":
        return (
            f"  • Кв. №{apt_num} — СТУДИЯ (28–38 м²):\n"
            f"      Единая жилая зона ≥22 м² + Кухня-ниша ≥6 м² + С/у совмещённый + Прихожая"
        )
    elif apt_type == "k1":
        return (
            f"  • Кв. №{apt_num} — 1-КОМНАТНАЯ (40–50 м²):\n"
            f"      ЖИЛАЯ КОМНАТА (≥15 м²) + Кухня (≥9 м²) + С/у + Прихожая (+ Лоджия)"
        )
    elif apt_type == "k2":
        return (
            f"  • Кв. №{apt_num} — 2-КОМНАТНАЯ (55–70 м²):\n"
            f"      ГОСТИНАЯ (≥16 м²) + СПАЛЬНЯ (≥10 м²) + Кухня (≥9 м²) + С/у + Прихожая (+ Лоджия)"
        )
    else:  # k3
        return (
            f"  • Кв. №{apt_num} — 3-КОМНАТНАЯ (80–95 м²):\n"
            f"      ГОСТИНАЯ (≥16 м²)\n"
            f"      СПАЛЬНЯ 1 (≥12 м²)   ← нарисовать и подписать «Спальня 1»\n"
            f"      СПАЛЬНЯ 2 (≥10 м²)   ← нарисовать и подписать «Спальня 2»\n"
            f"      + Кухня (≥9 м²) + С/у (можно 2) + Прихожая (+ Лоджия)"
        )


def _pct_summary(types: list[str]) -> str:
    n = len(types)
    parts = []
    for t, label in [("studio", "студий"), ("k1", "1-комн."), ("k2", "2-комн."), ("k3", "3-комн.")]:
        c = types.count(t)
        if c > 0:
            parts.append(f"{label}: {c} шт. ({round(c / n * 100)}%)")
    return ", ".join(parts)


def _prepare(inputs: MarketingInputs) -> PromptData:
    """Вычисляет ВСЕ факты для промпта. Промпт логики не содержит."""
    inner_w = max(1.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_h = max(1.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    footprint_area = inner_w * inner_h

    # Лифты по этажности (слайдер lifts_passenger/freight удалён — норма главнее)
    lifts_p, lifts_f, core_label = _lifts_by_floors(inputs.floors)

    # Квартиры
    n_units = _approx_unit_count(inputs, inner_w, inner_h)
    s_pct, k1_pct, k2_pct, _ = _normalize_pcts(inputs)
    types = _distribute(n_units, s_pct, k1_pct, k2_pct)
    programs = [_apt_program(t, i + 1) for i, t in enumerate(types)]
    summary = _pct_summary(types)

    # Секции (collapse если < 3 кв./ядро)
    n_sections = max(1, inputs.sections)
    effective_sections = n_sections if (n_units / n_sections) >= 3 else 1
    apts_per_section = max(1, n_units // effective_sections)

    return PromptData(
        inner_w=inner_w,
        inner_h=inner_h,
        footprint_area=footprint_area,
        floors=inputs.floors,
        lifts_passenger=lifts_p,
        lifts_freight=lifts_f,
        core_label=core_label,
        effective_sections=effective_sections,
        apts_per_section=apts_per_section,
        n_units=n_units,
        apartment_programs=programs,
        apt_summary=summary,
        total_parking=round(n_units * inputs.floors * inputs.parking_spaces_per_apt),
        fire_evac_max_m=inputs.fire_evacuation_max_m,
        fire_exits=inputs.fire_evacuation_exits_per_section,
        fire_dead_end_m=inputs.fire_dead_end_corridor_max_m,
        parking_levels=inputs.parking_underground_levels,
        parking_per_apt=inputs.parking_spaces_per_apt,
        max_coverage_pct=inputs.max_coverage_pct,
        max_height_m=inputs.max_height_m,
        setback_front=inputs.setback_front_m,
        setback_rear=inputs.setback_rear_m,
        setback_side=inputs.setback_side_m,
    )


# ---------------------------------------------------------------------------
# Рендеринг динамических блоков (только подстановка — никаких if/then)
# ---------------------------------------------------------------------------

def _render_subject(d: PromptData) -> str:
    """SUBJECT — все числа уже финальные, только подстановка."""
    # Layout description
    if d.effective_sections == 1:
        layout = (
            f"LAYOUT: одна точечная секция, ОДИН подъезд. "
            f"Центральное ядро: {d.core_label}. "
            f"Коридор ≤{d.fire_dead_end_m:.0f} м. "
            f"Все {d.n_units} квартир вокруг ядра.\n"
            f"НУМЕРАЦИЯ: «Кв. №1»…«Кв. №{d.n_units}» (сквозная)."
        )
    else:
        section_w = d.inner_w / d.effective_sections
        numbering = "  ".join(
            f"«Кв. {s}-1»…«Кв. {s}-{d.apts_per_section}»"
            for s in range(1, d.effective_sections + 1)
        )
        layout = (
            f"LAYOUT: {d.effective_sections}-секционный дом ({d.effective_sections} подъезда). "
            f"Пятно {d.inner_w:.0f}×{d.inner_h:.0f} м делится на {d.effective_sections} РАВНЫХ секции "
            f"по ~{section_w:.1f}×{d.inner_h:.0f} м.\n"
            f"ПРОТИВОПОЖАРНЫЕ СТЕНЫ REI 60 между секциями (двойная линия ≥0.7 мм + штриховка).\n"
            f"КАЖДАЯ СЕКЦИЯ: {d.core_label} + коридор ≤{d.fire_dead_end_m:.0f} м "
            f"+ {d.apts_per_section} квартир вокруг ядра.\n"
            f"Section labels: «СЕКЦИЯ 1», «СЕКЦИЯ 2»… (bold).\n"
            f"НУМЕРАЦИЯ: {numbering}."
        )

    apt_list = "\n".join(d.apartment_programs)

    return (
        f"═══════════════════════════════════════════════════════════════════\n"
        f"SUBJECT — типовой этаж жилого здания\n"
        f"═══════════════════════════════════════════════════════════════════\n"
        f"Footprint EXACTLY {d.inner_w:.0f} × {d.inner_h:.0f} м — "
        f"DRAW AT THIS EXACT ASPECT RATIO, plan fills the sheet.\n"
        f"Площадь застройки = {d.inner_w:.0f} × {d.inner_h:.0f} = {d.footprint_area:.0f} м² "
        f"(подписать в ТЭП именно это число).\n"
        f"{d.floors}-этажное здание.\n\n"
        f"{layout}\n\n"
        f"⚠️ APARTMENT COUNT — STRICT: EXACTLY {d.n_units} apartments per floor "
        f"(EXACTLY {d.n_units * d.floors} total). DO NOT draw more or fewer.\n\n"
        f"⚠️ APARTMENT MIX — STRICT (кухня и с/у НЕ комнаты; комнатность по КЗ-стандарту):\n"
        f"{apt_list}\n\n"
        f"Итого: {d.apt_summary}. Типы НЕ менять, НЕ добавлять.\n\n"
        f"{_STATIC_MIN_ROOMS}\n\n"
        f"{_STATIC_FURNITURE}\n\n"
        f"ANNOTATIONS:\n"
        f"  • «Кв. №N», под номером: «S общ. = … м²», «S жил. = … м²»\n"
        f"    (S жил. = сумма ТОЛЬКО жилых комнат, без кухни/с-у/прихожей/лоджии)\n"
        f"  • Внутри каждой комнаты: имя + площадь «18,4 м²» (запятая-десятичная, м² надстрочный)"
    )


def _render_engineering(d: PromptData) -> str:
    """ENGINEERING — только финальные числа."""
    return (
        f"═══════════════════════════════════════════════════════════════════\n"
        f"ENGINEERING & SAFETY (visible on the plan)\n"
        f"═══════════════════════════════════════════════════════════════════\n"
        f"CORE: {d.core_label}. Concentrated in central reinforced-concrete core(s).\n\n"
        f"FIRE SAFETY: эвакуация ≤{d.fire_evac_max_m:.0f} м от двери квартиры до лестницы; "
        f"≥{d.fire_exits} эвак. выхода с этажа; тупик коридора ≤{d.fire_dead_end_m:.0f} м; "
        f"стрелки эвакуации к лестнице.\n\n"
        f"INSOLATION: крупные квартиры (2-3-комн.) на юг/юго-запад, мелкие — на север.\n\n"
        f"PARKING: {d.parking_levels} подз. уровень, ~{d.total_parking} м-мест "
        f"({d.parking_per_apt:.1f}/кв.); на типовом этаже не показан; "
        f"инж. шахта поднимается через ядро.\n\n"
        f"GPZU: покрытие {d.max_coverage_pct:.0f}%, высота ≤{d.max_height_m:.0f} м. "
        f"Отступы: {d.setback_front:.1f} м фронт, {d.setback_rear:.1f} м тыл, "
        f"{d.setback_side:.1f} м боковые.\n\n"
        f"TECH ZONES: «ВЕНТ» (0,6×0,6), «ЭЩ» (~1,5×1,5), «СС», «МСП» (0,4×0,4, у ядра), "
        f"«ВКР» (0,3×0,3, у каждой мокрой зоны)."
    )


def _render_control(d: PromptData) -> str:
    """Финальный контроль — сверяет нарисованное с конкретными числами выше."""
    lifts_line = (
        f"На плане {d.lifts_passenger} пасс. + {d.lifts_freight} груз. лифта — "
        f"проверь что нарисовано именно столько (не больше, не меньше)."
        if d.lifts_passenger > 0 else
        f"На плане ЛИФТОВ НЕТ ({d.floors} эт.) — убедись что нарисована ТОЛЬКО лестница Л-1, без лифтов."
    )
    return (
        f"═══ КОНТРОЛЬ ПЕРЕД ВЫВОДОМ (сверь нарисованное с числами выше) ═══\n"
        f"  1) {lifts_line}\n"
        f"  2) Квартир на плане ровно {d.n_units} — не больше, не меньше.\n"
        f"  3) Жилых комнат в каждой квартире = числу в её подписи (кухня НЕ комната).\n"
        f"  4) Есть «Спальня 1» → есть и «Спальня 2» (4-комн. — и «Спальня 3»).\n"
        f"  5) Σ площадей жилых комнат = S жил. каждой квартиры.\n"
        f"  6) Σ пролётов цепочки = длине здания; площадь застройки = {d.footprint_area:.0f} м²."
    )


# ---------------------------------------------------------------------------
# Главная функция
# ---------------------------------------------------------------------------

def build_marketing_prompt(inputs: MarketingInputs) -> str:
    """Собирает промпт для gpt-image-2. Вся логика — в _prepare()."""
    d = _prepare(inputs)
    return "\n\n".join([
        _STATIC_HEADER,
        _STATIC_ROOM_DEFINITION,
        _STATIC_LINE_WEIGHTS,
        _STATIC_TAIMAS,
        _render_subject(d),
        _STATIC_ANNOTATIONS,
        _render_engineering(d),
        _STATIC_COLOR,
        _STATIC_NEGATIVES,
        _STATIC_REFERENCE,
        _render_control(d),
    ])
