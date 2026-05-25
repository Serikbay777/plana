"""Регрессия для floorplan_ifc.py.

Фиксирует то, что мы добились в Phase 3a/3b/3c:
  - Z-stacking этажей (каждый этаж на правильной Z, не складываются в Z=0)
  - Внутренние стены (ядро + коридор + перегородки комнат)
  - Двери/окна как проёмы в стенах (с lintels/sills)
  - Лестница как IfcStair
  - IFC4 валидность

Если будущий рефакторинг сломает один из этих пунктов — тест падает.
"""
from __future__ import annotations

import re
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.placement as up
import pytest

from plana_engine.cad.floorplan_ifc import build_ifc_from_layout
from plana_engine.cad.layout_schema import LayoutFloor


# ── helpers ─────────────────────────────────────────────────────────────


def _open_ifc_bytes(bytes_: bytes, tmp_path: Path, name: str) -> ifcopenshell.file:
    p = tmp_path / name
    p.write_bytes(bytes_)
    return ifcopenshell.open(str(p))


def _world_z(product) -> float:
    return float(up.get_local_placement(product.ObjectPlacement)[2, 3])


# ── базовая структура ───────────────────────────────────────────────────


def test_basic_structure_ifc4(minimal_layout: LayoutFloor, tmp_path: Path):
    """Минимальный layout даёт валидный IFC4 со всей spatial-иерархией."""
    data = build_ifc_from_layout(minimal_layout, n_floors=2, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "basic.ifc")

    assert m.schema == "IFC4"
    assert len(m.by_type("IfcProject")) == 1
    assert len(m.by_type("IfcSite")) == 1
    assert len(m.by_type("IfcBuilding")) == 1
    assert len(m.by_type("IfcBuildingStorey")) == 2
    assert len(m.by_type("IfcSlab")) == 2
    # IfcSpace на каждую комнату + ядро + коридор × этажи = (7 rooms + 2 cores + 1 corridor) × 2
    assert len(m.by_type("IfcSpace")) == 20


# ── Phase 3a: Z-stacking ────────────────────────────────────────────────


def test_z_stacking_storeys(minimal_layout: LayoutFloor, tmp_path: Path):
    """Storeys стоят на правильных Z: 0, 3, 6 для трёх этажей."""
    data = build_ifc_from_layout(minimal_layout, n_floors=3, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "z3.ifc")

    storeys = m.by_type("IfcBuildingStorey")
    storey_zs = sorted(_world_z(s) for s in storeys)
    assert storey_zs == pytest.approx([0.0, 3.0, 6.0])
    assert [float(s.Elevation) for s in sorted(storeys, key=_world_z)] == \
        pytest.approx([0.0, 3.0, 6.0])


def test_z_stacking_slabs_per_floor(minimal_layout: LayoutFloor, tmp_path: Path):
    """Каждый slab на свой этаж (regression: раньше все слабы валились на Z=-0.2)."""
    data = build_ifc_from_layout(minimal_layout, n_floors=3, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "zslab.ifc")

    slab_zs = sorted(_world_z(s) for s in m.by_type("IfcSlab"))
    # slab кладётся на z_storey - thickness (0.2), значит верх slab = верх этажа
    assert slab_zs == pytest.approx([-0.2, 2.8, 5.8])


def test_z_stacking_walls_per_floor(minimal_layout: LayoutFloor, tmp_path: Path):
    """Стены распределены по этажам (не сложились в Z=0)."""
    data = build_ifc_from_layout(minimal_layout, n_floors=3, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "zwall.ifc")

    walls_at = {0.0: 0, 3.0: 0, 6.0: 0}
    for w in m.by_type("IfcWall"):
        z = _world_z(w)
        # Lintels стартуют на z + door_head ≈ 2.1 → группируем по ближайшему этажу
        floor_z = min(walls_at.keys(), key=lambda fz: abs(z - fz))
        # Игнорируем lintels (отстают на 2.1 м)
        if abs(z - floor_z) > 0.5:
            continue
        walls_at[floor_z] += 1
    # Все три этажа должны иметь стены
    for fz, n in walls_at.items():
        assert n > 0, f"этаж z={fz} без стен (Z-stacking регресс)"


# ── Phase 3b: внутренние стены ──────────────────────────────────────────


