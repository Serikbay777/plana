"""Prompt-builder на основе master-prompt-kz-v2.

Структура: статические блоки (стиль, TAIMAS, негативы) + динамические
(пятно, квартирография с точной программой помещений, инженерия).
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

    insolation_priority: bool = True
    insolation_min_hours: float = 2.0

    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0

    site_polygon: tuple[tuple[float, float], ...] | None = None


# ---------------------------------------------------------------------------
# Статические блоки
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

⚠️ CRITICAL — DRAWING ASPECT RATIO: The plan MUST be drawn at the EXACT building footprint ratio specified below. If footprint is 60×40, the drawing rectangle must be 1.5:1 (wide). DO NOT draw a narrow vertical strip when a wide rectangle is requested. Use the FULL sheet area. Match the requested floor dimensions precisely."""

_STATIC_ROOM_DEFINITION = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ ОПРЕДЕЛЕНИЕ КОМНАТНОСТИ КВАРТИР (КАЗАХСТАНСКИЙ / ПОСТСОВЕТСКИЙ СТАНДАРТ)
ЭТО САМОЕ ВАЖНОЕ ПРАВИЛО ПЛАНИРОВКИ — НАРУШАТЬ НЕЛЬЗЯ
═══════════════════════════════════════════════════════════════════
В Казахстане «N-комнатная квартира» = N ЖИЛЫХ комнат.

ЖИЛЫЕ комнаты (считаются в N): Гостиная, Спальни, Детская, Кабинет,
«Жилая комната» (для 1-комнатных).

НЕ ЯВЛЯЮТСЯ КОМНАТАМИ и НЕ ВХОДЯТ в счёт N (никогда):
Кухня, Санузел/ванная/туалет/С/у, Прихожая, Коридор, Холл, Гардеробная,
Кладовая, Лоджия, Балкон, Тамбур.

ОБЯЗАТЕЛЬНЫЙ СОСТАВ по типам (каждая жилая комната — ОТДЕЛЬНОЕ помещение
со своей подписью и площадью; ничего не «подразумевать»):
  → Студия       = единая жилая зона ≥22 м² + кухня-ниша + с/у совмещённый + прихожая
  → 1-комнатная  = 1 ЖИЛАЯ КОМНАТА + кухня + с/у + прихожая (+ лоджия)
  → 2-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ (РОВНО 2 жилые комнаты) + кухня + с/у + прихожая (+ лоджия)
  → 3-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 (РОВНО 3 жилые комнаты,
                   ОБЕ спальни нарисованы и подписаны ОТДЕЛЬНО: «Спальня 1» И «Спальня 2»)
                   + кухня + с/у (или 2 с/у) + прихожая (+ лоджия)
  → 4-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 + СПАЛЬНЯ-3 (РОВНО 4 жилые)
                   + кухня + 2 с/у + прихожая (+ лоджия)

❌ ОШИБКА №1 — КУХНЯ КАК КОМНАТА: «гостиная + кухня» (без спальни) — это
   1-КОМНАТНАЯ, а НЕ 2-комнатная. «2-комнатная» = гостиная + спальня + кухня (отдельно).
❌ ОШИБКА №2 — НЕДОСЧЁТ СПАЛЕН: у «3-комнатной» ОБЯЗАНЫ быть ДВЕ спальни.
   Подпись «Спальня 1» БЕЗ парной «Спальня 2» запрещена.
   КОНТРОЛЬ ПЛОЩАДЕЙ: S жил. квартиры = сумме площадей ВСЕХ её жилых комнат.
   Если сумма видимых жилых комнат < S жил. — комната пропущена, ДОРИСОВАТЬ.

