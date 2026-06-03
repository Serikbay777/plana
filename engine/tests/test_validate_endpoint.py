"""Verify POST /validate/project routes through layout_to_project when an
optional `layout` is present (rooms.check fires on real geometry), and stays
byte-compatible with the old no-layout path. Auth-gated like the rest.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token

_client = TestClient(app)
_AUTH = {"Authorization": f"Bearer {create_token('t', 't@e.kz', 'user')}"}


def _layout_payload(living_w: float = 3.0) -> dict:
    return {
        "width_m": 20.0, "depth_m": 14.0,
        "sections": [{
            "index": 0, "x_start": 0.0, "width": 20.0,
            "corridor_y": 6.0, "corridor_d": 1.6,
            "cores": [{"kind": "stair", "x": 8.0, "y": 6.0, "w": 4.0, "d": 1.6}],
            "apartments": [{
                "type_code": "2k", "number": 1, "x": 0.5, "y": 0.5, "w": 9.0, "d": 5.0,
                "rooms": [
                    {"kind": "living", "name_ru": "Гостиная",
                     "x": 0.0, "y": 0.0, "w": living_w, "d": 3.0},
                    {"kind": "bedroom", "name_ru": "Спальня",
                     "x": 5.0, "y": 0.0, "w": 4.0, "d": 5.0},
                ],
            }],
        }],
    }


def test_requires_auth() -> None:
    r = _client.post("/validate/project", json={"site_width_m": 20, "site_depth_m": 14})
    assert r.status_code == 401


def test_no_layout_is_backward_compatible() -> None:
    """No layout -> old marketing_to_project path (floors=[]) -> no room checks."""
    r = _client.post("/validate/project", headers=_AUTH,
                     json={"site_width_m": 20, "site_depth_m": 14})
    assert r.status_code == 200
    d = r.json()
    assert "summary" in d and "violations" in d
    assert not any(v["rule"].startswith("room.min_area") for v in d["violations"])


def test_layout_fires_room_validation() -> None:
    """A 3×3 = 9 m² living room (< 15 m²) must surface room.min_area.living."""
    r = _client.post("/validate/project", headers=_AUTH, json={
        "site_width_m": 20, "site_depth_m": 14,
        "layout": _layout_payload(living_w=3.0),
    })
    assert r.status_code == 200
    rules = [v["rule"] for v in r.json()["violations"]]
    assert "room.min_area.living" in rules, rules
