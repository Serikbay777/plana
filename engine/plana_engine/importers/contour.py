"""Vision-анализ контура / участка / этажа (Этап 2 ТЗ — «AI-анализ пространства»).

Принимает изображение (JPG / PNG / PDF) с участком или контуром этажа.
Просит gpt-4.1-vision вернуть структурированный анализ:
    - описание формы
    - оценочные габариты bbox
    - ориентация (для инсоляции)
    - окружение (соседи, дороги, зелень)
    - ранжированные рекомендации по форме здания

Ключ читается из ENV `OPENAI_API_KEY`.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, asdict
from typing import Any


class ContourAnalysisError(RuntimeError):
    """Ошибка анализа контура — кривое изображение, нет ключа, кривой JSON."""


@dataclass
class Recommendation:
    """Одна архитектурная рекомендация по контуру."""
    title: str         # короткий заголовок: «Срезать юго-западный угол»
    detail: str        # пояснение в 1-2 предложениях
    priority: str      # "high" | "medium" | "low"
    tag: str           # "geometry" | "insolation" | "access" | "fire" | "landscape" | "context"

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class ContourAnalysis:
    """Результат анализа изображения контура / участка."""
    shape_summary: str
    """Описание формы: «неправильная трапеция, ~50×40 м, срез на юго-западе»."""

    estimated_width_m: float | None
    estimated_depth_m: float | None
    """Оценочные габариты bounding box. None если масштаб не понятен."""

    estimated_orientation_deg: float | None
    """Угол поворота длинной стороны от севера, 0..360°. None если неясно."""

    context_features: list[str]
    """Что вокруг: «дорога с севера», «соседнее 9-этажное здание на востоке»,
    «зелёная зона на юге», «река/река-овраг»."""

    suggested_purpose: str | None
    """Угаданное назначение: residential / commercial / mixed_use / hotel / null."""

    recommendations: list[Recommendation]
    """Ранжированный список архитектурных рекомендаций."""

    notes: str
    """Свободные заметки от модели."""

    confidence: str  # "high" | "medium" | "low"

    def to_dict(self) -> dict[str, Any]:
        return {
            "shape_summary":             self.shape_summary,
            "estimated_width_m":         self.estimated_width_m,
            "estimated_depth_m":         self.estimated_depth_m,
            "estimated_orientation_deg": self.estimated_orientation_deg,
            "context_features":          self.context_features,
            "suggested_purpose":         self.suggested_purpose,
            "recommendations":           [r.to_dict() for r in self.recommendations],
            "notes":                     self.notes,
            "confidence":                self.confidence,
        }


_SYSTEM_PROMPT = """\
You are a senior architect specialising in concept design for residential
and mixed-use developments in Kazakhstan / Russia. The user gives you one
or several images: aerial photos of a site, screenshots of a CAD floor
contour, hand-drawn sketches, or PDF site plans.

Your job is to analyse the SHAPE of the buildable space and return
actionable architectural recommendations: where to cut corners for better
insolation, which side to align the long facade with, where to place the
main entrance, what to watch out for given visible context (roads, trees,
neighbouring buildings, terrain). Be concrete and pragmatic — the
recommendations will be shown to a developer who will adjust input
parameters and regenerate AI floor plans.

If a measurement is not visible or ambiguous, return null — do not guess.
Output strictly valid JSON matching the provided schema.

All recommendations and free text MUST be in Russian (Cyrillic).
"""


_USER_PROMPT = """\
Проанализируй изображение(я) и верни JSON с архитектурными рекомендациями
для девелопера. Заполни:

1. shape_summary — короткое описание формы участка/контура одним предложением
   на русском (например: «Прямоугольный участок 60×40 м, длинная сторона
   ориентирована с запада на восток»).

2. estimated_width_m, estimated_depth_m — оценочные габариты bounding box
   в метрах, если на изображении есть масштаб или подписи. Иначе null.

3. estimated_orientation_deg — угол поворота длинной стороны от севера,
   0..360°. Север=0, восток=90, юг=180, запад=270. Если непонятно — null.

4. context_features — массив строк на русском, что есть на изображении
   рядом с участком: дороги, соседние здания (с этажностью если видно),
   зелёные зоны, водоёмы, рельеф. Каждая строка ≤ 80 символов.

5. suggested_purpose — лучшее назначение здания исходя из контекста:
   "residential", "commercial", "mixed_use", "hotel", или null если неясно.