(US convention, где кухня входит в счёт комнат, здесь НЕВЕРНА.)
═══════════════════════════════════════════════════════════════════"""

_STATIC_DENSITY = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ РЕАЛИСТИЧНАЯ ПЛОТНОСТЬ И ПЛОЩАДИ КВАРТИР (анти-абсурд по размеру)
═══════════════════════════════════════════════════════════════════
Площади квартир должны быть РЕАЛИСТИЧНЫМИ по типу (ориентир СНиП РК):
  • Студия ~ 28 м²   • 1-комн. ~ 40–50 м²   • 2-комн. ~ 55–70 м²
  • 3-комн. ~ 80–95 м²   • 4-комн. ~ 100–115 м²

ЧИСЛО КВАРТИР НА ЭТАЖ должно соответствовать площади этажа:
  полезная площадь ≈ (длина × ширина) × 0,75   (минус стены/ядро/коридоры)
  разумное число квартир ≈ полезная площадь ÷ ~58 м² (средняя квартира)
  Пример: этаж 29×13 = 377 м² → полезно ~283 м² → ~5 квартир, НЕ 2 и НЕ 12.

❌ НЕ рисуй 2 квартиры на 377 м² — каждая выйдет ~140 м² (абсурд).
❌ НЕ рисуй 12 квартир на 377 м² — будут по ~24 м² (тесно, нарушает СНиП).
Если заданное число квартир даёт среднюю > 95 м² или < 32 м² на квартиру —
это сигнал, что параметры нереалистичны: придерживайся реалистичных площадей
по типу выше, а лишнюю площадь отдавай под общие зоны/коридоры.
═══════════════════════════════════════════════════════════════════"""

_STATIC_SECTION_RATIO = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ ПРОПОРЦИЯ СЕКЦИЙ И ЛИФТОВ (АНТИ-АБСУРД — соблюдать при компоновке)
═══════════════════════════════════════════════════════════════════
• МИНИМУМ КВАРТИР НА СЕКЦИЮ: ≥ 3–4. ПРОВЕРКА: (квартир ÷ секций) ≥ 3.
• ПРИ 2–5 КВАРТИРАХ НА ЭТАЖ — ОДНА точечная секция (point-tower) с ЕДИНЫМ
  ядром, БЕЗ деления противопожарной стеной на подъезды.
• НЕСКОЛЬКО секций — только от ~6–8 квартир на этаж (≥3–4 на секцию).
• ЛИФТЫ СТРОГО ПО ЭТАЖНОСТИ (НЕ ставить «на всякий случай»):
    – до 5 этажей  → ЛИФТОВ НЕТ, только лестница Л-1;
    – 5–9 этажей   → 1 пассажирский лифт на секцию;
    – 10+ этажей   → 2 пассажирских + 1 грузовой на секцию.
  Это правило ГЛАВНЕЕ любых примеров ниже. Если этажей ≤5 — на плане
  НЕ ДОЛЖНО быть НИ ОДНОГО лифта, только лестничная клетка.
• БАЛАНС ПЛОЩАДЕЙ: площадь общих помещений (ядро + коридоры + холлы) НЕ должна
  превышать суммарную площадь квартир. Если общее > жилого — секций/ядер
  слишком много на мало квартир: уменьши секции или увеличь число квартир.
═══════════════════════════════════════════════════════════════════"""

_STATIC_DIMENSION_ARITH = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ РАЗМЕРНЫЕ ЦЕПОЧКИ — АРИФМЕТИКА (числа обязаны складываться)
═══════════════════════════════════════════════════════════════════
• СУММА всех пролётов наружной цепочки по ВЕРХУ = общей длине здания
  (итоговому числу над цепочкой). Пример для 29 000 на 9 пролётов:
  3300+3200+3200+3200+3200+3200+3200+3200+3300 = 29 000. Сумма СХОДИТСЯ.
• СУММА пролётов по ЛЕВОМУ фасаду = ширине здания.
• ПЛОЩАДЬ ЗАСТРОЙКИ = длина × ширина (точно).
• «Жилая площадь этажа» = СУММА всех S жил. квартир.
• Итоговое число над цепочкой и пропорции рисунка = заданному футпринту.
  НЕ подписывай «29 000», если по факту нарисовано здание на ~26 000.
ПРИМЕЧАНИЕ: цифры на чертеже — данные, которые читатель складывает; держи их согласованными.
═══════════════════════════════════════════════════════════════════"""

