"""TAIMAS-стандарт промптов для полного альбома (30 типов листов).

ОТЛИЧИЕ от sheet_prompts.py:
  • sheet_prompts.py — фиксированные промпты для PDF-Виз
    (генерируем рендер «по теме страницы» из загруженного PDF)
  • album_prompts.py — ПАРАМЕТРИЗОВАННЫЕ промпты для генерации
    с нуля по параметрам формы. Каждый шаблон содержит плейсхолдеры
    типа {floors}, {width_m}, {depth_m}, {sections}, и т.д., которые
    подставляются перед отправкой в gpt-image.

ИСТОЧНИК СТАНДАРТА: ресёрч реального альбома TAIMAS-М 2025
(28 страниц альбома АВ2-ДР-РР-ДСТБ-65086 в Алматы).

ПРИНЦИПЫ оформления (применяются ко ВСЕМ листам, через _common_taimas_rules):
  1. Sheet format A1 landscape, white paper background
  2. Cyrillic GOST font (ISOCPEUR / Arial Narrow)
  3. CAD line weights: bearing walls 0.5mm + red-orange ANSI31 hatching,
     partitions 0.25mm thin, dimensions 0.13mm
  4. Axis grid: letter circles А-Ж на top, number circles 1-N слева
  5. Triple dimension chains (wall/axis/total) на top и left
  6. Title block bottom-right с пустыми ячейками или «—»
  7. North arrow «С» в top-right
  8. Section cut markers «1-1», «2-2» на edges
  9. NO marketing aesthetic, NO 3D, NO Latin labels, NO colored fills
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .marketing_prompt import MarketingInputs


# ─── enum типов листов в альбоме ───────────────────────────────────────────


SHEET_KIND_TITLE              = "title"
SHEET_KIND_GENERAL_DATA       = "general_data"
SHEET_KIND_EXPLANATORY_NOTE   = "explanatory_note"
SHEET_KIND_BASEMENT_PLAN      = "basement_plan"
SHEET_KIND_FLOOR_PLAN         = "floor_plan"           # параметр: floor_number
SHEET_KIND_ROOF_PLAN          = "roof_plan"
SHEET_KIND_SECTION            = "section"              # параметр: section_label («1-1», «2-2»)
SHEET_KIND_FACADE             = "facade"               # параметр: side ("S"/"N"/"W"/"E")
SHEET_KIND_WINDOWS_SPEC       = "windows_spec"
SHEET_KIND_DOORS_SPEC         = "doors_spec"
SHEET_KIND_WINDOWS_DETAILS    = "windows_details"
SHEET_KIND_DOORS_DETAILS      = "doors_details"
SHEET_KIND_WINDOW_NODE        = "window_node"          # узел окна-к-стене
SHEET_KIND_EVAC_PLAN          = "evac_plan"            # параметр: floor_number
SHEET_KIND_OPENINGS_PLAN      = "openings_plan"        # параметр: floor_number
SHEET_KIND_STAIRS_NODES       = "stairs_nodes"
SHEET_KIND_RAILINGS_NODES     = "railings_nodes"
SHEET_KIND_LIFT_SECTION       = "lift_section"
SHEET_KIND_FRAME_NODES        = "frame_nodes"
SHEET_KIND_HERO_RENDER        = "hero_render"          # маркетинговый
SHEET_KIND_MASTERPLAN         = "masterplan"           # маркетинговый аэровид
SHEET_KIND_INTERIOR_STUDIO    = "interior_studio"
SHEET_KIND_INTERIOR_K1        = "interior_k1"
SHEET_KIND_INTERIOR_K2        = "interior_k2"
SHEET_KIND_INTERIOR_K3        = "interior_k3"


@dataclass(frozen=True)
class AlbumSheetSpec:
    """Спецификация одного листа альбома.

    template содержит placeholders в формате {field_name}; они подставляются
    из params через `render_album_sheet`.
    """
    kind: str
    label: str                       # для UI: «План 2-го этажа»
    aspect: str                      # «16:9», «A3" landscape», etc.
    template: str                    # промпт с placeholders
    extra_params: dict[str, Any] = field(default_factory=dict)


# ─── Общие правила TAIMAS-стиля (вшивается в каждый шаблон) ────────────────


_TAIMAS_COMMON_RULES = """
═══════════════════════════════════════════════════════════════════
TAIMAS-СТАНДАРТ (real Kazakh DD-album style)
═══════════════════════════════════════════════════════════════════

