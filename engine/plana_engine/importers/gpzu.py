"""ГПЗУ-импорт через OpenAI Vision API.

Принимает PDF-байты ГПЗУ, рендерит первые N страниц в PNG через pypdfium2
и отправляет в OpenAI structured-output (json_schema) — модель извлекает
нормативные ограничения (отступы, высота, КИТ, разрешённое назначение).

Ключ читается из ENV `OPENAI_API_KEY` (тот же, что у visualizer).
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any


class GpzuParseError(RuntimeError):
    """Ошибка импорта ГПЗУ — кривой PDF, нет ключа, кривой JSON от модели."""


@dataclass
class GpzuExtraction:
    """Результат извлечения данных из ГПЗУ."""
    site_area_m2: float | None
    site_width_m: float | None
    site_depth_m: float | None
    setback_front_m: float | None
    setback_side_m: float | None
    setback_rear_m: float | None
    max_height_m: float | None
    max_floors: int | None
    max_coverage_pct: float | None
    max_far: float | None
    purpose_allowed: list[str]
    notes: str
    confidence: str  # "high" | "medium" | "low"


_SYSTEM_PROMPT = """\
You are an expert at reading Russian urban-planning documents (ГПЗУ —
градостроительный план земельного участка). The user gives you one or
several pages of a ГПЗУ as images. Extract numeric site dimensions and
building restrictions. If a value is not stated explicitly or is
ambiguous, return null — do not guess. Output strictly valid JSON
matching the provided schema.

CRITICAL RULES:
- All measurements must be in METERS and SQUARE METERS.
- site_width_m and site_depth_m are the physical width and depth of the
  land plot bounding box. Typical residential/commercial plots in
  Kazakhstan/Russia are 10–500 m wide. If you see values > 1000 for
  dimensions, those are likely geodetic coordinates or millimetres —
  return null for those fields instead.
- Do NOT use cadastral/geodetic coordinates as dimensions.
- If only site_area_m2 is stated but no explicit width/depth — return
  null for site_width_m and site_depth_m.
- «Минимальные отступы» are minimum required distances (metres) from
  the site boundary to the building face.
- «Предельная высота» — maximum allowed building height in metres.
- «Процент застройки» — maximum buildup percentage of the site (0..100).
- «Коэффициент использования территории / КИТ» — FAR (dimensionless ratio).
"""

_USER_PROMPT = """\
Извлеки следующие поля из изображений ГПЗУ:

- site_area_m2 — общая площадь участка, м² (ищи «площадь участка», «S=»)
- site_width_m — ширина участка в МЕТРАХ (10–500 м для типичного участка);
  если не указана явно или значение > 1000 — верни null
- site_depth_m — глубина участка в МЕТРАХ (10–500 м); аналогично null если
  не указана или > 1000
- setback_front_m, setback_side_m, setback_rear_m — минимальные отступы от
  границ участка, м (ищи «минимальные отступы», «красные линии»)
- max_height_m — предельная высота зданий, м
- max_floors — предельная этажность (целое число)
- max_coverage_pct — процент застройки, 0..100 (ищи «процент застройки»,
  «КЗ»)
- max_far — коэффициент использования территории (КИТ / FAR),
  безразмерное число обычно 0.5–5
- purpose_allowed — список разрешённых видов использования
  (residential, commercial, mixed_use, hotel — переводи на английский)
- notes — свободные заметки о красных линиях, особых условиях, всём,
  что не уложилось в структурированные поля
- confidence — твоя уверенность: "high" | "medium" | "low"

