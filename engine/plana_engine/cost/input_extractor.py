"""AI extraction of cost-placement assumptions from a free-form brief.

This module uses OpenAI only to normalize user input into structured fields.
It does not calculate cost totals. Cost totals must remain deterministic in the
frontend cost-placement engine until a separate verified backend calculator is
introduced.
"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from ..ai.openai_runtime import chat_completion, resolve_openai_model


Region = Literal["Almaty", "Astana", "Shymkent", "Aktobe", "default"]
QualityClass = Literal["economy", "comfort", "business"]
ParkingMode = Literal["open", "underground", "mixed"]
ConfidenceLevel = Literal["low", "medium", "high"]


class CostInputExtractionRequest(BaseModel):
    brief: str = Field(min_length=1, max_length=12000)


class CostInputExtraction(BaseModel):
    region: Region | None = None
    object_type: str | None = None
    building_class: QualityClass | None = None
    site_width_m: float | None = None
    site_depth_m: float | None = None
    setback_front_m: float | None = None
    setback_side_m: float | None = None
    setback_rear_m: float | None = None
    gfa_above_ground_m2: float | None = None
    gfa_underground_m2: float | None = None
    efficiency_ratio: float | None = None
    market_price_per_sellable_m2: float | None = None
    floors_above: int | None = None
    floors_below: int | None = None
    footprint_width_m: float | None = None
    footprint_depth_m: float | None = None
    parking_mode: ParkingMode | None = None
    parking_spots: int | None = None
    complex_soil: bool | None = None
    complex_slope: bool | None = None
    missing_data_warnings: list[str] = Field(default_factory=list)
    assumptions_notes: list[str] = Field(default_factory=list)
    confidence_level: ConfidenceLevel = "low"


class CostInputExtractionResponse(BaseModel):
    extraction: CostInputExtraction
    model_used: str
    source: Literal["openai"]


_SYSTEM_PROMPT = """You are a senior Kazakhstan real-estate cost analyst.

Extract only structured cost-placement assumptions from a user's brief.
Do not calculate construction cost, revenue, total estimate, or feasibility.
If a value is not explicitly stated or safely inferable, return null and add a
missing_data_warnings entry. Prefer conservative uncertainty over guessing.

Normalize regions to: Almaty, Astana, Shymkent, Aktobe, default.
Normalize building_class to: economy, comfort, business.
Normalize parking_mode to: open, underground, mixed.
For Kazakhstan residential projects, object_type can be "multifamily residential"
unless the brief clearly says otherwise.

Return JSON only.
"""


_USER_PROMPT_TEMPLATE = """Extract cost-placement inputs from this brief:

{brief}

Important:
- Do not output final cost or budget.
- Do not invent official Kazakhstan rates.
- If underground parking is mentioned but no area is given, infer a rough
  underground GFA only if the parking count or footprint makes it reasonable;
  otherwise leave it null and warn.
- If exact topography/geotech/parking norm is missing, warn.
"""


_SCHEMA: dict = {
    "name": "cost_input_extraction",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "region": {"type": ["string", "null"], "enum": ["Almaty", "Astana", "Shymkent", "Aktobe", "default", None]},
            "object_type": {"type": ["string", "null"]},
            "building_class": {"type": ["string", "null"], "enum": ["economy", "comfort", "business", None]},
            "site_width_m": {"type": ["number", "null"]},
            "site_depth_m": {"type": ["number", "null"]},
            "setback_front_m": {"type": ["number", "null"]},
            "setback_side_m": {"type": ["number", "null"]},
            "setback_rear_m": {"type": ["number", "null"]},
            "gfa_above_ground_m2": {"type": ["number", "null"]},
            "gfa_underground_m2": {"type": ["number", "null"]},
            "efficiency_ratio": {"type": ["number", "null"]},
            "market_price_per_sellable_m2": {"type": ["number", "null"]},
            "floors_above": {"type": ["integer", "null"]},
            "floors_below": {"type": ["integer", "null"]},
            "footprint_width_m": {"type": ["number", "null"]},
            "footprint_depth_m": {"type": ["number", "null"]},
            "parking_mode": {"type": ["string", "null"], "enum": ["open", "underground", "mixed", None]},
            "parking_spots": {"type": ["integer", "null"]},
            "complex_soil": {"type": ["boolean", "null"]},
            "complex_slope": {"type": ["boolean", "null"]},
            "missing_data_warnings": {"type": "array", "items": {"type": "string"}},
            "assumptions_notes": {"type": "array", "items": {"type": "string"}},
            "confidence_level": {"type": "string", "enum": ["low", "medium", "high"]},
        },
        "required": [
            "region",
            "object_type",
            "building_class",
            "site_width_m",
            "site_depth_m",
            "setback_front_m",
            "setback_side_m",
            "setback_rear_m",
            "gfa_above_ground_m2",
            "gfa_underground_m2",
            "efficiency_ratio",
            "market_price_per_sellable_m2",
            "floors_above",
            "floors_below",
            "footprint_width_m",
            "footprint_depth_m",
            "parking_mode",
            "parking_spots",
            "complex_soil",
            "complex_slope",
            "missing_data_warnings",
            "assumptions_notes",
            "confidence_level",
        ],
    },
    "strict": True,
}


def _clean_extraction(raw: CostInputExtraction) -> CostInputExtraction:
    data = raw.model_dump()

    if data["efficiency_ratio"] is not None:
        data["efficiency_ratio"] = min(0.95, max(0.5, float(data["efficiency_ratio"])))
    if data["market_price_per_sellable_m2"] is not None:
        data["market_price_per_sellable_m2"] = max(0, float(data["market_price_per_sellable_m2"]))
    for key in (
        "site_width_m",
        "site_depth_m",
        "setback_front_m",
        "setback_side_m",
        "setback_rear_m",
        "gfa_above_ground_m2",
        "gfa_underground_m2",
        "footprint_width_m",
        "footprint_depth_m",
    ):
        if data[key] is not None:
            data[key] = max(0, float(data[key]))
    for key in ("floors_above", "floors_below", "parking_spots"):
        if data[key] is not None:
            data[key] = max(0, int(data[key]))

    warnings = list(dict.fromkeys(data.get("missing_data_warnings") or []))
    if data["region"] is None:
        warnings.append("Region/city is not explicit")
    if data["gfa_above_ground_m2"] is None:
        warnings.append("Above-ground GFA is missing")
    if data["complex_soil"] is None:
        warnings.append("No geotechnical data")
    if data["complex_slope"] is None:
        warnings.append("No exact slope/topography data")
    data["missing_data_warnings"] = list(dict.fromkeys(warnings))

    return CostInputExtraction(**data)


def extract_cost_inputs_from_brief(brief: str) -> CostInputExtractionResponse:
    if not brief or not brief.strip():
        raise ValueError("brief is empty")

    model = resolve_openai_model()
    response = chat_completion(
        operation="cost.extract_inputs",
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _USER_PROMPT_TEMPLATE.format(brief=brief.strip())},
        ],
        response_format={"type": "json_schema", "json_schema": _SCHEMA},
        temperature=0.1,
        max_output_tokens=1800,
    )

    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("OpenAI returned empty extraction")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"OpenAI returned invalid JSON: {e}") from e

    extraction = _clean_extraction(CostInputExtraction(**data))
    return CostInputExtractionResponse(
        extraction=extraction,
        model_used=model,
        source="openai",
    )
