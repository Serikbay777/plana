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
    LayoutDoor,
    LayoutFloor,
    LayoutRoom,
    LayoutSection,
    LayoutWindow,
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


# Минимальная глубина для двухсторонней секции:
# юг 4 + коридор 1.4 + север 4 + 2 несущие стены 0.8 ≈ 10.2.
# С запасом на нормальные квартиры берём 12 м как переход в галерейный режим.
_GALLERY_THRESHOLD_M = 12.0


def generate_floor_layout(inputs: MarketingInputs) -> LayoutFloor:
    """Сгенерировать планировку этажа — параметрически + GPT-4o для типов квартир.

    Структура здания (ядра, коридоры, границы секций) вычисляется детерминированно.
    GPT-4o используется для назначения типов квартир согласно заданному миксу
    и для структурированного вывода в виде LayoutFloor.

    Два режима:
      • секционный (depth ≥ 12 м) — квартиры с двух сторон коридора по центру
      • галерейный (depth < 12 м) — коридор у северной стены, квартиры только
        с южной стороны (лучшая инсоляция). Используется для общежитий,
        апарт-отелей, узких корпусов социального жилья.
    """
    inner_w = max(6.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_d = max(6.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)
    n_sect  = max(1, inputs.sections)
    sect_w  = inner_w / n_sect

    gallery_mode = inner_d < _GALLERY_THRESHOLD_M

    if gallery_mode:
        # Коридор у северной стены, квартиры с юга
        corr_d = max(_CORR_MIN_D, 1.4)
        corr_y = round(inner_d - corr_d - _BEAR_T, 3)
        apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
        apt_d_n = 0.0   # квартир с севера нет
    else:
        # Двухсторонняя секция: коридор по центру
        corr_d = max(_CORR_MIN_D, round(inner_d * 0.12, 2))
        corr_y = round((inner_d - corr_d) / 2, 3)
        apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
        apt_d_n = max(4.0, round(inner_d - corr_y - corr_d - _BEAR_T, 3))

    # Целевой микс квартир
    mix = _resolve_mix(inputs, n_sect, sect_w, apt_d_s, apt_d_n, sides=1 if gallery_mode else 2)

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

        # Ядро в секции. В галерейном — у северной стены, прислонено к коридору.
        # В секционном — по центру.
        core_cx = x0 + sect_w / 2
        core_x = round(core_cx - _CORE_W / 2, 3)
        if gallery_mode:
            core_d = min(_CORE_D, corr_y)
            core_y = round(corr_y - core_d, 3)
        else:
            core_d = _CORE_D
            core_y = round((inner_d - core_d) / 2, 3)
        cores = _make_cores(core_x, core_y, inputs.lifts_passenger, inputs.lifts_freight, core_d=core_d)

        # Количество квартир по фасаду
        n_apts = max(1, round(usable_w / 7.5))
        apt_w  = usable_w / n_apts

        # Какие стороны застраиваем
        if gallery_mode:
            apt_sides: list[tuple[float, float]] = [
                (round(_BEAR_T, 3), apt_d_s),   # только юг
            ]
        else:
            apt_sides = [
                (round(_BEAR_T, 3),         apt_d_s),   # юг
                (round(corr_y + corr_d, 3), apt_d_n),   # север
            ]

        apartments: list[LayoutApartment] = []
        for side_y, apt_d in apt_sides:
            for ai in range(n_apts):
                ax = round(apt_x0 + ai * apt_w, 3)
                aw = round(apt_w, 3)
                area = round(aw * apt_d, 1)

                # Тип из микса или по площади
                apt_type = mix.pop(0) if mix else _apt_type_from_area(area)

                rooms_raw = _ROOM_BUILDERS[apt_type](aw, apt_d)
                rooms = [LayoutRoom(**r) for r in rooms_raw]

                # Где у этой квартиры фасадная (наружная) и где внутренняя
                # (к коридору) стена. В двухсторонней секции:
                #   южная квартира → фасад S, коридор N
                #   северная квартира → фасад N, коридор S
                # В галерейном — квартиры только с юга, коридор N.
                exterior_side: str = "S" if side_y < corr_y else "N"
                interior_side: str = "N" if side_y < corr_y else "S"
                _add_apertures(rooms, apt_d, exterior_side, interior_side)

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


# ── Двери и окна ───────────────────────────────────────────────────────────


_WINDOW_KINDS: frozenset[str] = frozenset({"living", "bedroom", "kitchen"})
"""Какие типы комнат получают окна на фасадной стене."""

_DOOR_NEEDED_KINDS: frozenset[str] = frozenset({
    "living", "bedroom", "kitchen", "bathroom", "toilet", "hallway",
})
"""Какие комнаты должны иметь хотя бы одну дверь (для попадания внутрь)."""


def _add_apertures(
    rooms: list[LayoutRoom],
    apt_d: float,
    exterior_side: str,   # "S" — низ Y, "N" — верх Y
    interior_side: str,   # противоположная exterior_side
) -> None:
    """Расставить окна и двери для всех комнат квартиры in-place.

    Простейшая (но визуально читаемая) логика:
      • Окно — на стороне комнаты, совпадающей с фасадом квартиры,
        если эта сторона физически касается фасадной кромки квартиры.
        Только для жилых комнат и кухни (не для сан.узлов и кладовых).
      • Дверь — каждой комнате, кроме коридорно-прихожей.
        Если комната касается прихожей по стороне — дверь там.
        Иначе — дверь со стороны interior_side (к коридору) или произвольно
        к ближайшей соседней комнате.
      • Прихожая получает входную дверь на стороне квартиры, обращённой
        к коридору (interior_side).
    """
    # Найдём прихожую (для определения куда вешать двери комнат)
    hallway = next((r for r in rooms if r.kind == "hallway"), None)

    for room in rooms:
        # ── Окна ─────────────────────────────────────────────────────
        if room.kind in _WINDOW_KINDS:
            window = _make_window_on_facade(room, apt_d, exterior_side)
            if window is not None:
                room.windows.append(window)

        # ── Двери ────────────────────────────────────────────────────
        if room.kind == "hallway":
            # Входная дверь квартиры — на стороне коридора
            entrance = _make_entrance_door(room, apt_d, interior_side)
            if entrance is not None:
                room.doors.append(entrance)
        elif room.kind in _DOOR_NEEDED_KINDS:
            # Дверь в эту комнату — пытаемся со стороны прихожей,
            # иначе со стороны interior_side.
            door = _make_internal_door(room, hallway, apt_d, interior_side)
            if door is not None:
                room.doors.append(door)


def _make_window_on_facade(
    room: LayoutRoom, apt_d: float, exterior_side: str,
) -> LayoutWindow | None:
    """Окно на фасадной стене комнаты, если она физически касается фасада."""
    if exterior_side == "S":
        # Южная стена квартиры — y = 0. Комната касается её, если room.y ≈ 0.
        if room.y > 0.01:
            return None
        side = "S"
        stretch = room.w
    elif exterior_side == "N":
        if abs(room.y + room.d - apt_d) > 0.01:
            return None
        side = "N"
        stretch = room.w
    else:
        return None

    # Ширина окна — пропорционально стене, но не больше 2 м, не меньше 0.9 м
    width = min(2.0, max(0.9, stretch * 0.55))
    offset = (stretch - width) / 2
    return LayoutWindow(side=side, offset=round(offset, 3), width=round(width, 3))


def _make_entrance_door(
    room: LayoutRoom, apt_d: float, interior_side: str,
) -> LayoutDoor | None:
    """Входная дверь квартиры — из прихожей на коридор."""
    if interior_side == "S":
        if room.y > 0.01:
            return None
        stretch = room.w
    elif interior_side == "N":
        if abs(room.y + room.d - apt_d) > 0.01:
            return None
        stretch = room.w
    else:
        return None

    width = 0.9
    offset = (stretch - width) / 2
    return LayoutDoor(
        side=interior_side,  # type: ignore[arg-type]
        offset=round(offset, 3),
        width=width,
        swing="in",
        hinge="left",
    )


def _make_internal_door(
    room: LayoutRoom,
    hallway: LayoutRoom | None,
    apt_d: float,
    interior_side: str,
) -> LayoutDoor | None:
    """Дверь во внутреннюю комнату.

    Эвристика:
      1. Если комната смежна с прихожей по какой-то стене — дверь там.
      2. Иначе — на стороне комнаты, обращённой к interior_side
         (т.е. в глубь квартиры).
      3. Если ничего не подходит — выбираем самую длинную стену.
    """
    # 1. Смежна ли с прихожей?
    if hallway is not None:
        adj_side = _adjacent_side(room, hallway)
        if adj_side is not None:
            return _door_centered(room, adj_side, swing="in")

    # 2. interior_side, если комната не у фасада
    if interior_side == "S" and abs(room.y) > 0.01:
        return _door_centered(room, "S", swing="in")
    if interior_side == "N" and abs(room.y + room.d - apt_d) > 0.01:
        return _door_centered(room, "N", swing="in")

    # 3. На самую длинную стену
    if room.w >= room.d:
        return _door_centered(room, interior_side if interior_side in ("S", "N") else "S", swing="in")
    return _door_centered(room, "W", swing="in")


def _adjacent_side(room: LayoutRoom, other: LayoutRoom, tol: float = 0.05) -> str | None:
    """Какой стороной room касается other (если касается)."""
    # other.y_top == room.y (other южнее room) → дверь на S-стене room
    if abs(room.y - (other.y + other.d)) < tol:
        return "S"
    # other.y == room.y + room.d (other севернее) → N-стена
    if abs((room.y + room.d) - other.y) < tol:
        return "N"
    # other.x + other.w == room.x → W-стена
    if abs(room.x - (other.x + other.w)) < tol:
        return "W"
    if abs((room.x + room.w) - other.x) < tol:
        return "E"
    return None


def _door_centered(
    room: LayoutRoom, side: str, *, swing: str = "in",
) -> LayoutDoor:
    """Дверь по центру указанной стены комнаты."""
    width = 0.8 if room.kind in ("bathroom", "toilet") else 0.9
    stretch = room.w if side in ("S", "N") else room.d
    offset = max(0.1, (stretch - width) / 2)
    return LayoutDoor(
        side=side,                         # type: ignore[arg-type]
        offset=round(offset, 3),
        width=width,
        swing=swing,                       # type: ignore[arg-type]
        hinge="left",
    )


# ── Вспомогательные функции ───────────────────────────────────────────────


def _make_cores(
    core_x: float, core_y: float,
    n_pass: int, n_freight: int,
    *,
    core_d: float = _CORE_D,
) -> list[LayoutCore]:
    cores: list[LayoutCore] = []
    x = core_x
    lift_p_w = 1.5
    lift_f_w = 2.1
    stair_w  = 2.1
    lift_d = min(1.5, core_d)
    freight_d = min(lift_f_w, core_d)

    for _ in range(max(1, n_pass)):
        cores.append(LayoutCore(kind="lift_passenger", x=round(x, 3), y=core_y, w=lift_p_w, d=lift_d))
        x += lift_p_w

    cores.append(LayoutCore(kind="stair", x=round(x, 3), y=core_y, w=stair_w, d=core_d))
    x += stair_w

    for _ in range(max(1, n_freight)):
        cores.append(LayoutCore(kind="lift_freight", x=round(x, 3), y=core_y, w=lift_f_w, d=freight_d))
        x += lift_f_w

    return cores


def _resolve_mix(
    inputs: MarketingInputs,
    n_sect: int,
    sect_w: float,
    apt_d_s: float,
    apt_d_n: float,
    *,
    sides: int = 2,
) -> list[str]:
    """Строит список типов квартир (ordered) исходя из процентного микса.

    ``sides`` = 2 для секционного, 1 для галерейного типа.
    apt_d_s / apt_d_n зарезервированы для будущей логики «крупные квартиры
    идут на более глубокую сторону» — сейчас неиспользуются, но сигнатура
    сохранена для обратной совместимости.
    """
    del apt_d_s, apt_d_n   # currently unused — reserved for future weighting

    # Общее кол-во квартир (оценка)
    usable_w_per_sect = sect_w - _BEAR_T * 2
    n_per_side = max(1, round(usable_w_per_sect / 7.5))
    total = n_sect * n_per_side * max(1, sides)

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
