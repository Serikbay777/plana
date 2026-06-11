"""Дополнительные prompt-билдеры для трёх режимов визуализации.

1. SITE_PLACEMENT — «Посадка здания на участок».
   Получает аэрофото участка (как референс через images.edit) +
   промпт «впишите сюда жилой комплекс согласно параметрам».

2. EXTERIOR — «Внешний вид ЖК».
   3/4-перспектива здания в окружении.

3. FLOORPLAN_FURNITURE — «Планировка с мебелью».
   Pinterest-grade top-down план с мебелью и parquet (без строгого CAD).

4. INTERIOR — «Интерьер квартиры».
   Перспектива одной комнаты типичной квартиры.
"""

from __future__ import annotations

from .. import norms
from .marketing_prompt import MarketingInputs, _approx_unit_count


# ---------------------------------------------------------------------------
# 1. SITE PLACEMENT (image-to-image edit)
# ---------------------------------------------------------------------------


def build_site_placement_prompt(inputs: MarketingInputs) -> str:
    """Промпт для image edit — впишет здание в загруженное аэрофото."""
    purpose_descriptor = {
        "residential": "modern multi-storey residential apartment building",
        "commercial":  "modern glass-facade commercial office building",
        "mixed_use":   "mixed-use building with retail podium and residential tower",
        "hotel":       "boutique hotel with landscaped entrance plaza",
    }.get(inputs.purpose, "modern residential building")

    n_floors = inputs.floors
    inner_w = inputs.site_width_m - 2 * inputs.setback_side_m
    inner_h = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m
    _p_ratio = norms.parking_ratio(inputs.housing_class, inputs.parking_spaces_per_apt)
    parking_total = int(_approx_unit_count(inputs, inner_w, inner_h) * inputs.floors * _p_ratio)

    return f"""Place a {purpose_descriptor} ({n_floors} storeys, footprint approximately {inner_w:.0f}×{inner_h:.0f} meters) onto this aerial site photo.

POSITIONING:
• Center the building inside the plot, respecting setbacks: {inputs.setback_front_m:.1f}m from the front (street side), {inputs.setback_rear_m:.1f}m from the back, {inputs.setback_side_m:.1f}m from each side
• Building footprint should not exceed {inputs.max_coverage_pct:.0f}% of the plot
• Long axis of the building parallel to the longest plot edge
• Main entrance facing the closest street

LANDSCAPING & SITE LAYOUT (around the building):
• Pedestrian pathways from street to entrance
• Surface parking lot for ~{int(parking_total * 0.2)} cars (20% of parking aboveground)
• Landscaped courtyard with trees, benches, playground (if residential)
• Drop-off zone at the main entrance
• Retain any existing trees or landscape features visible in the photo
• Soft natural ground cover (grass, planted areas) around the building footprint

STYLE:
• Photorealistic top-down rendering, daylight, clear shadows
• Modern Russian/Kazakh urban architecture
• Building walls: light beige, white, or warm grey concrete with glass balconies
• Roof: flat with technical equipment visible (rooftop AC units, antenna)
• Maintain the original aerial photo's lighting, shadows, and surrounding context
• Do not add roads, sidewalks, or buildings outside the visible plot — keep the surroundings as in the original photo
• Building scale must match the plot: a {inputs.floors}-storey building (~{inputs.floors * 3:.0f}m tall) casts proportional shadow

DO NOT:
× Replace the entire aerial photo with a generated scene
× Show the building in 3D perspective — keep top-down orthographic
× Add labels, dimension lines, or compass — pure photorealistic site rendering
× Distort or reposition existing site features (roads, neighboring lots)

OUTPUT: the same aerial photo, but with the new {purpose_descriptor} fitted onto the plot following all constraints above. Looks like a real Google Maps satellite shot of an existing development."""


# ---------------------------------------------------------------------------
# 2. EXTERIOR (text-to-image) — несколько ракурсов
# ---------------------------------------------------------------------------

# Единая «личность» фасада — чтобы все 4 ракурса выглядели как один проект.
# Описывает стиль с референсов: айвори-штукатурка + кирпичный акцент + камень
# по цоколю + французские балкончики, плоская кровля.
_FACADE_IDENTITY = (
    "Contemporary classic-modern residential architecture: ivory and warm beige plaster walls with crisp white "
    "pilaster/lesene framing, large windows with dark grey frames and tall glazing, a vertical accent bay clad in "
    "warm brown clinker brick, dark anthracite-grey accent volumes near the roofline and at the corner, rusticated "
    "light beige stone cladding on the ground-floor base, slim Juliet balconies with thin black metal railings, "
    "flat roof with a clean parapet. Newly built, premium developer quality, fresh clean materials."
)

