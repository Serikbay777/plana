"""Парсеры входного контура этажа.

Поддерживается три источника:
- `rect` — прямоугольник по габаритам (дефолт для UI и тестов)
- `dxf` — DXF/DWG через ezdxf (минимальная имплементация: первый замкнутый
  LWPOLYLINE/POLYLINE)
- `pdf` — векторный PDF (отложено, см. ТЗ §9 — OCR не входит в MVP)
"""

from .rect import parse_rect
from .dxf import parse_dxf

__all__ = ["parse_rect", "parse_dxf"]