⚠️ THIS IS A STRICT ENGINEERING DRAWING — NOT a marketing brochure, NOT a
Pinterest illustration, NOT a watercolor. Pure CAD vector line work as in
real Kazakh architectural design-institute albums (Алматы, Астана).

VISUAL CUES (все обязательны):
• Pure white paper background, NO color tints in rooms, NO pastel fills
• Bearing walls: thin black outline 0.5mm + RED-ORANGE diagonal ANSI31
  hatching inside wall thickness (45° angle, dense 4-5mm spacing). This
  hatching is the SIGNATURE of Kazakh CAD bearing walls.
• Non-bearing partitions: 0.25mm twin parallel lines, no hatching
• Windows: pale blue (#d8e7ef) glass area, triple parallel frame lines
• Cyrillic GOST font (ISOCPEUR / Arial Narrow), narrow letterforms
• ALL labels in Russian Cyrillic — NO English/Latin text

TITLE BLOCK in bottom-right corner (small grid, ALL CELLS EMPTY or «—»):
  «Изм. | Кол.уч. | Лист | N.док. | Подпись | Дата»
  «Стадия: ЭП | Лист: — | Листов: —»
  «Разработал: — | — | —»
  «Plana AI · plana.kz · {date}»
  Leave personal-name and firm cells BLANK with dash «—».

ABSOLUTE NEGATIVES (must NOT appear):
× NO watercolor, NO painted illustration, NO Pinterest aesthetic
× NO photorealistic furniture (only line-drawing block diagrams)
× NO wood grain, parquet, marble, ceramic tile textures
× NO 3D, isometric, perspective — strict 2D top-down for plans
× NO shadows, gradients, soft lighting, glow effects
× NO Latin/English labels — все надписи на русском кириллицей
× NO colored room fills (real Kazakh CAD has white rooms)
× NO modern sans-serif fonts (Roboto, Inter) — only CAD narrow fonts
""".strip()


# ─── Шаблоны 30 типов листов ───────────────────────────────────────────────
# В Sprint 1a реализуем 8 базовых типов. Остальные 22 — Sprint 1b.


_TEMPLATES: dict[str, AlbumSheetSpec] = {}


def _register(spec: AlbumSheetSpec) -> None:
    _TEMPLATES[spec.kind] = spec


# 1. ТИТУЛЬНЫЙ ЛИСТ ─────────────────────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_TITLE,
    label="Титульный лист",
    aspect="A3 portrait",
    template="""
Title page of an architectural project album, Kazakh DD-album style (ТОО TAIMAS-М 2025 reference).
Pure white A3 portrait sheet. NOT a marketing brochure — strict engineering documentation.

LAYOUT (top to bottom, centered):
• Large bold uppercase project name: «{project_name}»
• Subtitle: «МНОГОКВАРТИРНЫЙ ЖИЛОЙ ДОМ»
• Project location: «г. {city}»
• Building parameters table (small grid, 2 columns):
  - Габариты пятна: {width_m} × {depth_m} м
  - Этажность: {floors} эт.
  - Секций: {sections}
  - Лифтов на секцию: {lifts_passenger} пасс. + {lifts_freight} груз.
  - Дата: {date}
  - Стадия: ЭП (эскизный проект)
• Project code shifr: «PL2025-{project_code}»
• Album volume mark: «ТОМ III · Альбом 1 · Архитектурно-строительные решения»

Bottom-right corner: empty stamp grid with «Plana AI · plana.kz · автоген» label.
Top-left: small abstract logo placeholder (geometric shape, NO real branding).

{common_rules}
""".strip(),
))


# 2. ОБЩИЕ ДАННЫЕ / СОСТАВ АЛЬБОМА ─────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_GENERAL_DATA,
    label="Общие данные",
    aspect="A1 landscape",
    template="""
"General data" sheet of architectural album, Kazakh DD-album style.
Pure white A1 landscape sheet, densely packed with tables and small text.

LAYOUT (top to bottom):
• Sheet title: «ОБЩИЕ ДАННЫЕ»
• Table 1 «ВЕДОМОСТЬ ОСНОВНЫХ ЧЕРТЕЖЕЙ»: 3 columns (№, Наименование, Лист)
  with ~30 rows listing all sheets of the album:
  1 Титульный лист — Лист 1
  2 Общие данные — Лист 2
  3 Пояснительная записка — Лист 3
  4 План подвала — Лист 4
  5-{floors_plus_4} План 1...{floors}-го этажа — Лист 5...{floors_plus_4}
  ... and so on for sections, facades, specs, details
• Table 2 «ЭКСПЛИКАЦИЯ ПОМЕЩЕНИЙ ГЕНПЛАНА»: 4 columns
  (№, Наименование, Площадь м², Категория)
• Table 3 «ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ»:
  - Площадь застройки: {width_m} × {depth_m} = {floor_area} м²
  - Общая площадь здания: ~{total_area} м²
  - Этажность: {floors}
  - Квартир всего: ~{total_apartments}
  - Микс: студии {studio_pct}% / 1к {k1_pct}% / 2к {k2_pct}% / 3к {k3_pct}%

Use narrow CAD font, GOST table borders, no colors except for the
table header row (light grey shading).

{common_rules}
""".strip(),
))


# 4. ПЛАН ПОДВАЛА ──────────────────────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_BASEMENT_PLAN,
    label="План подвала",
    aspect="A1 landscape",
    template="""
"План подвала · М 1:100" — basement floor plan of a {floors}-storey
residential building, Kazakh DD-album CAD style.

BUILDING FOOTPRINT: {width_m} × {depth_m} m, {sections} section(s).
LEVEL TYPE: Technical underground floor — no apartments, only structural
elements and engineering rooms.

CONTENT (top-down orthographic view, scale 1:100):
• Monolithic reinforced concrete walls with red-orange ANSI31 hatching
• Structural column grid in regular pattern
• Foundation slab visible as the floor base
• Engineering rooms labeled: «ИТП», «ЭЛЕКТРОЩИТОВАЯ», «НАСОСНАЯ»,
  «ВОДОМЕРНЫЙ УЗЕЛ», «КАМЕРА УЧЁТА»
• Storage units (кладовые) for apartments — small rooms numbered Кл-1 ... Кл-N
• Stairway access from each section labeled «Л-1», «Л-2»
• Elevator shaft outlines, dashed (lifts don't open at basement level
  unless mixed_use)
• No windows on basement walls (or small horizontal slot windows
  near ceiling)

MANDATORY ELEMENTS:
• Axis grid: letter circles А-Ж top, number circles 1-N left, Ø500mm
• Triple dimension chains on top and left edges (mm without units)
• Title block bottom-right: «План подвала», «М 1:100», stage ЭП

{common_rules}
""".strip(),
))


# 5. ПЛАН ЭТАЖА (универсальный — параметризован floor_number) ──────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_FLOOR_PLAN,
    label="План этажа",
    aspect="A1 landscape",
    template="""
"План {floor_number}-го этажа · М 1:100" — apartment floor plan,
Kazakh DD-album CAD style. {level_description}

BUILDING FOOTPRINT: {width_m} × {depth_m} m, {sections} section(s).

APARTMENT MIX (must match exactly):
- {studio_pct}% studios (28-32 m²)
- {k1_pct}% 1-bedroom (40-50 m²)
- {k2_pct}% 2-bedroom (55-70 m²)
- {k3_pct}% 3-bedroom (80-95 m²)

VERTICAL CIRCULATION (center of each section):
- {lifts_passenger} passenger elevator(s) + {lifts_freight} freight
- 1 staircase «Л-1» (U-shape, parallel tread lines)
- Central corridor ≤ 12 m dead-end

CONTENT (top-down 2D, scale 1:100):
• Apartment numbering: «Кв.{floor_number}-1», «Кв.{floor_number}-2»...
• Room labels in narrow GOST font: «Гостиная», «Кухня», «Спальня»,
  «С/у», «Прихожая», «Лоджия»
• Area beneath each room name: «32,7 м²», «80,1 м²»
• Section labels: «СЕКЦИЯ 1»{section_labels_extra}
• Section cut markers «1-1», «2-2» as arrows on plan edges

MANDATORY СПДС ELEMENTS:
• Axis grid letter circles (А-Ж top) + number circles (1-N left), Ø500mm
• Triple dimension chains on top and left edges
• North arrow «С» in top-right corner outside building outline
• Title block bottom-right: «План {floor_number}-го этажа», «М 1:100»

LINE WEIGHTS:
• Bearing walls: 0.5mm outline + red-orange ANSI31 hatching, 400mm thick
• Partitions: 0.25mm twin lines, no hatching, 120mm thick
• Doors: thin lines + arc swing
• Windows: pale blue triple lines, glass tinted #d8e7ef

{common_rules}
""".strip(),
))


# 6. ПЛАН КРОВЛИ ───────────────────────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_ROOF_PLAN,
    label="План кровли",
    aspect="A1 landscape",
    template="""
"План кровли · М 1:100" — roof plan of a {floors}-storey residential
building, Kazakh DD-album CAD style.

BUILDING FOOTPRINT: {width_m} × {depth_m} m, {sections} section(s).
ROOF TYPE: Flat ventilated roof at +{roof_elevation} m.

CONTENT (top-down 2D, scale 1:100):
• Parapet around perimeter (drawn as double line offset 600mm inside)
• Roof slope arrows directed toward central drainage funnels
• Drainage funnels (воронки) placed every ~15 m, marked with circle
• Emergency overflow scuppers near edges
• Ventilation shafts (вент.шахты) labeled «ВВ-1», «ВВ-2»...,
  each {sections}×{floors} per section
• Roof access ladders, marked «ЛК»
• Central machine room / staircase exit structure raised above roof,
  labeled «ВЫХОД НА КРОВЛЮ»
• Roof flashings at edges (metal capping, double-line drawing)
• Antenna mounts, lightning protection (small circles + lines to perimeter)

MATERIALS LEGEND (in corner box):
  - Покрытие: рулонная гидроизоляция в 2 слоя
  - Утеплитель: минвата 180 мм
  - Уклон: 1.5%

MANDATORY СПДС ELEMENTS:
• Axis grid А-Ж top + 1-N left, Ø500mm
• Triple dimension chains top and left
• North arrow «С» top-right
• Title block bottom-right

{common_rules}
""".strip(),
))


# 7. РАЗРЕЗ (универсальный — параметризован section_label) ─────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_SECTION,
    label="Разрез",
    aspect="A1 landscape",
    template="""
"Разрез {section_label} · М 1:100" — vertical cross-section through the
entire building, Kazakh DD-album CAD style.

BUILDING: {floors}-storey, footprint {width_m} × {depth_m} m, {sections} section(s).
SECTION AXIS: {section_axis_description}

CONTENT (vertical orthographic projection):
• Foundation slab at elevation -{basement_depth} m
• Basement walls (reinforced concrete) with red-orange ANSI31 hatching
• Floor slabs at each level — 200mm RC slabs with hatching, labeled with
  elevation marks: ±0.000, +{floor_height_1}, +{floor_height_2}, ...
• Bearing walls vertical with red-orange ANSI31 hatching
• Partitions thin double lines
• Window openings on facade — pale blue triple lines, glass tinted
• Roof parapet at top, elevation +{roof_elevation}
• Stairs through center: parallel tread lines, mark «Л-1»
• Apartment outlines on each floor — semi-transparent furniture
  suggestions (sofa, bed) as simple block icons

ELEVATION MARKS (right side, vertical chain):
  ±0,000   — 1-й этаж
  +{floor_height_1}   — 2-й этаж
  +{floor_height_2}   — 3-й этаж
  ...
  +{roof_elevation}  — Парапет

MANDATORY СПДС:
• Section marker references at edges «{section_label}»
• Dimension chain on right side (elevation marks)
• Horizontal dimension chain at bottom (axis spacing)
• Title block bottom-right: «Разрез {section_label}», «М 1:100»

{common_rules}
""".strip(),
))


# 8. ФАСАД (универсальный — параметризован side) ──────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_FACADE,
    label="Фасад",
    aspect="A1 landscape",
    template="""
"{facade_title} · М 1:100" — vertical orthographic facade view of a
{floors}-storey residential building, Kazakh DD-album CAD style.

FACADE SIDE: {facade_side_description}
FACADE LENGTH: {facade_length_m} m

CONTENT (frontal orthographic projection, scale 1:100):
• Ground level baseline at elevation ±0.000
• Building outline rising to roof parapet at +{roof_elevation}
• Window grid: {floors} rows × N columns of aluminum-framed windows
  - Width {window_width} mm typical
  - Pale blue tinted glass (#d8e7ef)
  - Frame thin steel-blue lines
• Balconies on side facades (if applicable): {balcony_description}
• Main entrance bay on south facade (if applicable): {entrance_description}
• Facade materials with RAL color callouts:
  - Plinth (нижняя часть): granite cladding RAL 9001 (cream-beige)
  - Floors 2-{floors}: HPL panels RAL 9010 (bright white)
  - Central entrance bay: clinker brick RAL 7044 (warm beige)
  - Parapet crown: seam-folded metal RAL 9022 (anthracite)
  - Aluminum accents: RAL 9006 (silver-grey)

ELEVATION MARKS (left side, vertical chain):
  ±0.000   — Уровень земли
  +{floor_height_1}   — 2 этаж
  +{floor_height_2}   — 3 этаж
  ...
  +{roof_elevation}  — Парапет

LINE WEIGHTS:
• Building outline: 0.7mm thick black
• Window/door frames: 0.3mm
• Material change boundaries: 0.4mm
• Decorative cornice lines: 0.25mm

NO PHOTOREALISM — strict orthographic flat 2D facade as in real
СПДС album. NO shadows, NO 3D, NO sky background.

MANDATORY СПДС:
• Title block bottom-right: «{facade_title}», «М 1:100»
• Axis circles along bottom edge (А, Б, В, Г, Д)
• Horizontal dimension chain at bottom

{common_rules}
""".strip(),
))


# 9. СПЕЦИФИКАЦИЯ ОКОННЫХ БЛОКОВ ──────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_WINDOWS_SPEC,
    label="Спецификация оконных блоков",
    aspect="A1 landscape",
    template="""
"ВЕДОМОСТЬ ОКОННЫХ БЛОКОВ" — window specification sheet of a
{floors}-storey residential building, Kazakh DD-album CAD style.

CONTENT — large table with 7 columns:
1. Поз. (position): В-1, В-2, В-3...В-{window_count}
2. Обозначение (designation): ГОСТ 23166-99 «ОП»
3. Тип (type): single-sash, double-sash, triple-sash, panoramic
4. Ширина × Высота (W × H, mm)
5. Кол-во (count)
6. Материал (material): алюм. профиль / ПВХ / дерево
7. Примечание (notes)

Approximately {window_count} rows total (typical mix):
  В-1  ГОСТ 23166-99  Одностворчатое  600×1500   {qty_w1}  Алюм.  С/у
  В-2  ГОСТ 23166-99  Двухстворчатое  1200×1500  {qty_w2}  Алюм.  Спальня
  В-3  ГОСТ 23166-99  Двухстворчатое  1500×1500  {qty_w3}  Алюм.  Кухня
  В-4  ГОСТ 23166-99  Трёхстворчатое  1800×1500  {qty_w4}  Алюм.  Гостиная
  В-5  ГОСТ 23166-99  Панорамное      2400×2700  {qty_w5}  Алюм.  Лоджия

Below the table: short text describing thermal performance
requirements per СНиП РК 2.04-21:
  «Светопрозрачные конструкции с приведённым сопротивлением
  теплопередаче не менее R₀ = 0,55 м²·°C/Вт».

MANDATORY СПДС:
• Table borders 0.5mm black, internal lines 0.25mm
• Header row in light grey shading
• Cyrillic GOST narrow font in all cells
• Title block bottom-right: «Спецификация оконных блоков», «Лист N»

{common_rules}
""".strip(),
))


# 10. СПЕЦИФИКАЦИЯ ДВЕРНЫХ БЛОКОВ ─────────────────────────────────────────
_register(AlbumSheetSpec(
    kind=SHEET_KIND_DOORS_SPEC,
    label="Спецификация дверных блоков",
    aspect="A1 landscape",
    template="""
"ВЕДОМОСТЬ ДВЕРНЫХ БЛОКОВ" — door specification sheet, Kazakh CAD style.

CONTENT — large table with 7 columns:
1. Поз.: Д-1, Д-2, Д-3...Д-{door_count}
2. Обозначение: ГОСТ 6629-88 «ДГ» / ГОСТ 24698-81 «ДН»
3. Тип: входная металлическая / межкомнатная МДФ / противопожарная EI60
4. Ширина × Высота, mm
5. Кол-во
6. Открывание (swing): левая / правая, внутрь / наружу
7. Примечание

Approximately {door_count} rows total (typical mix):
  Д-1  ГОСТ 24698-81  Входная стальная антивандальная  1100×2100  {qty_d1}  Лев.внутрь    Подъезд
  Д-2  ГОСТ 6629-88   Межкомнатная МДФ дуб             800×2050   {qty_d2}  Прав.внутрь   Сан.узел
  Д-3  ГОСТ 6629-88   Межкомнатная МДФ дуб             900×2050   {qty_d3}  Прав.внутрь   Спальня
  Д-4  ГОСТ 6629-88   Межкомнатная МДФ дуб             900×2050   {qty_d4}  Лев.внутрь    Прихожая→жил.
  Д-5  СТБ 1138-94    Противопожарная EI60             1000×2050  {qty_d5}  Прав.наружу   Эвак.лестница
  Д-6  ГОСТ 24698-81  Входная в квартиру               1100×2100  {qty_d6}  Прав.внутрь   Тамбур→квартира

Bottom of sheet: fire-rating callout for EI60 doors per СНиП РК 2.02-05.

MANDATORY СПДС:
• Table format identical to windows spec
• Cyrillic narrow font
• Title block bottom-right: «Спецификация дверных блоков», «Лист N»

{common_rules}
""".strip(),
))


# ─── render API ────────────────────────────────────────────────────────────


def render_album_sheet(
    spec: AlbumSheetSpec, params: dict[str, Any],
) -> str:
    """Подставить параметры в template и вернуть финальный промпт.

    Все отсутствующие placeholders заполняются «—» чтобы не падать
    с KeyError. Это безопаснее чем strict format.
    """
    safe = dict(params)
    safe.setdefault("common_rules", _TAIMAS_COMMON_RULES)
    # Заполним пропуски
    import string
    formatter = string.Formatter()
    for _, name, _, _ in formatter.parse(spec.template):
        if name is not None and name not in safe:
            safe[name] = "—"
    return spec.template.format(**safe)


def get_album_sheet_spec(kind: str) -> AlbumSheetSpec | None:
    """Получить спецификацию по типу."""
    return _TEMPLATES.get(kind)


def list_album_sheet_kinds() -> list[str]:
    """Все известные типы листов."""
    return list(_TEMPLATES.keys())


# ─── Базовые параметры из MarketingInputs ─────────────────────────────────


def build_base_params(inputs: MarketingInputs, *, date: str = "") -> dict[str, Any]:
    """Собрать словарь базовых параметров для render_album_sheet.

    Не все шаблоны используют все поля — render_album_sheet
    игнорирует лишние и подставляет «—» для отсутствующих.
    """
    inner_w = inputs.site_width_m - 2 * inputs.setback_side_m
    inner_d = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m
    floor_area = round(inner_w * inner_d)
    total_area = floor_area * inputs.floors
    # грубая оценка квартир
    avg_apt = (
        25 * inputs.studio_pct + 45 * inputs.k1_pct +
        65 * inputs.k2_pct + 90 * inputs.k3_pct
    ) or 50
    apts_per_floor = max(1, round(floor_area * 0.55 / avg_apt))
    total_apartments = apts_per_floor * inputs.floors

    floor_height = 3.0
    basement_depth = 2.6
    roof_elevation = floor_height * inputs.floors

    return {
        "project_name": f"ЖК {inputs.floors}эт {int(inner_w)}×{int(inner_d)}",
        "project_code": "ALM-001",
        "city": "Алматы",
        "date": date or "2025",
        "width_m": int(inner_w),
        "depth_m": int(inner_d),
        "floors": inputs.floors,
        "floors_plus_4": inputs.floors + 4,
        "sections": inputs.sections,
        "lifts_passenger": inputs.lifts_passenger,
        "lifts_freight": inputs.lifts_freight,
        "studio_pct": int(inputs.studio_pct),
        "k1_pct": int(inputs.k1_pct),
        "k2_pct": int(inputs.k2_pct),
        "k3_pct": int(inputs.k3_pct),
        "floor_area": floor_area,
        "total_area": total_area,
        "total_apartments": total_apartments,
        "floor_height_1": round(floor_height, 2),
        "floor_height_2": round(floor_height * 2, 2),
        "floor_height_3": round(floor_height * 3, 2),
        "basement_depth": basement_depth,
        "roof_elevation": round(roof_elevation, 2),
        "section_labels_extra": "" if inputs.sections <= 1 else (
            ", «СЕКЦИЯ 2»" + ("..." + f"«СЕКЦИЯ {inputs.sections}»"
                              if inputs.sections > 2 else "")
        ),
        # дефолты для оконно/дверных счётчиков (нужны для specs-листов)
        "window_count": apts_per_floor * 4,    # ~4 окна на квартиру
        "door_count": apts_per_floor * 5,      # ~5 дверей на квартиру
        "qty_w1": apts_per_floor,
        "qty_w2": apts_per_floor * 2,
        "qty_w3": apts_per_floor,
        "qty_w4": apts_per_floor,
        "qty_w5": apts_per_floor // 2,
        "qty_d1": inputs.sections,
        "qty_d2": apts_per_floor * inputs.floors,
        "qty_d3": apts_per_floor * inputs.floors * 2,
        "qty_d4": apts_per_floor * inputs.floors,
        "qty_d5": inputs.sections * inputs.floors,
        "qty_d6": apts_per_floor * inputs.floors,
    }
