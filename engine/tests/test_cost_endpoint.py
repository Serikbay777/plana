"""Verify the POST /cost/aggregate endpoint wiring (auth, both input paths,
422 on missing input). Logic itself is covered by test_cost_aggregate.py.
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


def test_requires_auth() -> None:
    r = _client.post("/cost/aggregate", json={"gfa_m2": 100})
    assert r.status_code == 401


def test_explicit_gfa() -> None:
    r = _client.post("/cost/aggregate", headers=_AUTH,
                     json={"gfa_m2": 1000, "region": "Алматы"})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] > 0
    assert d["total_low"] < d["total"] < d["total_high"]
    assert d["is_certified_smeta"] is False
    assert d["warnings"]


def test_gfa_from_layout() -> None:
    r = _client.post("/cost/aggregate", headers=_AUTH, json={
        "region": "Астана", "n_floors": 3,
        "layout": {"width_m": 12, "depth_m": 10, "sections": []},
    })
    assert r.status_code == 200
    assert r.json()["gfa_m2"] == 360.0  # 12×10×3


def test_requires_gfa_or_layout() -> None:
    r = _client.post("/cost/aggregate", headers=_AUTH, json={"region": "Астана"})
    assert r.status_code == 422
