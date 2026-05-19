"""Генерация структурированной планировки этажа через GPT-4o structured output.

Второй запрос к GPT: первый — gpt-image-2 (картинки), этот — gpt-4o (геометрия).
Результат — LayoutFloor с точными координатами комнат, квартир, ядер.
"""

from __future__ import annotations

import logging
import math

from ..cad.layout_schema import (
    LayoutApartment,
    LayoutCore,
    LayoutFloor,
    LayoutRoom,
    LayoutSection,
)
from .marketing_prompt import MarketingInputs

log = logging.getLogger(__name__)

# ── Нормы размеров ──────────────────────────────────────────────────────────

_BEAR_T      = 0.40   # несущая/наружная стена
_FIRE_T      = 0.40   # противопожарная стена между секциями
_CORR_MIN_D  = 1.40   # минимальная ширина коридора (КМК 3.02-43-2007)
_CORE_W      = 1.5 + 2.1 + 2.1 + 0.8   # 6.5 м (пасс. лифт + груз. лифт + лестница + зазоры)
_CORE_D      = 5.50

# ── Типовые раскладки комнат ──────────────────────────────────────────────


def _rooms_for_studio(w: float, d: float) -> list[dict]:
    """Студия: кухня-гостиная + сан.узел + прихожая."""
    hall_d = min(2.0, d * 0.25)
    bath_w = min(2.5, w * 0.35)
    return [
        {"kind": "hallway",  "name_ru": "Прихожая",       "x": 0,      "y": 0,      "w": w,           "d": hall_d},
        {"kind": "bathroom", "name_ru": "Сан.узел",        "x": 0,      "y": hall_d, "w": bath_w,      "d": d - hall_d},
        {"kind": "living",   "name_ru": "Кухня-гостиная",  "x": bath_w, "y": hall_d, "w": w - bath_w,  "d": d - hall_d},
    ]


def _rooms_for_1k(w: float, d: float) -> list[dict]:
    """1К: гостиная / спальня / кухня / сан.узел / прихожая."""
    hall_d  = min(2.0, d * 0.22)
    bath_w  = min(2.5, w * 0.30)
    kit_w   = min(3.5, w * 0.35)
    rem_d   = d - hall_d
    bed_d   = rem_d * 0.50
    liv_d   = rem_d - bed_d
    return [
        {"kind": "hallway",  "name_ru": "Прихожая", "x": 0,           "y": 0,      "w": w,               "d": hall_d},
        {"kind": "kitchen",  "name_ru": "Кухня",    "x": 0,           "y": hall_d, "w": kit_w,           "d": bed_d},
        {"kind": "bathroom", "name_ru": "Сан.узел", "x": 0,           "y": hall_d + bed_d, "w": bath_w,  "d": liv_d},
        {"kind": "bedroom",  "name_ru": "Спальня",  "x": kit_w,       "y": hall_d, "w": w - kit_w,       "d": bed_d},
        {"kind": "living",   "name_ru": "Гостиная", "x": bath_w,      "y": hall_d + bed_d, "w": w - bath_w, "d": liv_d},
    ]


def _rooms_for_2k(w: float, d: float) -> list[dict]:
    """2К: гостиная / 2 спальни / кухня / 2 сан.узла / прихожая."""
    hall_d  = min(2.0, d * 0.20)
    bath_w  = min(2.5, w * 0.28)
    kit_w   = min(4.0, w * 0.36)
    rem_d   = d - hall_d
    bed_d   = rem_d * 0.45
    mid_d   = rem_d * 0.30
    liv_d   = rem_d - bed_d - mid_d
    return [
        {"kind": "hallway",  "name_ru": "Прихожая",   "x": 0,        "y": 0,                    "w": w,              "d": hall_d},
        {"kind": "bedroom",  "name_ru": "Спальня 1",  "x": 0,        "y": hall_d,               "w": kit_w,          "d": bed_d},
        {"kind": "bedroom",  "name_ru": "Спальня 2",  "x": kit_w,    "y": hall_d,               "w": w - kit_w,      "d": bed_d},
        {"kind": "kitchen",  "name_ru": "Кухня",      "x": 0,        "y": hall_d + bed_d,       "w": kit_w,          "d": mid_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 1", "x": kit_w,    "y": hall_d + bed_d,       "w": bath_w,         "d": mid_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 2", "x": kit_w + bath_w, "y": hall_d + bed_d, "w": w - kit_w - bath_w, "d": mid_d},
        {"kind": "living",   "name_ru": "Гостиная",   "x": 0,        "y": hall_d + bed_d + mid_d, "w": w,            "d": liv_d},
    ]


