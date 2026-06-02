"""Verify the QTO aggregator: the BillOfQuantities derived from an exported
IFC matches the quantities independently summed from the same model, and the
structural/partition split + floor area + opening counts are correct.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import ifcopenshell
from ifcopenshell.util.element import get_psets

from plana_engine.cad.floorplan_ifc import build_ifc_from_layout
from plana_engine.cad.layout_schema import (
    LayoutApartment, LayoutDoor, LayoutFloor, LayoutRoom, LayoutSection, LayoutWindow,
)
from plana_engine.cost import quantities_from_ifc


def _layout() -> LayoutFloor:
    return LayoutFloor(
        width_m=12.0, depth_m=10.0,
        sections=[
            LayoutSection(
                index=0, x_start=0.0, width=12.0,
                corridor_y=5.0, corridor_d=1.6,
                apartments=[
                    LayoutApartment(
                        type_code="2k", number=1, x=0.5, y=0.5, w=11.0, d=4.0,
                        rooms=[
                            LayoutRoom(
                                kind="living", name_ru="Гостиная",
                                x=0.0, y=0.0, w=6.0, d=4.0,
                                doors=[LayoutDoor(side="N", offset=2.0, width=0.9)],
                                windows=[LayoutWindow(side="S", offset=2.0, width=1.8)],
                            ),
                            LayoutRoom(
                                kind="kitchen", name_ru="Кухня",
                                x=6.0, y=0.0, w=5.0, d=4.0,
                                windows=[LayoutWindow(side="S", offset=1.5, width=1.5)],
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )


def _model() -> ifcopenshell.file:
    return ifcopenshell.file.from_string(
        build_ifc_from_layout(_layout(), n_floors=1).decode("utf-8")
    )


def _sum(model, cls: str, qname: str, field: str) -> float:
    return sum(
        get_psets(e, qtos_only=True)[qname][field]
        for e in model.by_type(cls)
        if qname in get_psets(e, qtos_only=True)
    )


def test_boq_matches_independent_sums() -> None:
    model = _model()
    boq = quantities_from_ifc(model)

    wall_vol = _sum(model, "IfcWall", "Qto_WallBaseQuantities", "NetVolume")
    slab_vol = _sum(model, "IfcSlab", "Qto_SlabBaseQuantities", "NetVolume")
    floor_area = _sum(model, "IfcSpace", "Qto_SpaceBaseQuantities", "NetFloorArea")

    # structural + partition should account for ALL wall + slab volume
    assert abs(
        (boq.total_structural_volume_m3 + boq.total_partition_volume_m3)
        - (wall_vol + slab_vol)
    ) < 1e-3
    assert abs(boq.total_floor_area_m2 - floor_area) < 1e-3
    assert boq.door_count == len(model.by_type("IfcDoor"))
    assert boq.window_count == len(model.by_type("IfcWindow"))


def test_walls_split_by_thickness() -> None:
    boq = quantities_from_ifc(_model())
    wall_lines = [ln for ln in boq.lines if ln.element_class == "IfcWall"]
    assert wall_lines, "no wall lines produced"
    thicknesses = {ln.key for ln in wall_lines}
    # perimeter bearing walls (0.40m) and room partitions (0.12m) must both appear
    assert any("0.40" in k for k in thicknesses), thicknesses
    assert any("0.12" in k for k in thicknesses), thicknesses
    # each wall line's headline quantity equals its summed volume
    for ln in wall_lines:
        assert ln.unit == "м³"
        assert abs(ln.quantity - round(ln.net_volume_m3, 3)) < 1e-6


def test_accepts_bytes() -> None:
    """quantities_from_ifc должен принимать сырые IFC-bytes, не только модель."""
    ifc_bytes = build_ifc_from_layout(_layout(), n_floors=1)
    boq = quantities_from_ifc(ifc_bytes)
    assert boq.total_floor_area_m2 > 0
    assert boq.lines


def _summary() -> None:
    boq = quantities_from_ifc(_model())
    print("\n── Ведомость объёмов (BillOfQuantities) ──")
    for ln in boq.lines:
        print(f"  {ln.key:<22} ×{ln.count:<3} {ln.quantity:8.2f} {ln.unit}"
              f"   (площ. {ln.net_area_m2:7.2f} м²)")
    print("  ─────")
    print(f"  Конструктив (перекр.+несущие): {boq.total_structural_volume_m3:8.2f} м³")
    print(f"  Перегородки:                   {boq.total_partition_volume_m3:8.2f} м³")
    print(f"  Площадь стен (под отделку):    {boq.total_wall_side_area_m2:8.2f} м²")
    print(f"  Площадь помещений:             {boq.total_floor_area_m2:8.2f} м²")
    print(f"  Двери / окна:                  {boq.door_count} / {boq.window_count} шт")


if __name__ == "__main__":
    test_boq_matches_independent_sums()
    test_walls_split_by_thickness()
    test_accepts_bytes()
    _summary()
    print("\nALL CHECKS PASSED")
