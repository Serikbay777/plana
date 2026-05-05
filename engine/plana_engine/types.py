"""Минимальные доменные типы движка Plana.

Движок чисто prompt-driven — параметры → промпт → gpt-image. Алгоритмическая
геометрия (Plan, PlacedTile, CoreSpec, Corridor, Polygon, Edge, …) удалена
вместе с pipeline-ом и DXF-экспортом.

Здесь остался только enum назначения объекта, который попадает в промпты
через `MarketingInputs.purpose` и переключает `_residential_blocks` /
`_commercial_blocks` / `_hotel_blocks` / `_mixed_use_blocks`.
"""

from __future__ import annotations

from enum import Enum


class BuildingPurpose(str, Enum):
    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    MIXED_USE = "mixed_use"
    HOTEL = "hotel"