# Пресеты ракурсов экстерьера, заточенные под 4 референс-кадра.
# `camera` — постановка камеры/ракурс, `scene` — наполнение кадра, `aspect` —
# пропорции. `label` — русская подпись для UI/ключей ассетов.
EXTERIOR_VIEWS: dict[str, dict[str, str]] = {
    # Фото 1 — угловой 3/4 одного дома с уровня улицы.
    "hero": {
        "label": "Общий вид",
        "aspect": "3:2",
        "camera": (
            "Photorealistic architectural render. Three-quarter corner perspective at street level, camera "
            "slightly below eye level looking up at the building corner, ONE full building filling the frame, "
            "35mm lens, no fish-eye distortion"
        ),
        "scene": (
            "A single residential building seen from its street corner on a clear sunny day, deep blue sky with "
            "a few soft clouds. Both main facades visible at once. Foreground: clean light paving-stone sidewalk, "
            "low neatly trimmed boxwood hedges and a couple of young green trees. Crisp directional sunlight, sharp "
            "accurate shadows. No people, no cars in the foreground."
        ),
    },
    # Фото 2 — аэросъёмка всего ЖК в лесу с горами на горизонте.
    "aerial": {
        "label": "С высоты",
        "aspect": "16:9",
        "camera": (
            "Photorealistic aerial drone render. High bird's-eye view at about 60 degrees downward, the ENTIRE "
            "residential complex of several identical buildings visible from above"
        ),
        "scene": (
            "An aerial shot of a residential micro-district: six to eight identical 4-storey buildings arranged in "
            "a regular grid, set in a clearing surrounded by dense green coniferous forest, with snow-capped "
            "Tien-Shan mountains on the horizon under a clear sky. Internal courtyards with children's playgrounds, "
            "a small football pitch and green lawns; surface parking lots with cars along the perimeter; paved "
            "internal roads and pedestrian paths with crosswalks. Soft natural midday light."
        ),
    },
    # Фото 3 — макро благоустройства: дорожка, клумба, боллард, размытый дом.
    "landscape": {
        "label": "Благоустройство",
        "aspect": "3:2",
        "camera": (
            "Photorealistic landscaping close-up render. Low eye-level shot near a garden path with shallow depth "
            "of field (85mm, f/2.8), the residential building softly blurred in the background (creamy bokeh)"
        ),
        "scene": (
            "A golden-hour morning close-up of the complex landscaping: a clean paving-stone walkway in the "
            "foreground, neatly trimmed boxwood hedges, a flower bed with purple, yellow and white blossoms and "
            "ornamental grasses, a sleek modern black bollard light. A children's playground and one residential "
            "building are softly out of focus in the warm hazy background. Intimate premium lifestyle-magazine mood. "
            "No people in frame."
        ),
    },
    # Фото 4 — двор с детской площадкой, людьми и домом на фоне.
    "yard": {
        "label": "Двор",
        "aspect": "3:2",
        "camera": (
            "Photorealistic architectural render. Eye-level view from inside the landscaped courtyard, camera at "
            "human height looking across the yard toward one building, 28mm wide angle, no fish-eye distortion"
        ),
        "scene": (
            "The courtyard of the residential complex on a warm sunny day: a colorful children's playground with "
            "slides and swings on soft rubber safety surfacing in the foreground, wooden benches, classic black "
            "street lamps, flower beds with red and yellow blooms, young trees and trimmed hedges, paved walkways. "
            "A few residents for life and scale — a couple walking, a parent with a small child. One 4-storey "
            "building rises behind, fully in focus."
        ),
    },
}

# Порядок ракурсов по умолчанию для галереи. «hero» (Общий вид) убран по
# просьбе — остаётся как fallback в build_exterior_prompt, но в галерею не идёт.
DEFAULT_EXTERIOR_VIEWS: list[str] = ["aerial", "landscape", "yard"]


def build_exterior_prompt(inputs: MarketingInputs, view: str = "hero") -> str:
    """Внешний вид ЖК. `view` выбирает ракурс из EXTERIOR_VIEWS.

    Промпты заточены под 4 присланных референса (угловой 3/4, аэро, макро
    благоустройства, двор). Единый стиль фасада — через _FACADE_IDENTITY.
    """
    preset = EXTERIOR_VIEWS.get(view, EXTERIOR_VIEWS["hero"])
    n_floors = inputs.floors
    height_m = inputs.floors * 3
    aspect = preset.get("aspect", "16:10")

    return f"""{preset['camera']}.

SUBJECT: a {n_floors}-storey residential apartment building (~{height_m}m tall), footprint about {inputs.site_width_m:.0f}×{inputs.site_depth_m:.0f}m.
{_FACADE_IDENTITY}

SCENE: {preset['scene']}

CONSISTENCY: keep the SAME building identity across every view — identical facade materials, colours, window pattern, proportions and floor count.

QUALITY: photorealistic marketing-grade architectural visualization, developer-brochure look, crisp shadows, accurate perspective, no fish-eye distortion, soft natural daylight.

NEGATIVE: no cartoonish or illustrated style, no nighttime, no rain, no exaggerated lens flares, no distorted geometry, no text or watermarks.

OUTPUT: {aspect} aspect ratio, ultra-high resolution."""


