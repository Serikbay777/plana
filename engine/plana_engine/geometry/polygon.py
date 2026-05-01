"""Конверсии и базовые операции над `types.Polygon` ↔ Shapely."""

from __future__ import annotations

import math

from shapely.geometry import Polygon as ShPolygon

from ..types import Edge, EdgeType, Point, Polygon


def poly_to_shapely(p: Polygon) -> ShPolygon:
    """Преобразовать наш `Polygon` в Shapely-полигон."""
    ext, holes = p.as_tuples()
    return ShPolygon(ext, holes)


def shapely_to_poly(sp: ShPolygon) -> Polygon:
    """Обратная конверсия. Дубликат-замыкатель убирается."""
    ext = list(sp.exterior.coords)
    if ext and ext[0] == ext[-1]:
        ext = ext[:-1]
    holes = []
    for ring in sp.interiors:
        h = list(ring.coords)
        if h and h[0] == h[-1]:
            h = h[:-1]
        holes.append([Point(x=x, y=y) for x, y in h])
    return Polygon(
        exterior=[Point(x=x, y=y) for x, y in ext],
        holes=holes,
    )


def polygon_area(p: Polygon) -> float:
    """Площадь полигона в м² (с учётом дырок)."""
    return float(poly_to_shapely(p).area)


def polygon_edges(p: Polygon) -> list[Edge]:
    """Извлечь рёбра внешнего контура. Тип рёбер по умолчанию — UNKNOWN
    (классификация фасад/внутр. — `classify_edges`)."""
    pts = p.exterior
    edges: list[Edge] = []
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        length = math.hypot(b.x - a.x, b.y - a.y)
        edges.append(Edge(a=a, b=b, type=EdgeType.UNKNOWN, length=length))
    return edges


def rect_polygon(x: float, y: float, w: float, h: float) -> Polygon:
    """Удобный конструктор прямоугольника. CCW."""
    return Polygon(
        exterior=[
            Point(x=x,       y=y),
            Point(x=x + w,   y=y),
            Point(x=x + w,   y=y + h),
            Point(x=x,       y=y + h),
        ]
    )
