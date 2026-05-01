"""Геометрические хелперы поверх Shapely.

Здесь — операции, которые используются алгоритмом размещения: классификация
рёбер (фасад / межквартирные), нарезка фасадов на слоты, расчёт ориентации,
эвакуационных расстояний.
"""

from .polygon import (
    poly_to_shapely, shapely_to_poly, polygon_area, polygon_edges,
    rect_polygon,
)
from .facades import classify_edges, edge_orientation, south_oriented_edges
from .slots import cut_facade_into_slots, Slot

__all__ = [
    "poly_to_shapely", "shapely_to_poly", "polygon_area", "polygon_edges",
    "rect_polygon",
    "classify_edges", "edge_orientation", "south_oriented_edges",
    "cut_facade_into_slots", "Slot",
]
