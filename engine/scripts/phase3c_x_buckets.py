"""Phase 3c — посчитать стены в IFC по X-зонам (left/right)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ifcopenshell
import ifcopenshell.util.placement as up

model = ifcopenshell.open(str(Path(__file__).parent / "phase3c_real.ifc"))
walls = model.by_type("IfcWall")
print(f"Total IfcWall: {len(walls)}\n")

# Bucket by X (left=x<15, right=x>=15) и floor
buckets = {}
for w in walls:
    m = up.get_local_placement(w.ObjectPlacement)
    x, y, z = m[0,3], m[1,3], m[2,3]
    floor = round(z / 3.0)
    region = "left " if x < 15 else "right"
    name_prefix = w.Name.split("-")[0] if w.Name else "?"
    key = (floor, region, name_prefix)
    buckets[key] = buckets.get(key, 0) + 1

print("Walls by (floor, X-region, type):")
for k in sorted(buckets):
    print(f"  floor={k[0]}  region={k[1]}  type={k[2]:10}  count={buckets[k]}")

left  = sum(1 for w in walls if up.get_local_placement(w.ObjectPlacement)[0,3] < 15)
right = sum(1 for w in walls if up.get_local_placement(w.ObjectPlacement)[0,3] >= 15)
print(f"\nLeft (x<15): {left}, Right (x≥15): {right}, ratio={left/right:.2f}")

# Найти Room-стены конкретных apartment-id
print("\nWalls per apartment number (from name):")
import re
apt_counts = {}
for w in walls:
    if w.Name and w.Name.startswith("Room-"):
        # Name: Room-{floor}-{sect}-{apt#}-{room#}-{side}-...
        m_name = re.match(r"Room-(\d+)-(\d+)-(\d+)-(\d+)-", w.Name)
        if m_name:
            apt_n = int(m_name.group(3))
            apt_counts[apt_n] = apt_counts.get(apt_n, 0) + 1
for apt_n in sorted(apt_counts):
    print(f"  Apt #{apt_n}: {apt_counts[apt_n]} room-walls")
