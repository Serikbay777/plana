"""Prompt-builder на основе master-prompt-kz-fixed.

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

    lifts_passenger: int = 2
    lifts_freight: int = 1

    insolation_priority: bool = True
    insolation_min_hours: float = 2.0

    max_coverage_pct: float = 50.0
    max_height_m: float = 30.0

    site_polygon: tuple[tuple[float, float], ...] | None = None


# ---------------------------------------------------------------------------
# Статические блоки (не зависят от параметров пользователя)
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

ЖИЛЫЕ комнаты (считаются в N):
  • Гостиная
  • Спальни
  • Детская
  • Кабинет (если используется как жилая комната)
  • «Жилая комната» (для 1-комнатных)

НЕ ЯВЛЯЮТСЯ КОМНАТАМИ и НЕ ВХОДЯТ в счёт N (никогда):
  • Кухня (kitchen) — это НЕ комната
  • Санузел / ванная / туалет / С/у — это НЕ комната
  • Прихожая (entry hall)
  • Коридор / Холл / Гардеробная / Кладовая / Лоджия / Балкон / Тамбур

ПОЭТОМУ обязательный состав по типам (каждая жилая комната — ОТДЕЛЬНОЕ
помещение со своей подписью и своей площадью; ничего не «подразумевать»):
  → Студия       = единая жилая зона ≥22 м² + кухня-ниша + с/у совмещённый + прихожая
  → 1-комнатная  = 1 ЖИЛАЯ КОМНАТА + кухня + с/у + прихожая (+ лоджия)
  → 2-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ (РОВНО 2 жилые комнаты)
                   + кухня + с/у + прихожая (+ лоджия)
  → 3-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 (РОВНО 3 жилые комнаты —
                   ОБЕ спальни нарисованы и подписаны ОТДЕЛЬНО:
                   «Спальня 1» И «Спальня 2», не только одна!)
                   + кухня + с/у (или 2 с/у) + прихожая (+ лоджия)
  → 4-комнатная  = ГОСТИНАЯ + СПАЛЬНЯ-1 + СПАЛЬНЯ-2 + СПАЛЬНЯ-3 (РОВНО 4 жилые,
                   все три спальни подписаны отдельно)
                   + кухня + 2 с/у + прихожая (+ лоджия)

❌ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО считать кухню жилой комнатой.
   «2-комнатная» = ОБЯЗАТЕЛЬНО гостиная + спальня + кухня (отдельно).
   «3-комнатная» = ОБЯЗАТЕЛЬНО гостиная + 2 спальни + кухня (отдельно).
   Это самая частая ошибка — НЕ допускать её.

❌ ЧАСТАЯ ОШИБКА №2 — НЕДОСЧЁТ СПАЛЕН В ТРЁШКАХ/ЧЕТВЁРКАХ:
   Если на чертеже у «3-комнатной» нарисованы только ГОСТИНАЯ + одна СПАЛЬНЯ —
   это ОШИБКА (по факту получилась 2-комнатная). У 3-комнатной ОБЯЗАНЫ быть
   ДВЕ отдельные спальни. Подпись «Спальня 1» БЕЗ парной «Спальня 2» —
   запрещена: если есть «Спальня 1», то ОБЯЗАТЕЛЬНО рисуется и «Спальня 2».
   КОНТРОЛЬ ПЛОЩАДЕЙ: S жил. квартиры ДОЛЖНА равняться сумме площадей ВСЕХ
   жилых комнат. Для 3-комнатной: S жил. = гостиная + спальня-1 + спальня-2.
   Если сумма видимых комнат меньше S жил. — значит комната пропущена, ДОРИСОВАТЬ.

(US convention where kitchen counts toward "bedroom count" is WRONG here.
 Use the post-Soviet / Kazakh convention defined above without exception.)
═══════════════════════════════════════════════════════════════════"""

_STATIC_SECTION_RATIO = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ ПРОПОРЦИЯ СЕКЦИЙ И КВАРТИР (АНТИ-АБСУРД — соблюдать при компоновке)
═══════════════════════════════════════════════════════════════════
Лифтово-лестничное ядро (лифты + лестница + холл) ДОРОГОЕ и занимает много
площади. Оно оправдано только при ДОСТАТОЧНОМ числе квартир, которые его
обслуживают. Соблюдай здравые пропорции:

