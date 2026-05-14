"""Доменная модель plana — Pydantic + Shapely.

Публичный API:
    from plana_engine.domain import (
        Project, Site, Building, Floor, Apartment, Room, Core, Shaft,
        Setbacks, GpzuConstraints, BuildingPurpose,
        marketing_to_project,
        PolygonField, MultiPolygonField,
    )

Подробности — см. domain/model.py (схема) и domain/bridge.py (мост из формы).
"""

from __future__ import annotations

from ..types import BuildingPurpose
from ._shapely_adapter import MultiPolygonField, PolygonField
from .bridge import marketing_to_project
from .model import (
    Apartment, ApartmentType, Building, Core, CoreKind,
    Floor, GpzuConstraints, Project, Room, RoomKind,
    Setbacks, Shaft, ShaftPurpose, Site,
)

__all__ = [
    # Модель
    "Apartment", "ApartmentType",
    "Building",
    "BuildingPurpose",
    "Core", "CoreKind",
    "Floor",
    "GpzuConstraints",
    "Project",
    "Room", "RoomKind",
    "Setbacks",
    "Shaft", "ShaftPurpose",
    "Site",
    # Мост
    "marketing_to_project",
    # Geometry-поля для расширения схемы
    "PolygonField", "MultiPolygonField",
]
