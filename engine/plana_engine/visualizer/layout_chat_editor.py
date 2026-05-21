"""Чат-итерация над планом этажа.

Юзер: «увеличь спальню на 2 м», «добавь балкон в кв.3», «удали гардеробную».
GPT-4 принимает текущий LayoutFloor (JSON) + пользовательскую инструкцию,
возвращает обновлённый LayoutFloor (полностью, не diff).

Это сильнее режима C из PDF Виз: юзер видит результат на canvas и тут же
может попросить ещё правку, диалогом. Аналог чата в maket.ai.
"""

from __future__ import annotations

import json
import os
from typing import Any

from ..cad.layout_schema import LayoutFloor


class LayoutChatError(RuntimeError):
    """Ошибка чат-редактирования — нет ключа, OpenAI отказал, кривой JSON."""


_SYSTEM_PROMPT = """\
You are an architect's AI assistant. The user shows you the current floor
plan as a JSON document (LayoutFloor schema) and asks for a SPECIFIC
modification. Your job is to return the complete updated JSON with that
modification applied.

HARD RULES — never violate:

1. Return the FULL LayoutFloor JSON, not a diff or just the changed part.
2. PRESERVE everything the user did NOT ask to change:
   - building width_m and depth_m
   - section count, x_start, width, corridor_y, corridor_d
   - cores (lifts and stairs) — geometry and types
3. ONLY modify apartments / rooms according to the user's request:
   - resize rooms (change x, y, w, d)
   - add/remove rooms
   - add/remove apartments
   - move furniture/doors/windows along with their room
4. NO overlapping rooms within an apartment.
5. Rooms must stay inside their apartment bounds (apt.x..apt.x+apt.w,
   apt.y..apt.y+apt.d).
6. Keep door/window arrays consistent: if a room is resized, also adjust
   the offset/width of any aperture so it still fits on the wall.
7. Keep furniture[] array consistent: items should not protrude outside
   the room's new bounds. If they no longer fit, you may remove them.
8. Apartment.number must remain unique across the layout.
9. All numeric coordinates in METRES, kept to 3 decimal places.
10. Do BEST EFFORT if request is geometrically impossible — return your
    best JSON, don't refuse.

Output STRICTLY valid JSON matching LayoutFloor schema. No markdown
fences, no commentary outside JSON.
"""


def _layout_schema() -> dict[str, Any]:
    """Минимальная JSON Schema LayoutFloor для structured output."""
    return {
        "name": "layout_floor",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["width_m", "depth_m", "sections"],
            "properties": {
                "width_m": {"type": "number"},
                "depth_m": {"type": "number"},
                "sections": {
                    "type": "array",
                    "items": {"type": "object", "additionalProperties": True},
                },
            },
        },
        "strict": False,
    }


def edit_layout_with_chat(
    layout: LayoutFloor,
    user_message: str,
    *,
    model: str = "gpt-4.1",
) -> LayoutFloor:
    """Применить пользовательскую правку к layout через GPT-4."""
    if not user_message or not user_message.strip():
        raise LayoutChatError("Сообщение пустое")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LayoutChatError("OPENAI_API_KEY не задан в окружении")

    layout_json = layout.model_dump(exclude_none=False)
    user_payload = (
        f"ТЕКУЩИЙ ПЛАН (LayoutFloor JSON):\n"
        f"```json\n{json.dumps(layout_json, ensure_ascii=False)}\n```\n\n"
        f"ЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n«{user_message.strip()}»\n\n"
        f"Верни ПОЛНЫЙ обновлённый LayoutFloor JSON с применённой правкой."
    )

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": user_payload},
            ],
            response_format={"type": "json_schema", "json_schema": _layout_schema()},
            temperature=0.2,
        )
    except Exception as e:
        raise LayoutChatError(f"OpenAI API failed: {e}") from e

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise LayoutChatError("OpenAI вернул пустой ответ")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise LayoutChatError(f"OpenAI вернул невалидный JSON: {e}") from e

    try:
        return LayoutFloor.model_validate(data)
    except Exception as e:
        raise LayoutChatError(
            f"OpenAI-ответ не валидируется как LayoutFloor: {e}"
        ) from e