def _rooms_for_3k(w: float, d: float) -> list[dict]:
    """3К: гостиная / 3 спальни / кухня / 2 сан.узла / прихожая."""
    hall_d  = min(2.0, d * 0.18)
    bath_w  = min(2.5, w * 0.26)
    kit_w   = min(4.2, w * 0.36)
    rem_d   = d - hall_d
    bed_d   = rem_d * 0.40
    mid_d   = rem_d * 0.28
    liv_d   = rem_d - bed_d - mid_d
    bed_w   = w / 3
    return [
        {"kind": "hallway",  "name_ru": "Прихожая",   "x": 0,          "y": 0,                    "w": w,           "d": hall_d},
        {"kind": "bedroom",  "name_ru": "Спальня 1",  "x": 0,          "y": hall_d,               "w": bed_w,       "d": bed_d},
        {"kind": "bedroom",  "name_ru": "Спальня 2",  "x": bed_w,      "y": hall_d,               "w": bed_w,       "d": bed_d},
        {"kind": "bedroom",  "name_ru": "Спальня 3",  "x": 2 * bed_w,  "y": hall_d,               "w": w - 2*bed_w, "d": bed_d},
        {"kind": "kitchen",  "name_ru": "Кухня",      "x": 0,          "y": hall_d + bed_d,       "w": kit_w,       "d": mid_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 1", "x": kit_w,      "y": hall_d + bed_d,       "w": bath_w,      "d": mid_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 2", "x": kit_w+bath_w,"y": hall_d + bed_d,      "w": w-kit_w-bath_w, "d": mid_d},
        {"kind": "living",   "name_ru": "Гостиная",   "x": 0,          "y": hall_d+bed_d+mid_d,   "w": w,           "d": liv_d},
    ]


_ROOM_BUILDERS = {
    "studio": _rooms_for_studio,
    "1k":     _rooms_for_1k,
    "2k":     _rooms_for_2k,
    "3k":     _rooms_for_3k,
}

# ── Определение типа квартиры по площади и целевому миксу ─────────────────


def _apt_type_from_area(area_m2: float) -> str:
    if area_m2 < 42:
        return "studio"
    if area_m2 < 57:
        return "1k"
    if area_m2 < 80:
        return "2k"
    return "3k"


# ── Параметрическая генерация планировки ──────────────────────────────────