def test_wall_categories_present(minimal_layout: LayoutFloor, tmp_path: Path):
    """В IFC есть стены всех 4 категорий: периметр, ядро, коридор, комнаты."""
    data = build_ifc_from_layout(minimal_layout, n_floors=1, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "cats.ifc")

    walls = m.by_type("IfcWall")
    cats: dict[str, int] = {}
    for w in walls:
        if not w.Name:
            continue
        prefix = w.Name.split("-")[0]
        cats[prefix] = cats.get(prefix, 0) + 1

    assert cats.get("W", 0) > 0, "нет периметральных стен (W-*)"
    assert cats.get("Core", 0) > 0, "нет стен ядра (Core-*) — Phase 3b регресс"
    assert cats.get("Corr", 0) > 0, "нет стен коридора (Corr-*) — Phase 3b регресс"
    assert cats.get("Room", 0) > 0, "нет стен комнат (Room-*) — Phase 3b регресс"


def test_walls_scale_with_floors(minimal_layout: LayoutFloor, tmp_path: Path):
    """Кол-во стен пропорционально кол-ву этажей (не stuck на одном)."""
    one = build_ifc_from_layout(minimal_layout, n_floors=1, storey_h=3.0)
    three = build_ifc_from_layout(minimal_layout, n_floors=3, storey_h=3.0)

    m1 = _open_ifc_bytes(one, tmp_path, "n1.ifc")
    m3 = _open_ifc_bytes(three, tmp_path, "n3.ifc")
    n1 = len(m1.by_type("IfcWall"))
    n3 = len(m3.by_type("IfcWall"))
    # Должно быть строго 3× (с допуском в ±5 на крошечные segment-нюансы)
    assert abs(n3 - 3 * n1) <= 5, f"стены не масштабируются: 1 этаж={n1}, 3 этажа={n3}"


def test_fire_walls_between_sections(two_sections_layout: LayoutFloor, tmp_path: Path):
    """Между секциями есть IfcWall с префиксом FW (противопожарная)."""
    data = build_ifc_from_layout(two_sections_layout, n_floors=1, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "fire.ifc")

    fire_walls = [w for w in m.by_type("IfcWall") if w.Name and w.Name.startswith("FW-")]
    assert len(fire_walls) >= 1, "нет противопожарной стены между секциями"


# ── Phase 3c: двери / окна / лестницы ───────────────────────────────────


def test_door_window_count_matches_layout(
    minimal_layout: LayoutFloor, tmp_path: Path,
):
    """IfcDoor/IfcWindow ровно столько, сколько в LayoutDoor/LayoutWindow × n_floors."""
    n_floors = 2
    # Считаем входные двери/окна
    n_doors_per_floor = sum(
        len(r.doors) for sect in minimal_layout.sections
        for apt in sect.apartments for r in apt.rooms
    )
    n_windows_per_floor = sum(
        len(r.windows) for sect in minimal_layout.sections
        for apt in sect.apartments for r in apt.rooms
    )

    data = build_ifc_from_layout(minimal_layout, n_floors=n_floors, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "doors.ifc")

    assert len(m.by_type("IfcDoor")) == n_doors_per_floor * n_floors
    assert len(m.by_type("IfcWindow")) == n_windows_per_floor * n_floors


def test_stair_count_matches_cores(minimal_layout: LayoutFloor, tmp_path: Path):
    """IfcStair на каждое LayoutCore.kind=='stair' × n_floors."""
    n_floors = 2
    n_stairs_per_floor = sum(
        1 for sect in minimal_layout.sections
        for c in sect.cores if c.kind == "stair"
    )
    data = build_ifc_from_layout(minimal_layout, n_floors=n_floors, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "stairs.ifc")
    assert len(m.by_type("IfcStair")) == n_stairs_per_floor * n_floors


def test_door_lintels_above_door_head(minimal_layout: LayoutFloor, tmp_path: Path):
    """Lintel-стены над дверями находятся на z_storey + 2.10 м (head door)."""
    data = build_ifc_from_layout(minimal_layout, n_floors=1, storey_h=3.0)
    m = _open_ifc_bytes(data, tmp_path, "lintels.ifc")

    lintels = [w for w in m.by_type("IfcWall")
               if w.Name and re.search(r"-lin\d+", w.Name)]
    assert lintels, "не найдены lintel-стены — Phase 3c регресс"
    for w in lintels:
        z = _world_z(w)
        # Lintel либо над дверью (z=2.1) либо над окном (z=2.4)
        assert any(abs(z - h) < 0.01 for h in (2.10, 2.40)), \
            f"lintel {w.Name} на странной Z={z} (ожидалось 2.10 или 2.40)"