• МИНИМУМ КВАРТИР НА СЕКЦИЮ: ≥ 3–4. НЕ рисуй полноценное ядро
  (2 пасс. + 1 груз. лифт + лестница) ради ОДНОЙ квартиры в секции —
  в реальности так не строят.
• ЕСЛИ квартир мало (всего 2–4 на этаж) — используй ОДНУ секцию
  (точечную башню, point-tower) с ЕДИНЫМ ядром на все квартиры этажа,
  а НЕ несколько секций с отдельными ядрами в каждой.
• НЕСКОЛЬКО секций (2+) применять только когда на КАЖДУЮ секцию приходится
  ≥ 3–4 квартиры (т.е. от ~6–8 квартир на этаж и больше).
• БАЛАНС ПЛОЩАДЕЙ: суммарная площадь ОБЩИХ помещений (ядро + коридоры +
  холлы + тамбуры + техпомещения) НЕ должна превышать суммарную площадь
  КВАРТИР на этаже. Если «общее» > «жилого» — значит ядер/секций слишком
  много на слишком мало квартир: уменьши число секций или увеличь число квартир.
• ЛИФТЫ ПО ЭТАЖНОСТИ: до 5 этажей лестница может быть без лифта; 5–9 этажей —
  обычно 1 пасс. лифт на секцию; 10+ этажей — 2 пасс. + 1 груз. на секцию.
  НЕ ставь 2 пасс. + груз. лифт в 4-этажке без необходимости.

ПРОВЕРКА перед компоновкой: (число квартир на этаж ÷ число секций) ≥ 3.
Если меньше — пересобери как одну точечную секцию.
═══════════════════════════════════════════════════════════════════"""

_STATIC_DIMENSION_ARITH = """\
═══════════════════════════════════════════════════════════════════
⚠️⚠️ РАЗМЕРНЫЕ ЦЕПОЧКИ — АРИФМЕТИКА И СОГЛАСОВАННОСТЬ С ПЛОЩАДЯМИ
═══════════════════════════════════════════════════════════════════
Размеры на чертеже должны быть ВНУТРЕННЕ согласованы:

• СУММА всех пролётов в наружной размерной цепочке по ВЕРХНЕМУ фасаду
  ОБЯЗАНА равняться общей длине здания (итоговому числу над цепочкой).
  Пример для длины 29 000 мм на 8 пролётов:
  3600+3600+3600+3600+3600+3600+3600+3200 = 29 000. Сумма СХОДИТСЯ.
  НЕ выдумывай произвольные пролёты, сумма которых не равна итогу.
• СУММА пролётов по ЛЕВОМУ фасаду ОБЯЗАНА равняться ширине здания.
• ПЛОЩАДЬ ЗАСТРОЙКИ в ТЭП = длина × ширина по наружным осям.
  Сверяй: «Площадь застройки» = длина(м) × ширина(м) — точное число.
• «Жилая площадь этажа» в ТЭП = СУММА всех S жил. квартир этажа.
• «Общая площадь этажа» ≈ сумма S общ. квартир + площадь общих помещений.
• Итоговое число над цепочкой и аспект-ratio рисунка ДОЛЖНЫ соответствовать
  заданному футпринту.

ПРИМЕЧАНИЕ: держи арифметику согласованной; цифры на чертеже — не декор,
а данные, которые читатель складывает и проверяет.
═══════════════════════════════════════════════════════════════════"""

_STATIC_LINE_WEIGHTS = """\
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
• DIMENSION LINES: thin black 0.13 mm with arrowheads, numbers in mm (no decimals)
═══════════════════════════════════════════════════════════════════"""

_STATIC_TAIMAS = """\
═══════════════════════════════════════════════════════════════════
TAIMAS-STANDARD CHECKLIST — обязательные элементы (real Kazakh DD-album)
═══════════════════════════════════════════════════════════════════
This drawing MUST include ALL of the following GOST/SPDS elements,
exactly like in real Almaty/Astana design-institute albums:

1. ✓ AXIS GRID — letter circles (А, Б, В, Г, Д, Е, Ж) on TOP edge and
   number circles (1, 2, 3, 4, 5...) on LEFT edge, Ø ~600mm, connected
   to the building outline by thin dashed grey lines extending past
   the walls. EVERY column-line and wall-axis gets a letter/number.

