"""Phase 3c — гистограмма X-позиций стен."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ifcopenshell
import ifcopenshell.util.placement as up

model = ifcopenshell.open(str(Path(__file__).parent / "phase3c_real.ifc"))
walls = model.by_type("IfcWall")

# Bins of 2m: 0-2, 2-4, ... 28-30
bins = [0] * 16  # 16 bins × 2m = 32m, covers 0..32
for w in walls:
    m = up.get_local_placement(w.ObjectPlacement)
    x = m[0,3]
    idx = min(15, max(0, int(x / 2)))
    bins[idx] += 1

print("X-histogram of wall placements (2m bins):")
for i, n in enumerate(bins):
    bar = "█" * min(80, n // 5)
    print(f"  x={i*2:2d}..{(i+1)*2:2d}m  count={n:4d}  {bar}")

print()
# Also: Room walls only
room_bins = [0] * 16
for w in walls:
    if not w.Name or not w.Name.startswith("Room-"):
        continue
    m = up.get_local_placement(w.ObjectPlacement)
    x = m[0,3]
    idx = min(15, max(0, int(x / 2)))
    room_bins[idx] += 1

print("Room walls only:")
for i, n in enumerate(room_bins):
    bar = "█" * min(80, n // 3)
    print(f"  x={i*2:2d}..{(i+1)*2:2d}m  count={n:4d}  {bar}")
