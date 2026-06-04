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

    КЛЮЧЕВОЕ РАЗДЕЛЕНИЕ:
      • building_width_m / building_depth_m — пятно застройки (FOOTPRINT),
        то что юзер обычно имеет в виду, когда говорит «дом 30×16»
      • site_width_m / site_depth_m — размер участка (включая отступы)
    Если указан только building — backend вычислит site = building + 2*setback.
    Если указан только site — backend оставит как есть.
    Если ничего не указано — backend применит дефолтные размеры.
    """
    site_width_m:     float | None
    site_depth_m:     float | None
    building_width_m: float | None
    building_depth_m: float | None
    setback_front_m: float | None
    setback_side_m:  float | None
    setback_rear_m:  float | None
    floors:          int | None
    purpose:         str | None       # residential / commercial / mixed_use / hotel
    # Тип здания: single_family (частный дом / коттедж) vs multi_family
    # (секционная многоквартирная застройка) vs commercial / mixed.
    # Влияет на генерацию: для single_family НЕ создаются ядра (лифт/
    # лестница подъезда) и нет общего коридора секции — одна квартира на
    # весь этаж.
    building_type:   str | None       # single_family / multi_family / commercial / mixed
    sections:        int | None
    studio_pct:      float | None
    k1_pct:          float | None
    k2_pct:          float | None
    k3_pct:          float | None
    k4_pct:          float | None
    lifts_passenger: int | None
    lifts_freight:   int | None
    max_height_m:    float | None
    # Параметры для single_family — игнорируются для multi_family.
    bedrooms:        int | None       # количество спален в доме
    bathrooms:       int | None       # количество санузлов
    has_garage:      bool | None      # пристроенный гараж
    # Типология этажа для multi_family: "symmetric" / "t_shape" / null
    floor_typology:  str | None
    notes:           str             # что не уложилось в поля


_SYSTEM_PROMPT = """\
You are an architect's assistant. The user gives you a free-form Russian
brief for a residential / commercial building floor plan. Extract the
structured numeric parameters that will be used to generate a typical floor
layout. Output strictly valid JSON matching the schema.

CRITICAL RULES — read carefully:

1. DIMENSIONS — самая важная часть. Различай ДВА типа размеров:

   а) building_width_m / building_depth_m = ПЯТНО ЗАСТРОЙКИ (footprint
      здания). Это то, что юзер обычно имеет в виду, когда говорит:
        • «габариты здания 30×16»
        • «дом 30×16 м»
        • «ЖК 60×40»
        • «здание длиной 30, глубиной 16»
        • «корпус 30×16»
      Когда видишь такие фразы — заполняй building_width_m /
      building_depth_m, а site_*_m оставляй null.

   б) site_width_m / site_depth_m = РАЗМЕР УЧАСТКА (включая землю
      под отступами). Это когда юзер явно говорит про участок:
        • «участок 50×30»
        • «земельный надел 40×25»
        • «лот 30×20»
        • «надел 10 соток» (= 1000 м² участка, аспект 1.4:1 →
          примерно 40×25 м)
      В этих случаях заполняй site_*_m.

   в) Если ТЗ говорит про площадь («180-220 м²») без явного «здание»/
      «участок» — трактуй как площадь ЗАСТРОЙКИ (пятно), выбери
      аспект 1.5:1 — 2:1 → building_width_m × building_depth_m.

   КРИТИЧНО: НЕ пиши одни и те же числа в site_* И в building_* —
   выбери одно. Если юзер не уточнил тип, и используется слово
   «здание/дом/ЖК/корпус» — это building_*.

2. setback_front_m / setback_side_m / setback_rear_m:
     - Defaults for small residential: 3 m on all sides
     - «Отступы от красной линии N м, боковые M м, задний K м» —
       парсь все три значения отдельно
     - «Плотная застройка» / «без отступов» → 0
   If not stated and dimensions are < 25 m on any side — use 3 m, not 5 m
   (5 m on a 20×16 building leaves a tiny inner footprint).

3. floors: integer. Default to 4 if not stated.

4. sections: how many подъездов / секций. Default to 1 unless the brief
   says "две секции", "3 подъезда", etc.

