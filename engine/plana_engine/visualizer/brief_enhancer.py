"""Энхансер ТЗ: сырой текст пользователя → архитектурно-грамотный текст.

Юзер пишет "4-этажный дом 30×16 в Алматы, 5 м отступы" — но 5 м отступов на
16 м глубину съедают всё внутреннее пространство. Энхансер прогоняет ТЗ
через GPT-архитектора, который:
  • сохраняет явные намерения (размеры, этажность, секции)
  • снижает чрезмерные отступы (5 м боковых на узком здании → 3 м)
  • заполняет недостающее (микс квартир, лифты, высота этажа)
  • привязывает к нормам КМК
  • возвращает чистый текст на русском, готовый снова идти в parse_brief

В отличие от parse_brief (который возвращает структуру), энхансер работает
на уровне текста — это даёт юзеру читаемое ТЗ, которое он может ещё
подправить вручную перед генерацией.
"""

from __future__ import annotations

import os


class BriefEnhanceError(RuntimeError):
    """Ошибка энхансера — нет ключа, OpenAI отказал, пустой ответ."""


_SYSTEM_PROMPT = """\
You are a senior residential architect in Kazakhstan / Russia. The user gives
you a short, vague, or technically problematic brief for an apartment building
floor plan. Your job is to REWRITE it into a clean, normatively-correct,
architecturally-feasible brief in Russian — ready to be parsed by an automatic
floor-plan generator.

Hard rules — never violate:

1. PRESERVE user intent. If the user specified explicit dimensions (e.g.
   "30×16 м"), keep them. If they specified floor count, sections, lift
   count, mix percentages — keep those too.

2. FIX over-aggressive setbacks. For Kazakhstan/Russia:
   - Front setback (от красной линии улицы): 3–5 м
   - Side setbacks: 1.5–3 м (NOT 5 m unless plot is huge)
   - Rear setback: 3 m
   If user wrote "отступы 5 м" without specifying sides — interpret as
   "front 5, sides 3, rear 3" so that inner footprint stays buildable.

3. MINIMUM inner depth for double-loaded section: 12 m
   MINIMUM inner depth for single-corridor (galleria): 7 m
   If after the corrected setbacks the inner depth is still < 7 m → suggest
   increasing the overall building depth or note "галерейный тип".

4. FILL missing fields with reasonable defaults:
   - Sections (подъезды): if not stated, default to 1 for buildings < 30 m
     wide, otherwise 2.
   - Lifts: at least 1 passenger lift per section. For ≥ 9 floors —
     2 passenger + 1 freight per section.
   - Floor height: 3.0 m (жилые), 3.5 m (1-й этаж с КН).
   - Apartment mix if not stated: 20% studios, 40% 1-bedroom (1к),
     30% 2-bedroom (2к), 10% 3-bedroom (3к).

5. Inсolation/КМК: south-facing rooms preferred. Add a sentence about
   ориентация only if relevant (e.g. узкая сторона на север).

6. Output ONLY the rewritten brief in Russian. No JSON, no markdown headers,
   no preamble "Вот улучшенное ТЗ:". Just the text the user will see in
   their textarea, ready to send to /generate/layout-from-brief.

7. Keep the format short and structured — use line breaks per logical block.
   Do not write more than 12 lines total.

8. If the user's brief is already excellent and complete — return it
   essentially unchanged (maybe just fix grammar).
"""


_USER_PROMPT_TPL = """\
Вот моё ТЗ:

\"\"\"
{brief}
\"\"\"

Перепиши его как опытный архитектор: сохрани мои намерения, скорректируй
нереалистичные параметры (особенно отступы), допиши недостающее
(микс квартир, лифты, ориентация), но не раздувай — максимум 12 строк.
Верни ТОЛЬКО улучшенный текст на русском, без комментариев и оформления.
"""


def enhance_brief(brief: str, *, model: str = "gpt-4.1") -> str:
    """Прогнать ТЗ через GPT-архитектора и вернуть улучшенный текст.

    Никаких JSON, никаких parse — просто текст в, текст из.
    Бросает BriefEnhanceError при сбоях.
    """
    if not brief or not brief.strip():
        raise BriefEnhanceError("ТЗ пустое")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise BriefEnhanceError("OPENAI_API_KEY не задан в окружении")

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": _USER_PROMPT_TPL.format(brief=brief.strip())},
            ],
            temperature=0.3,
            max_tokens=600,
        )
    except Exception as e:
        raise BriefEnhanceError(f"OpenAI API failed: {e}") from e

    enhanced = (resp.choices[0].message.content or "").strip()
    if not enhanced:
        raise BriefEnhanceError("OpenAI вернул пустой ответ")

    # Срежем кавычки, если модель завернула ответ
    if enhanced.startswith('"') and enhanced.endswith('"') and enhanced.count('"') == 2:
        enhanced = enhanced[1:-1].strip()

    return enhanced