Верни JSON ровно по схеме. Если поле не указано — поставь null
(для массивов — пустой список).
"""


# Pydantic-несовместимая, но валидная для OpenAI structured outputs JSON Schema.
_SCHEMA: dict[str, Any] = {
    "name": "gpzu_extraction",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "site_area_m2":     {"type": ["number", "null"]},
            "site_width_m":     {"type": ["number", "null"]},
            "site_depth_m":     {"type": ["number", "null"]},
            "setback_front_m":  {"type": ["number", "null"]},
            "setback_side_m":   {"type": ["number", "null"]},
            "setback_rear_m":   {"type": ["number", "null"]},
            "max_height_m":     {"type": ["number", "null"]},
            "max_floors":       {"type": ["integer", "null"]},
            "max_coverage_pct": {"type": ["number", "null"]},
            "max_far":          {"type": ["number", "null"]},
            "purpose_allowed":  {"type": "array", "items": {"type": "string"}},
            "notes":            {"type": "string"},
            "confidence":       {"type": "string", "enum": ["high", "medium", "low"]},
        },
        "required": [
            "site_area_m2", "site_width_m", "site_depth_m",
            "setback_front_m", "setback_side_m", "setback_rear_m",
            "max_height_m", "max_floors", "max_coverage_pct", "max_far",
            "purpose_allowed", "notes", "confidence",
        ],
    },
    "strict": True,
}


def _sanitize_extraction(ext: GpzuExtraction) -> GpzuExtraction:
    """Post-process: drop obviously wrong dimensions (coordinates, wrong units)."""
    w, d, area = ext.site_width_m, ext.site_depth_m, ext.site_area_m2

    # Sanity: dimensions must be in [5, 2000] m for any buildable plot.
    if w is not None and not (5 <= w <= 2000):
        w = None
    if d is not None and not (5 <= d <= 2000):
        d = None

    # Cross-check: if area is known and both dims available, their product should
    # be within 3× of the stated area. If not, the dims are from a different field.
    if area and area > 0 and w and d:
        ratio = (w * d) / area
        if not (0.33 <= ratio <= 3.0):
            w = None
            d = None

    # If area is known but dims are missing, estimate a square-ish footprint
    # as a hint (marked approximate via notes).
    if area and area > 0 and (w is None or d is None):
        import math as _math
        side = round(_math.sqrt(area))
        w = side if w is None else w
        d = side if d is None else d
        note_suffix = f" [site_width/depth approximated as √{area:.0f}≈{side} m]"
        ext = GpzuExtraction(
            site_area_m2=area,
            site_width_m=w,
            site_depth_m=d,
            setback_front_m=ext.setback_front_m,
            setback_side_m=ext.setback_side_m,
            setback_rear_m=ext.setback_rear_m,
            max_height_m=ext.max_height_m,
            max_floors=ext.max_floors,
            max_coverage_pct=ext.max_coverage_pct,
            max_far=ext.max_far,
            purpose_allowed=ext.purpose_allowed,
            notes=(ext.notes or "") + note_suffix,
            confidence="low" if ext.confidence == "high" else ext.confidence,
        )
        return ext

    return GpzuExtraction(
        site_area_m2=area,
        site_width_m=w,
        site_depth_m=d,
        setback_front_m=ext.setback_front_m,
        setback_side_m=ext.setback_side_m,
        setback_rear_m=ext.setback_rear_m,
        max_height_m=ext.max_height_m,
        max_floors=ext.max_floors,
        max_coverage_pct=ext.max_coverage_pct,
        max_far=ext.max_far,
        purpose_allowed=ext.purpose_allowed,
        notes=ext.notes,
        confidence=ext.confidence,
    )


def extract_gpzu(pdf_bytes: bytes, *, model: str = "gpt-4.1") -> GpzuExtraction:
    """Извлечь поля из PDF-ГПЗУ через OpenAI Vision."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise GpzuParseError("OPENAI_API_KEY не задан в окружении")

    from .._pdf_render import PdfRenderError, pdf_to_png

    try:
        png_pages = pdf_to_png(pdf_bytes)
    except PdfRenderError as e:
        raise GpzuParseError(str(e)) from e
    except Exception as e:
        raise GpzuParseError(f"не удалось отрендерить PDF: {e}") from e
    if not png_pages:
        raise GpzuParseError("PDF не содержит страниц")

    # Сборка multimodal content
    user_content: list[dict[str, Any]] = [{"type": "text", "text": _USER_PROMPT}]
    for png in png_pages:
        b64 = base64.b64encode(png).decode("ascii")
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"},
        })

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_schema", "json_schema": _SCHEMA},
            temperature=0.1,
        )
    except Exception as e:
        raise GpzuParseError(f"OpenAI API failed: {e}") from e

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise GpzuParseError("OpenAI вернул пустой ответ")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise GpzuParseError(f"OpenAI вернул невалидный JSON: {e}") from e

    try:
        raw = GpzuExtraction(**data)
    except TypeError as e:
        raise GpzuParseError(f"структура ответа не соответствует схеме: {e}") from e

    return _sanitize_extraction(raw)
