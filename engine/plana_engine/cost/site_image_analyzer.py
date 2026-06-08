"""OpenAI vision analysis for non-authoritative site cost risk flags.

The model is only allowed to describe visible risks and uncertainty. It must
not calculate cost, estimate official engineering conditions, or replace a
geotechnical/topographic survey.
"""

from __future__ import annotations

import base64
import json
from typing import Literal

from pydantic import BaseModel, Field

from ..ai.openai_runtime import chat_completion, resolve_openai_model


ConfidenceLevel = Literal["low", "medium", "high"]
RiskSeverity = Literal["low", "medium", "high"]
RiskFlagKey = Literal[
    "apparent_slope",
    "limited_road_access",
    "dense_context",
    "visible_site_constraints",
    "uncertain_image",
]


class SiteImageRiskFlag(BaseModel):
    key: RiskFlagKey
    label: str
    severity: RiskSeverity
    suggested_value: bool = True
    reason: str


class SiteImageRiskAnalysis(BaseModel):
    apparent_slope: bool | None = None
    road_access: Literal["clear", "limited", "unclear"] = "unclear"
    dense_context: bool | None = None
    visible_constraints: list[str] = Field(default_factory=list)
    risk_flags: list[SiteImageRiskFlag] = Field(default_factory=list)
    missing_data_warnings: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    confidence_level: ConfidenceLevel = "low"


class SiteImageRiskAnalysisResponse(BaseModel):
    analysis: SiteImageRiskAnalysis
    model_used: str
    source: Literal["openai_vision"]


_SYSTEM_PROMPT = """You are a cautious site feasibility analyst for early Kazakhstan residential development.

Inspect the uploaded site photo or aerial image and extract only visible,
non-authoritative cost risk flags. Do not calculate construction cost, sale
price, total budget, official zoning, official parking requirements, geotechnical
conditions, or exact slope/topography.

If the image is ambiguous, say so and lower confidence. Treat all findings as
screening hints that require user confirmation and professional survey.
Return JSON only.
"""


_USER_PROMPT = """Analyze this site image for early cost-placement risk hints.

Focus on:
- apparent slope or uneven terrain
- road/access visibility
- visible constraints such as water, rail, power lines, retained structures,
  dense neighboring context, narrow access, or demolition/clearing uncertainty
- image uncertainty / insufficient evidence

Do not estimate cost. Do not output a budget. Do not claim official engineering,
topographic, cadastral, or regulatory status.
"""


_SCHEMA: dict = {
    "name": "site_image_risk_analysis",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "apparent_slope": {"type": ["boolean", "null"]},
            "road_access": {"type": "string", "enum": ["clear", "limited", "unclear"]},
            "dense_context": {"type": ["boolean", "null"]},
            "visible_constraints": {"type": "array", "items": {"type": "string"}},
            "risk_flags": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "key": {
                            "type": "string",
                            "enum": [
                                "apparent_slope",
                                "limited_road_access",
                                "dense_context",
                                "visible_site_constraints",
                                "uncertain_image",
                            ],
                        },
                        "label": {"type": "string"},
                        "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                        "suggested_value": {"type": "boolean"},
                        "reason": {"type": "string"},
                    },
                    "required": ["key", "label", "severity", "suggested_value", "reason"],
                },
            },
            "missing_data_warnings": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "array", "items": {"type": "string"}},
            "confidence_level": {"type": "string", "enum": ["low", "medium", "high"]},
        },
        "required": [
            "apparent_slope",
            "road_access",
            "dense_context",
            "visible_constraints",
            "risk_flags",
            "missing_data_warnings",
            "notes",
            "confidence_level",
        ],
    },
    "strict": True,
}


def _mime_from_content_type(content_type: str | None) -> str:
    if content_type and content_type.lower() in {"image/png", "image/jpeg", "image/webp"}:
        return content_type.lower()
    return "image/png"


def _clean_analysis(raw: SiteImageRiskAnalysis) -> SiteImageRiskAnalysis:
    data = raw.model_dump()
    warnings = list(dict.fromkeys(data.get("missing_data_warnings") or []))
    warnings.append("Image analysis is non-authoritative and requires user confirmation")
    warnings.append("No official topographic/geotechnical survey attached")
    data["missing_data_warnings"] = list(dict.fromkeys(warnings))

    if not data.get("risk_flags") and data.get("confidence_level") != "high":
        data["risk_flags"] = [
            {
                "key": "uncertain_image",
                "label": "Image uncertainty",
                "severity": "medium",
                "suggested_value": True,
                "reason": "No strong site risk flag was visible, but image evidence is not enough for engineering decisions.",
            }
        ]

    return SiteImageRiskAnalysis(**data)


def analyze_site_image_risks(
    image_bytes: bytes,
    *,
    content_type: str | None = None,
    model: str | None = None,
) -> SiteImageRiskAnalysisResponse:
    if not image_bytes:
        raise ValueError("site image is empty")
    if len(image_bytes) > 12 * 1024 * 1024:
        raise ValueError("site image is too large; max 12MB")

    resolved_model = resolve_openai_model(model)
    mime = _mime_from_content_type(content_type)
    b64 = base64.b64encode(image_bytes).decode("ascii")
    response = chat_completion(
        operation="cost.site_image_risk_analysis",
        model=resolved_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _USER_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            },
        ],
        response_format={"type": "json_schema", "json_schema": _SCHEMA},
        temperature=0.1,
        max_output_tokens=1600,
    )

    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("OpenAI returned empty site image analysis")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"OpenAI returned invalid JSON: {e}") from e

    return SiteImageRiskAnalysisResponse(
        analysis=_clean_analysis(SiteImageRiskAnalysis(**data)),
        model_used=resolved_model,
        source="openai_vision",
    )