5. Apartment mix (studio_pct / k1_pct / k2_pct / k3_pct / k4_pct) —
   percentages 0..100 summing to ~100. k4_pct — для 4-комнатных
   (премиум, комфорт+). If the brief gives counts ("4 однушки и 6
   двушек, 1 четырёхкомнатная пентхаус") — convert to percentages.
   If nothing about mix is said — leave all as null; the backend will
   use a reasonable default.

6. purpose: "residential" by default.

7. building_type — ВАЖНО, определяет всю типологию плана:
   • "single_family" — частный дом / коттедж / индивидуальное жильё.
     Маркеры: «частный дом», «коттедж», «дом для семьи», «ИЖС»,
     «загородный дом», «дача», «1-2 этажный дом», «таунхаус на одну
     семью», небольшая площадь (до ~300 м²) + ≤2-3 этажа.
     БЕЗ лифтов и БЕЗ межквартирной лестницы — это одна квартира
     на этаже.
   • "multi_family" — секционная многоквартирная застройка
     (подъезды, лифты, КВ-1, КВ-2, …). Маркеры: «жилой дом N
     этажей», «секция», «подъезд», «N лифтов», «микс квартир»,
     «многоквартирный», ≥3 этажей с микс-квартирами.
   • "commercial" — офис / ритейл / общественное здание.
   • "mixed" — mixed-use (первые этажи коммерция + верхние жильё).

   Default: если явных маркеров нет, но floors ≤2 И площадь
   ≤300 м² И в ТЗ слова «дом», «семейный», «коттедж» — это
   single_family. Иначе multi_family.

8. lifts_passenger / lifts_freight: integers. Default 1 / 0.
   Для single_family ОБЯ́ЗАТЕЛЬНО ставь 0 / 0 (в частном доме
   нет лифтов).

9. max_height_m: number in meters. Default 30.

10. bedrooms / bathrooms / has_garage — ТОЛЬКО для single_family.
    Для multi_family оставь null (типы квартир задаются через mix-проценты).
    Для single_family:
    • bedrooms: явно считай по ТЗ — «3 спальни», «две спальни», «studio
      без отдельной спальни» (=1 если есть кровать в гостиной).
      Default 2 если ничего не сказано.
    • bathrooms: «1 санузел», «2 ванные», «гостевой туалет + master bath»
      = 2. Default 1.
    • has_garage: true если упомянут гараж / гаражная зона / car port.
      false если явно сказано «без гаража». null если не упомянуто.

11. floor_typology — ТОЛЬКО для multi_family (для single_family оставь null):
    • "symmetric" — обычная двухсторонняя секционка (default).
      Маркеры: «секционный», «коридор с двух сторон», «обычная секция»,
      или просто не указано.
    • "t_shape" — Т-типология: 2 крупных квартиры наверху + 3 стандартных
      внизу. Узкое вертикальное ядро (лифт+лестница).
      Маркеры: «Т-типология», «T-форма», «5 квартир на этаж», «2 пентхауса
      сверху», «комфорт+ с двумя большими квартирами и тремя обычными»,
      «бизнес-класс асимметричная планировка».
      Если в ТЗ явно «5 квартир на этаж» И mix включает большие (2k/3k) —
      ставь t_shape.

12. NEVER guess wildly. If the brief literally says nothing about a value
    AND no reasonable derivation is possible — return null. The backend
    has its own sane defaults.

13. notes: brief 1-2 sentence summary in Russian of what you did and
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
            "building_width_m": {"type": ["number", "null"]},
            "building_depth_m": {"type": ["number", "null"]},
            "setback_front_m":  {"type": ["number", "null"]},
            "setback_side_m":   {"type": ["number", "null"]},
            "setback_rear_m":   {"type": ["number", "null"]},
            "floors":           {"type": ["integer", "null"]},
            "purpose":          {
                "type": ["string", "null"],
                "enum": ["residential", "commercial", "mixed_use", "hotel", None],
            },
            "building_type":    {
                "type": ["string", "null"],
                "enum": ["single_family", "multi_family", "commercial", "mixed", None],
            },
            "sections":         {"type": ["integer", "null"]},
            "studio_pct":       {"type": ["number", "null"]},
            "k1_pct":           {"type": ["number", "null"]},
            "k2_pct":           {"type": ["number", "null"]},
            "k3_pct":           {"type": ["number", "null"]},
            "k4_pct":           {"type": ["number", "null"]},
            "lifts_passenger":  {"type": ["integer", "null"]},
            "lifts_freight":    {"type": ["integer", "null"]},
            "max_height_m":     {"type": ["number", "null"]},
            "bedrooms":         {"type": ["integer", "null"]},
            "bathrooms":        {"type": ["integer", "null"]},
            "has_garage":       {"type": ["boolean", "null"]},
            "floor_typology":   {
                "type": ["string", "null"],
                "enum": ["symmetric", "t_shape", None],
            },
            "notes":            {"type": "string"},
        },
        "required": [
            "site_width_m", "site_depth_m",
            "building_width_m", "building_depth_m",
            "setback_front_m", "setback_side_m", "setback_rear_m",
            "floors", "purpose", "building_type", "sections",
            "studio_pct", "k1_pct", "k2_pct", "k3_pct", "k4_pct",
            "lifts_passenger", "lifts_freight", "max_height_m",
            "bedrooms", "bathrooms", "has_garage",
            "floor_typology",
            "notes",
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
        resp = client.chat.completions.create(  # type: ignore[call-overload]
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
        building_width_m=data.get("building_width_m"),
        building_depth_m=data.get("building_depth_m"),
        setback_front_m= data.get("setback_front_m"),
        setback_side_m=  data.get("setback_side_m"),
        setback_rear_m=  data.get("setback_rear_m"),
        floors=          data.get("floors"),
        purpose=         data.get("purpose"),
        building_type=   data.get("building_type"),
        sections=        data.get("sections"),
        studio_pct=      data.get("studio_pct"),
        k1_pct=          data.get("k1_pct"),
        k2_pct=          data.get("k2_pct"),
        k3_pct=          data.get("k3_pct"),
        k4_pct=          data.get("k4_pct"),
        lifts_passenger= data.get("lifts_passenger"),
        lifts_freight=   data.get("lifts_freight"),
        max_height_m=    data.get("max_height_m"),
        bedrooms=        data.get("bedrooms"),
        bathrooms=       data.get("bathrooms"),
        has_garage=      data.get("has_garage"),
        floor_typology=  data.get("floor_typology"),
        notes=           data.get("notes", ""),
    )
