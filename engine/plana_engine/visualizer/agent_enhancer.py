"""Двухстадийный агентный prompt-enhancer с базой знаний РК.

Архитектура:

    MarketingInputs
         │
         ▼
    [Stage 0] Norm Selector — детерминистский (kz_norms.select_relevant_norms)
         │   выбирает 3-6 релевантных разделов по purpose+параметрам
         ▼
    [Stage 1] Architect Critic — LLM (Gemma 4 / GPT-4)
         │   читает inputs + выбранные нормы
         │   → возвращает Critique:
         │       • numerical_constraints — числовые требования
         │       • design_recommendations — архитектурные советы
         │       • risks — что нарушает входные параметры
         ▼
    [Stage 2] Prompt Composer — LLM
         │   получает base_prompt + Critique
         │   → вшивает нормы в промпт сохраняя структуру и числа
         ▼
    enhanced prompt → gpt-image-1


Если ключа `LLM_API_KEY` нет — graceful fallback на оригинальный промпт.
Если первая стадия упала — вторая работает с пустым critique.
Если вторая стадия упала — отдаём оригинал.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from .kz_norms import (
    NormSection, build_norms_context, select_relevant_norms,
)
from .marketing_prompt import MarketingInputs


_DEFAULT_BASE_URL = "https://llm.alem.ai/v1"
_DEFAULT_MODEL = "qwen3"


def _robust_json_parse(raw: str) -> dict | None:
    """Robust JSON parser для LLM-выходов.

    LLM (особенно gemma/qwen через alem.ai) часто возвращают:
      - JSON в markdown-обёртке ```json {...} ```
      - С преамбулой типа «Вот ответ:» перед JSON
      - С trailing commas
      - С одинарными кавычками вместо двойных

    Эта функция пытается всё это починить и распарсить.
    Возвращает dict или None если ничего не помогло.
    """
    import re

    s = raw.strip()

    # 1. Убираем markdown-обёртки
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"\s*```\s*$", "", s, flags=re.MULTILINE)
    s = s.strip()

    # 2. Извлекаем первый top-level JSON объект (если есть преамбула)
    if not s.startswith("{"):
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            s = m.group(0)

    # 3. Пробуем парсить как есть
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # 4. Чистим trailing commas
    cleaned = re.sub(r",(\s*[}\]])", r"\1", s)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 5. Заменяем одинарные кавычки на двойные (хрупко, но иногда работает)
    cleaned2 = re.sub(r"'([^']*)':", r'"\1":', cleaned)
    cleaned2 = re.sub(r":\s*'([^']*)'", r': "\1"', cleaned2)
    try:
        return json.loads(cleaned2)
    except json.JSONDecodeError:
        pass

    return None


def _alem_credentials() -> tuple[str | None, str, str]:
    """Считывает ALEM_API_KEY/ALEM_MODEL/ALEM_BASE_URL.

    Поддерживает legacy LLM_* для обратной совместимости.
    Возвращает (api_key, base_url, model). api_key = None → ключа нет.
    """
    api_key = os.environ.get("ALEM_API_KEY") or os.environ.get("LLM_API_KEY")
    base_url = (
        os.environ.get("ALEM_BASE_URL")
        or os.environ.get("LLM_BASE_URL")
        or _DEFAULT_BASE_URL
    )
    model = (
        os.environ.get("ALEM_MODEL")
        or os.environ.get("LLM_MODEL")
        or _DEFAULT_MODEL
    )
    return api_key, base_url, model


# ── структуры данных ────────────────────────────────────────────────────────

@dataclass
class NumericalConstraint:
    """Одно числовое требование, извлечённое из норм."""
    parameter: str    # «ширина коридора», «эвакуация», «инсоляция»
    value: str        # «≥ 1.4 м», «≤ 25 м», «≥ 2 ч»
    source: str       # «СНиП РК 3.02-43-2007 п. 5.5.11»


@dataclass
class DesignRecommendation:
    """Архитектурная рекомендация."""
    title: str
    detail: str
    priority: str  # "high" | "medium" | "low"


@dataclass
class Risk:
    """Возможное нарушение норм входными параметрами."""
    description: str
    severity: str  # "blocker" | "warning" | "info"


@dataclass
class Critique:
    """Структурированная архитектурная критика — выход Stage 1."""
    numerical_constraints: list[NumericalConstraint] = field(default_factory=list)
    design_recommendations: list[DesignRecommendation] = field(default_factory=list)
    risks: list[Risk] = field(default_factory=list)
    summary: str = ""

    @property
    def is_empty(self) -> bool:
        return not (
            self.numerical_constraints or self.design_recommendations or
            self.risks or self.summary
        )


# ── Stage 1: Architect Critic ───────────────────────────────────────────────

_CRITIC_SYSTEM = """Ты — главный архитектор-консультант по нормам РК.

