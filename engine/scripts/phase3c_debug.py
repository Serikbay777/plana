"""Phase 3c debug — выясняем почему в 3D половина квартир без стен."""
import sys, json, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
layout = data["layout"]

print(f"Floor: {layout['width_m']:.1f} × {layout['depth_m']:.1f} м")
for sect in layout["sections"]:
    print(f"\n=== Section {sect['index']} ===")
    print(f"  x_start={sect['x_start']:.1f}, width={sect['width']:.1f}")
    print(f"  corridor_y={sect['corridor_y']:.1f}, corridor_d={sect['corridor_d']:.1f}")
    print(f"  cores: {[(c['kind'], c['x'], c['y'], c['w'], c['d']) for c in sect['cores']]}")
    print(f"  apartments: {len(sect['apartments'])}")
    for apt in sect["apartments"]:
        print(f"\n    Apt #{apt['number']} ({apt['type_code']}) — abs ({apt['x']:.1f},{apt['y']:.1f}) {apt['w']:.1f}×{apt['d']:.1f}")
        for room in apt["rooms"]:
            rx_abs = apt["x"] + room["x"]
            ry_abs = apt["y"] + room["y"]
            print(f"      Room {room['name_ru']:18}  rel({room['x']:.1f},{room['y']:.1f}) {room['w']:.1f}×{room['d']:.1f}  → abs({rx_abs:.1f},{ry_abs:.1f})")
