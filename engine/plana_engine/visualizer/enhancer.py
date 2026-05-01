"""Prompt enhancer через Gemma 4 (OpenAI-совместимый эндпоинт llm.alem.ai).

Входной template-промпт (наш `marketing_prompt.build_marketing_prompt`)
оставляет всю техническую часть как есть, но обогащает атмосферу: добавляет
описания интерьеров, материалов, освещения, стилистики — в зависимости от
типа здания и квартирографии.

Архитектура:
    template prompt (детерминированный) → Gemma 4 → enhanced prompt
                                                    (с поправкой атмосферы)

Переменные окружения:
    LLM_API_KEY    — ключ alem.ai (sk-...)
    LLM_BASE_URL   — base URL, по умолчанию https://llm.alem.ai/v1
    LLM_MODEL      — модель, по умолчанию gemma4

Если LLM_API_KEY не задан — функция возвращает входной промпт без изменений
(graceful degradation).
"""

from __future__ import annotations

import hashlib
import os


_DEFAULT_BASE_URL = "https://llm.alem.ai/v1"
_DEFAULT_MODEL = "gemma4"


_SYSTEM_PROMPT = """Ты — prompt enhancer для image generation модели gpt-image-2.

Твоя задача: обогатить технический архитектурный промпт атмосферой, стилем,
лексикой — но СОХРАНИТЬ ВСЕ ТЕХНИЧЕСКИЕ ИНСТРУКЦИИ И ЧИСЛА ДОСЛОВНО.

Что МОЖНО менять/добавлять:
  • Стилистические эпитеты («modern Scandinavian», «Mediterranean warm», etc.)
  • Описания материалов (parquet wood tone, brick accents, etc.)
  • Атмосферные детали (мебель, освещение, растения)
  • Лексику AutoCAD/CAD точнее (drafting standards, line weights)
  • Целевую аудиторию здания («for young urban professionals», etc.)
  • Художественные референсы (Bauhaus, Brutalist, Russian Constructivism)

Что НЕЛЬЗЯ менять:
  ✗ Числа (размеры, площади, проценты микса, число лифтов, нормы)
  ✗ Технические инструкции по толщинам линий
  ✗ Раздел NEGATIVES (он критичен)
  ✗ Список аннотаций и подписей
  ✗ Структуру разделов (═══ заголовки)

Вход: технический промпт (английский, иногда с кириллицей).
Выход: тот же промпт, но богаче атмосферой. Та же структура, та же длина ±20%.
Никаких преамбул («вот улучшенная версия:») — сразу финальный промпт.
"""


def has_llm_key() -> bool:
    return bool(os.environ.get("LLM_API_KEY"))


def _cache_key(prompt: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(prompt.encode("utf-8"))
    h.update(f"|{model}".encode("utf-8"))
    return h.hexdigest()[:32]


_ENHANCED_CACHE: dict[str, str] = {}
_CACHE_LIMIT = 64


def enhance_prompt(
    base_prompt: str,
    *,
    use_cache: bool = True,
    temperature: float = 0.7,
) -> tuple[str, str]:
    """Доработать промпт через Gemma. Возвращает (enhanced_text, source).

    `source` = "gemma4" если реально вызвали API, "fallback" если ключа нет
    или вызов упал, "cache" если из кэша.
    """
    api_key = os.environ.get("LLM_API_KEY")
    if not api_key:
        return base_prompt, "fallback"

    base_url = os.environ.get("LLM_BASE_URL", _DEFAULT_BASE_URL)
    model = os.environ.get("LLM_MODEL", _DEFAULT_MODEL)

    key = _cache_key(base_prompt, model)
    if use_cache and key in _ENHANCED_CACHE:
        return _ENHANCED_CACHE[key], "cache"

    try:
        from openai import OpenAI
    except ImportError:
        return base_prompt, "fallback"

    client = OpenAI(api_key=api_key, base_url=base_url)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": base_prompt},
            ],
            temperature=temperature,
            max_tokens=4000,
        )
    except Exception as e:
        # graceful degradation: если Gemma недоступна — отдаём как есть
        # это не критическая ошибка, просто пропускаем enhancement
        import logging
        logging.warning(f"Gemma enhance failed, falling back: {e}")
        return base_prompt, "fallback"

    if not response.choices or not response.choices[0].message.content:
        return base_prompt, "fallback"

    enhanced = response.choices[0].message.content.strip()

    # сохраняем в кэш
    if use_cache:
        if len(_ENHANCED_CACHE) >= _CACHE_LIMIT:
            _ENHANCED_CACHE.pop(next(iter(_ENHANCED_CACHE)))
        _ENHANCED_CACHE[key] = enhanced

    return enhanced, model