# ---------------------------------------------------------------------------
# 3. FLOORPLAN WITH FURNITURE (Pinterest-style top-down, NOT strict CAD)
# ---------------------------------------------------------------------------


def build_floorplan_furniture_prompt(inputs: MarketingInputs) -> str:
    """Pinterest-grade top-down с мебелью — для брошюр, не CAD."""
    inner_w = inputs.site_width_m - 2 * inputs.setback_side_m
    inner_h = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m
    n_units = _approx_unit_count(inputs, inner_w, inner_h)

    mix_parts = []
    if inputs.studio_pct > 0.01:
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom")
    mix = ", ".join(mix_parts) or "balanced typology"

    return f"""Top-down architectural floor plan rendering, magazine-grade marketing brochure style. Photorealistic but illustrated, like a hand-drawn presentation poster from a high-end developer (Capital Group, ПИК, Самолет, Galaxy).

SUBJECT: typical residential floor of a {inputs.floors}-storey building. Footprint {inner_w:.0f}×{inner_h:.0f}m. {n_units} apartments per floor. Mix: {mix}.

LAYOUT: central reinforced-concrete core with {inputs.lifts_passenger} lifts and U-staircase, double-loaded corridor, apartments on both sides facing south and north facades.

EACH APARTMENT MUST CONTAIN realistic top-down furniture icons:
  • Bedrooms: neatly made double bed with neutral linens, bedside tables with lamps, wardrobe along the wall
  • Living rooms: sectional sofa, armchair, round coffee table, area rug, indoor plants in pots, wall-mounted TV
  • Kitchens: L-shaped counter with sink + induction stove + fridge, kitchen island with bar stools, hanging pendant lights
  • Dining areas: round or rectangular table with 4-6 chairs
  • Bathrooms: white bathtub OR glass shower, white toilet, vanity with mirror, towel rack
  • Hallways: built-in wardrobe, shoe storage, hanging mirror
  • Loggias: potted plants, folding chairs, glass railing

FLOORING: warm wood parquet (oak, walnut grain visible) inside every apartment, matte tiles in bathrooms, polished concrete in corridors and lobby.

COLOR PALETTE per apartment (each one a different soft pastel):
  Cream, sage green, dusty rose, powder blue, warm terracotta, soft lavender, pale mint, muted peach.
  Walls drawn as light gray 200mm bands. Apartment fills at ~70% opacity over the floor plan.

ANNOTATIONS in Cyrillic:
  • Apartment numbers in soft pastel circles: «1», «2», «3»…«{n_units}» — placed in the largest room
  • Apartment areas next to numbers: «{round(45 + (inputs.k2_pct * 25), 1)} м²» (varies per apartment)
  • Compass rose top-right
  • Scale bar bottom-left: «0    10 м»
  • Title top-left: «ПЛАНИРОВКА ЭТАЖА · {n_units} КВАРТИР»

QUALITY: 4K, ultra-detailed, Pinterest-grade, no Latin labels (Cyrillic only), no 3D perspective, strict 2D top-down view. Soft natural daylight from windows on facade walls. Subtle long shadows from interior walls.

OUTPUT: a single image. Like the cover of a developer's apartment-mix presentation booklet."""


