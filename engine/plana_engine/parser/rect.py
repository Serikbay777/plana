"""Простейший парсер: прямоугольный контур по габаритам.

Используется фронтом, когда пользователь задаёт W×H через форму, а также
тестами. Для реальной приёмки по ТЗ нужен `parse_dxf`.
"""

from __future__ import annotations

from ..types import Point, Polygon


def parse_rect(width_m: float, height_m: float) -> Polygon:
    """Контур этажа в виде прямоугольника `width × height` метров.

    Углы обходятся против часовой стрелки (CCW), origin (0,0) — нижний-левый.
    Это совпадает с конвенцией Shapely для exterior.
    """
    if width_m <= 0 or height_m <= 0:
        raise ValueError(f"rect dims must be positive, got {width_m}×{height_m}")
    return Polygon(
        exterior=[
            Point(x=0.0,       y=0.0),
            Point(x=width_m,   y=0.0),
            Point(x=width_m,   y=height_m),
            Point(x=0.0,       y=height_m),
        ],
        holes=[],
    )
