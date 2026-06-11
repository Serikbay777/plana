"""OpenAI planner for GIS parcel masterplan scenarios.

This module is intentionally explanation-first and geometry-light: OpenAI
proposes structured site objects, while deterministic validators/editor layers
remain responsible for hard compliance checks.
"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from .ai.openai_runtime import chat_completion, resolve_openai_model


MasterplanObjectType = Literal[
    "residential_block",
    "school",
    "kindergarten",
    "parking",
    "commerce",
    "yard",
]


class GisMasterplanParcelParams(BaseModel):
    housing_class: str = "comfort"
    purpose: str = "residential"
    max_coverage_pct: float = 50
    floors: int = 9


class GisMasterplanParcel(BaseModel):
    id: str
    name: str
    designation: str = ""
    functionalZone: str = ""
    isSocial: bool = False
    local: list[list[float]]
    width: float
    height: float
    areaM2: float
    params: GisMasterplanParcelParams


class GisMasterplanRequest(BaseModel):
    parcels: list[GisMasterplanParcel]
    strategy_hint: str = Field(
        default="Generate three feasible early-stage site planning scenarios for Kazakhstan.",
        max_length=800,
    )


class GisMasterplanObject(BaseModel):
    id: str
    parcel_id: str
    type: MasterplanObjectType
    name: str
    x: float
    y: float
    width: float
    depth: float
    rotationDeg: float = 0
    floors: int = 0
    rationale: str = ""


class GisMasterplanScenario(BaseModel):
    key: str
    title: str
    strategy: str
    objects: list[GisMasterplanObject]
    rule_notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GisMasterplanResponse(BaseModel):
    scenarios: list[GisMasterplanScenario]
    model_used: str
    source: Literal["openai"] = "openai"


_SYSTEM_PROMPT = """You are a senior Kazakhstan urban planner and architect.

Generate early-stage masterplan placement scenarios for selected real GIS land
parcels. Return JSON only.

Rules:
- Do not claim legal compliance. This is screening-level concept planning.
- Use only the provided parcel geometry, dimensions, zoning labels, and params.
- Every object must reference an existing parcel_id.
- Coordinates are local meters inside the referenced parcel coordinate frame.
- x/y are object centers. width/depth are meters. rotationDeg is degrees.
- Prefer simple rectangular masses that fit within parcel width/height.
- Respect social-designated parcels: use school/kindergarten/yard there, not
  residential blocks, unless the designation clearly allows mixed use.
- Include parking and yard/green space for residential scenarios.
- Produce exactly three scenarios: maximum GFA, balanced courtyard, social mix.
- Put uncertainty and missing norm assumptions into warnings.
"""


_SCHEMA: dict = {
    "name": "gis_masterplan_scenarios",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "scenarios": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "key": {"type": "string"},
                        "title": {"type": "string"},
                        "strategy": {"type": "string"},
                        "objects": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "id": {"type": "string"},
                                    "parcel_id": {"type": "string"},
                                    "type": {
                                        "type": "string",
                                        "enum": [
                                            "residential_block",
                                            "school",
                                            "kindergarten",
                                            "parking",
                                            "commerce",
                                            "yard",
                                        ],
                                    },
                                    "name": {"type": "string"},
                                    "x": {"type": "number"},
                                    "y": {"type": "number"},
                                    "width": {"type": "number"},
                                    "depth": {"type": "number"},
                                    "rotationDeg": {"type": "number"},
                                    "floors": {"type": "integer"},
                                    "rationale": {"type": "string"},
                                },
                                "required": [
                                    "id",
                                    "parcel_id",
                                    "type",
                                    "name",
                                    "x",
                                    "y",
                                    "width",
                                    "depth",
                                    "rotationDeg",
                                    "floors",
                                    "rationale",
                                ],
                            },
                        },
                        "rule_notes": {"type": "array", "items": {"type": "string"}},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["key", "title", "strategy", "objects", "rule_notes", "warnings"],
                },
            },
        },
        "required": ["scenarios"],
    },
    "strict": True,
}


def _compact_parcel(parcel: GisMasterplanParcel) -> dict:
    return {
        "id": parcel.id,
        "name": parcel.name,
        "designation": parcel.designation,
        "functional_zone": parcel.functionalZone,
        "is_social": parcel.isSocial,
        "width_m": round(parcel.width, 1),
        "height_m": round(parcel.height, 1),
        "area_m2": round(parcel.areaM2, 1),
        "polygon_local_m": [[round(p[0], 1), round(p[1], 1)] for p in parcel.local[:16]],
        "params": parcel.params.model_dump(),
    }


def _clamp_object(obj: GisMasterplanObject, parcels: dict[str, GisMasterplanParcel]) -> GisMasterplanObject:
    parcel = parcels.get(obj.parcel_id)
    if parcel is None:
        parcel = next(iter(parcels.values()))
        obj.parcel_id = parcel.id

    max_width = max(4.0, parcel.width * 0.9)
    max_depth = max(4.0, parcel.height * 0.9)
    obj.width = round(min(max(2.0, obj.width), max_width), 1)
    obj.depth = round(min(max(2.0, obj.depth), max_depth), 1)
    obj.x = round(min(max(obj.width / 2, obj.x), max(obj.width / 2, parcel.width - obj.width / 2)), 1)
    obj.y = round(min(max(obj.depth / 2, obj.y), max(obj.depth / 2, parcel.height - obj.depth / 2)), 1)
    obj.rotationDeg = round(obj.rotationDeg % 360, 1)
    obj.floors = max(0, min(80, int(obj.floors)))
    if obj.type == "yard":
        obj.floors = 0
    return obj


def generate_gis_masterplan(req: GisMasterplanRequest) -> GisMasterplanResponse:
    if not req.parcels:
        raise ValueError("At least one parcel is required")

    model = resolve_openai_model()
    payload = {
        "strategy_hint": req.strategy_hint,
        "parcels": [_compact_parcel(parcel) for parcel in req.parcels[:8]],
        "output_contract": {
            "scenarios": "exactly 3",
            "object_coordinate_frame": "local meters per parcel",
            "screening_only": True,
        },
    }

    response = chat_completion(
        operation="gis.masterplan.generate",
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        response_format={"type": "json_schema", "json_schema": _SCHEMA},
        temperature=0.2,
        max_output_tokens=3200,
    )

    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("OpenAI returned empty masterplan response")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OpenAI returned invalid JSON: {exc}") from exc

    result = GisMasterplanResponse(
        scenarios=[GisMasterplanScenario(**scenario) for scenario in data["scenarios"]],
        model_used=model,
    )
    parcel_by_id = {parcel.id: parcel for parcel in req.parcels}
    for scenario in result.scenarios:
        scenario.objects = [_clamp_object(obj, parcel_by_id) for obj in scenario.objects]
        if "Screening-only; confirm GPZU/PDP and Kazakhstan norms before design freeze." not in scenario.warnings:
            scenario.warnings.append("Screening-only; confirm GPZU/PDP and Kazakhstan norms before design freeze.")
    return result
