"""Укладка тайла из каталога в фасадный слот (ТЗ §5.1, шаг 5).

Тайл укладывается в слот так, чтобы фасадная стена тайла совпадала с
фасадным ребром этажа. Применяется допуск ±10% по ширине и глубине, чтобы
заполнить слот целиком (растяжение/сжатие в пределах допуска).

Если допуска не хватает — тайл считается неподходящим (вернёт `None`).
"""

from __future__ import annotations

import math

from ..types import (
    Edge, EdgeType, PlacedTile, PlacedZone, Point, Polygon, TileSpec, Zone,
)
from ..geometry.slots import Slot


def fits_slot(spec: TileSpec, slot: Slot) -> bool:
    """Проверить, влезает ли тайл в слот с учётом допусков ±tolerance."""
    tol = spec.tolerance
    w_min = spec.width * (1 - tol)
    w_max = spec.width * (1 + tol)
    d_min = spec.depth * (1 - tol)
    d_max = spec.depth * (1 + tol)
    return (w_min <= slot.width <= w_max) and (d_min <= slot.depth <= d_max)


def place_tile_in_slot(spec: TileSpec, slot: Slot) -> PlacedTile | None:
    """Преобразовать тайл (локальные координаты) в `PlacedTile` (мировые).

    Возвращает `None` если тайл не помещается даже с допусками.
    """
    if not fits_slot(spec, slot):
        return None

    origin, (ux, uy) = slot.origin_world()
    nx, ny = -uy, ux  # нормаль внутрь здания (поскольку слот — внутрь от фасада)

    # фактические размеры (с растяжением/сжатием в слот)
    w = slot.width
    d = slot.depth

    # вычисляем 4 угла мирового полигона тайла
    p0 = (origin.x,            origin.y)
    p1 = (origin.x + ux * w,   origin.y + uy * w)
    p2 = (origin.x + ux * w + nx * d, origin.y + uy * w + ny * d)
    p3 = (origin.x + nx * d,   origin.y + ny * d)

    polygon = Polygon(exterior=[
        Point(x=p0[0], y=p0[1]),
        Point(x=p1[0], y=p1[1]),
        Point(x=p2[0], y=p2[1]),
        Point(x=p3[0], y=p3[1]),
    ])

    # Преобразуем зоны из локальных координат тайла в мировые.
    # Базис тайла: X' = (ux, uy) — вдоль фасада, Y' = (nx, ny) — внутрь здания.
    # Origin тайла = `origin` (точка на фасадном ребре, ближе к edge.a).
    sx = w / spec.width   # масштаб по X' (вдоль фасада)
    sy = d / spec.depth   # масштаб по Y' (вглубь)
    placed_zones: list[PlacedZone] = []
    for z in spec.zones:
        corners_local = [
            (z.x,        z.y),
            (z.x + z.w,  z.y),
            (z.x + z.w,  z.y + z.h),
            (z.x,        z.y + z.h),
        ]
        corners_world: list[Point] = []
        for (zx, zy) in corners_local:
            scaled_x = zx * sx
            scaled_y = zy * sy
            wx = origin.x + ux * scaled_x + nx * scaled_y
            wy = origin.y + uy * scaled_x + ny * scaled_y
            corners_world.append(Point(x=wx, y=wy))
        placed_zones.append(PlacedZone(
            kind=z.kind,
            polygon=Polygon(exterior=corners_world),
        ))

    # положение входной двери в мировых координатах:
    # на коридорной стороне (локальный y = depth), смещение `door_offset`
    # от ближнего к edge.a края тайла (локальный x = door_offset)
    door_x = spec.door_offset * sx
    door_y = d
    door_world = Point(
        x=origin.x + ux * door_x + nx * door_y,
        y=origin.y + uy * door_x + ny * door_y,
    )

    # площадь жилых зон (living + bedroom)
    from ..geometry.polygon import poly_to_shapely
    living_area = 0.0
    for pz in placed_zones:
        if pz.kind.value in ("living", "bedroom"):
            living_area += float(poly_to_shapely(pz.polygon).area)

    return PlacedTile(
        spec_code=spec.code,
        apt_type=spec.apt_type,
        label=spec.label,
        polygon=polygon,
        area=round(w * d, 1),
        width=w,
        depth=d,
        facade_edge=Edge(a=slot.edge.a, b=slot.edge.b, type=EdgeType.FACADE,
                         length=slot.edge.length),
        zones=placed_zones,
        door_world=door_world,
        living_area=round(living_area, 1),
    )


def candidate_tiles_for_slot(catalog: tuple[TileSpec, ...], slot: Slot) -> list[TileSpec]:
    """Все тайлы из каталога, которые геометрически помещаются в слот."""
    return [t for t in catalog if fits_slot(t, slot)]


def slot_facing_orientation(slot: Slot, north_angle_rad: float = math.pi / 2) -> str:
    """Какой стороной света смотрит фасадное ребро слота — для пресета инсоляции."""
    from ..geometry.facades import edge_orientation
    return edge_orientation(slot.edge, north_angle_rad)
