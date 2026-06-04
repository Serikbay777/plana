"""Inspect actual world Z of walls/slabs in baseline.ifc to confirm root cause."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ifcopenshell
import ifcopenshell.util.placement as up

model = ifcopenshell.open(str(Path(__file__).parent / "phase0_baseline.ifc"))

print("=== IfcBuildingStorey placements (world Z) ===")
for s in model.by_type("IfcBuildingStorey"):
    m = up.get_local_placement(s.ObjectPlacement)
    print(f"  {s.Name:20} world_z={m[2,3]:+.3f}  Elevation={s.Elevation}")

print("\n=== IfcSlab placements (world Z) ===")
for s in model.by_type("IfcSlab"):
    m = up.get_local_placement(s.ObjectPlacement)
    print(f"  {s.Name:20} world_z={m[2,3]:+.3f}")

print("\n=== IfcWall placements (world Z) — first 6 ===")
for w in model.by_type("IfcWall")[:6]:
    m = up.get_local_placement(w.ObjectPlacement)
    print(f"  {w.Name:25} world_z={m[2,3]:+.3f}")

print("\n=== IfcSpace placements (world Z) — все 20 ===")
for sp in model.by_type("IfcSpace"):
    m = up.get_local_placement(sp.ObjectPlacement)
    print(f"  {sp.Name:40} world_z={m[2,3]:+.3f}")