2. ✓ TRIPLE DIMENSION CHAINS along TOP and LEFT building edges
   (ОБЯЗАТЕЛЬНО — без них чертёж не читается):
   • inner chain  — wall-to-wall (between rooms)
   • middle chain — axis-to-axis (between letter/number axes)
   • outer chain  — total building dimension end-to-end
   All numbers in MILLIMETRES without unit suffix:
   «3450», «6000», «28800» — small narrow CAD font directly above
   the chain line, with arrow ticks (not arrowheads, ticks at 45°).

3. ✓ ROOM NUMBERS in small circles (Ø 500mm) inside each room,
   placed above the room name: «1», «2», «3»... (reference to explication table)

4. ✓ EXPLICATION TABLE (Экспликация помещений) — rectangular grid
   BELOW or to the RIGHT of the plan:
   3 columns: «№ | Наименование | Площадь, м²»

5. ✓ DOOR/WINDOW SPECIFICATIONS — «Д-1», «Д-2»... for doors, «В-1», «В-2»... for windows

6. ✓ SECTION CUT ARROWS «1—1», «2—2» — thick black arrows on plan edges

7. ✓ NORTH ARROW — small «С» (север) compass outside building outline, TOP-RIGHT margin

8. ✓ SCALE INDICATOR «М 1:100» in title block or under sheet title

9. ✓ SHEET TITLE at top: «ПЛАН ТИПОВОГО ЭТАЖА» — bold uppercase, large narrow CAD font

CRITICAL — без этих элементов чертёж выглядит «AI-нарисованным», а не профессиональным.
═══════════════════════════════════════════════════════════════════"""

_STATIC_ANNOTATIONS = """\
═══════════════════════════════════════════════════════════════════
UNIVERSAL ANNOTATIONS (Kazakh CAD style)
═══════════════════════════════════════════════════════════════════
• AXIS GRID:
  - Dashed thin grey lines extending beyond the plan
  - Each axis ends in a CIRCLE (~600 mm dia) with letter or number inside
  - Vertical axes: «А», «Б», «В», «Г», «Д», «Е», «Ж», «И» (avoid «З» — looks like 3)
  - Horizontal axes: «1», «2», «3»… up to «10»

• DIMENSION CHAINS (см. также блок «РАЗМЕРНЫЕ ЦЕПОЧКИ — АРИФМЕТИКА» выше):
  - Numbers in mm WITHOUT unit symbol: «1500», «2100», «2700», «4500», «7200»
  - Total building dimension in larger text: «25 200» or «60 000»
  - СУММА пролётов = итоговому размеру здания (обязательно сходится!)
  - All dimension text in narrow CAD font (ISOCPEUR/GOST), horizontal

• CUT-SECTION MARKERS «1—1» and «2—2»:
  - Small thick black arrow pointing INWARD to the plan from outside
  - Place 2 sets at strategic locations (across long axis and short axis)

• ELEVATION MARKS: triangle markers «±0.000» at main floor level, «-0.150» at entrance steps

• COMPASS «С» (north arrow) in top-right corner — small thin black arrow with «С» label

• ROOM LABELS (inside each room):
  - Room name: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая», «Тамбур», «Холл»
  - Area below: «80,1 м²», «32,7 м²» (Russian comma decimal, м² with superscript ²)
  - Narrow Cyrillic CAD font (ISOCPEUR/Arial Narrow)

• TITLE BLOCK (bottom-right — Kazakh standard):
  RENDER FIELD LABELS but LEAVE NAME/COMPANY CELLS EMPTY (placeholder «—»):
  «Изм. | Кол.уч. | Лист | N.док. | Подпись | Дата»
  «Разработал | — | — | —»  ← NO real names
  «Стадия: ЭП | Лист: — | Листов: —»
  «Строительство [—]», «г.Астана», «План типового этажа», «Лицензия [—]»
  NEVER insert real firm names (ТОО...) or real person names.

• AREA SUMMARY (right side or bottom):
  «Общая площадь — XXX м²», «Площадь застройки — XXX м²», «Жилая площадь — XXX м²»
═══════════════════════════════════════════════════════════════════"""

_STATIC_COLOR = """\
═══════════════════════════════════════════════════════════════════
COLOR PALETTE (Kazakh CAD style — strict, NOT marketing)
═══════════════════════════════════════════════════════════════════
• Background: pure white #ffffff (paper)
• All structural lines: pure black #000000
• Wall diagonal hatching: red-orange #c14d3d / terracotta — signature Kazakh CAD style
• Window glass: very pale blue #d8e7ef (wash effect, ~30% opacity)
• Window frames: pale steel blue #6b95b3 thin lines
• Bathroom fixtures (tub, toilet, sink): pale blue accent #b8d4e0 outlines
• ROOM INTERIORS: pure white background — NO pastel fills, NO color rotation between rooms
• NO wood grain, NO parquet, NO marble, NO photorealistic textures, NO gradients, NO shadows

