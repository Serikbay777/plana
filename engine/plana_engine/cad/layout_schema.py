"""Pydantic-схема структурированной планировки этажа.

Используется двумя потребителями:
  - layout_generator.py  → structured_output от GPT-4o
  - floorplan_ifc.py     → build_ifc_from_layout()
  - main.py              → /generate/floor-layout + /export/floorplan-ifc
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


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
