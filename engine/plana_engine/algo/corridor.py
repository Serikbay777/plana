"""Прокладка коридоров (ТЗ §5.1, шаг 3).

Стратегия для MVP:
- Если здание вытянутое (aspect > 1.6) — линейный коридор вдоль длинной оси.
- Иначе — центральный холл (актуально для башен).

Из коридора потом отдельно строится «фасадный пояс» — это полоса между
фасадом и коридором, в которую укладываются квартиры.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..norms import Norms
from ..types import CoreSpec, Corridor, CorridorKind, Edge, Polygon
from ..geometry.polygon import polygon_edges, poly_to_shapely, rect_polygon


@dataclass(frozen=True)
class FacadeBelt:
    """Фасадный пояс — полоса между фасадным ребром и коридором.

    Это «зона размещения тайлов». Для двустороннего коридора получается
    2 пояса (с севера и с юга). Для центрального холла — пояса по периметру.
    """
    edge: Edge                      # фасадное ребро
    depth: float                    # глубина пояса (≥ apt_depth_min)


@dataclass(frozen=True)
class CorridorPlan:
    corridors: list[Corridor]
    belts: list[FacadeBelt]
    kind: CorridorKind


def lay_corridors(
    contour: Polygon,
    core: CoreSpec,
    norms: Norms,
    target_apt_depth: float | None = None,
) -> CorridorPlan:
    """Спроектировать коридоры и фасадные пояса.

    В MVP — двусторонний коридор (double-loaded), проходит горизонтально
    через ядро. Глубина квартир — параметр `target_apt_depth` (если задан)
    или дефолт по нормам. Параметризация по пресету позволяет варьировать
    разрез плана — разные пресеты дают **структурно разные планы** (ТЗ §2.2).
    """
    sp = poly_to_shapely(contour)
    minx, miny, maxx, maxy = sp.bounds
    w_total = maxx - minx
    h_total = maxy - miny
    aspect = w_total / max(h_total, 1e-6)

    apt_depth = target_apt_depth or norms.tile.apt_depth_max_m
    apt_depth = max(norms.tile.apt_depth_min_m,
                    min(apt_depth, norms.tile.apt_depth_max_m))
    cor_w = max(norms.corridor.min_width_m, 1.6)

    edges = polygon_edges(contour)

    # Линейный двусторонний коридор для вытянутых корпусов
    if aspect >= 1.0:
        # глубина квартиры подгоняется так, чтобы 2*apt_depth + cor_w == h_total
        usable = h_total - cor_w
        belt_depth = max(norms.tile.apt_depth_min_m,
                         min(apt_depth, usable / 2))
        # фасадные пояса — у северного и южного фасадов
        # edges нумеруются по CCW, начиная с южного (нижнего) для нашего CCW-rect
        south_edge = edges[0]  # bottom
        north_edge = edges[2]  # top
        # коридор — горизонтальная полоса посередине
        cy = miny + belt_depth
        corridor_poly = rect_polygon(minx, cy, w_total, cor_w)
        corridor = Corridor(
            polygon=corridor_poly,
            kind=CorridorKind.LINEAR,
            length=w_total,
        )
        belts = [
            FacadeBelt(edge=south_edge, depth=belt_depth),
            FacadeBelt(edge=north_edge, depth=belt_depth),
        ]
        return CorridorPlan(corridors=[corridor], belts=belts, kind=CorridorKind.LINEAR)

    # Центральный холл для компактных контуров (квадратных)
    hall_size = max(cor_w * 2, 3.0)
    hcx = minx + (w_total - hall_size) / 2
    hcy = miny + (h_total - hall_size) / 2
    hall_poly = rect_polygon(hcx, hcy, hall_size, hall_size)
    corridor = Corridor(
        polygon=hall_poly,
        kind=CorridorKind.CENTRAL,
        length=hall_size * 4,
    )
    # пояса — со всех 4 сторон
    belt_depth = max(norms.tile.apt_depth_min_m,
                     (min(w_total, h_total) - hall_size) / 2)
    belts = [FacadeBelt(edge=e, depth=belt_depth) for e in edges[:4]]
    return CorridorPlan(corridors=[corridor], belts=belts, kind=CorridorKind.CENTRAL)