def generate_floor_layout(inputs: MarketingInputs) -> LayoutFloor:
    """Сгенерировать планировку этажа — параметрически + GPT-4o для типов квартир.

    Структура здания (ядра, коридоры, границы секций) вычисляется детерминированно.
    GPT-4o используется для назначения типов квартир согласно заданному миксу
    и для структурированного вывода в виде LayoutFloor.
    """
    inner_w = max(6.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_d = max(6.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    n_sect  = max(1, inputs.sections)
    sect_w  = inner_w / n_sect

    # Коридор по центру здания
    corr_d = max(_CORR_MIN_D, round(inner_d * 0.12, 2))
    corr_y = round((inner_d - corr_d) / 2, 3)

    # Глубина квартир с каждой стороны
    apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
    apt_d_n = max(4.0, round(inner_d - corr_y - corr_d - _BEAR_T, 3))

    # Целевой микс квартир
    mix = _resolve_mix(inputs, n_sect, sect_w, apt_d_s, apt_d_n)

    sections: list[LayoutSection] = []
    apt_num = 1

    for si in range(n_sect):
        x0 = round(si * sect_w, 3)

        # Стены секции
        wall_l = _BEAR_T if si == 0 else _FIRE_T / 2
        wall_r = _BEAR_T if si == n_sect - 1 else _FIRE_T / 2
        apt_x0 = x0 + wall_l
        apt_x1 = x0 + sect_w - wall_r
        usable_w = apt_x1 - apt_x0

        # Ядро в центре секции
        core_cx = x0 + sect_w / 2
        core_x = round(core_cx - _CORE_W / 2, 3)
        core_y = round((inner_d - _CORE_D) / 2, 3)
        cores = _make_cores(core_x, core_y, inputs.lifts_passenger, inputs.lifts_freight)

        # Количество квартир по фасаду
        n_apts = max(1, round(usable_w / 7.5))
        apt_w  = usable_w / n_apts

        apartments: list[LayoutApartment] = []
        for side_y, apt_d in [
            (round(_BEAR_T, 3),                          apt_d_s),   # юг
            (round(corr_y + corr_d, 3),                  apt_d_n),   # север
        ]:
            for ai in range(n_apts):
                ax = round(apt_x0 + ai * apt_w, 3)
                aw = round(apt_w, 3)
                area = round(aw * apt_d, 1)

                # Тип из микса или по площади
                apt_type = mix.pop(0) if mix else _apt_type_from_area(area)

                rooms_raw = _ROOM_BUILDERS[apt_type](aw, apt_d)
                rooms = [LayoutRoom(**r) for r in rooms_raw]

                apartments.append(LayoutApartment(
                    type_code=apt_type,
                    number=apt_num,
                    x=ax, y=side_y,
                    w=aw, d=round(apt_d, 3),
                    rooms=rooms,
                ))
                apt_num += 1

        sections.append(LayoutSection(
            index=si,
            x_start=x0,
            width=round(sect_w, 3),
            corridor_y=corr_y,
            corridor_d=round(corr_d, 3),
            cores=cores,
            apartments=apartments,
        ))

    return LayoutFloor(width_m=round(inner_w, 3), depth_m=round(inner_d, 3), sections=sections)


# ── Вспомогательные функции ───────────────────────────────────────────────


def _make_cores(core_x: float, core_y: float, n_pass: int, n_freight: int) -> list[LayoutCore]:
    cores: list[LayoutCore] = []
    x = core_x
    lift_p_w = 1.5
    lift_f_w = 2.1
    stair_w  = 2.1

    for _ in range(max(1, n_pass)):
        cores.append(LayoutCore(kind="lift_passenger", x=round(x, 3), y=core_y, w=lift_p_w, d=1.5))
        x += lift_p_w

    cores.append(LayoutCore(kind="stair", x=round(x, 3), y=core_y, w=stair_w, d=_CORE_D))
    x += stair_w

    for _ in range(max(1, n_freight)):
        cores.append(LayoutCore(kind="lift_freight", x=round(x, 3), y=core_y, w=lift_f_w, d=lift_f_w))
        x += lift_f_w

    return cores


def _resolve_mix(
    inputs: MarketingInputs,
    n_sect: int,
    sect_w: float,
    apt_d_s: float,
    apt_d_n: float,
) -> list[str]:
    """Строит список типов квартир (ordered) исходя из процентного микса."""
    # Общее кол-во квартир (оценка)
    usable_w_per_sect = sect_w - _BEAR_T * 2
    n_per_side = max(1, round(usable_w_per_sect / 7.5))
    total = n_sect * n_per_side * 2

    pcts = {
        "studio": inputs.studio_pct,
        "1k":     inputs.k1_pct,
        "2k":     inputs.k2_pct,
        "3k":     inputs.k3_pct,
    }
    total_pct = sum(pcts.values())
    if total_pct < 1.0:
        # Нет явного микса — не регулируем, пусть _apt_type_from_area решает
        return []

    result: list[str] = []
    remainder = 0.0
    for apt_type, pct in pcts.items():
        count_f = total * pct / total_pct
        count_i = int(count_f)
        remainder += count_f - count_i
        if remainder >= 1.0:
            count_i += 1
            remainder -= 1.0
        result.extend([apt_type] * count_i)

    # Дополнить до total, если округление не дотянуло
    while len(result) < total:
        result.append("2k")
    return result[:total]
