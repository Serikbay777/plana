from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token
from plana_engine.cost import analyst_explainer


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


def _payload() -> dict:
    return {
        "selected_variant": "central",
        "cost_snapshot": {
            "total_estimate": 1000000000,
            "total_low": 700000000,
            "total_high": 1300000000,
            "cost_buckets": [{"label": "Construction hard costs", "amount": 800000000}],
            "feasibility": {"label": "CAUTION", "score": 64},
        },
        "assumptions": {"region": "Almaty", "rate_source_type": "placeholder"},
        "source_registry": [{"sourceType": "placeholder", "confidenceLevel": "low"}],
        "missing_data_warnings": ["No geotechnical report attached"],
    }


def test_cost_explain_snapshot_requires_auth() -> None:
    r = _client.post("/cost/explain-snapshot", json=_payload())
    assert r.status_code == 401


def test_cost_explain_snapshot_returns_analyst_bullets(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_chat_completion(**kwargs):
        calls.append(kwargs)
        return _Response(json.dumps({
            "summary": "Screening estimate is driven by hard construction cost and missing source confidence.",
            "key_drivers": ["Construction hard costs dominate the total."],
            "risk_notes": ["Placeholder rates keep confidence low."],
            "missing_data": ["Geotechnical report is missing."],
            "next_documents": ["Topographic survey", "Geotechnical report"],
            "confidence_level": "medium",
        }))

    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.5")
    monkeypatch.setattr(analyst_explainer, "chat_completion", fake_chat_completion)

    r = _client.post("/cost/explain-snapshot", headers=_AUTH, json=_payload())

    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "openai"
    assert body["model_used"] == "gpt-5.5"
    assert body["explanation"]["summary"].startswith("Screening estimate")
    assert body["explanation"]["key_drivers"]
    assert body["explanation"]["next_documents"] == ["Topographic survey", "Geotechnical report"]
    assert calls
    assert calls[0]["operation"] == "cost.analyst_explanation"
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert "Do not recalculate" in calls[0]["messages"][1]["content"]