6. recommendations — массив до 6 ранжированных рекомендаций. Каждая:
   - title  — короткий заголовок на русском, ≤ 60 символов
              (например: «Срезать юго-западный угол на 2 м»)
   - detail — пояснение 1-2 предложения на русском (≤ 220 символов),
              почему это улучшит проект
   - priority — "high" | "medium" | "low"
   - tag — одна из категорий:
       "geometry"   — изменение формы / габаритов
       "insolation" — инсоляция / ориентация по сторонам света
       "access"     — въезды, входы, эвакуация
       "fire"       — пожарные нормы, отступы между секциями
       "landscape"  — благоустройство, зелень
       "context"    — соседи / городская среда

7. notes — свободные заметки на русском, всё что не уложилось в поля выше.

8. confidence — твоя уверенность: "high" | "medium" | "low".

Старайся быть конкретным: вместо «улучшите ориентацию» напиши «разверните
длинную сторону на 15° по часовой для инсоляции жилых комнат».
"""


_SCHEMA: dict[str, Any] = {
    "name": "contour_analysis",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "shape_summary":             {"type": "string"},
            "estimated_width_m":         {"type": ["number", "null"]},
            "estimated_depth_m":         {"type": ["number", "null"]},
            "estimated_orientation_deg": {"type": ["number", "null"]},
            "context_features":          {"type": "array", "items": {"type": "string"}},
            "suggested_purpose": {
                "type": ["string", "null"],
                "enum": ["residential", "commercial", "mixed_use", "hotel", None],
            },
            "recommendations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title":    {"type": "string"},
                        "detail":   {"type": "string"},
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "tag":      {
                            "type": "string",
                            "enum": [
                                "geometry", "insolation", "access",
                                "fire", "landscape", "context",
                            ],
                        },
                    },
                    "required": ["title", "detail", "priority", "tag"],
                },
            },
            "notes":      {"type": "string"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
        "required": [
            "shape_summary", "estimated_width_m", "estimated_depth_m",
            "estimated_orientation_deg", "context_features", "suggested_purpose",
            "recommendations", "notes", "confidence",
        ],
    },
    "strict": True,
}


def _pdf_to_png(pdf_bytes: bytes, *, dpi: int = 150, max_pages: int = 4) -> list[bytes]:
    """Отрендерить до `max_pages` страниц PDF в PNG-байты."""
    try:
        import pymupdf  # type: ignore[import-untyped]
    except ImportError as e:
        raise ContourAnalysisError(
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


def _bytes_to_png_list(data: bytes, *, mime: str | None = None) -> list[bytes]:
    """Привести любой загруженный файл к списку PNG-байт.

    PDF → рендерим в PNG через pymupdf.
    JPG/PNG/прочее изображение → отдаём как есть, в одном элементе.

    Не валидируем содержимое — gpt-4.1 сам разберётся, если на входе мусор.
    """
    # Простая магическая проверка на PDF
    if data[:4] == b"%PDF" or (mime and "pdf" in mime.lower()):
        return _pdf_to_png(data)
    return [data]


def analyze_contour(
    image_bytes: bytes,
    *,
    mime: str | None = None,
    model: str = "gpt-4.1",
) -> ContourAnalysis:
    """Прогнать изображение участка/контура через gpt-4.1-vision.

    Возвращает структурированный анализ. Бросает `ContourAnalysisError`
    при отсутствии ключа, кривом ответе или ошибке OpenAI.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ContourAnalysisError("OPENAI_API_KEY не задан в окружении")

    try:
        png_pages = _bytes_to_png_list(image_bytes, mime=mime)
    except ContourAnalysisError:
        raise
    except Exception as e:
        raise ContourAnalysisError(f"не удалось обработать изображение: {e}") from e
    if not png_pages:
        raise ContourAnalysisError("файл не содержит изображений")

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
            temperature=0.2,
        )
    except Exception as e:
        raise ContourAnalysisError(f"OpenAI API failed: {e}") from e

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise ContourAnalysisError("OpenAI вернул пустой ответ")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ContourAnalysisError(f"OpenAI вернул невалидный JSON: {e}") from e

    try:
        recs = [Recommendation(**r) for r in data.get("recommendations", [])]
        return ContourAnalysis(
            shape_summary=             data["shape_summary"],
            estimated_width_m=         data["estimated_width_m"],
            estimated_depth_m=         data["estimated_depth_m"],
            estimated_orientation_deg= data["estimated_orientation_deg"],
            context_features=          list(data.get("context_features", [])),
            suggested_purpose=         data.get("suggested_purpose"),
            recommendations=           recs,
            notes=                     data.get("notes", ""),
            confidence=                data["confidence"],
        )
    except (TypeError, KeyError) as e:
        raise ContourAnalysisError(f"структура ответа не соответствует схеме: {e}") from e
