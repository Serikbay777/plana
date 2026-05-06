"""Доменная схема входа CAD-эндпоинта.

В Phase 1 поля принимаются, но writer выдаёт фиксированную раскладку.
Фазы 2–3 начнут читать эти параметры по-настоящему.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AptType = Literal["studio", "k1", "euro1", "k2", "euro2", "k3", "euro3"]
WindowSide = Literal["north", "south", "east", "west"]


class ApartmentSpec(BaseModel):
    """Параметры одной квартиры для пред-планировки."""

    apt_type: AptType = "k1"

    # габариты внешнего контура квартиры (в метрах)
    width_m: float = Field(6.0, ge=4.0, le=14.0)
    depth_m: float = Field(4.0, ge=4.0, le=14.0)

    # стороны со внешними окнами; для секционной — одна, для торцевой/угловой — две
    window_sides: list[WindowSide] = Field(default_factory=lambda: ["south"])

    bathroom_count: Literal[1, 2] = 1

    has_loggia: bool = False
    loggia_side: WindowSide | None = None

    ceiling_height_mm: int = Field(2800, ge=2400, le=3500)
