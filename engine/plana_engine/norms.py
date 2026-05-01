"""Загрузка и доступ к `norms.yaml`.

Конфиг загружается один раз на процесс и хранится в `Norms` (Pydantic).
Изменения значений в YAML не требуют изменений кода — это ключевое требование
ТЗ §7.2.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Pydantic-схемы — валидируют структуру файла на старте
# ---------------------------------------------------------------------------


class CorridorNorms(BaseModel):
    min_width_m: float
    min_width_evacuation_m: float
    max_evacuation_length_m: float
    min_clear_height_m: float


class RoomNorms(BaseModel):
    min_area_sqm: float
    min_width_m: float | None = None


class KitchenLivingNorms(BaseModel):
    min_area_sqm: float


class RoomsNorms(BaseModel):
    living_room: RoomNorms
    bedroom: RoomNorms
    kitchen: RoomNorms
    kitchen_living: KitchenLivingNorms
    bathroom: RoomNorms
    hall: RoomNorms


Orientation = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


class InsolationNorms(BaseModel):
    min_hours_per_day: float
    required_share_of_apts: float
    preferred_orientations: list[Orientation]


class CoreNorms(BaseModel):
    min_lifts_per_floor_apts: int
    min_stairs_per_section: int
    min_stair_width_m: float
    min_lift_shaft_m: float
    shaft_required_for_storeys_above: int


class FireNorms(BaseModel):
    max_dead_end_corridor_m: float
    required_evacuation_exits: int
    fire_compartment_max_area_sqm: float


class TileNorms(BaseModel):
    size_tolerance: float
    min_facade_width_m: float
    max_facade_width_m: float
    apt_depth_min_m: float
    apt_depth_max_m: float


class WetZonesNorms(BaseModel):
    must_align_with_shaft: bool
    max_distance_to_shaft_m: float


class Norms(BaseModel):
    """Полный нормативный конфиг."""

    version: str
    region: str
    last_review: str | None = None
    reviewer: str | None = None

    corridor: CorridorNorms
    rooms: RoomsNorms
    insolation: InsolationNorms
    core: CoreNorms
    fire: FireNorms
    tile: TileNorms
    wet_zones: WetZonesNorms = Field(alias="wet_zones")


# ---------------------------------------------------------------------------
# API модуля
# ---------------------------------------------------------------------------


DEFAULT_NORMS_PATH = Path(__file__).resolve().parent.parent / "data" / "norms.yaml"


def load_norms(path: Path | str | None = None) -> Norms:
    """Загрузить и провалидировать `norms.yaml`. Бросает `pydantic.ValidationError`
    если структура неконсистентна — это лучше, чем тихие ошибки в продакшене."""
    p = Path(path) if path else DEFAULT_NORMS_PATH
    if not p.is_file():
        raise FileNotFoundError(f"norms.yaml not found at {p}")
    with p.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return Norms.model_validate(data)


@lru_cache(maxsize=4)
def get_norms(path: str | None = None) -> Norms:
    """Кэшированный аксессор. Большая часть кода работает с дефолтным конфигом —
    кэш живёт на процесс. Для тестов передавайте явный путь."""
    return load_norms(path)


def reload_norms() -> Norms:
    """Сбросить кэш и перечитать (для админ-эндпоинта /admin/reload-norms)."""
    get_norms.cache_clear()
    return get_norms()
