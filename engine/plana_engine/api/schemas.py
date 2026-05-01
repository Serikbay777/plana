"""Pydantic-схемы HTTP API.

Это тонкая обёртка вокруг доменных типов из `types.py` — здесь только
запросы/ответы и поля, специфичные для HTTP-уровня.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..presets import PRESET_DESCRIPTIONS, PRESET_LABELS
from ..types import (
    AptType, BuildingPurpose, GenerateResponse, Plan, PresetKey, TargetMix,
)


class GenerateRectRequest(BaseModel):
    """Удобный вход для UI: прямоугольный контур + параметры.

    Это упрощённая форма `GenerateRequest` для случая, когда контур задаётся
    шириной и глубиной (без DXF). Реальный DXF-эндпоинт — `/generate-from-dxf`.
    """

    site_width_m: float = Field(gt=0, le=300)
    site_depth_m: float = Field(gt=0, le=300)
    setback_front_m: float = Field(ge=0, default=0)
    setback_side_m: float = Field(ge=0, default=0)
    setback_rear_m: float = Field(ge=0, default=0)
    floors: int = Field(ge=1, le=80, default=1)
    purpose: BuildingPurpose = BuildingPurpose.RESIDENTIAL
    target_mix: TargetMix | None = None


class PresetMeta(BaseModel):
    """Описание пресета для фронта."""
    key: PresetKey
    label: str
    description: str


class PresetsResponse(BaseModel):
    presets: list[PresetMeta]


class TileSpecMeta(BaseModel):
    """Краткая инфа по тайлу для UI (не вся метадата каталога)."""
    code: str
    apt_type: AptType
    label: str
    area: float
    width: float
    depth: float


class CatalogResponse(BaseModel):
    version: str
    tiles: list[TileSpecMeta]


class HealthResponse(BaseModel):
    status: str
    version: str
    norms_version: str
    catalog_size: int


class GenerateAPIResponse(GenerateResponse):
    """Совпадает с `GenerateResponse` — экспозируется напрямую."""
    pass
