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
    parking_total = int(_approx_unit_count(inputs) * inputs.floors * inputs.parking_spaces_per_apt)

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
# 2. EXTERIOR (text-to-image)
# ---------------------------------------------------------------------------


def build_exterior_prompt(inputs: MarketingInputs) -> str:
    """Внешний вид здания, 3/4 перспектива, в окружении."""
    purpose_lookup = {
        "residential": (
            "Modern multi-storey residential apartment building, balconies and large windows, "
            "warm beige/white facade with timber accents, contemporary Russian/Kazakh urban architecture"
        ),
        "commercial": (
            "Modern glass-facade commercial office building, full-height curtain wall, sleek minimalist "
            "design, accent stone or aluminum cladding, professional business district aesthetic"
        ),
        "mixed_use": (
            "Mixed-use building: 2-3 storey retail/F&B podium with large storefront windows on the ground "
            "level, residential tower above with balconies, layered architectural composition"
        ),
        "hotel": (
            "Boutique hotel exterior, signature canopy at the entrance, curved or distinctive architectural "
            "element on top, warm lighting visible through windows even during day, landscaped forecourt"
        ),
    }
    subject = purpose_lookup.get(inputs.purpose, purpose_lookup["residential"])
    n_floors = inputs.floors
    height_m = inputs.floors * 3

    return f"""Photorealistic architectural rendering, 3/4 perspective view (front + one side visible).

SUBJECT: {subject}. {n_floors} storeys, approximately {height_m}m tall. Footprint matching {inputs.site_width_m:.0f}×{inputs.site_depth_m:.0f}m plot.

ENVIRONMENT:
• Daytime, natural daylight, partly cloudy sky with soft sunlight from upper-left
• Foreground: pedestrian pathway with people walking (couples, family, professionals)
• Mid-ground: landscaped grounds with mature trees, flowering shrubs, manicured lawn, a few cars parked along curb
• Background: slight blur, urban context (other modern buildings, skyline) — implies prosperous district
• Materials visible: glass railings on balconies, warm timber/stone accents, polished entrance lobby through glass

QUALITY MARKERS:
• Photorealistic but slightly idealized — like a high-end developer brochure cover or magazine spread
• Crisp shadows, accurate perspective, no fish-eye distortion
• Slight haze/atmospheric effect on distant elements for depth
• People rendered tastefully, not too prominent
• Building looks newly built — clean, no weathering, fresh landscaping

NEGATIVE: no exaggerated lens flares, no cartoonish style, no abandoned/grungy aesthetic, no nighttime, no rain.

OUTPUT: 16:10 aspect ratio, ultra-high resolution, marketing-grade architectural rendering for a developer's website hero image."""


# ---------------------------------------------------------------------------
# 3. FLOORPLAN WITH FURNITURE (Pinterest-style top-down, NOT strict CAD)
# ---------------------------------------------------------------------------


def build_floorplan_furniture_prompt(inputs: MarketingInputs) -> str:
    """Pinterest-grade top-down с мебелью — для брошюр, не CAD."""
    n_units = _approx_unit_count(inputs)
    inner_w = inputs.site_width_m - 2 * inputs.setback_side_m
    inner_h = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m

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