_STATIC_LINE_WEIGHTS = """\
═══════════════════════════════════════════════════════════════════
LINE WEIGHTS (CRITICAL — like real Kazakh CAD)
═══════════════════════════════════════════════════════════════════
• EXTERIOR BEARING WALLS: thin black outline 0.5 mm, thickness ~400 mm, red-orange diagonal hatching (ANSI31, 45°, dense) — signature of bearing walls.
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
3. ✓ ROOM NUMBERS in small circles (Ø500mm) referencing the explication table.
4. ✓ EXPLICATION TABLE (Экспликация помещений): «№ | Наименование | Площадь, м²».
5. ✓ DOOR/WINDOW SPECS — «Д-1»,«Д-2»… for doors, «В-1»,«В-2»… for windows.
6. ✓ SECTION CUT ARROWS «1—1», «2—2» — thick black arrows on plan edges.
7. ✓ NORTH ARROW — small «С» compass (thin black ARROW, NOT a filled black blob),
   OUTSIDE the building outline, TOP-RIGHT margin.
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
• DIMENSION CHAINS: numbers in mm без единиц; СУММА пролётов = итогу здания
  (см. блок «РАЗМЕРНЫЕ ЦЕПОЧКИ»); narrow CAD font, horizontal.
• CUT-SECTION MARKERS «1—1», «2—2»: small thick arrows inward, 2 sets.
• ELEVATION MARKS: «±0.000» main floor, «-0.150» entrance steps.
• COMPASS «С»: thin black ARROW pointing up with «С», top-right (НЕ залитый круг).
• ROOM LABELS: имя + площадь под ним; narrow Cyrillic CAD font.
• TITLE BLOCK (bottom-right, Kazakh standard) — RENDER LABELS, leave name/firm cells EMPTY/«—»:
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
«Кв. №14», «S общ. = 65,10 м²», «S жил. = 30,70 м²»; section labels bold (только если секций >1).
═══════════════════════════════════════════════════════════════════"""

_STATIC_NEGATIVES = """\
═══════════════════════════════════════════════════════════════════
ABSOLUTE NEGATIVES (must NOT appear)
═══════════════════════════════════════════════════════════════════
× NO lifts at all when floors ≤ 5 (only staircase Л-1 — лифты строго по этажности)
× NO counting kitchen/с-у/прихожая/коридор/лоджия as жилая комната
× NO «2-комнатная» = гостиная + кухня (это 1-комнатная)
× NO «3-комнатная» with fewer than THREE жилые комнаты
× NO «Спальня 1» without paired «Спальня 2» (and «Спальня 3» for 4-room)
× NO apartments unrealistically large (>95 м²/кв. при заданном числе) or tiny (<32 м²)
× NO dimension chain whose bay sum ≠ building total
× NO площадь застройки ≠ длина×ширина
× NO multi-section split / противопожарная стена when apartments-per-section < 3
× NO «общая площадь» общих помещений > суммы квартир
× NO compass drawn as a filled black blob — it must be a thin arrow with «С»
× NO watercolor, photorealistic furniture, wood/parquet/marble, 3D/isometric, shadows
× NO Latin/English labels (только кириллица), NO Pinterest pastel, NO colored room fills
× NO narrow vertical strip when a wide footprint is requested
× NO sans-serif modern fonts (Roboto/Inter) — only narrow CAD fonts
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

_STATIC_CONTROL = """\
═══ КОНТРОЛЬ ПЕРЕД ВЫВОДОМ (пройди по пунктам перед финалом) ═══
  1) Этажность ≤5 → лифтов НЕТ (только лестница). Иначе лифты по этажности.
  2) Жилых комнат в каждой квартире = числу в подписи (кухня НЕ комната).
  3) Есть «Спальня 1» → есть и «Спальня 2» (4-комн. — и «Спальня 3»).
  4) Σ площадей жилых комнат = S жил. квартиры.
  5) Σ пролётов цепочки = длине здания; площадь застройки = длина×ширина.
  6) (квартир ÷ секций) ≥ 3, иначе одна точечная секция; общее ≤ жилого.
  7) Средняя площадь квартиры в реалистичном диапазоне по типу."""

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
  Кухня ≥9 (2+комн); Ванная ширина ≥1,5; С/у совмещ. ≥1,7 ширина;
  Прихожая ширина ≥1,4; Коридор ≥1,0."""


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _lifts_for_floors(floors: int) -> str:
    """Описание лифтов по этажности (правило ГЛАВНЕЕ всего)."""
    if floors < 5:
        return f"ЛИФТОВ НЕТ (этажей {floors} ≤ 5 — только лестница Л-1, без лифтов на плане)"
    elif floors <= 9:
        return f"1 пассажирский лифт на секцию (этажей {floors}: 5–9)"
    else:
        return f"2 пассажирских + 1 грузовой лифт на секцию (этажей {floors}: 10+)"


