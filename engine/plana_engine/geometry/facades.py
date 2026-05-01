"""Классификация рёбер контура: фасад vs внутреннее, ориентация по сторонам света.

В MVP контур этажа = внешний полигон здания, поэтому **все рёбра экстерьера
считаются фасадами**. Внутренние стены (между квартирами и коридором)
появляются позже как результат укладки тайлов.
"""

from __future__ import annotations

import math
from typing import Literal

from ..types import Edge, EdgeType


Orientation = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def classify_edges(edges: list[Edge]) -> list[Edge]:
    """В MVP — помечаем все рёбра как FACADE.

    В будущем (Этап 2) сюда добавится логика обнаружения внутренних дворов,
    атриумов и сквозных проездов из тайла исходного DXF.
    """
    return [e.model_copy(update={"type": EdgeType.FACADE}) for e in edges]


def edge_orientation(edge: Edge, north_angle_rad: float = math.pi / 2) -> Orientation:
    """Определить ориентацию ребра по сторонам света по нормали к нему.

    `north_angle_rad` — направление на север в системе координат (по умолчанию
    +y, π/2). Нормаль направлена наружу здания (вправо от хода ребра по CCW).
    """
    dx = edge.b.x - edge.a.x
    dy = edge.b.y - edge.a.y
    # внешняя нормаль для CCW-полигона: повёрнута на -90°
    nx, ny = dy, -dx
    n_len = math.hypot(nx, ny) or 1.0
    nx /= n_len
    ny /= n_len

    # угол нормали относительно «востока» (+x)
    angle = math.atan2(ny, nx)
    # нормализуем относительно «севера» (north_angle_rad)
    rel = math.degrees(angle - north_angle_rad) % 360
    # rel: 0=N, 90=E, 180=S, 270=W (по часовой)
    sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    sector_idx = int(((rel + 22.5) % 360) // 45)
    return sectors[sector_idx]  # type: ignore[return-value]


def south_oriented_edges(
    edges: list[Edge],
    preferred: tuple[Orientation, ...] = ("S", "SE", "SW"),
    north_angle_rad: float = math.pi / 2,
) -> list[Edge]:
    """Отфильтровать рёбра, ориентированные на юг/ю-в/ю-з (для инсоляции)."""
    return [e for e in edges if edge_orientation(e, north_angle_rad) in preferred]
