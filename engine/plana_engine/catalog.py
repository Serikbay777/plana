"""Загрузка каталога тайлов (`catalog.yaml`)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from .types import AptType, TileSpec, Zone, ZoneKind


DEFAULT_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.yaml"


def load_catalog(path: Path | str | None = None) -> list[TileSpec]:
    """Загрузить каталог тайлов. Бросает `pydantic.ValidationError` при
    некорректной структуре — структурная валидация на старте."""
    p = Path(path) if path else DEFAULT_CATALOG_PATH
    if not p.is_file():
        raise FileNotFoundError(f"catalog.yaml not found at {p}")
    with p.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    tiles: list[TileSpec] = []
    for raw in data.get("tiles", []):
        zones = [
            Zone(
                kind=ZoneKind(z["kind"]),
                x=z["x"], y=z["y"], w=z["w"], h=z["h"],
            )
            for z in raw.get("zones", [])
        ]
        tiles.append(
            TileSpec(
                code=raw["code"],
                apt_type=AptType(raw["apt_type"]),
                label=raw["label"],
                area=raw["area"],
                width=raw["width"],
                depth=raw["depth"],
                tolerance=raw.get("tolerance", 0.10),
                door_offset=raw.get("door_offset", 0.4),
                zones=zones,
            )
        )
    return tiles


@lru_cache(maxsize=4)
def get_catalog(path: str | None = None) -> tuple[TileSpec, ...]:
    """Кэшированный кортеж (immutable) тайлов."""
    return tuple(load_catalog(path))


def by_code(code: str, catalog: tuple[TileSpec, ...] | None = None) -> TileSpec:
    """Найти тайл по коду — например, `S-25` или `3K-95`."""
    cat = catalog or get_catalog()
    for t in cat:
        if t.code == code:
            return t
    raise KeyError(f"tile {code!r} not found in catalog")


def by_type(apt_type: AptType, catalog: tuple[TileSpec, ...] | None = None) -> list[TileSpec]:
    """Все тайлы заданного класса (например, все `k2`)."""
    cat = catalog or get_catalog()
    return [t for t in cat if t.apt_type == apt_type]
