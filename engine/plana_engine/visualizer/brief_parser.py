"""Парсер свободного текстового ТЗ → структурированные параметры этажа.

GPT-4o structured output читает текст вроде:
    «4-этажный жилой дом 30×16 м в Алматы, 1 секция, 2 пасс. лифта,
     микс: 30% студий, 40% 1к, 30% 2к, высота 14 м, отступы 5 м»

и возвращает заполненный BriefDerivedInputs, который дальше идёт в
`generate_floor_layout` (детерминированная геометрия).

Используется новым табом «Архитектурные чертежи».
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any


class BriefParseError(RuntimeError):
    """Ошибка парсинга ТЗ — нет ключа, OpenAI отказал, кривой JSON."""


@dataclass
class BriefDerivedInputs:
    """Поля, которые модель пытается извлечь из текстового ТЗ.

    Все поля опциональны — если не указано в ТЗ, заполним дефолтом.
    Названия совпадают с VisualizeFromInputsRequest для лёгкого маппинга.
    """
    site_width_m:    float | None
    site_depth_m:    float | None
    setback_front_m: float | None
    setback_side_m:  float | None
    setback_rear_m:  float | None
    floors:          int | None
    purpose:         str | None       # residential / commercial / mixed_use / hotel
    sections:        int | None
    studio_pct:      float | None
    k1_pct:          float | None
    k2_pct:          float | None
    k3_pct:          float | None
    lifts_passenger: int | None
    lifts_freight:   int | None
    max_height_m:    float | None
    notes:           str             # что не уложилось в поля


_SYSTEM_PROMPT = """\
You are an architect's assistant. The user gives you a free-form Russian
brief for a residential / commercial building floor plan. Extract the
structured numeric parameters that will be used to generate a typical floor
layout. Output strictly valid JSON matching the schema.

CRITICAL RULES — read carefully:

1. Building footprint dimensions (site_width_m, site_depth_m) are the MOST
   important fields. Look HARDER for them. Sources to check, in order:
     - explicit "30×16 м", "60 на 40 метров", "30x16", "30 м × 16 м"
     - in project title or first line ("ЖК 60×40", "Дом 30 на 20")
     - "длина 30, ширина 16" / "длинная сторона 30 м"
     - approximate area "180-220 м²" + reasonable aspect → derive
       width × depth (e.g. 200 m² ≈ 14×14 or 16×12)
     - plot size "10 соток" = 1000 m² total plot — НЕ путать с пятном
       застройки; здание обычно 30-40% от участка
   If only an area is given (e.g. "200 м²") without aspect — pick a
   reasonable rectangular footprint (aspect 1.5:1 — 2:1, e.g. 18×12).

2. setback_front_m / setback_side_m / setback_rear_m:
     - Defaults for small residential: 3 m on all sides
     - "Отступы от красных линий" — берём это число
     - "Плотная застройка" / "без отступов" → 0
   If not stated and dimensions are < 25 m on any side — use 3 m, not 5 m
   (5 m on a 20×16 building leaves a tiny inner footprint).

3. floors: integer. Default to 4 if not stated.

4. sections: how many подъездов / секций. Default to 1 unless the brief
   says "две секции", "3 подъезда", etc.

5. Apartment mix (studio_pct / k1_pct / k2_pct / k3_pct) — percentages
   0..100 summing to ~100. If the brief gives counts ("4 однушки и 6
   двушек") — convert to percentages. If nothing about mix is said —
   leave all four as null; the backend will use a reasonable default.

6. purpose: "residential" by default.

7. lifts_passenger / lifts_freight: integers. Default 1 / 0.

8. max_height_m: number in meters. Default 30.

9. NEVER guess wildly. If the brief literally says nothing about a value
   AND no reasonable derivation is possible — return null. The backend
   has its own sane defaults.

10. notes: brief 1-2 sentence summary in Russian of what you did and
    what assumptions you had to make.

For mix percentages: return numbers 0..100 (e.g. 30, not 0.30).
"""


_USER_PROMPT_TPL = """\
Извлеки структурированные параметры этажа из этого ТЗ:

ТЗ:
\"\"\"
{brief}
\"\"\"

Внимательно ищи габариты здания — это самое важное. Они могут быть
указаны как «30×16 м», «60 на 40», «30x16 метров», или в названии
проекта. Если есть только площадь — выведи пропорциональные стороны.

Заполни остальные поля. Для миксов квартир — проценты 0..100.
В notes (1-2 предложения, русский) перечисли свои допущения.
"""


_SCHEMA: dict[str, Any] = {
    "name": "brief_inputs",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "site_width_m":     {"type": ["number", "null"]},
            "site_depth_m":     {"type": ["number", "null"]},
            "setback_front_m":  {"type": ["number", "null"]},
            "setback_side_m":   {"type": ["number", "null"]},
            "setback_rear_m":   {"type": ["number", "null"]},
            "floors":           {"type": ["integer", "null"]},
            "purpose":          {
                "type": ["string", "null"],
                "enum": ["residential", "commercial", "mixed_use", "hotel", None],
            },
            "sections":         {"type": ["integer", "null"]},
            "studio_pct":       {"type": ["number", "null"]},
            "k1_pct":           {"type": ["number", "null"]},
            "k2_pct":           {"type": ["number", "null"]},
            "k3_pct":           {"type": ["number", "null"]},
            "lifts_passenger":  {"type": ["integer", "null"]},
            "lifts_freight":    {"type": ["integer", "null"]},
            "max_height_m":     {"type": ["number", "null"]},
            "notes":            {"type": "string"},
        },
        "required": [
            "site_width_m", "site_depth_m",
            "setback_front_m", "setback_side_m", "setback_rear_m",
            "floors", "purpose", "sections",
            "studio_pct", "k1_pct", "k2_pct", "k3_pct",
            "lifts_passenger", "lifts_freight",
            "max_height_m", "notes",
        ],
    },
    "strict": True,
}


def parse_brief(brief: str, *, model: str = "gpt-4.1") -> BriefDerivedInputs:
    """Распарсить свободное ТЗ в структурированные параметры этажа."""
    if not brief or not brief.strip():
        raise BriefParseError("ТЗ пустое")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise BriefParseError("OPENAI_API_KEY не задан в окружении")

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": _USER_PROMPT_TPL.format(brief=brief.strip())},
            ],
            response_format={"type": "json_schema", "json_schema": _SCHEMA},
            temperature=0.1,
        )
    except Exception as e:
        raise BriefParseError(f"OpenAI API failed: {e}") from e

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise BriefParseError("OpenAI вернул пустой ответ")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise BriefParseError(f"OpenAI вернул невалидный JSON: {e}") from e

    return BriefDerivedInputs(
        site_width_m=    data.get("site_width_m"),
        site_depth_m=    data.get("site_depth_m"),
        setback_front_m= data.get("setback_front_m"),
        setback_side_m=  data.get("setback_side_m"),
        setback_rear_m=  data.get("setback_rear_m"),
        floors=          data.get("floors"),
        purpose=         data.get("purpose"),
        sections=        data.get("sections"),
        studio_pct=      data.get("studio_pct"),
        k1_pct=          data.get("k1_pct"),
        k2_pct=          data.get("k2_pct"),
        k3_pct=          data.get("k3_pct"),
        lifts_passenger= data.get("lifts_passenger"),
        lifts_freight=   data.get("lifts_freight"),
        max_height_m=    data.get("max_height_m"),
        notes=           data.get("notes", ""),
    )
