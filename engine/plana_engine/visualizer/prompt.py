"""Структурированный prompt-builder из `Plan` для gpt-image-1.

Идея: чем точнее описано — тем правдоподобнее получится картинка.
Промпт собирается из реальной геометрии, не выдумывается.

Структура промпта:
1. Стиль (жанр, ракурс, освещение)
2. Здание (габариты, число квартир, форма)
3. Каждая квартира: номер, тип, площадь, состав комнат, мебель
4. Общие зоны: ядро, коридор, лоджии
5. Технические детали: компас, масштаб, подписи

Длина — около 1500–2500 символов. Это в лимите gpt-image-1 (4000 chars).
"""

from __future__ import annotations

from collections import Counter

from ..presets import PRESET_LABELS
from ..types import AptType, PlacedTile, Plan, PlacedZone, ZoneKind


# ---------------------------------------------------------------------------
# Подписи и описания зон
# ---------------------------------------------------------------------------


_APT_TYPE_DESC: dict[AptType, str] = {
    AptType.STUDIO: "open-plan studio (combined living/bedroom + small kitchenette + bathroom)",
    AptType.K1:     "1-bedroom apartment (separate bedroom, living room, kitchen, bathroom, hallway)",
    AptType.EURO1:  "Euro-1 layout (bedroom + open kitchen-living area + bathroom)",
    AptType.K2:     "2-bedroom apartment (master bedroom, second bedroom, living room, kitchen, bathroom)",
    AptType.EURO2:  "Euro-2 layout (bedroom + open kitchen-living + second bedroom, bathroom)",
    AptType.K3:     "3-bedroom apartment (master + 2 bedrooms, living room, kitchen, two bathrooms, hallway)",
    AptType.EURO3:  "Euro-3 layout (3 bedrooms + open kitchen-living, two bathrooms)",
    AptType.K4:     "4-bedroom family apartment (master + 3 bedrooms, large living room, kitchen, two bathrooms, walk-in closet, hallway)",
}

_ZONE_FURNITURE: dict[ZoneKind, str] = {
    ZoneKind.LIVING:   "modern sofa, armchair, coffee table, area rug, indoor plant, wall-mounted TV",
    ZoneKind.BEDROOM:  "double bed with neutral linens, bedside tables with lamps, wardrobe, small reading chair",
    ZoneKind.KITCHEN:  "L-shaped kitchen with sink, induction stove, oven, fridge, kitchen island with bar stools, hanging pendant lights",
    ZoneKind.BATHROOM: "bathtub or walk-in shower, white toilet, vanity with mirror, towel rack, small storage cabinet",
    ZoneKind.HALL:     "entrance hallway with built-in wardrobe, shoe rack, hanging mirror",
    ZoneKind.LOGGIA:   "small loggia with potted plants and a folding chair, glass railing",
}


def _zone_summary(zones: list[PlacedZone]) -> str:
    counts: Counter[ZoneKind] = Counter(z.kind for z in zones)
    parts: list[str] = []
    for kind, n in counts.items():
        label = kind.value if n == 1 else f"{n}× {kind.value}"
        parts.append(label)
    return ", ".join(parts) or "open-plan"


# ---------------------------------------------------------------------------
# Главный билдер
# ---------------------------------------------------------------------------


def build_prompt(plan: Plan, *, with_furniture: bool = True) -> str:
    """Собрать prompt из плана.

    Параметры:
        plan: результат `algo.generate_variant`
        with_furniture: добавлять ли мебель в описание (увеличивает детализацию,
            но и расход токенов)
    """
    contour = plan.floor_polygon
    xs = [p.x for p in contour.exterior]
    ys = [p.y for p in contour.exterior]
    bw = max(xs) - min(xs)
    bh = max(ys) - min(ys)
    apt_count = len(plan.tiles)
    preset_label = PRESET_LABELS.get(plan.preset, plan.preset.value)

    by_type: Counter[AptType] = Counter(t.apt_type for t in plan.tiles)
    mix_str = ", ".join(
        f"{n}× {_APT_TYPE_DESC[t].split(' (')[0]}" for t, n in by_type.most_common()
    )

    # ---- секция стиля
    style = _style_section()

    # ---- секция здания
    building = (
        f"Building: residential mid-rise floor plan, footprint {bw:.0f}×{bh:.0f} meters, "
        f"{apt_count} apartments per floor, central reinforced-concrete staircase + elevator "
        f"core in the middle, double-loaded corridor running along the long axis. "
        f"Variant strategy: {preset_label.lower()}. "
        f"Apartment mix: {mix_str}."
    )

    # ---- секция каждой квартиры
    apartments_lines: list[str] = []
    for t in sorted(plan.tiles, key=lambda x: x.apt_number):
        zsum = _zone_summary(t.zones)
        apartments_lines.append(
            f"  Apt #{t.apt_number}: {_APT_TYPE_DESC[t.apt_type]}, "
            f"S общ. {t.area:.1f} m², S жил. {t.living_area:.1f} m², zones: {zsum}."
        )
    apartments = "Apartments (each clearly outlined with thin walls, individual entry door from corridor):\n" + "\n".join(
        apartments_lines
    )

    # ---- секция мебели (опционально)
    furniture_block = ""
    if with_furniture:
        present_kinds = {z.kind for t in plan.tiles for z in t.zones}
        furniture_lines = [
            f"  {kind.value}: {_ZONE_FURNITURE[kind]}"
            for kind in present_kinds
        ]
        furniture_block = "Furniture per zone (top-down icons, clean modern style):\n" + "\n".join(furniture_lines)

    # ---- секция технических деталей
    tech = (
        "Technical annotations to include in the image:\n"
        "  • North arrow (compass rose) in top-right corner\n"
        "  • Scale bar 0–10 m in bottom-left\n"
        f"  • Apartment numbers «КВ №1»…«КВ №{apt_count}» in colored circles, one per apartment\n"
        "  • Cyrillic labels for room areas (e.g. «18.5 м²») inside each room\n"
        "  • Loggia outlines extending past the facade walls\n"
        "  • Window markers on facade walls (light blue stripes)\n"
        "  • Entry door arc swing for each apartment from corridor"
    )

    output = (
        "Output: realistic top-down architectural floor plan rendering at marketing brochure quality. "
        "Light beige background outside the building. Wood-grain parquet floors visible inside apartments. "
        "Each apartment is outlined with light grey 200 mm walls and tinted with a soft pastel color "
        "(different per apartment). Photorealistic but cleanly drawn — like a hand-illustrated developer "
        "presentation, not a photograph. No 3D perspective — strictly orthographic top-down view."
    )

    return "\n\n".join([
        style,
        building,
        apartments,
        furniture_block,
        tech,
        output,
    ])


def _style_section() -> str:
    return (
        "Top-down orthographic architectural floor plan, marketing brochure style, "
        "1:100 scale, professional developer presentation. Soft natural daylight, "
        "subtle long shadows from interior walls, hand-illustrated parquet floors, "
        "interior design Pinterest-style — bedrooms have beds, kitchens have islands, "
        "bathrooms have tubs and toilets, all rendered as small clean top-down icons. "
        "Color palette: warm beige walls, walnut and oak wood floors, soft pastel "
        "apartment fills, white furniture accents, natural greenery (potted plants). "
        "High detail, clean lines, no text overlap. 4K quality, ratio 16:10."
    )