def build_floorplan_furniture_edit_prompt(
    inputs: MarketingInputs, source_prompt: str = "",
) -> str:
    """Промпт для image-edit: «обставь ЭТОТ план мебелью, не трогая геометрию».

    На вход image-edit идёт реальный план-чертёж (PNG), поэтому число квартир/
    комнат/стен берётся из картинки, а не оценивается заново — это и даёт
    согласованность с чертежом. `source_prompt` — исходный промпт чертежа,
    добавляется как контекст «то же здание».
    """
    mix_parts = []
    if inputs.studio_pct > 0.01:
        mix_parts.append(f"{int(inputs.studio_pct*100)}% studios")
    if inputs.k1_pct > 0.01:
        mix_parts.append(f"{int(inputs.k1_pct*100)}% 1-bedroom")
    if inputs.k2_pct > 0.01:
        mix_parts.append(f"{int(inputs.k2_pct*100)}% 2-bedroom")
    if inputs.k3_pct > 0.01:
        mix_parts.append(f"{int(inputs.k3_pct*100)}% 3-bedroom")
    mix = ", ".join(mix_parts) or "balanced typology"

    context = ""
    if source_prompt.strip():
        # Берём начало исходного брифа чертежа как контекст «то же здание».
        brief = source_prompt.strip().replace("\n", " ")[:600]
        context = f"\n\nORIGINAL PLAN BRIEF (same building — keep it consistent): {brief}"

    return f"""You are given a technical architectural floor plan (top-down black line drawing on white paper, with room labels and apartment numbers). TRANSFORM it into a polished top-down MARKETING floor plan in magazine / Pinterest brochure style (photorealistic-illustrated).{context}

STRICTLY PRESERVE the geometry of the input drawing — this is the most important rule:
• Keep EVERY wall, partition and room boundary exactly where it is. Do NOT move, add, remove or redraw any wall.
• Keep the SAME number of apartments and rooms, the same room shapes, and the same apartment numbers/labels in the same positions.
• Keep the same overall proportions, footprint and orientation as the input image. Same aspect ratio.

ADD on top of the preserved layout (apartment mix for reference: {mix}):
• Realistic top-down furniture in every room — beds + wardrobes in bedrooms; sofas, coffee tables, rugs, TV in living rooms; L-shaped counters, islands and appliances in kitchens; bathtub or shower, toilet, vanity in bathrooms; dining tables with chairs; built-in storage in hallways; plants and chairs on loggias/balconies.
• Warm wood parquet inside apartments, matte tiles in bathrooms, light flooring in corridors and the central core.
• A soft pastel fill per apartment (cream, sage green, dusty rose, powder blue, terracotta, lavender, mint, peach) at about 70% opacity, so each apartment reads as a separate unit.
• Keep the walls as clean grey/black bands; keep the central stair/lift core readable.

STYLE: 4K, ultra-detailed, soft natural daylight from facade windows, subtle interior shadows, Cyrillic labels only (no Latin text), strict 2D top-down view (NO 3D, NO perspective). Premium developer apartment-mix booklet aesthetic.

OUTPUT: the SAME plan — furnished and styled — with its geometry completely untouched."""


# ---------------------------------------------------------------------------
# 4. INTERIOR (text-to-image, perspective view of one room)
# ---------------------------------------------------------------------------


def build_interior_prompt(inputs: MarketingInputs) -> str:
    """Интерьер одной комнаты — для самой крупной типологии в форме."""
    # выбираем самый крупный тип квартиры из микса
    if inputs.k3_pct >= max(inputs.studio_pct, inputs.k1_pct, inputs.k2_pct):
        apt_descriptor = "spacious 3-bedroom apartment (~90 m²) living room with adjoining open kitchen-dining area"
    elif inputs.k2_pct >= max(inputs.studio_pct, inputs.k1_pct):
        apt_descriptor = "comfortable 2-bedroom apartment (~65 m²) living room with kitchen island visible"
    elif inputs.k1_pct >= inputs.studio_pct:
        apt_descriptor = "modern 1-bedroom apartment (~45 m²) combined living and dining area"
    else:
        apt_descriptor = "stylish studio apartment (~30 m²) — open-plan living, kitchen, and sleeping zone"

    return f"""Photorealistic interior architectural rendering, residential interior magazine quality. Eye-level perspective view (camera at human height, ~1.5m), wide-angle but not distorted.

SUBJECT: {apt_descriptor} in a newly built {inputs.floors}-storey residential building. Modern Russian/Kazakh interior design, contemporary Scandinavian-influenced minimalism with warm earth tones.

INTERIOR ELEMENTS:
• Floor-to-ceiling windows with view of city/landscape (slight blur)
• Oak/walnut hardwood parquet flooring with visible grain
• Walls: warm beige or sage-green muted paint, accent wall in deep terracotta or charcoal
• Furniture: sectional sofa in light gray bouclé, walnut coffee table, woven area rug, leather armchair
• Kitchen island visible (if applicable): white quartz counter, brass faucet, bar stools
• Statement pendant light over the dining area
• Indoor plants (monstera, fiddle leaf fig, snake plant in ceramic pots)
• Wall art: large abstract painting or framed architectural prints
• Books on shelves, decorative objects (vases, candles), throw blankets
• Natural daylight as primary light source, warm interior lights as secondary

ATMOSPHERE:
• Daytime, golden hour bias, soft sunlight streaming through windows
• Long subtle shadows, warm color temperature ~3500K
• Slight haze/atmospheric depth for dimensional feel
• A single small detail: a coffee cup on the table, an open book, a folded throw — implies someone lives here

NEGATIVE: no fish-eye lens, no people in frame, no clutter, no cartoonish/illustrated style, no nighttime, no over-saturated colors, no industrial/loft aesthetic.

OUTPUT: photorealistic interior render, 16:10 aspect ratio, ultra-high resolution, like an Architectural Digest spread."""
