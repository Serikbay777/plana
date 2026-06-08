from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token
from plana_engine.cost import input_extractor


_client = TestClient(app)
_AUTH = {"Authorization": f"Bearer {create_token('t', 't@e.kz', 'user')}"}


class _ChoiceMessage:
    content: str

    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    message: _ChoiceMessage

    def __init__(self, content: str) -> None:
        self.message = _ChoiceMessage(content)


class _Response:
    choices: list[_Choice]

    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


def test_cost_extract_inputs_requires_auth() -> None:
    r = _client.post("/cost/extract-inputs", json={"brief": "Almaty comfort class"})
    assert r.status_code == 401


def test_cost_extract_inputs_uses_openai_for_structured_inputs(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_chat_completion(**kwargs):
        calls.append(kwargs)
        return _Response(json.dumps({
            "region": "Astana",
            "object_type": "multifamily residential",
            "building_class": "business",
            "site_width_m": 90,
            "site_depth_m": 110,
            "setback_front_m": 7,
            "setback_side_m": 5,
            "setback_rear_m": 7,
            "gfa_above_ground_m2": 26000,
            "gfa_underground_m2": 5000,
            "efficiency_ratio": 0.81,
            "market_price_per_sellable_m2": 760000,
            "floors_above": 16,
            "floors_below": 1,
            "footprint_width_m": 52,
            "footprint_depth_m": 34,
            "parking_mode": "mixed",
            "parking_spots": 420,
            "complex_soil": None,
            "complex_slope": False,
            "missing_data_warnings": ["No official parking norm selected"],
            "assumptions_notes": ["Brief says business class"],
            "confidence_level": "medium",
        }))

    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.5")
    monkeypatch.setattr(input_extractor, "chat_completion", fake_chat_completion)

    r = _client.post(
        "/cost/extract-inputs",
        headers=_AUTH,
        json={"brief": "Business-class residential tower in Astana, 26,000 m2 GFA."},
    )

    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "openai"
    assert body["model_used"] == "gpt-5.5"
    assert body["extraction"]["region"] == "Astana"
    assert body["extraction"]["building_class"] == "business"
    assert body["extraction"]["gfa_above_ground_m2"] == 26000
    assert body["extraction"]["confidence_level"] == "medium"
    assert "No geotechnical data" in body["extraction"]["missing_data_warnings"]
    assert calls
    assert calls[0]["operation"] == "cost.extract_inputs"
    assert calls[0]["response_format"]["type"] == "json_schema"


def test_cost_extract_inputs_rejects_empty_brief() -> None:
    r = _client.post("/cost/extract-inputs", headers=_AUTH, json={"brief": ""})
    assert r.status_code == 422
