"""ГПЗУ-импорт через OpenAI Vision API.

Принимает PDF-байты ГПЗУ, рендерит первые N страниц в PNG через pymupdf
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

All measurements are in meters and square meters. «Минимальные отступы»
are minimum required distances from the site boundary to the building.
«Предельная высота» — maximum allowed building height. «Процент
застройки» — maximum buildup percentage of the site (0..100).
«Коэффициент использования территории / КИТ» — FAR.
"""

_USER_PROMPT = """\
Извлеки следующие поля из изображений ГПЗУ:

- site_area_m2 — общая площадь участка, м²
- site_width_m, site_depth_m — приблизительные габариты bounding-box участка, м
- setback_front_m, setback_side_m, setback_rear_m — минимальные отступы
  от красных линий / границ участка, м
- max_height_m — предельная высота зданий, м
- max_floors — предельная этажность
- max_coverage_pct — процент застройки, 0..100
- max_far — коэффициент использования территории (КИТ / FAR)
- purpose_allowed — список разрешённых видов использования
  (например: residential, commercial, mixed_use, hotel)
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


def _pdf_to_png(pdf_bytes: bytes, *, dpi: int = 150, max_pages: int = 4) -> list[bytes]:
    """Отрендерить до `max_pages` страниц PDF в PNG-байты."""
    try:
        import pymupdf  # type: ignore[import-untyped]
    except ImportError as e:
        raise GpzuParseError(
            "pymupdf не установлен — добавь его в pyproject.toml"
        ) from e

    pages: list[bytes] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        n = min(len(doc), max_pages)
        zoom = dpi / 72.0
        mat = pymupdf.Matrix(zoom, zoom)
        for i in range(n):
            pix = doc[i].get_pixmap(matrix=mat, alpha=False)
            pages.append(pix.tobytes("png"))
    return pages


def extract_gpzu(pdf_bytes: bytes, *, model: str = "gpt-4.1") -> GpzuExtraction:
    """Извлечь поля из PDF-ГПЗУ через OpenAI Vision."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise GpzuParseError("OPENAI_API_KEY не задан в окружении")

    try:
        png_pages = _pdf_to_png(pdf_bytes)
    except GpzuParseError:
        raise
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
        return GpzuExtraction(**data)
    except TypeError as e:
        raise GpzuParseError(f"структура ответа не соответствует схеме: {e}") from e