TYPOGRAPHY (critical — must look like authentic Kazakh CAD):
• ALL labels in narrow CAD-style Cyrillic font: ISOCPEUR, GOST type A, or Arial Narrow
• Areas: «32,7 м²», «80,1 м²» (comma as decimal separator, м² with superscript ²)
• Apartment numbers: «Кв. №14», «S общ. = 65,10 м²», «S жил. = 30,70 м²»
• Section labels: «СЕКЦИЯ 1», «СЕКЦИЯ 2» — bold, larger height
═══════════════════════════════════════════════════════════════════"""

_STATIC_NEGATIVES = """\
═══════════════════════════════════════════════════════════════════
ABSOLUTE NEGATIVES (must NOT appear)
═══════════════════════════════════════════════════════════════════
× NO counting the kitchen (кухня) as a жилая комната — kitchen is NEVER a room
× NO counting bathroom/WC/санузел, hallway/прихожая, corridor, loggia/лоджия as rooms
× NO «2-комнатная» that actually contains only гостиная + кухня (that is a 1-комнатная)
× NO «3-комнатная» with fewer than THREE distinct жилые комнаты
× NO label «Спальня 1» without a paired «Спальня 2» (and «Спальня 3» for 4-room) — каждая трёшка обязана иметь ДВЕ нарисованные спальни
× NO dimension chain whose bay sum does NOT equal the building total (числа обязаны складываться в итог)
× NO площадь застройки, not equal to длина×ширина — сверяй арифметически
× NO multi-section split (противопожарная стена, 2+ подъезда) when apartments-per-section < 3
× NO full lift core (2 пасс. + грузовой) serving just 1 apartment per section
× NO «общая площадь» общих помещений превышает суммарную площадь квартир
× NO watercolor, painted illustration, Pinterest interior overlay
× NO photorealistic furniture (everything is line-drawing block diagrams)
× NO wood grain, parquet, marble textures, ceramic tile patterns
× NO 3D, isometric, perspective — strict 2D top-down only
× NO shadows, gradients, soft lighting effects, glow effects
× NO Latin/English labels — все надписи на русском кириллицей
× NO marketing brochure aesthetic, NO Pinterest pastel colors
× NO narrow vertical strip layout when wide footprint is requested
× NO unrealistically small rooms (kitchen 5 m², bedroom 4 m² — violates СНиП РК)
× NO missing elevator/staircase core in the center of the section
× NO COLORED ROOM FILLS (pale yellow/green/pink/etc — real Kazakh CAD has white rooms)
× NO sans-serif modern fonts like Roboto, Inter — only narrow CAD fonts
═══════════════════════════════════════════════════════════════════"""

_STATIC_REFERENCE = """\
═══════════════════════════════════════════════════════════════════
REFERENCE — exact visual style to match
═══════════════════════════════════════════════════════════════════
Real architectural floor plans from Kazakh design institutes (Almaty/Astana). Key visual cues:
• White A3 sheet, landscape orientation
• Axis numbering circles at perimeter: «1»…«10» horizontal, «А»-«Ж»-«И» vertical
• External dimension chains (mm without units) printed directly above the line
• Bearing walls with red-orange diagonal hatching (signature feature)
• Pale blue tinted glass in window openings
• Pale blue accent in bathroom fixtures
• Inside each room: room name + area: «Гостиная / 80,1 м²», «Кухня / 32,7 м²»
• Standard Cyrillic title block bottom-right with EMPTY fields (no real names)
• Overall feeling: official, technical, ready to be stamped «УТВЕРЖДАЮ»

