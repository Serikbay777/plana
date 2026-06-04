"""Phase 1 — HTTP smoke test: POST /export/floorplan-ifc с тестовым LayoutFloor."""
import sys, time, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import urllib.request
from plana_engine.cad.layout_schema import LayoutFloor
import importlib
phase0 = importlib.import_module("phase0_baseline")
sys.path.insert(0, str(Path(__file__).parent))
from phase0_baseline import make_test_layout

layout: LayoutFloor = make_test_layout()
payload = {
    "site_width_m": 30.0,
    "site_depth_m": 20.0,
    "floors": 2,
    "layout": layout.model_dump(),
}

# Wait for backend
for i in range(10):
    try:
        urllib.request.urlopen("http://localhost:8001/health", timeout=1).read()
        break
    except Exception:
        time.sleep(0.5)
else:
    print("[FAIL] backend not responding"); sys.exit(1)

# Auth: register or login
def _post(url, body, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    r = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

creds = {"email": "phase1@plana.local", "password": "phase1test123"}
code, body = _post("http://localhost:8001/auth/register", creds)
if code == 409:
    code, body = _post("http://localhost:8001/auth/login", creds)
assert code == 200, f"auth failed: {code} {body}"
token = body["access_token"]
print(f"[auth] {body.get('email')} → token {token[:20]}...")

req = urllib.request.Request(
    "http://localhost:8001/export/floorplan-ifc",
    data=json.dumps(payload).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()
        ct = resp.headers.get("Content-Type")
        cd = resp.headers.get("Content-Disposition")
        x_buildings = resp.headers.get("X-Buildings-Count")
        x_coverage = resp.headers.get("X-Coverage-Pct")
        print(f"[OK] HTTP {resp.status}")
        print(f"     Content-Type: {ct}")
        print(f"     Content-Disposition: {cd}")
        print(f"     X-Buildings-Count: {x_buildings}")
        print(f"     X-Coverage-Pct: {x_coverage}")
        print(f"     Body: {len(body):,} bytes")
        out = Path(__file__).parent / "phase1_http.ifc"
        out.write_bytes(body)
        print(f"     Saved: {out}")
except urllib.error.HTTPError as e:
    print(f"[FAIL] HTTP {e.code}: {e.read().decode()[:500]}")
    sys.exit(1)
