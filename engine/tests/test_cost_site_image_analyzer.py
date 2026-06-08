from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token
from plana_engine.cost import site_image_analyzer


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


def test_cost_analyze_site_image_requires_auth() -> None:
    r = _client.post(
        "/cost/analyze-site-image",
        files={"site_image": ("site.png", b"png-bytes", "image/png")},
    )
    assert r.status_code == 401


def test_cost_analyze_site_image_returns_non_authoritative_flags(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_chat_completion(**kwargs):
        calls.append(kwargs)
        return _Response(json.dumps({
            "apparent_slope": True,
            "road_access": "limited",
            "dense_context": True,
            "visible_constraints": ["Retaining wall visible"],
            "risk_flags": [
                {
                    "key": "apparent_slope",
                    "label": "Apparent slope",
                    "severity": "medium",
                    "suggested_value": True,
                    "reason": "Terrain edge and retaining wall suggest uneven ground.",
                },
                {
                    "key": "limited_road_access",
                    "label": "Limited road access",
                    "severity": "medium",
                    "suggested_value": True,
                    "reason": "Access road is not clearly visible.",
                },
            ],
            "missing_data_warnings": ["No exact slope/topography data"],
            "notes": ["Screening only"],
            "confidence_level": "medium",
        }))

    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.5")
    monkeypatch.setattr(site_image_analyzer, "chat_completion", fake_chat_completion)

    r = _client.post(
        "/cost/analyze-site-image",
        headers=_AUTH,
        files={"site_image": ("site.png", b"png-bytes", "image/png")},
    )

    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "openai_vision"
    assert body["model_used"] == "gpt-5.5"
    assert body["analysis"]["apparent_slope"] is True
    assert body["analysis"]["risk_flags"][0]["key"] == "apparent_slope"
    assert "Image analysis is non-authoritative and requires user confirmation" in body["analysis"]["missing_data_warnings"]
    assert calls
    assert calls[0]["operation"] == "cost.site_image_risk_analysis"
    assert calls[0]["response_format"]["type"] == "json_schema"
