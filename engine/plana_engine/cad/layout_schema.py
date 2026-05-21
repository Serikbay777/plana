"""Pydantic-схема структурированной планировки этажа.

Используется двумя потребителями:
  - layout_generator.py  → structured_output от GPT-4o
  - floorplan_ifc.py     → build_ifc_from_layout()
  - main.py              → /generate/floor-layout + /export/floorplan-ifc
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


Side = Literal["S", "N", "W", "E"]
"""Сторона комнаты/квартиры:
   S — южная (low Y)   N — северная (high Y)
   W — западная (low X)   E — восточная (high X)
"""


class LayoutDoor(BaseModel):
    """Дверь, привязанная к одной из четырёх стен комнаты."""
    side: Side
    offset: float
    """Расстояние от южной (для W/E) или западной (для S/N) кромки стены (м)"""
    width: float = 0.9
    """Ширина проёма (м). По умолчанию стандартная межкомнатная 0.9 м."""
    swing: Literal["in", "out"] = "in"
    """Открывание: внутрь комнаты (in) или наружу (out)."""
    hinge: Literal["left", "right"] = "left"
    """С какой стороны проёма петли (если смотреть со стороны open-направления)."""


class LayoutWindow(BaseModel):
    """Окно на одной из стен комнаты (обычно внешней)."""
    side: Side
    offset: float
    width: float = 1.5


class LayoutRoom(BaseModel):
    kind: str
    """Функция помещения: living / bedroom / kitchen / bathroom / toilet / hallway / loggia / storage"""
    name_ru: str
    """Название на русском: «Гостиная», «Спальня», «Кухня», …"""
    x: float
    """Левый край относительно начала квартиры (м)"""
    y: float
    """Нижний край относительно начала квартиры (м)"""
    w: float
    """Ширина по оси X (м)"""
    d: float
    """Глубина по оси Y (м)"""
    doors: list[LayoutDoor] = []
    windows: list[LayoutWindow] = []

    @property
    def area_m2(self) -> float:
        return round(self.w * self.d, 1)


class LayoutApartment(BaseModel):
    type_code: Literal["studio", "1k", "2k", "3k"]
    number: int
    x: float
    """Абсолютная координата в здании (м)"""
    y: float
    w: float
    d: float
    rooms: list[LayoutRoom] = []

    @property
    def area_m2(self) -> float:
        return round(self.w * self.d, 1)


class LayoutCore(BaseModel):
    kind: Literal["lift_passenger", "lift_freight", "stair"]
    x: float
    y: float
    w: float
    d: float


class LayoutSection(BaseModel):
    index: int
    x_start: float
    """Левый край секции в системе координат здания (м)"""
    width: float
    corridor_y: float
    """Y-координата нижнего края коридора"""
    corridor_d: float
    """Ширина коридора (м), КМК ≥ 1.4"""
    cores: list[LayoutCore] = []
    apartments: list[LayoutApartment] = []


class LayoutFloor(BaseModel):
    """Планировка типового этажа — результат GPT-4o structured output."""
    width_m: float
    depth_m: float
    sections: list[LayoutSection] = []
