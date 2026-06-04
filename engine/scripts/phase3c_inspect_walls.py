"""Phase 3c — посчитать стены в IFC по областям XY."""
import sys, json, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ifcopenshell
import ifcopenshell.util.placement as up

creds = {"email":"phase1@plana.local","password":"phase1test123"}
r = urllib.request.Request("http://localhost:8001/auth/login",
    data=json.dumps(creds).encode(),
    headers={"Content-Type":"application/json"}, method="POST")
tok = json.loads(urllib.request.urlopen(r).read())["access_token"]

brief = "4-этажный жилой дом 30×16 метров в Алматы. 1 секция, 2 пассажирских лифта. Микс квартир: 30% студий, 40% однушек, 30% двушек. Высота 14 м. Отступы от границ участка 5 м."
r2 = urllib.request.Request("http://localhost:8001/generate/layout-from-brief",
    data=json.dumps({"brief": brief}).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {tok}"}, method="POST")
data = json.loads(urllib.request.urlopen(r2, timeout=60).read())

# Now export IFC with that layout
payload = {
    "site_width_m": 30.0, "site_depth_m": 16.0,
    "floors": 4, "layout": data["layout"],
}
r3 = urllib.request.Request("http://localhost:8001/export/floorplan-ifc",
    data=json.dumps(payload).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {tok}"}, method="POST")
ifc_bytes = urllib.request.urlopen(r3, timeout=60).read()
out = Path(__file__).parent / "phase3c_real.ifc"
out.write_bytes(ifc_bytes)
print(f"Saved {len(ifc_bytes):,} bytes to {out}\n")

model = ifcopenshell.open(str(out))
walls = model.by_type("IfcWall")
print(f"Total IfcWall: {len(walls)}")

# Bucket by X (south=y<8, north=y>=8) и floor (z)
buckets = {}
for w in walls:
    m = up.get_local_placement(w.ObjectPlacement)
    x, y, z = m[0,3], m[1,3], m[2,3]
    floor = round(z / 3.0)
    region = "south" if y < 8 else "north"
    name_prefix = w.Name.split("-")[0] if w.Name else "?"
    key = (floor, region, name_prefix)
    buckets[key] = buckets.get(key, 0) + 1

print("\nWalls by (floor, region, type):")
for k in sorted(buckets):
    print(f"  floor={k[0]}  region={k[1]:6}  type={k[2]:10}  count={buckets[k]}")

# Сколько стен с y<8 (south) и y>=8 (north)
south = sum(1 for w in walls if up.get_local_placement(w.ObjectPlacement)[1,3] < 8)
north = sum(1 for w in walls if up.get_local_placement(w.ObjectPlacement)[1,3] >= 8)
print(f"\nSouth (y<8): {south}, North (y≥8): {north}")
