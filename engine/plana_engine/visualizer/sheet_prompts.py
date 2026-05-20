"""Реестр промптов для PDF-визуализации.

Используется новой фичей «PDF Визуализация»: юзер загружает PDF архитектурного
альбома, выбирает тип для каждой страницы (или авто-классификация),
получает фотореалистичный рендер по заранее настроенному шаблону.

Промпты вытащены из ``GPT_IMAGE_PROMPTS.md`` (проект АВ2-DP-RP-DCTB-65086) и
сгруппированы: 27 листов реального альбома → 10 универсальных типов.

Режим A (MVP): возвращаем фиксированный prompt по типу страницы — без чтения
самой страницы. Это даёт «красивый альбом в стилистике Almaty residential»
независимо от того, что было на исходном чертеже. Режимы B/C (vision-extract,
image-to-image) добавим следующей итерацией поверх той же таблицы.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SheetTemplate:
    """Шаблон промпта для одного типа архитектурного листа."""
    key: str
    label: str           # человекочитаемое имя для UI
    aspect: str          # рекомендованный aspect-ratio (для подсказки модели)
    prompt: str          # сам промпт для gpt-image


_TEMPLATES: tuple[SheetTemplate, ...] = (
    SheetTemplate(
        key="title_hero",
        label="Титул / Hero-рендер фасада",
        aspect="16:9",
        prompt=(
            "Photorealistic exterior hero render of a contemporary 4-story residential "
            "building, late afternoon golden hour lighting. Ventilated facade combining "
            "warm cream-beige granite panels on first floor base, large bright white HPL "
            "panels on upper floors, warm beige clinker brick accents around the central "
            "entrance bay, dark anthracite grey seam-folded metal cladding on parapet "
            "crown, silver-grey aluminum panel inserts. Large floor-to-ceiling "
            "aluminum-framed windows, balconies with glass railings on side facades. "
            "Glass spider-system entrance canopy. Modern landscaped courtyard with "
            "paving and young trees, mountain backdrop. Architectural photography "
            "style, soft directional sunlight, sharp detail, 35mm lens, high resolution, "
            "professional real estate marketing imagery."
        ),
    ),
    SheetTemplate(
        key="block_scheme",
        label="Схема / Мастерплан",
        aspect="16:9",
        prompt=(
            "Aerial isometric bird's-eye view of a residential complex masterplan, "
            "rectangular building blocks arranged in a diagonal grid pattern on a "
            "hillside site. One foreground block highlighted in subtle red/coral tint "
            "while others are neutral white-grey. Compass rose with North-South-East-West "
            "on bottom-left. Paved internal roads, courtyards with trees, parking areas, "
            "mountain ranges in distance. Technical architectural masterplan style, "
            "soft shadows from high-angle sun, axonometric 30-degree projection, "
            "clean modern presentation, top-down 3/4 view with slight perspective, "
            "white background gradient, schematic but photorealistic CGI rendering."
        ),
    ),
    SheetTemplate(
        key="basement_plan",
        label="План подвала / Технический этаж",
        aspect="4:3",
        prompt=(
            "Isometric cutaway 3D dollhouse view of an underground basement floor for "
            "a residential building, technical utility crawl space. Exposed monolithic "
            "reinforced concrete walls, structural columns in regular grid pattern, "
            "visible foundation slab, no partitions, completely open space for "
            "engineering communications. Ceramic brick interior wall sections "
            "highlighted. Stairs in corner with steel ladder. Dim cool fluorescent "
            "lighting, raw concrete textures, industrial atmosphere. Architectural "
            "cutaway visualization style, top-down 45-degree isometric angle, walls "
            "in light grey with red-orange highlights for brick/concrete elements, "
            "white background, technical clarity with photorealistic materials."
        ),
    ),
    SheetTemplate(
        key="floor_plan",
        label="План этажа (тип. этаж, дольхаус)",
        aspect="4:3",
        prompt=(
            "Isometric 3D dollhouse cutaway view of a residential floor of a multi-unit "
            "building, ceiling cut away to reveal interior layout. Multiple apartments "
            "visible (mix of 1-bedroom, 2-bedroom, 3-bedroom units). Central core with "
            "elevator shaft, staircase, lift hall, vestibule. Each apartment showing "
            "furniture arrangement: living rooms with sofas, kitchens with appliances, "
            "bedrooms with beds, bathrooms with fixtures. Loggias along south facade, "
            "small balconies on side ends. Materials: warm hardwood floors in living "
            "spaces, ceramic tiles in wet areas, white walls. Soft natural light from "
            "windows. Architectural dollhouse style render, 35-degree top-down isometric "
            "angle, photorealistic furniture, clean modern Scandinavian-style interiors, "
            "professional real estate visualization quality."
        ),
    ),
    SheetTemplate(
        key="roof_plan",
        label="План кровли",
        aspect="16:9",
        prompt=(
            "Top-down aerial photograph-style view of a flat ventilated roof on a "
            "residential building. Soft warm bituminous waterproofing membrane surface "
            "in dark grey-brown. Parapet walls around perimeter. Roof slope directed "
            "toward central parapet drainage funnels and emergency overflow scuppers. "
            "Distributed across roof: ceramic brick ventilation shafts of varying sizes, "
            "each 2-3 bricks visible above roof level, with aluminum protective caps. "
            "Several roof aerator/mushroom-shaped caps. Central elevated machine "
            "room/staircase exit structure. Steel access ladder on side. Roof edges "
            "with metal flashings. Sharp midday sunlight casting clear shadows. Aerial "
            "drone photography style, photorealistic, top-down 90-degree view with "
            "slight angle showing 3D depth of vent shafts and parapet, high resolution."
        ),
    ),
    SheetTemplate(
        key="sections",
        label="Разрезы (cross-section)",
        aspect="3:2",
        prompt=(
            "Architectural cutaway cross-section render of a 4-story residential "
            "building, vertical slice exposing interior. Visible monolithic reinforced "
            "concrete slabs between floors, gas concrete infill walls with internal "
            "layers visible. Staircase running through central core with metal railings. "
            "Facade glazing pattern visible. Each level filled with semi-transparent "
            "furniture suggesting habitation. Architectural cutaway visualization, "
            "dollhouse cross-section style, materials photorealistic but section cuts "
            "highlighted with subtle red hatching at concrete edges, sky/exterior "
            "visible above roof, soil layer below foundation, professional architectural "
            "CGI render."
        ),
    ),
    SheetTemplate(
        key="facades",
        label="Фасады (все 4 элевации)",
        aspect="16:9",
        prompt=(
            "Photorealistic architectural elevation render showing all four facades of "
            "a 4-story residential building, displayed as four separate frontal "
            "flat-projection views arranged in 2×2 grid. Main facade: symmetrical "
            "composition with central entrance bay clad in warm clinker brick, flanking "
            "sections in bright white HPL panels, ground floor base in cream-beige "
            "granite, dark anthracite parapet crown, aluminum panel accents. Large "
            "aluminum-framed windows in regular grid pattern. Glass spider-system "
            "entrance canopy at ground level. Side facades: minimal asymmetric "
            "composition with vertical window strips and small balconies. Rear facade "
            "similar to main but without entrance canopy. Architectural elevation "
            "drawing style with photorealistic materials and shading, frontal "
            "orthographic projection, soft daylight, clean professional presentation."
        ),
    ),
    SheetTemplate(
        key="door_window_catalog",
        label="Каталог дверей/окон",
        aspect="1:1",
        prompt=(
            "Photorealistic product catalog rendering of architectural doors and "
            "windows arranged in a clean grid. Multiple specimens shown frontally: "
            "aluminum-framed thermal-break windows with double/triple glazing, "
            "various proportions (1200×2400, 1500×2400, 1800×2400), some with "
            "transom; main entrance steel doors with anti-vandal glass inserts; "
            "interior MDF doors in warm oak finish. Each item with dimensional "
            "annotations in millimetres, RAL color tags, hardware specification "
            "callouts. Studio product photography, soft even lighting, neutral grey "
            "background, sharp focus on hardware details, architectural specification "
            "sheet aesthetic, professional manufacturer catalog quality."
        ),
    ),
    SheetTemplate(
        key="construction_stage",
        label="Стадия строительства (изометрия)",
        aspect="3:2",
        prompt=(
            "Isometric construction-phase render of a residential building at masonry "
            "stage. RC slab visible, building walls being erected with gas concrete "
            "blocks. Cutaway exposing structural skeleton: reinforced concrete columns, "
            "beams, slabs. Brickwork in progress on facade walls. Construction site "
            "context: scaffolding wrapping building exterior, crane in background, "
            "stacks of materials, small workers for scale. Cool blue sky, soft "
            "directional daylight. Architectural construction visualization, isometric "
            "35-degree angle, photorealistic concrete and masonry textures, daylight, "
            "professional construction documentation style."
        ),
    ),
    SheetTemplate(
        key="structural_reinforcement",
        label="Армирование / Узлы конструкций",
        aspect="1:1",
        prompt=(
            "Exploded technical 3D render showing steel reinforcement frames for "
            "masonry openings in a seismic building. Galvanized steel U-channel "
            "100×50×1.5mm frames with angle reinforcements and anchor bolts, multiple "
            "configurations (rectangular, U-shaped, composite with central support). "
            "Frames floating in exploded view with anchor bolt details (M12 anchor "
            "studs) highlighted. Bright industrial galvanized steel finish "
            "(silver-grey), small bolt details visible. Below the floating frames, "
            "transparent ghost of building floor outline showing installation context. "
            "Technical CGI rendering style, neutral white background, sharp focus, "
            "isometric 30-degree angle, engineering documentation aesthetic, "
            "photorealistic steel materials, weight specification labels."
        ),
    ),
    SheetTemplate(
        key="hardware",
        label="Лестницы, ограждения, люки",
        aspect="1:1",
        prompt=(
            "Photorealistic product visualization showing residential building safety "
            "hardware: steel access ladder to roof with safety cage in hot-dip "
            "galvanized finish; multiple aluminum/steel railings for balconies, "
            "staircases, terraces with vertical balusters; roof access hatch with "
            "hinged cover and lockable handle. Each item displayed against neutral "
            "grey background with subtle shadow, product catalog style. Realistic "
            "galvanized steel and powder-coated finishes. Studio product photography, "
            "soft even lighting, sharp focus, architectural hardware catalog "
            "aesthetic, professional presentation, isometric and frontal views combined."
        ),
    ),
    SheetTemplate(
        key="elevator_cutaway",
        label="Узел лифта / Шахта",
        aspect="3:2",
        prompt=(
            "Architectural cutaway 3D render showing a residential elevator installed "
            "in a multi-story building. Vertical section view exposing monolithic "
            "reinforced concrete elevator shaft, internal dimensions ~1900×2900mm, "
            "200mm wall thickness. Cabin visible at ground floor — modern stainless "
            "steel and dark wood interior. Multiple stops with cabin doors. Above "
            "cabin: traction sheave mechanism (gearless, no machine room). "
            "Counterweight rails on one side. Steel guide rails. Pit at bottom. "
            "Technical specifications visible in corner. Architectural cutaway "
            "visualization, professional vertical cross-section, photorealistic "
            "materials, clean white background, technical engineering aesthetic."
        ),
    ),
    SheetTemplate(
        key="facade_node",
        label="Узлы фасада / Детали",
        aspect="1:1",
        prompt=(
            "Macro-scale architectural detail render showing facade construction node "
            "details for a ventilated facade system, arranged in a 2×3 grid. Each "
            "detail shown as zoomed-in cross-section: window-to-opening junction with "
            "aluminum frame, sealant, anchor plate, vapor barrier membrane, mineral "
            "wool insulation, ventilated cavity, granite cladding; granite cladding "
            "fixing with stainless steel brackets and aluminum sub-structure; "
            "ground-level transition showing foundation, plinth granite, drainage; "
            "aluminum sub-structure with thermal break and EPDM gasket. All layers "
            "shown with photorealistic material textures. Technical macro photography "
            "style, sharp detail, neutral background, construction documentation "
            "aesthetic, professional building envelope visualization, callout numbers "
            "labeling each layer."
        ),
    ),
    SheetTemplate(
        key="glass_canopy",
        label="Козырёк / Витражи",
        aspect="3:2",
        prompt=(
            "Photorealistic architectural detail render of a modern spider-system "
            "glass entrance canopy at the main entry of a residential building. "
            "Canopy made of laminated triplex safety glass, suspended by 4 stainless "
            "steel tension rods anchored to the building facade above, with stainless "
            "steel spider-fittings holding the glass at four corners. Glass slightly "
            "tinted, semi-transparent with crisp reflections. Below the canopy: "
            "glass-doored entrance with stainless steel handles. Surrounding facade: "
            "warm clinker brick at base, granite cladding, large vertical vitrine. "
            "Soft daylight casting subtle shadow through glass onto entrance threshold. "
            "Close-up architectural detail photography style, photorealistic, sharp "
            "focus on hardware details, professional architectural detailing portfolio "
            "aesthetic, warm afternoon ambient light, polished surfaces."
        ),
    ),
    SheetTemplate(
        key="generic",
        label="Прочее / Авто",
        aspect="16:9",
        prompt=(
            "Photorealistic architectural visualization of a contemporary residential "
            "building project: clean modern lines, ventilated facade with mix of HPL "
            "panels, granite plinth, clinker brick accents, aluminum windows. Soft "
            "daylight, professional architectural photography, sharp detail, high "
            "resolution presentation render."
        ),
    ),
)


# Быстрый доступ по ключу
_BY_KEY: dict[str, SheetTemplate] = {t.key: t for t in _TEMPLATES}


def list_sheet_types() -> list[SheetTemplate]:
    """Все известные типы листов — для отдачи на фронт."""
    return list(_TEMPLATES)


def get_sheet_template(key: str) -> SheetTemplate:
    """Шаблон по ключу. Падает на ``generic``, если ключа нет."""
    return _BY_KEY.get(key) or _BY_KEY["generic"]
