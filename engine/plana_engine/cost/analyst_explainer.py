"""AI explanation layer for deterministic Class 5 cost snapshots.

The LLM is allowed to explain drivers, risks, missing data, and next documents.
It is not allowed to recalculate or override deterministic totals.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..ai.openai_runtime import chat_completion, resolve_openai_model


ConfidenceLevel = Literal["low", "medium", "high"]


class CostAnalystExplanationRequest(BaseModel):
    selected_variant: str
    cost_snapshot: dict[str, Any]
    assumptions: dict[str, Any]
    source_registry: list[dict[str, Any]] = Field(default_factory=list)
    missing_data_warnings: list[str] = Field(default_factory=list)


class CostAnalystExplanation(BaseModel):
    summary: str
    key_drivers: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    next_documents: list[str] = Field(default_factory=list)
    confidence_level: ConfidenceLevel = "low"


class CostAnalystExplanationResponse(BaseModel):
    explanation: CostAnalystExplanation
    model_used: str
    source: Literal["openai"]


_SYSTEM_PROMPT = """You are a senior Kazakhstan real-estate cost analyst.

Explain the provided deterministic Class 5 screening estimate. You must not
recalculate totals, invent rates, change the selected variant, or produce a new
budget. Use only the numbers and assumptions provided by the application.

Be concise and decision-maker friendly. Keep bullets specific. Clearly mention
that this is screening-only and not official Kazakhstan estimate documentation.
Return JSON only.
"""


_SCHEMA: dict = {
    "name": "cost_analyst_explanation",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
            "key_drivers": {"type": "array", "items": {"type": "string"}},
            "risk_notes": {"type": "array", "items": {"type": "string"}},
            "missing_data": {"type": "array", "items": {"type": "string"}},
            "next_documents": {"type": "array", "items": {"type": "string"}},
            "confidence_level": {"type": "string", "enum": ["low", "medium", "high"]},
        },
        "required": [
            "summary",
            "key_drivers",
            "risk_notes",
            "missing_data",
            "next_documents",
            "confidence_level",
        ],
    },
    "strict": True,
}


def explain_cost_snapshot(req: CostAnalystExplanationRequest) -> CostAnalystExplanationResponse:
    model = resolve_openai_model()
    payload = {
        "selected_variant": req.selected_variant,
        "cost_snapshot": req.cost_snapshot,
        "assumptions": req.assumptions,
        "source_registry": req.source_registry,
        "missing_data_warnings": req.missing_data_warnings,
        "instruction": "Explain only. Do not recalculate or override totals.",
    }
    response = chat_completion(
        operation="cost.analyst_explanation",
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        response_format={"type": "json_schema", "json_schema": _SCHEMA},
        temperature=0.2,
        max_output_tokens=1800,
    )

    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("OpenAI returned empty analyst explanation")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"OpenAI returned invalid JSON: {e}") from e

    return CostAnalystExplanationResponse(
        explanation=CostAnalystExplanation(**data),
        model_used=model,
        source="openai",
    )
