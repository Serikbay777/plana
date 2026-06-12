from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from plana_engine import gis_masterplan_ai
from plana_engine.visualizer.openai_client import GenerationResult
from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token


_client = TestClient(app)
_AUTH = {"Authorization": f"Bearer {create_token('t', 't@e.kz', 'user')}"}


class _ChoiceMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _ChoiceMessage(content)


class _Response:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


def _parcel() -> dict:
    return {
        "id": "p1",
        "name": "Parcel 1",
        "designation": "Residential",
        "functionalZone": "Ж-3",
        "isSocial": False,
        "local": [[0, 0], [100, 0], [100, 80], [0, 80]],
        "width": 100,
        "height": 80,
        "areaM2": 8000,
        "params": {
            "housing_class": "comfort",
            "purpose": "residential",
            "max_coverage_pct": 45,
            "floors": 9,
        },
    }


def test_gis_masterplan_requires_auth() -> None:
    r = _client.post("/generate/gis-masterplan", json={"parcels": [_parcel()]})
    assert r.status_code == 401


def test_gis_masterplan_uses_openai_structured_response(monkeypatch) -> None:
    def fake_chat_completion(**kwargs):
        assert kwargs["operation"] == "gis.masterplan.generate"
        return _Response(json.dumps({
            "scenarios": [
                {
                    "key": "max_gfa",
                    "title": "Max GFA",
                    "strategy": "One compact residential slab.",
                    "objects": [
                        {
                            "id": "b1",
                            "parcel_id": "p1",
                            "type": "residential_block",
                            "name": "Residential block",
                            "x": 50,
                            "y": 40,
                            "width": 38,
                            "depth": 20,
                            "rotationDeg": 0,
                            "floors": 9,
                            "rationale": "Keeps footprint compact.",
                        }
                    ],
                    "rule_notes": ["Check red lines in deterministic validator."],
                    "warnings": ["No official parking norm selected."],
                },
                {
                    "key": "balanced_courtyard",
                    "title": "Balanced Courtyard",
                    "strategy": "Two blocks with a yard.",
                    "objects": [
                        {
                            "id": "y1",
                            "parcel_id": "p1",
                            "type": "yard",
                            "name": "Green courtyard",
                            "x": 50,
                            "y": 45,
                            "width": 30,
                            "depth": 22,
                            "rotationDeg": 0,
                            "floors": 0,
                            "rationale": "Adds green area.",
                        }
                    ],
                    "rule_notes": [],
                    "warnings": [],
                },
                {
                    "key": "social_mix",
                    "title": "Social Mix",
                    "strategy": "Residential plus kindergarten.",
                    "objects": [
                        {
                            "id": "k1",
                            "parcel_id": "p1",
                            "type": "kindergarten",
                            "name": "Kindergarten",
                            "x": 72,
                            "y": 28,
                            "width": 24,
                            "depth": 18,
                            "rotationDeg": 0,
                            "floors": 2,
                            "rationale": "Supports social program.",
                        }
                    ],
                    "rule_notes": [],
                    "warnings": [],
                },
            ]
        }))

    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.5")
    monkeypatch.setattr(gis_masterplan_ai, "chat_completion", fake_chat_completion)

    r = _client.post("/generate/gis-masterplan", headers=_AUTH, json={"parcels": [_parcel()]})

    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "openai"
    assert body["model_used"] == "gpt-5.5"
    assert len(body["scenarios"]) == 3
    assert body["scenarios"][0]["objects"][0]["parcel_id"] == "p1"


def test_gis_masterplan_visualization_returns_png(monkeypatch) -> None:
    captured = {}

    def fake_generate_image_with_meta(prompt, opts, use_cache=True):
        captured["prompt"] = prompt
        captured["quality"] = opts.quality
        captured["use_cache"] = use_cache
        return GenerationResult(png=b"fake-png", model_used="gpt-image-2")

    monkeypatch.setattr(
        "plana_engine.api.main.generate_image_with_meta",
        fake_generate_image_with_meta,
    )

    scenario = {
        "key": "social_mix",
        "title": "Social Mix",
        "strategy": "Residential and kindergarten.",
        "objects": [
            {
                "id": "b1",
                "parcel_id": "p1",
                "type": "residential_block",
                "name": "Residential block",
                "x": 50,
                "y": 40,
                "width": 38,
                "depth": 20,
                "rotationDeg": 0,
                "floors": 9,
                "rationale": "Compact slab.",
            },
            {
                "id": "k1",
                "parcel_id": "p1",
                "type": "kindergarten",
                "name": "Kindergarten",
                "x": 70,
                "y": 30,
                "width": 24,
                "depth": 18,
                "rotationDeg": 0,
                "floors": 2,
                "rationale": "Social infrastructure.",
            },
        ],
        "rule_notes": ["Check red lines."],
        "warnings": ["No official parking norm selected."],
    }

    r = _client.post(
        "/visualize/gis-masterplan",
        headers=_AUTH,
        json={
            "handoff": {"parcels": [_parcel()], "summary": {"parcelsCount": 1}},
            "scenario": scenario,
            "strategy_hint": "Keep a green courtyard and safe access.",
        },
    )

    assert r.status_code == 200
    assert r.content == b"fake-png"
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-model-used"] == "gpt-image-2"
    assert captured["quality"] == "medium"
    assert captured["use_cache"] is False
    assert "Kindergarten" in captured["prompt"]
    assert "Keep a green courtyard" in captured["prompt"]