The drawing should look indistinguishable from a real Kazakh DWG printout printed at A3.
Ratio 16:10, ultra-high resolution, every line crisp, every dimension legible. Pure engineering aesthetic.
═══════════════════════════════════════════════════════════════════"""

_STATIC_FURNITURE = """\
FURNITURE inside each apartment (simple top-down block icons, NOT photoreal):
  • Bedrooms: rectangle bed with «X» for pillow, bedside table, wardrobe long thin rectangle
  • Living rooms: L-shape sofa, round table, armchair circle, TV thin rectangle on wall
  • Kitchens: counter L along wall with sink + stove (square with 4 burner circles), fridge rectangle
  • Bathrooms: oval tub OR shower square, oval toilet, vanity rectangle
  • Hallways: built-in wardrobe rectangle, shoe storage
  • Loggias: small rectangles outside facade wall, labeled «Лоджия», 3-6 м²"""

_STATIC_MIN_ROOMS = """\
⚠️ MINIMUM ROOM SIZES (СНиП РК 3.02-43-2007 — STRICT):
  • Living room (гостиная): ≥ 16 м² for 2-3-room apts, ≥ 15 м² for 1-room
  • Master bedroom (спальня на 2 человека): ≥ 10 м²
  • Single bedroom: ≥ 8 м²
  • Kitchen: ≥ 9 м² for 2+ room apts (≥ 6 м² only for studios as kitchen-niche)
  • Bathroom (ванная): width ≥ 1.5 м
  • Combined WC (с/у совмещённый): ≥ 1.7 м wide
  • Hallway (прихожая): width ≥ 1.4 м
  • Internal corridor: ≥ 1.0 м"""


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

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
    """Разбивает n_units квартир на конкретные типы по процентам и возвращает список типов."""
    n_studio = round(inputs.studio_pct * n_units)
    n_k1 = round(inputs.k1_pct * n_units)
    n_k2 = round(inputs.k2_pct * n_units)
    n_k3 = n_units - n_studio - n_k1 - n_k2
    # Корректируем если вышло отрицательным
    if n_k3 < 0:
        n_k2 = max(0, n_k2 + n_k3)
        n_k3 = 0
    types: list[str] = (
        ["studio"] * n_studio +
        ["k1"] * n_k1 +
        ["k2"] * n_k2 +
        ["k3"] * n_k3
    )
    # Заполняем до n_units если что-то пошло не так
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
            f"      1 жилая комната → ЖИЛАЯ КОМНАТА (≥15 м²)\n"
            f"      + Кухня (≥9 м²) + С/у + Прихожая (+ Лоджия)"
        )
    elif apt_type == "k2":
        return (
            f"  • Кв. №{apt_num} — 2-КОМНАТНАЯ (55–70 м²):\n"
            f"      ОБЯЗАТЕЛЬНО 2 жилые комнаты → ГОСТИНАЯ (≥16 м²) + СПАЛЬНЯ (≥10 м²)\n"
            f"      + Кухня (≥9 м²) + С/у + Прихожая (+ Лоджия)"
        )
    else:  # k3
        return (
            f"  • Кв. №{apt_num} — 3-КОМНАТНАЯ (80–95 м²):\n"
            f"      ОБЯЗАТЕЛЬНО 3 ОТДЕЛЬНЫЕ жилые комнаты, каждая подписана:\n"
            f"        - ГОСТИНАЯ (≥16 м²)\n"
            f"        - СПАЛЬНЯ 1 (≥12 м²)   ← подписать именно «Спальня 1»\n"
            f"        - СПАЛЬНЯ 2 (≥10 м²)   ← ОБЯЗАТЕЛЬНО нарисовать и подписать «Спальня 2»\n"
            f"      + Кухня (≥9 м²) + С/у (можно 2) + Прихожая (+ Лоджия)\n"
            f"      КОНТРОЛЬ: S жил. = гостиная + спальня-1 + спальня-2. Если на чертеже\n"
            f"      видна только «Спальня 1» — это ОШИБКА, дорисовать «Спальня 2»."
        )


def _pct_summary(types: list[str]) -> str:
    """Текстовое резюме квартирографии."""
    n = len(types)
    parts = []
    for t, label in [("studio", "студий"), ("k1", "1-комн."), ("k2", "2-комн."), ("k3", "3-комн.")]:
        c = types.count(t)
        if c > 0:
            parts.append(f"{label}: {c} шт. ({round(c/n*100)}%)")
    return ", ".join(parts)


def _build_apartment_block(inputs: MarketingInputs, n_units: int) -> str:
    """Блок с точной программой помещений каждой квартиры."""
    types = _distribute_apartments(n_units, inputs)
    programs = "\n".join(_apt_program(t, i + 1) for i, t in enumerate(types))
    summary = _pct_summary(types)
    return (
        f"⚠️ APARTMENT MIX — STRICT (комнатность по казахстанскому стандарту, кухня и санузел НЕ комнаты):\n"
        f"Состав {n_units} квартир на этаж — точная программа помещений (НЕ менять, НЕ добавлять типы):\n\n"
        f"{programs}\n\n"
        f"Итого: {summary}.\n"
        f"These room programs are FIXED. Do NOT add apartment types not listed above.\n"
        f"ПРОВЕРКА перед отрисовкой: в каждой 2-комнатной видны ДВЕ жилые комнаты (гостиная + спальня),\n"
        f"в 3-комнатной — ТРИ жилые комнаты. Кухня нигде НЕ засчитывается как комната.\n"
        f"ДОПОЛНИТЕЛЬНО: если где-то есть подпись «Спальня 1» — ОБЯЗАНА присутствовать и «Спальня 2».\n"
        f"Сверь сумму площадей жилых комнат с указанной S жил.: они должны совпадать. Расхождение = пропущенная комната."
    )


def _build_section_block(inputs: MarketingInputs, n_units: int, inner_w: float, inner_h: float) -> str:
    """Описание секционности: точечный или многосекционный дом."""
    n_sections = max(1, inputs.sections)
    footprint_area = inner_w * inner_h
    apts_per_core = n_units / max(1, n_sections)
    # If ratio < 3, collapse to single point-tower regardless of requested sections
    effective_sections = n_sections if apts_per_core >= 3 else 1

    if effective_sections == 1:
        note = (
            f" (см. правило «ПРОПОРЦИЯ СЕКЦИЙ»: при {n_units} кв. на {n_sections} секций"
            f" → {apts_per_core:.1f} кв./ядро < 3, поэтому одна точечная башня)"
            if n_sections > 1 else ""
        )
        return (
            f"⚠️ APARTMENT COUNT — STRICT: EXACTLY {n_units} apartments per floor "
            f"(EXACTLY {n_units * inputs.floors} total for {inputs.floors} floors). "
            f"DO NOT draw more or fewer apartments than this number. "
            f"Single-section point tower with {n_units} apartments per floor{note}.\n\n"
            f"Площадь застройки = {inner_w:.0f} × {inner_h:.0f} = {footprint_area:.0f} м² "
            f"(используй именно это число в ТЭП).\n\n"
            f"POINT-TOWER LAYOUT (1 section): central reinforced-concrete core. "
            f"Лифты по этажности: {inputs.floors} этажей → "
            f"{'лестница без лифта (до 5 эт.)' if inputs.floors < 5 else f'{inputs.lifts_passenger} пасс. + {inputs.lifts_freight} груз. лифт'}. "
            f"All {n_units} apartments arranged AROUND the central core. "
            f"НЕ делить на секции."
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
            f"DO NOT draw more or fewer.\n\n"
            f"Площадь застройки = {inner_w:.0f} × {inner_h:.0f} = {footprint_area:.0f} м² "
            f"(используй именно это число в ТЭП).\n\n"
            f"⚠️ CRITICAL — SECTIONAL LAYOUT: {effective_sections}-SECTION building "
            f"(многосекционный, {effective_sections} подъезда). "
            f"Floor plate {inner_w:.0f}×{inner_h:.0f} м divided into {effective_sections} EQUAL sections, "
            f"each ~{section_w:.1f}×{inner_h:.0f} м.\n\n"
            f"SECTION BOUNDARIES: THICK FIRE-RATED WALLS REI 60 (double parallel lines ≥0.7 mm, "
            f"diagonal hatching). NO doorways crossing these walls.\n\n"
            f"EACH SECTION CONTAINS:\n"
            f"  • Central core: лифты по этажности ({inputs.floors} эт.) + 1 staircase Л-1\n"
            f"  • Short dead-end corridor ≤12 м\n"
            f"  • {apts_per_section_eff} apartments around the core\n"
            f"  • Section label: «СЕКЦИЯ 1», «СЕКЦИЯ 2»…\n\n"
            f"APARTMENT NUMBERING:\n{numbering}"
        )


def _build_engineering_block(inputs: MarketingInputs, n_units: int) -> str:
    """Инженерный блок: лифты, пожарка, паркинг, ГПЗУ, техзоны."""
    total_parking = round(n_units * inputs.floors * inputs.parking_spaces_per_apt)
    height = inputs.floors * 3.0  # примерно
    return (
        f"═══════════════════════════════════════════════════════════════════\n"
        f"ENGINEERING & SAFETY (visible on the plan)\n"
        f"═══════════════════════════════════════════════════════════════════\n"
        f"LIFT GROUP: {inputs.lifts_passenger} passenger elevator(s) + "
        f"{inputs.lifts_freight} freight elevator "
        f"(rectangles with diagonal cross «×», labeled «ЛИФТ») + "
        f"U-shaped staircase (parallel tread lines 300 mm apart, upward arrow «↑», labeled «Л-1»). "
        f"Concentrated in central reinforced-concrete core(s).\n\n"
        f"FIRE SAFETY: maximum evacuation distance ≤{inputs.fire_evacuation_max_m:.0f} м "
        f"from any apartment door to staircase. "
        f"{inputs.fire_evacuation_exits_per_section} evacuation exits per section. "
        f"Dead-end corridor ≤{inputs.fire_dead_end_corridor_max_m:.0f} м. "
        f"Show evacuation arrows from each unit toward the staircase.\n\n"
        f"INSOLATION: large units (2-3 bedroom) face south or south-west, smaller units face north.\n\n"
        f"PARKING: {inputs.parking_underground_levels} underground level(s), "
        f"~{total_parking} parking spaces total "
        f"({inputs.parking_spaces_per_apt:.1f} per apartment). "
        f"Parking NOT shown on this floor; engineering shaft rises through central core.\n\n"
        f"GPZU CONSTRAINTS: max site coverage {inputs.max_coverage_pct:.0f}%, "
        f"height ≤{inputs.max_height_m:.0f} м (~{inputs.floors} floors, ~{height:.0f} м). "
        f"Setbacks: {inputs.setback_front_m:.1f} м front, {inputs.setback_rear_m:.1f} м rear, "
        f"{inputs.setback_side_m:.1f} м sides.\n\n"
        f"TECH ZONES (mark on plan): «ВЕНТ» (vent shaft, 0.6×0.6 м), «ЭЩ» (electrical ~1.5×1.5 м), "
        f"«СС» (weak-current), «МСП» (trash chute, 0.4×0.4 м, near core), "
        f"«ВКР» (water riser, 0.3×0.3 м, near each wet zone)."
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
        f"Standard Kazakh CAD title block in BOTTOM-RIGHT corner (ALL NAME/COMPANY CELLS EMPTY OR «—»):\n"
        f"  «Изм. | Кол.уч. | Лист | N.док. | Подпись | Дата»\n"
        f"  «Разработал | — | — | —»  (NO real names)\n"
        f"  «Стадия: ЭП | Лист: — | Листов: —»\n"
        f"  «Строительство [—]», «г.Астана», «План типового этажа», «Лицензия [—]»\n\n"
        f"Building footprint EXACTLY {inner_w:.0f} × {inner_h:.0f} м — "
        f"DRAW THE PLAN AT THIS EXACT ASPECT RATIO with the entire plan filling the sheet.\n"
        f"One typical floor of a {inputs.floors}-storey residential building.\n\n"
        f"{_build_section_block(inputs, n_units, inner_w, inner_h)}\n\n"
        f"{_build_apartment_block(inputs, n_units)}\n\n"
        f"{_STATIC_MIN_ROOMS}\n\n"
        f"{_STATIC_FURNITURE}\n\n"
        f"ANNOTATIONS inside the plan:\n"
        f"  • Apartment numbers per section (Кв. №1, Кв. №2…)\n"
        f"  • «S общ. = 45.20 м²», «S жил. = 32.10 м²» — areas under each apartment number\n"
        f"    (S жил. = сумма площадей ТОЛЬКО жилых комнат, БЕЗ кухни/с-у/прихожей/лоджии)\n"
        f"  • Room labels: «Гостиная», «Спальня», «Кухня», «С/у», «Прихожая», «Лоджия»\n"
        f"  • Room areas inside each room: realistic values in м²"
    )

    return "\n\n".join([
        _STATIC_HEADER,
        _STATIC_ROOM_DEFINITION,
        _STATIC_SECTION_RATIO,
        _STATIC_LINE_WEIGHTS,
        _STATIC_TAIMAS,
        _STATIC_DIMENSION_ARITH,
        subject_block,
        _STATIC_ANNOTATIONS,
        _build_engineering_block(inputs, n_units),
        _STATIC_COLOR,
        _STATIC_NEGATIVES,
        _STATIC_REFERENCE,
    ])