Тебе на вход дают:
  1. ПАРАМЕТРЫ ОБЪЕКТА (площадь участка, этажность, назначение, квартирография, лифты, паркинг, отступы).
  2. ВЫПИСКУ ИЗ КАЗАХСТАНСКИХ НОРМ (СНиП РК, СН РК, СП РК — релевантные разделы).

Твоя задача:
  • Выбрать из норм наиболее важные ЧИСЛОВЫЕ требования, применимые к этому объекту.
  • Дать 3-6 архитектурных РЕКОМЕНДАЦИЙ — что должно быть на плане, чтобы он соответствовал нормам и был эстетически грамотным.
  • Если входные параметры нарушают нормы — указать РИСКИ.

ВАЖНО:
  • Все числа цитируй ДОСЛОВНО из норм с указанием источника (СНиП РК ХХХ п. Y).
  • Не выдумывай числа, которых нет в нормах.
  • Рекомендации формулируй кратко, по делу, без воды.
  • Все ответы на РУССКОМ.

Верни СТРОГО ВАЛИДНЫЙ JSON в этой схеме (и только JSON, ничего больше):
{
  "numerical_constraints": [
    {"parameter": "...", "value": "...", "source": "..."}
  ],
  "design_recommendations": [
    {"title": "...", "detail": "...", "priority": "high"}
  ],
  "risks": [
    {"description": "...", "severity": "warning"}
  ],
  "summary": "Одно предложение."
}

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА JSON-ВЫВОДА:
1. ТОЛЬКО двойные кавычки " — не одинарные '
2. НЕТ trailing commas (запятая перед }) и ])
3. НЕТ markdown-обёрток ```json
4. НЕТ преамбул («Вот ответ:», «JSON:»)
5. НЕТ комментариев // или /* */
6. priority — ТОЛЬКО одно из: "high" / "medium" / "low"
7. severity — ТОЛЬКО одно из: "blocker" / "warning" / "info"
8. Все строковые значения экранируй: " → \\", \\n для переносов
9. Начинай ответ сразу с { и заканчивай }
"""


_CRITIQUE_SCHEMA: dict[str, Any] = {
    "name": "architect_critique",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "numerical_constraints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "parameter": {"type": "string"},
                        "value": {"type": "string"},
                        "source": {"type": "string"},
                    },
                    "required": ["parameter", "value", "source"],
                },
            },
            "design_recommendations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                    },
                    "required": ["title", "detail", "priority"],
                },
            },
            "risks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "description": {"type": "string"},
                        "severity": {"type": "string", "enum": ["blocker", "warning", "info"]},
                    },
                    "required": ["description", "severity"],
                },
            },
            "summary": {"type": "string"},
        },
        "required": ["numerical_constraints", "design_recommendations", "risks", "summary"],
    },
    "strict": True,
}


def _format_inputs_for_critic(inputs: MarketingInputs) -> str:
    """Текстовое представление параметров для LLM."""
    return f"""ПАРАМЕТРЫ ОБЪЕКТА:

  • Назначение: {inputs.purpose}
  • Размеры участка: {inputs.site_width_m} × {inputs.site_depth_m} м
  • Отступы: фронт {inputs.setback_front_m} м, бок {inputs.setback_side_m} м, тыл {inputs.setback_rear_m} м
  • Этажность: {inputs.floors}
  • Квартирография:
      - студии: {int(inputs.studio_pct * 100)}%
      - 1-комн: {int(inputs.k1_pct * 100)}%
      - 2-комн: {int(inputs.k2_pct * 100)}%
      - 3-комн: {int(inputs.k3_pct * 100)}%
  • Лифты: {inputs.lifts_passenger} пассажирских + {inputs.lifts_freight} грузовых
  • Паркинг: {inputs.parking_spaces_per_apt} м/м на квартиру, {inputs.parking_underground_levels} подземных этажа
  • Эвакуация: ≤ {inputs.fire_evacuation_max_m} м, тупиковые ≤ {inputs.fire_dead_end_corridor_max_m} м
  • Инсоляция: {"приоритет инсоляции" if inputs.insolation_priority else "без приоритета"}, мин. {inputs.insolation_min_hours} ч
  • ГПЗУ: КИТ {inputs.max_coverage_pct}%, высота ≤ {inputs.max_height_m} м
"""


def _critic_call(
    inputs: MarketingInputs, norms_context: str, *,
    api_key: str, base_url: str, model: str,
) -> Critique:
    """Stage 1: дёргаем LLM с нормами и параметрами, получаем Critique."""
    try:
        from openai import OpenAI
    except ImportError:
        return Critique()

    user_payload = (
        f"{_format_inputs_for_critic(inputs)}\n"
        f"───────────────────────────────────\n"
        f"ВЫПИСКА ИЗ НОРМ РК:\n\n{norms_context}"
    )

    client = OpenAI(api_key=api_key, base_url=base_url)
    try:
        # Сначала пробуем с json_schema (если модель поддерживает)
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _CRITIC_SYSTEM},
                    {"role": "user", "content": user_payload},
                ],
                response_format={"type": "json_schema", "json_schema": _CRITIQUE_SCHEMA},
                temperature=0.2,
                max_tokens=2500,
            )
        except Exception:
            # Фолбэк на json_object для моделей попроще (Gemma на alem.ai)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _CRITIC_SYSTEM},
                    {"role": "user", "content": user_payload},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=2500,
            )
    except Exception as e:
        logging.warning(f"Architect Critic failed: {e}")
        return Critique()

    if not resp.choices or not resp.choices[0].message.content:
        return Critique()

    raw = resp.choices[0].message.content.strip()
    data = _robust_json_parse(raw)
    if data is None:
        logging.warning(f"Critic returned unparseable JSON (preview): {raw[:200]!r}")
        return Critique()

    # Парсим элементы по одному с пропуском невалидных,
    # чтобы один кривой элемент не валил всю критику.
    def _safe_items(key: str, cls):
        items = data.get(key) or []
        result = []
        for x in items:
            if not isinstance(x, dict):
                continue
            try:
                result.append(cls(**x))
            except (TypeError, ValueError) as e:
                logging.debug(f"Skipping invalid {cls.__name__}: {e}")
        return result

    return Critique(
        numerical_constraints=_safe_items("numerical_constraints", NumericalConstraint),
        design_recommendations=_safe_items("design_recommendations", DesignRecommendation),
        risks=_safe_items("risks", Risk),
        summary=str(data.get("summary", "")),
    )


# ── Stage 2: Prompt Composer ────────────────────────────────────────────────

_COMPOSER_SYSTEM = """Ты — prompt enhancer для image-generation модели gpt-image.

На вход:
  1. БАЗОВЫЙ ТЕХНИЧЕСКИЙ ПРОМПТ (английский, иногда с кириллицей) — детерминированно собранный архитектурный промпт.
  2. АРХИТЕКТУРНАЯ КРИТИКА — числовые требования из норм РК, рекомендации, риски (на русском).

Задача: вшить ключевые числовые требования и 1-2 рекомендации из критики в существующий промпт, СОХРАНИВ его структуру и все исходные числа.

Что МОЖНО:
  • Уточнить размеры в существующих фразах (например: «коридор» → «коридор шириной ≥ 1.4 м (СНиП РК 3.02-43-2007)»)
  • Добавить 1-2 атмосферные/архитектурные ноты из рекомендаций
  • Усилить лексику AutoCAD (line weights, drafting standards) в духе исходного промпта
  • Перефразировать любой текст для лучшей читаемости gpt-image

Что НЕЛЬЗЯ:
  ✗ Менять числа из исходного промпта (они от пользователя)
  ✗ Удалять разделы ═══ или менять их структуру
  ✗ Удалять секцию NEGATIVES (она критична)
  ✗ Переводить кириллические лейблы в латиницу
  ✗ Добавлять преамбулу типа «вот улучшенная версия:» — сразу финальный промпт

Длина: ±25% от исходной. Никакого markdown снаружи промпта. Просто текст.
"""


def _format_critique_for_composer(c: Critique) -> str:
    """Текстовое представление критики для второй стадии."""
    if c.is_empty:
        return "(критика пуста — обогащай промпт по своему усмотрению, без выдумывания норм)"

    lines: list[str] = []

    if c.summary:
        lines.append(f"АРХИТЕКТУРНЫЙ ПОСЫЛ: {c.summary}\n")

    if c.numerical_constraints:
        lines.append("ЧИСЛОВЫЕ ТРЕБОВАНИЯ ИЗ НОРМ РК:")
        for n in c.numerical_constraints[:8]:  # ограничиваем чтобы не раздуть
            lines.append(f"  • {n.parameter}: {n.value} ({n.source})")
        lines.append("")

    if c.design_recommendations:
        lines.append("РЕКОМЕНДАЦИИ:")
        for r in c.design_recommendations[:5]:
            lines.append(f"  • [{r.priority}] {r.title}: {r.detail}")
        lines.append("")

    if c.risks:
        lines.append("РИСКИ (учти при компоновке промпта):")
        for r in c.risks[:5]:
            lines.append(f"  • [{r.severity}] {r.description}")

    return "\n".join(lines)


def _composer_call(
    base_prompt: str, critique: Critique, *,
    api_key: str, base_url: str, model: str,
    temperature: float = 0.6,
) -> str:
    """Stage 2: дёргаем LLM с базовым промптом и критикой, получаем enhanced."""
    try:
        from openai import OpenAI
    except ImportError:
        return base_prompt

    user_payload = (
        f"БАЗОВЫЙ ПРОМПТ:\n\n{base_prompt}\n\n"
        f"───────────────────────────────────\n"
        f"АРХИТЕКТУРНАЯ КРИТИКА:\n\n{_format_critique_for_composer(critique)}\n"
    )

    client = OpenAI(api_key=api_key, base_url=base_url)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _COMPOSER_SYSTEM},
                {"role": "user", "content": user_payload},
            ],
            temperature=temperature,
            max_tokens=4500,
        )
    except Exception as e:
        logging.warning(f"Prompt Composer failed: {e}")
        return base_prompt

    if not resp.choices or not resp.choices[0].message.content:
        return base_prompt

    return resp.choices[0].message.content.strip()


# ── главная функция ────────────────────────────────────────────────────────

@dataclass
class EnhancementResult:
    """Результат всего пайплайна — enhanced prompt + метаданные."""
    enhanced_prompt: str
    source: str               # "agent" | "fallback" | "no-key"
    norms_used: list[str]     # ключи разделов
    critique: Critique | None # для отладки/UI


def enhance_with_kz_norms(
    base_prompt: str, inputs: MarketingInputs,
    *,
    use_seismic: bool = True,
) -> EnhancementResult:
    """Главный вход: обогатить промпт с учётом норм РК.

    Если LLM_API_KEY не задан — возвращает base_prompt без изменений.
    Если что-то падает в любой стадии — graceful degradation на base_prompt.
    """
    # Stage 0: детерминистский селектор
    sections: list[NormSection] = select_relevant_norms(
        purpose=inputs.purpose,
        floors=inputs.floors,
        lifts_passenger=inputs.lifts_passenger,
        parking_spaces_per_apt=inputs.parking_spaces_per_apt,
        seismic_zone=use_seismic,
    )

    api_key, base_url, model = _alem_credentials()
    if not api_key:
        return EnhancementResult(
            enhanced_prompt=base_prompt,
            source="no-key",
            norms_used=[s.key for s in sections],
            critique=None,
        )

    norms_context = build_norms_context(sections)

    # Stage 1: critic
    critique = _critic_call(
        inputs, norms_context,
        api_key=api_key, base_url=base_url, model=model,
    )

    # Stage 2: composer
    enhanced = _composer_call(
        base_prompt, critique,
        api_key=api_key, base_url=base_url, model=model,
    )

    return EnhancementResult(
        enhanced_prompt=enhanced,
        source="agent" if not critique.is_empty else "fallback",
        norms_used=[s.key for s in sections],
        critique=critique if not critique.is_empty else None,
    )
