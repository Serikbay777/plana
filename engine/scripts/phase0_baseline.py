"""Phase 0 baseline — прямой вызов build_ifc_from_layout без uvicorn.

Идея: проверить что текущий IFC-конвертер выдаёт валидный файл,
не поднимая весь FastAPI-стек (часть зависимостей в env отсутствует).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from plana_engine.cad.floorplan_ifc import build_ifc_from_layout
from plana_engine.cad.layout_schema import (
    LayoutFloor, LayoutSection, LayoutCore, LayoutApartment,
    LayoutRoom, LayoutDoor, LayoutWindow,
)


def make_test_layout() -> LayoutFloor:
    """Минимальный, но осмысленный LayoutFloor: 1 секция, 2 квартиры (юг/север)."""
    return LayoutFloor(
        width_m=24.0,
        depth_m=14.0,
        sections=[
            LayoutSection(
                index=0,
                x_start=0.0,
                width=24.0,
                corridor_y=6.0,
                corridor_d=1.6,
                cores=[
                    LayoutCore(kind="lift_passenger", x=11.0, y=6.5, w=1.5, d=1.5),
                    LayoutCore(kind="stair",          x=13.0, y=4.5, w=2.1, d=5.5),
                ],
                apartments=[
                    LayoutApartment(
                        type_code="2k", number=1,
                        x=0.4, y=0.4, w=10.0, d=5.6,
                        rooms=[
                            LayoutRoom(kind="living",   name_ru="Гостиная", x=0.0, y=0.0, w=4.5, d=5.6,
                                       windows=[LayoutWindow(side="S", offset=1.0, width=1.8)]),
                            LayoutRoom(kind="kitchen",  name_ru="Кухня",    x=4.5, y=0.0, w=3.0, d=3.0,
                                       windows=[LayoutWindow(side="S", offset=0.6, width=1.5)]),
                            LayoutRoom(kind="bedroom",  name_ru="Спальня",  x=7.5, y=0.0, w=2.5, d=3.5,
                                       doors=[LayoutDoor(side="N", offset=0.5, width=0.9)]),
                            LayoutRoom(kind="bathroom", name_ru="Санузел",  x=4.5, y=3.0, w=2.0, d=2.6,
                                       doors=[LayoutDoor(side="N", offset=0.5, width=0.7)]),
                        ],
                    ),
                    LayoutApartment(
                        type_code="1k", number=2,
                        x=13.6, y=8.0, w=10.0, d=5.6,
                        rooms=[
                            LayoutRoom(kind="living",   name_ru="Гостиная", x=0.0, y=0.0, w=5.0, d=5.6,
                                       windows=[LayoutWindow(side="N", offset=1.0, width=1.8)]),
                            LayoutRoom(kind="kitchen",  name_ru="Кухня",    x=5.0, y=0.0, w=3.0, d=3.0),
                            LayoutRoom(kind="bathroom", name_ru="Санузел",  x=5.0, y=3.0, w=2.0, d=2.6),
                        ],
                    ),
                ],
            ),
        ],
    )


def main() -> int:
    layout = make_test_layout()
    print(f"[1/3] LayoutFloor: {layout.width_m}×{layout.depth_m} м, "
          f"секций={len(layout.sections)}, квартир={sum(len(s.apartments) for s in layout.sections)}")

    ifc_bytes = build_ifc_from_layout(layout, n_floors=2, storey_h=3.0)
    out_path = ROOT / "scripts" / "phase0_baseline.ifc"
    out_path.write_bytes(ifc_bytes)
    print(f"[2/3] IFC written: {out_path}  ({len(ifc_bytes):,} bytes)")

    # Re-open and inspect
    import ifcopenshell
    model = ifcopenshell.open(str(out_path))
    schema = model.schema
    counts = {}
    for klass in (
        "IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey",
        "IfcSlab", "IfcWall", "IfcSpace", "IfcDoor", "IfcWindow", "IfcStair",
    ):
        counts[klass] = len(model.by_type(klass))
    print(f"[3/3] schema={schema}")
    for k, v in counts.items():
        print(f"        {k:24} = {v}")

    # Quick semantic checks
    storeys = model.by_type("IfcBuildingStorey")
    spaces = model.by_type("IfcSpace")
    walls = model.by_type("IfcWall")
    assert len(storeys) == 2, f"expected 2 storeys, got {len(storeys)}"
    assert len(spaces) >= 14, f"expected ≥14 spaces (rooms+cores+corridor)*2 floors, got {len(spaces)}"
    assert len(walls) >= 8, f"expected ≥8 walls, got {len(walls)}"
    print("[OK] baseline checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