def _approx_unit_count(inputs: MarketingInputs) -> int:
    """Грубая оценка кол-ва квартир на этаже по площади пятна и миксу."""
    inner_w = max(0.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_h = max(0.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    floor_area = inner_w * inner_h
    if floor_area <= 0:
        return 4
    saleable = floor_area * 0.55
    if inputs.purpose in ("residential", "mixed_use"):
        avg = (
            28 * inputs.studio_pct +
            45 * inputs.k1_pct +
            65 * inputs.k2_pct +
            90 * inputs.k3_pct
        ) or 55
    elif inputs.purpose == "hotel":
        avg = 28
    elif inputs.purpose == "commercial":
        avg = 30
    else:
        avg = 55
    return max(2, min(round(saleable / avg), 30))


def _distribute_apartments(n_units: int, inputs: MarketingInputs) -> list[str]:
    """Разбивает n_units квартир на конкретные типы по процентам."""
    n_studio = round(inputs.studio_pct * n_units)
    n_k1 = round(inputs.k1_pct * n_units)
    n_k2 = round(inputs.k2_pct * n_units)
    n_k3 = n_units - n_studio - n_k1 - n_k2
    if n_k3 < 0:
        n_k2 = max(0, n_k2 + n_k3)
        n_k3 = 0
    types: list[str] = (
        ["studio"] * n_studio +
        ["k1"] * n_k1 +
        ["k2"] * n_k2 +
        ["k3"] * n_k3
    )
    while len(types) < n_units:
        types.append("k2")
    return types[:n_units]


def _apt_program(apt_type: str, apt_num: int) -> str:
    """Генерирует строку с программой помещений для одной квартиры."""
    if apt_type == "studio":
        return (
            f"  • Кв. №{apt_num} — СТУДИЯ (28–38 м²):\n"
            f"      Единая жилая зона ≥22 м² (гостиная + спальная зона совмещены)\n"
            f"      + Кухня-ниша ≥6 м² + С/у совмещённый + Прихожая"
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
            f"      ОБЯЗАТЕЛЬНО 3 ОТДЕЛЬНЫЕ жилые комнаты, каждая подписана:\n"
            f"        - ГОСТИНАЯ (≥16 м²)\n"
            f"        - СПАЛЬНЯ 1 (≥12 м²)   ← подписать именно «Спальня 1»\n"
            f"        - СПАЛЬНЯ 2 (≥10 м²)   ← ОБЯЗАТЕЛЬНО нарисовать и подписать «Спальня 2»\n"
            f"      + Кухня (≥9 м²) + С/у (можно 2) + Прихожая (+ Лоджия)\n"
            f"      КОНТРОЛЬ: S жил. = гостиная + спальня-1 + спальня-2. Если видна только «Спальня 1» — ОШИБКА."
        )


def _pct_summary(types: list[str]) -> str:
    """Текстовое резюме квартирографии."""
    n = len(types)
    parts = []
    for t, label in [("studio", "студий"), ("k1", "1-комн."), ("k2", "2-комн."), ("k3", "3-комн.")]:
        c = types.count(t)
        if c > 0:
            parts.append(f"{label}: {c} шт. ({round(c / n * 100)}%)")
    return ", ".join(parts)


def _build_apartment_block(inputs: MarketingInputs, n_units: int) -> str:
    """Блок с точной программой помещений каждой квартиры."""
    types = _distribute_apartments(n_units, inputs)
    programs = "\n".join(_apt_program(t, i + 1) for i, t in enumerate(types))
    summary = _pct_summary(types)
    return (
        f"⚠️ APARTMENT MIX — STRICT (комнатность по КЗ-стандарту; кухня и с/у НЕ комнаты):\n"
        f"Состав {n_units} квартир на этаж — точная программа помещений (НЕ менять, НЕ добавлять типы):\n\n"
        f"{programs}\n\n"
        f"Итого: {summary}. Типы НЕ менять, НЕ добавлять.\n"
        f"ПРОВЕРКА: в каждой 2-комн. — ДВЕ жилые комнаты, в 3-комн. — ТРИ. Кухня НЕ комната.\n"
        f"ДОПОЛНИТЕЛЬНО: «Спальня 1» → обязана быть «Спальня 2».\n"
        f"Σ площадей жилых комнат = S жил. (расхождение = пропущенная комната, дорисовать)."
    )


def _build_section_block(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Описание секционности с учётом правила лифтов и пропорции секций."""
    n_sections = max(1, inputs.sections)
    footprint_area = inner_w * inner_h
    apts_per_core = n_units / max(1, n_sections)
    # Авто-коллапс в одну секцию если < 3 квартир на ядро
    effective_sections = n_sections if apts_per_core >= 3 else 1
    lifts_desc = _lifts_for_floors(inputs.floors)

    # Предупреждение о плотности
    usable = footprint_area * 0.75
    avg_area = usable / max(1, n_units)
    density_note = ""
    if avg_area > 95:
        density_note = (
            f"\n(ВНИМАНИЕ: при {n_units} кв. на {footprint_area:.0f} м² средняя ~{avg_area:.0f} м² > 95 м² — "
            f"придерживайся реалистичных площадей по типу, лишнее → просторные комнаты/общие зоны.)"
        )
    elif avg_area < 32:
        density_note = (
            f"\n(ВНИМАНИЕ: при {n_units} кв. на {footprint_area:.0f} м² средняя ~{avg_area:.0f} м² < 32 м² — "
            f"квартиры нарушают СНиП; придерживайся реалистичных площадей по типу.)"
        )

    if effective_sections == 1:
        collapse_note = (
            f" (правило: {apts_per_core:.1f} кв./ядро < 3 → одна точечная башня)"
            if n_sections > 1 else ""
        )
        return (
            f"⚠️ APARTMENT COUNT — STRICT: EXACTLY {n_units} apartments per floor "
            f"(EXACTLY {n_units * inputs.floors} total for {inputs.floors} floors). "
            f"DO NOT draw more or fewer.{density_note}\n\n"
            f"Площадь застройки = {inner_w:.0f} × {inner_h:.0f} = {footprint_area:.0f} м² (в ТЭП).\n\n"
            f"⚠️ ЭТАЖНОСТЬ = {inputs.floors} → {lifts_desc}.\n\n"
            f"LAYOUT: ОДНА точечная секция (point-tower), ОДИН подъезд{collapse_note}. "
            f"Центральное ядро — лестница Л-1 + техшахты. "
            f"Коридор ≤12 м. Все {n_units} квартир вокруг ядра.\n"
            f"APARTMENT NUMBERING: «Кв. №1»…«Кв. №{n_units}» (сквозная, без секц. префиксов)."
        )
    else:
        section_w = inner_w / effective_sections
        apts_per_section_eff = max(1, n_units // effective_sections)
        numbering = "\n".join(
            f"  • Section {s}: «Кв. {s}-1»…«Кв. {s}-{apts_per_section_eff}»"
            for s in range(1, effective_sections + 1)
        )
        return (
            f"⚠️ APARTMENT COUNT — STRICT: EXACTLY {n_units} apartments per floor "
            f"(EXACTLY {n_units * inputs.floors} total for {inputs.floors} floors). "
            f"DO NOT draw more or fewer.{density_note}\n\n"
            f"Площадь застройки = {inner_w:.0f} × {inner_h:.0f} = {footprint_area:.0f} м² (в ТЭП).\n\n"
            f"⚠️ ЭТАЖНОСТЬ = {inputs.floors} → {lifts_desc}.\n\n"
            f"⚠️ SECTIONAL LAYOUT: {effective_sections}-SECTION building "
            f"(многосекционный, {effective_sections} подъезда). "
            f"Floor plate {inner_w:.0f}×{inner_h:.0f} м divided into {effective_sections} EQUAL sections, "
            f"each ~{section_w:.1f}×{inner_h:.0f} м.\n\n"
            f"SECTION BOUNDARIES: THICK FIRE-RATED WALLS REI 60 (double parallel lines ≥0.7 mm, "
            f"diagonal hatching). NO doorways crossing these walls.\n\n"
            f"EACH SECTION CONTAINS:\n"
            f"  • Central core: {lifts_desc} + 1 staircase Л-1\n"
            f"  • Short dead-end corridor ≤12 м\n"
            f"  • {apts_per_section_eff} apartments around the core\n"
            f"  • Section label: «СЕКЦИЯ 1», «СЕКЦИЯ 2»… (bold)\n\n"
            f"APARTMENT NUMBERING:\n{numbering}"
        )


def _build_engineering_block(inputs: MarketingInputs, n_units: int) -> str:
    """Инженерный блок: лифты, пожарка, паркинг, ГПЗУ, техзоны."""
    total_parking = round(n_units * inputs.floors * inputs.parking_spaces_per_apt)
    height = inputs.floors * 3.0
    lifts_desc = _lifts_for_floors(inputs.floors)
    if inputs.floors < 5:
        core_desc = (
            f"CORE: лестница Л-1 (U-shape, parallel tread lines 300 mm, upward arrow «↑») "
            f"в центральном ж/б ядре. ЛИФТОВ НЕТ — {inputs.floors} этажей ≤ 5. "
            f"(Лифты рисуются прямоугольником с «×» и подписью «ЛИФТ» ТОЛЬКО если этажность ≥5.)"
        )
    elif inputs.floors <= 9:
        core_desc = (
            f"CORE: 1 пассажирский лифт (прямоугольник с «×», подпись «ЛИФТ») + "
            f"лестница Л-1 (U-shape, parallel tread lines 300 mm, «↑») в центральном ядре. "
            f"({inputs.floors} этажей → {lifts_desc}.)"
        )
    else:
        core_desc = (
            f"CORE: 2 пассажирских лифта + 1 грузовой (прямоугольники с «×», «ЛИФТ») + "
            f"лестница Л-1 (U-shape, parallel tread lines 300 mm, «↑») в центральном ядре. "
            f"({inputs.floors} этажей → {lifts_desc}.)"
        )
    return (
        f"═══════════════════════════════════════════════════════════════════\n"
        f"ENGINEERING & SAFETY (visible on the plan)\n"
        f"═══════════════════════════════════════════════════════════════════\n"
        f"{core_desc}\n\n"
        f"FIRE SAFETY: эвакуация ≤{inputs.fire_evacuation_max_m:.0f} м от двери квартиры до лестницы; "
        f"≥{inputs.fire_evacuation_exits_per_section} эвак. выхода с этажа; "
        f"тупик коридора ≤{inputs.fire_dead_end_corridor_max_m:.0f} м; стрелки эвакуации к лестнице.\n\n"
        f"INSOLATION: крупные квартиры (2-3-комн.) на юг/юго-запад, мелкие — на север.\n\n"
        f"PARKING: {inputs.parking_underground_levels} подз. уровень, "
        f"~{total_parking} м-мест ({inputs.parking_spaces_per_apt:.1f}/кв.); "
        f"на типовом этаже не показан; инж. шахта поднимается через ядро.\n\n"
        f"GPZU: покрытие {inputs.max_coverage_pct:.0f}%, высота ≤{inputs.max_height_m:.0f} м "
        f"(~{inputs.floors} эт., ~{height:.0f} м). "
        f"Отступы: {inputs.setback_front_m:.1f} м фронт, {inputs.setback_rear_m:.1f} м тыл, "
        f"{inputs.setback_side_m:.1f} м боковые.\n\n"
        f"TECH ZONES: «ВЕНТ» (0,6×0,6), «ЭЩ» (~1,5×1,5), «СС», «МСП» (0,4×0,4, у ядра), "
        f"«ВКР» (0,3×0,3, у каждой мокрой зоны)."
    )


# ---------------------------------------------------------------------------
# Главная функция
# ---------------------------------------------------------------------------

def build_marketing_prompt(inputs: MarketingInputs) -> str:
    """Собирает полный промпт для gpt-image-2 на основе параметров пользователя."""
    inner_w = max(1.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_h = max(1.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    n_units = _approx_unit_count(inputs)

    subject_block = (
        f"═══════════════════════════════════════════════════════════════════\n"
        f"SUBJECT — RESIDENTIAL FLOOR (типовой этаж жилого здания)\n"
        f"═══════════════════════════════════════════════════════════════════\n"
        f"Building footprint EXACTLY {inner_w:.0f} × {inner_h:.0f} м — "
        f"DRAW AT THIS EXACT ASPECT RATIO, plan fills the sheet.\n"
        f"Площадь застройки = {inner_w:.0f} × {inner_h:.0f} = {inner_w * inner_h:.0f} м² (в ТЭП).\n"
        f"One typical floor of a {inputs.floors}-storey residential building.\n\n"
        f"{_build_section_block(inputs, n_units, inner_w, inner_h)}\n\n"
        f"{_build_apartment_block(inputs, n_units)}\n\n"
        f"{_STATIC_MIN_ROOMS}\n\n"
        f"{_STATIC_FURNITURE}\n\n"
        f"ANNOTATIONS:\n"
        f"  • «Кв. №N», под номером: «S общ. = … м²», «S жил. = … м²»\n"
        f"    (S жил. = сумма ТОЛЬКО жилых комнат, без кухни/с-у/прихожей/лоджии)\n"
        f"  • Над комнатой: имя; внутри: площадь «18,4 м²» (запятая-десятичная, м² надстрочный ²)"
    )

    return "\n\n".join([
        _STATIC_HEADER,
        _STATIC_ROOM_DEFINITION,
        _STATIC_DENSITY,
        _STATIC_SECTION_RATIO,
        _STATIC_DIMENSION_ARITH,
        _STATIC_LINE_WEIGHTS,
        _STATIC_TAIMAS,
        subject_block,
        _STATIC_ANNOTATIONS,
        _build_engineering_block(inputs, n_units),
        _STATIC_COLOR,
        _STATIC_NEGATIVES,
        _STATIC_REFERENCE,
        _STATIC_CONTROL,
    ])
