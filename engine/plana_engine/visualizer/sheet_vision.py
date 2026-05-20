"""Vision-функции для PDF Визуализации.

Две операции поверх gpt-4.1:
    - classify_sheet  — определяет тип архитектурного листа из реестра
    - extract_sheet_context — возвращает 3–5 предложений с конкретными
                              параметрами здания для инжекта в промпт gpt-image
                              (режим C — «визуализация в стиле моего альбома»)

Намеренно держим Vision-вызовы простыми: один промпт, один JSON, без цепочек.
Стоимость gpt-4.1 vision ≈ $0.01–0.03 на страницу — приемлемо.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any


class SheetVisionError(RuntimeError):
    """Ошибка vision-операции — нет ключа, кривой ответ, фейл OpenAI."""


@dataclass
class SheetClassification:
    sheet_type: str
    confidence: str        # "high" | "medium" | "low"


def _client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SheetVisionError("OPENAI_API_KEY не задан в окружении")
    try:
        from openai import OpenAI
    except ImportError as e:
        raise SheetVisionError(f"openai SDK not installed: {e}") from e
    return OpenAI(api_key=api_key)


def _img_content(jpeg_bytes: bytes) -> dict[str, Any]:
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
    }


# ---------------------------------------------------------------------------
# Классификация типа листа
# ---------------------------------------------------------------------------


def _build_classify_schema(allowed_keys: list[str]) -> dict[str, Any]:
    return {
        "name": "sheet_classification",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "sheet_type": {"type": "string", "enum": allowed_keys},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            },
            "required": ["sheet_type", "confidence"],
        },
        "strict": True,
    }


_CLASSIFY_SYSTEM = """\
You are an expert at reading architectural project sheets (multi-apartment
residential buildings). The user shows you ONE page from an architectural
album. Decide which TYPE of sheet it is from the provided list, then return
JSON: {sheet_type, confidence}. Do NOT guess wildly — if unsure, pick
"generic" with low confidence.
"""


_CLASSIFY_USER_TPL = """\
What is this sheet? Pick exactly one type key from the list below.

Allowed keys with hints:
{hints}

Return strictly the JSON: {{"sheet_type": "<one of the keys>",
"confidence": "high"|"medium"|"low"}}.
"""


_TYPE_HINTS = {
    "title_hero":               "title page / hero exterior render of the building",
    "block_scheme":             "site masterplan / block diagram from above",
    "basement_plan":            "basement / technical underground floor plan",
    "floor_plan":               "typical floor plan with apartments and rooms",
    "roof_plan":                "roof plan with drainage funnels and vent shafts",
    "sections":                 "vertical cross-section (разрез) of the building",
    "facades":                  "elevations of all four facades",
    "door_window_catalog":      "door/window catalog / specification sheet",
    "construction_stage":       "construction phase / masonry/structure stage",
    "structural_reinforcement": "steel reinforcement frames for openings (К-N)",
    "hardware":                 "stairs, railings, hatches hardware spec",
    "elevator_cutaway":         "elevator shaft cross-section / specification",
    "facade_node":              "facade construction nodes / detail sections",
    "glass_canopy":             "glass canopy / spider-system entrance detail",
    "generic":                  "other / unknown / general drawing",
}


def classify_sheet(jpeg_bytes: bytes, *, model: str = "gpt-4.1") -> SheetClassification:
    """Vision-классификация одной страницы PDF.

    Returns SheetClassification(sheet_type, confidence). Никогда не падает на
    «не знаю» — в худшем случае возвращает ("generic", "low").
    """
    if not jpeg_bytes:
        return SheetClassification(sheet_type="generic", confidence="low")

    allowed_keys = list(_TYPE_HINTS.keys())
    hints = "\n".join(f"  - {k}: {v}" for k, v in _TYPE_HINTS.items())
    user_text = _CLASSIFY_USER_TPL.format(hints=hints)

    client = _client()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _CLASSIFY_SYSTEM},
                {"role": "user", "content": [
                    {"type": "text", "text": user_text},
                    _img_content(jpeg_bytes),
                ]},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": _build_classify_schema(allowed_keys),
            },
            temperature=0.0,
        )
    except Exception as e:
        raise SheetVisionError(f"OpenAI vision failed: {e}") from e

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        return SheetClassification(sheet_type="generic", confidence="low")
    try:
        data = json.loads(content)
        return SheetClassification(
            sheet_type=data.get("sheet_type") or "generic",
            confidence=data.get("confidence") or "low",
        )
    except (json.JSONDecodeError, KeyError):
        return SheetClassification(sheet_type="generic", confidence="low")


# ---------------------------------------------------------------------------
# Извлечение контекста страницы для режима C
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = """\
You are an architect's assistant. The user shows you ONE page from an
architectural project album (multi-apartment residential building). Read the
page carefully and produce a short, factual description in English with the
specific building parameters that are visible on this page (dimensions,
floor count, apartment count and types, facade materials, RAL colors, key
features). 3 to 5 sentences. Stay factual — DO NOT invent values that are
not visible.

This description will be appended to a text-to-image prompt so that the
generated render matches the actual building shown on the source page.
"""


_EXTRACT_USER = """\
Describe this architectural page in 3–5 short English sentences. Focus on:
- footprint and overall dimensions, floor count, total area if visible
- apartment count and mix (studios / 1k / 2k / 3k / 4k) if shown
- facade materials and RAL palette
- distinctive features (canopy, balconies, mansard, etc.)

Plain prose, no markdown, no lists. If something is not visible — skip it,
do not write "not visible".
"""


def extract_sheet_context(jpeg_bytes: bytes, *, model: str = "gpt-4.1") -> str:
    """Vision-extract: вернуть 3–5 предложений-описание страницы.

    Возвращает пустую строку, если страница пустая или vision не справился.
    Никогда не бросает наружу — фича C должна деградировать до A без падения.
    """
    if not jpeg_bytes:
        return ""

    try:
        client = _client()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": [
                    {"type": "text", "text": _EXTRACT_USER},
                    _img_content(jpeg_bytes),
                ]},
            ],
            temperature=0.2,
            max_tokens=350,
        )
    except SheetVisionError:
        return ""
    except Exception:
        return ""

    text = (resp.choices[0].message.content or "").strip()
    # уберём случайные кавычки / markdown
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    return text
