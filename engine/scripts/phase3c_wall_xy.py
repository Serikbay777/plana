"""Phase 3c — выгрузить XY-позиции стен квартиры #1 (студия на южном краю)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import math
import ifcopenshell
import ifcopenshell.util.placement as up

model = ifcopenshell.open(str(Path(__file__).parent / "phase3c_real.ifc"))
walls = model.by_type("IfcWall")

# Walls of apt #1, floor 1, with absolute XY
print("Apt #1 walls (floor 1):")
import re
for w in walls:
    if not w.Name or not w.Name.startswith("Room-1-1-1-"):
        continue
    m = up.get_local_placement(w.ObjectPlacement)
    x, y, z = m[0,3], m[1,3], m[2,3]
    # Length из representation
    rep = w.Representation.Representations[0] if w.Representation else None
    length = None
    if rep:
        for item in rep.Items:
            if item.is_a("IfcExtrudedAreaSolid"):
                length = item.Depth  # for wall reps, length may be in profile
                # Actually for add_wall_representation, length is encoded in profile points
            # IfcExtrudedAreaSolid extrudes by Depth ABOVE plane → that's height
            # length is in the profile (probably IfcArbitraryClosedProfileDef)
    print(f"  {w.Name:50} placement=({x:6.2f},{y:6.2f},{z:5.2f})")

# Same for apt #5 (north-left, 1k)
print("\nApt #5 walls (floor 1):")
for w in walls:
    if not w.Name or not w.Name.startswith("Room-1-1-5-"):
        continue
    m = up.get_local_placement(w.ObjectPlacement)
    x, y, z = m[0,3], m[1,3], m[2,3]
    print(f"  {w.Name:50} placement=({x:6.2f},{y:6.2f},{z:5.2f})")
