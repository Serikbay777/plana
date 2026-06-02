"""Output-verification: the IFC export carries BaseQuantities on every
quantifiable element, and the quantities are internally consistent
(NetVolume == Length × Width × Height for walls). This is the takeoff
foundation — a generated layout must come out takeoff-ready (ВОР / QTO).

Runs under pytest, or standalone: `python tests/test_floorplan_ifc_qto.py`.
"""
from __future__ import annotations

import os
import sys

# allow standalone execution (add engine/ to path so `plana_engine` imports)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# standalone runs may hit a non-UTF-8 console (Windows cp1251) — force UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import ifcopenshell
from ifcopenshell.util.element import get_psets

from shapely.geometry import Polygon as ShPolygon

from plana_engine.cad.floorplan_ifc import build_floorplan_ifc, build_ifc_from_layout
from plana_engine.cad.layout_schema import (
    LayoutApartment, LayoutCore, LayoutDoor, LayoutFloor, LayoutRoom,
    LayoutSection, LayoutWindow,
)
from plana_engine.domain.model import Building, Project, Site

_QTO_BY_CLASS = {
    "IfcWall":   "Qto_WallBaseQuantities",
    "IfcSlab":   "Qto_SlabBaseQuantities",
    "IfcSpace":  "Qto_SpaceBaseQuantities",
    "IfcDoor":   "Qto_DoorBaseQuantities",
    "IfcWindow": "Qto_WindowBaseQuantities",
}


def _sample_layout() -> LayoutFloor:
    return LayoutFloor(
        width_m=20.0, depth_m=14.0,
        sections=[
            LayoutSection(
                index=0, x_start=0.0, width=20.0,
                corridor_y=6.2, corridor_d=1.6,
                cores=[LayoutCore(kind="stair", x=8.0, y=6.0, w=4.0, d=2.0)],
                apartments=[
                    LayoutApartment(
                        type_code="2k", number=1, x=0.5, y=0.5, w=9.0, d=5.0,
                        rooms=[
                            LayoutRoom(
                                kind="living", name_ru="Гостиная",
                                x=0.0, y=0.0, w=5.0, d=5.0,
                                doors=[LayoutDoor(side="N", offset=2.0, width=0.9)],
                                windows=[LayoutWindow(side="S", offset=1.5, width=1.5)],
                            ),
                            LayoutRoom(
                                kind="bedroom", name_ru="Спальня",
                                x=5.0, y=0.0, w=4.0, d=5.0,
                                windows=[LayoutWindow(side="S", offset=1.0, width=1.5)],
                            ),
                        ],
                    ),
                    LayoutApartment(
                        type_code="1k", number=2, x=10.5, y=0.5, w=8.0, d=5.0,
                        rooms=[
                            LayoutRoom(
                                kind="living", name_ru="Студия",
                                x=0.0, y=0.0, w=8.0, d=5.0,
                                doors=[LayoutDoor(side="N", offset=3.0, width=0.9)],
                                windows=[LayoutWindow(side="S", offset=2.0, width=2.0)],
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )


def _build_model() -> ifcopenshell.file:
    ifc_bytes = build_ifc_from_layout(_sample_layout(), n_floors=2)
    return ifcopenshell.file.from_string(ifc_bytes.decode("utf-8"))


def test_every_element_has_base_quantities() -> None:
    model = _build_model()
    for cls, qname in _QTO_BY_CLASS.items():
        elems = model.by_type(cls)
        assert elems, f"export produced no {cls}"
        for e in elems:
            qsets = get_psets(e, qtos_only=True)
            assert qname in qsets, f"{cls} '{e.Name}' has no {qname}"


def test_wall_volume_is_consistent() -> None:
    """NetVolume must equal Length × Width × Height (the takeoff identity)."""
    model = _build_model()
    walls = model.by_type("IfcWall")
    assert walls
    for w in walls:
        q = get_psets(w, qtos_only=True)["Qto_WallBaseQuantities"]
        expected = q["Length"] * q["Width"] * q["Height"]
        assert abs(q["NetVolume"] - expected) < 1e-6, (
            f"wall '{w.Name}': NetVolume {q['NetVolume']} != L×W×H {expected}"
        )


def test_quantities_are_positive() -> None:
    model = _build_model()
    wall_vol = sum(
        get_psets(w, qtos_only=True)["Qto_WallBaseQuantities"]["NetVolume"]
        for w in model.by_type("IfcWall")
    )
    slab_vol = sum(
        get_psets(s, qtos_only=True)["Qto_SlabBaseQuantities"]["NetVolume"]
        for s in model.by_type("IfcSlab")
    )
    space_area = sum(
        get_psets(sp, qtos_only=True)["Qto_SpaceBaseQuantities"]["NetFloorArea"]
        for sp in model.by_type("IfcSpace")
    )
    assert wall_vol > 0 and slab_vol > 0 and space_area > 0


def test_parametric_path_has_quantities() -> None:
    """build_floorplan_ifc (the fallback path) uses core/corridor/apartment
    helpers unique to it — verify those sites also emit quantities."""
    poly = ShPolygon([(0, 0), (30, 0), (30, 16), (0, 16)])
    project = Project(
        site=Site(boundary=poly),
        buildings=[Building(
            footprint=poly, floors_count=2, sections_count=2, height_m=6.0,
        )],
    )
    model = ifcopenshell.file.from_string(
        build_floorplan_ifc(project).decode("utf-8")
    )
    for cls, qname in _QTO_BY_CLASS.items():
        if cls in ("IfcDoor", "IfcWindow"):
            continue  # parametric path draws no opening entities
        elems = model.by_type(cls)
        assert elems, f"parametric export produced no {cls}"
        for e in elems:
            assert qname in get_psets(e, qtos_only=True), (
                f"{cls} '{e.Name}' has no {qname} (parametric path)"
            )


def _summary() -> None:
    """Print a mini material takeoff to eyeball the numbers."""
    model = _build_model()

    def _sum(cls: str, qname: str, field: str) -> float:
        return sum(
            get_psets(e, qtos_only=True)[qname][field]
            for e in model.by_type(cls)
        )

    print("\n── IFC takeoff (sample 2-storey layout) ──")
    print(f"  IfcWall   : {len(model.by_type('IfcWall')):>4}  "
          f"бетон/кладка NetVolume = {_sum('IfcWall','Qto_WallBaseQuantities','NetVolume'):8.2f} м³")
    print(f"  IfcSlab   : {len(model.by_type('IfcSlab')):>4}  "
          f"NetVolume = {_sum('IfcSlab','Qto_SlabBaseQuantities','NetVolume'):8.2f} м³")
    print(f"  IfcSpace  : {len(model.by_type('IfcSpace')):>4}  "
          f"NetFloorArea = {_sum('IfcSpace','Qto_SpaceBaseQuantities','NetFloorArea'):8.2f} м²")
    print(f"  IfcDoor   : {len(model.by_type('IfcDoor')):>4}  "
          f"Area = {_sum('IfcDoor','Qto_DoorBaseQuantities','Area'):8.2f} м²")
    print(f"  IfcWindow : {len(model.by_type('IfcWindow')):>4}  "
          f"Area = {_sum('IfcWindow','Qto_WindowBaseQuantities','Area'):8.2f} м²")


if __name__ == "__main__":
    test_every_element_has_base_quantities()
    test_wall_volume_is_consistent()
    test_quantities_are_positive()
    test_parametric_path_has_quantities()
    _summary()
    print("\nALL CHECKS PASSED")
