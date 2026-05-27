"""Генерация структурированной планировки этажа через GPT-4o structured output.

Второй запрос к GPT: первый — gpt-image-2 (картинки), этот — gpt-4o (геометрия).
Результат — LayoutFloor с точными координатами комнат, квартир, ядер.
"""

from __future__ import annotations

import logging

from ..cad.layout_schema import (
    LayoutApartment,
    LayoutCore,
    LayoutDoor,
    LayoutFloor,
    LayoutFurniture,
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
# Ядро компактное (раньше было 6.5×5.5 — вылазило за corridor и накладывалось
# на квартиры). Теперь лифт + лестница + опц. грузовой ≈ 6.5×3.0, помещаются
# внутри расширенного corridor (лифтового холла).
_CORE_W      = 1.8 + 2.1 + 2.5 + 0.5   # ~6.9 м (пасс. лифт + груз. лифт + лестница + зазоры)
_CORE_D      = 3.00

# Целевая и минимальная ширина квартиры по типу (м) — реалистичные для МКД РК.
# Раньше все квартиры были одной ширины (~7.5 м), независимо от типа — давало
# 8 одинаковых квартир на 30-метровом фасаде, что нереалистично для 2к/3к.
# Теперь упаковываем mix переменной ширины: студии узкие, трёшки широкие.
#
# Текущие значения соответствуют классу «комфорт» (60–75 м² на квартиру).
# TODO: вынести в параметр building_class={econom|comfort|business|premium} —
# для эконома уменьшить (5/7/10/12), для премиума увеличить (10/13/16/20).
_TARGET_APT_W = {"studio": 7.0, "1k":  9.0,  "2k": 12.0, "3k": 15.0, "4k": 18.0}
_MIN_APT_W    = {"studio": 5.5, "1k":  7.0,  "2k": 10.0, "3k": 12.0, "4k": 15.0}

# ── Asymmetric depth: юг глубже севера ───────────────────────────────────
# Применяется в широтных секциях (длинная ось E-W): юг получает крупные
# форматы (2к/3к/4к) с большой глубиной, север — компактные (студии/1к).
# Ratio собран из обмеров реальных ЖК (ПИК-1: 1.33, ПИК-2: 1.60,
# Самолёт типовая: 1.36, Highvill Park: 1.55, BI Family Nest: 1.40).
_ASYM_RATIO_DEFAULT = 1.50
# Min N: студия 22-25 м² шириной 4.8-5 м × глубиной 4.8 проходит (СП 54 п. 5.11).
_ASYM_N_MIN = 4.8
_ASYM_N_MAX = 6.0
_ASYM_S_MIN = 6.5
# Max S = 9 м: глубже падает КЕО в дальнем углу комнаты ниже 0.5%
# (СП 23-102-2003 п. 5.3: глубина/высота окна ≤ 2.5).
_ASYM_S_MAX = 9.0

# ── Double-core: длинная секция с двумя ядрами ───────────────────────────
# Применяется когда длина секции > 42 м (СП 1.13130 табл. 3 — максимум
# 40 м между лестничными клетками для I-II степени огнестойкости С0,
# плюс 2 м запас) или общая площадь квартир этажа > 500 м² (СП 1.13130
# п. 6.1.1). Ядра позиционируются на 0.22L и 0.78L — от каждого торца
# не более 25 м тупикового коридора, между ядрами — не более 40 м.
_DOUBLE_CORE_MIN_W = 42.0
_DOUBLE_CORE_MAX_W = 80.0   # больше → нужно 3-е ядро или ПП-стена
_DOUBLE_CORE_X1_RATIO = 0.22
_DOUBLE_CORE_X2_RATIO = 0.78
_DOUBLE_CORE_CORR_W = 1.6   # для длин > 40 м (СП 54.13330 п. 4.7)

# ── Tower: 4 квартиры вокруг центрального ядра ────────────────────────────
# 4-квартирный «квадрат 2×2» для премиум/бизнес ЖК. Ядро в центре пятна
# (расширенное — 7.5×7.5: 2 пасс. лифта + 1 груз. + лестница H2 + холл).
# Каждая квартира — угловая, окна на 2 фасада. Используется на стеснённых
# участках, в высотных премиум-проектах (Esentai, Highvill F, Mercury City).
# Рекомендуемый диапазон по обмерам реальных башен: W,D ∈ [22, 34] м.
_TOWER_W_MIN = 22.0
_TOWER_D_MIN = 22.0
_TOWER_CORE_W = 7.5
_TOWER_CORE_D = 7.5

# ── Core-shifted: ядро смещено к торцу ───────────────────────────────────
# Авторская/премиум-типология. Ядро смещено на 0.25–0.35 от центра, что даёт
# на «длинной» стороне 1 крупную квартиру (3к/4к/пентхаус) с угловыми окнами,
# а на «короткой» — 1-2 малые (1к/2к). Точные публичные цифры застройщики
# не публикуют; диапазон выведен из планировок премиум-проектов (Меганом,
# Скуратов, Highvill, BAZIS-A PRIMAVERA, ФСК «Архитектор», Садовые кварталы)
# и нормы 12 м тупикового коридора по СП 1.13130.
_CORE_SHIFTED_OFFSET = 0.30          # default; range 0.25–0.35
_CORE_SHIFTED_W_MIN = 22.0
_CORE_SHIFTED_W_MAX = 32.0

# ── Типовые раскладки комнат ──────────────────────────────────────────────


def _rooms_for_studio(w: float, d: float) -> list[dict]:
    """Студия: Кухня-гостиная у фасада (y=0), прихожая+санузел у коридора.

    Жилые комнаты у фасадной кромки (y=0) → получают окна автоматически.
    """
    hall_d = min(2.0, d * 0.25)
    bath_w = min(2.5, w * 0.35)
    living_d = d - hall_d
    return [
        # Фасадный ряд (y=0): кухня-гостиная во всю ширину
        {"kind": "living",   "name_ru": "Кухня-гостиная", "x": 0,      "y": 0,        "w": w,          "d": living_d},
        # Тыльный ряд (к коридору): прихожая + санузел
        {"kind": "hallway",  "name_ru": "Прихожая",      "x": 0,      "y": living_d, "w": w - bath_w, "d": hall_d},
        {"kind": "bathroom", "name_ru": "Сан.узел",       "x": w - bath_w, "y": living_d, "w": bath_w, "d": hall_d},
    ]


def _rooms_for_1k(w: float, d: float) -> list[dict]:
    """1К: Спальня + Гостиная-кухня у фасада, Прихожая+Санузел у коридора."""
    hall_d  = min(2.0, d * 0.30)
    bath_w  = min(2.5, w * 0.30)
    living_d = d - hall_d
    bed_w   = max(2.5, w * 0.42)
    liv_w   = w - bed_w
    return [
        # Фасадный ряд: спальня | гостиная-кухня
        {"kind": "bedroom",  "name_ru": "Спальня",      "x": 0,         "y": 0,        "w": bed_w, "d": living_d},
        {"kind": "living",   "name_ru": "Гостиная-кухня","x": bed_w,    "y": 0,        "w": liv_w, "d": living_d},
        # Тыльный ряд: прихожая | санузел
        {"kind": "hallway",  "name_ru": "Прихожая",     "x": 0,         "y": living_d, "w": w - bath_w, "d": hall_d},
        {"kind": "bathroom", "name_ru": "Сан.узел",     "x": w - bath_w,"y": living_d, "w": bath_w,     "d": hall_d},
    ]


def _rooms_for_2k(w: float, d: float) -> list[dict]:
    """2К: Спальня + Гостиная + Кухня у фасада, остальное у коридора."""
    hall_d  = min(2.0, d * 0.28)
    bath_w  = min(2.0, w * 0.20)
    living_d = d - hall_d
    # Фасадный ряд из трёх комнат: спальня (35%), гостиная (35%), кухня (30%)
    bed_w   = max(2.5, w * 0.36)
    liv_w   = max(2.5, w * 0.34)
    kit_w   = w - bed_w - liv_w
    return [
        # Фасадный ряд: спальня | гостиная | кухня
        {"kind": "bedroom",  "name_ru": "Спальня",   "x": 0,                 "y": 0,        "w": bed_w, "d": living_d},
        {"kind": "living",   "name_ru": "Гостиная",  "x": bed_w,             "y": 0,        "w": liv_w, "d": living_d},
        {"kind": "kitchen",  "name_ru": "Кухня",     "x": bed_w + liv_w,     "y": 0,        "w": kit_w, "d": living_d},
        # Тыльный ряд: прихожая | 2 санузла
        {"kind": "hallway",  "name_ru": "Прихожая",  "x": 0,                 "y": living_d, "w": w - 2 * bath_w, "d": hall_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 1","x": w - 2 * bath_w,    "y": living_d, "w": bath_w,          "d": hall_d},
        {"kind": "bathroom", "name_ru": "Сан.узел 2","x": w - bath_w,        "y": living_d, "w": bath_w,          "d": hall_d},
    ]


def _rooms_for_3k(w: float, d: float) -> list[dict]:
    """3К по СНиП РК — 3 жилых: 2 спальни + гостиная + кухня + раздельные
    ванная и туалет + кладовая + прихожая.

    По табл. 1 СНиП РК 3.02-43-2007 для III класса 3К: ≥2 санузла,
    обязательны отдельная ванная и туалет.
    """
    hall_d  = min(2.0, d * 0.26)
    bath_w    = min(1.7, max(1.5, w * 0.13))   # ванная (≥1.5м ширина)
    toilet_w  = min(1.2, max(0.9, w * 0.08))   # туалет (≥0.8м)
    storage_w = min(1.5, max(1.0, w * 0.09))   # кладовая (≥1.0м² для 3К-4К)
    living_d = d - hall_d
    # 4 комнаты у фасада: спальня1 | спальня2 | гостиная | кухня
    bed1_w  = max(2.5, w * 0.22)
    bed2_w  = max(2.5, w * 0.20)
    kit_w   = max(2.5, w * 0.20)
    liv_w   = w - bed1_w - bed2_w - kit_w
    # Тыльный ряд: прихожая | кладовая | ванная | туалет
    back_total = storage_w + bath_w + toilet_w
    hallway_w = w - back_total
    return [
        # Фасадный ряд — 2 спальни + гостиная + кухня
        {"kind": "bedroom",  "name_ru": "Спальня 1", "x": 0,                              "y": 0,        "w": bed1_w, "d": living_d},
        {"kind": "bedroom",  "name_ru": "Спальня 2", "x": bed1_w,                         "y": 0,        "w": bed2_w, "d": living_d},
        {"kind": "living",   "name_ru": "Гостиная",  "x": bed1_w + bed2_w,                "y": 0,        "w": liv_w,  "d": living_d},
        {"kind": "kitchen",  "name_ru": "Кухня",     "x": bed1_w + bed2_w + liv_w,        "y": 0,        "w": kit_w,  "d": living_d},
        # Тыльный ряд: прихожая + кладовая + ванная + туалет
        {"kind": "hallway",  "name_ru": "Прихожая",  "x": 0,                              "y": living_d, "w": hallway_w, "d": hall_d},
        {"kind": "storage",  "name_ru": "Кладовая",  "x": hallway_w,                      "y": living_d, "w": storage_w, "d": hall_d},
        {"kind": "bathroom", "name_ru": "Ванная",    "x": hallway_w + storage_w,          "y": living_d, "w": bath_w,    "d": hall_d},
        {"kind": "toilet",   "name_ru": "Туалет",    "x": hallway_w + storage_w + bath_w, "y": living_d, "w": toilet_w,  "d": hall_d},
    ]


def _rooms_for_4k(w: float, d: float) -> list[dict]:
    """4К по СНиП РК — 4 жилых: 3 спальни + гостиная + кухня + раздельные
    ванная и туалет + гардероб + кладовая + прихожая.

    Целевая площадь 85-110 м² (комфорт+/бизнес).
    """
    hall_d  = min(2.0, d * 0.26)
    bath_w     = min(1.8, max(1.5, w * 0.10))
    toilet_w   = min(1.2, max(0.9, w * 0.06))
    wardrobe_w = min(2.0, max(1.4, w * 0.10))
    storage_w  = min(1.5, max(1.0, w * 0.07))
    living_d = d - hall_d
    # 5 комнат у фасада: спальня1 | спальня2 | спальня3 | гостиная | кухня
    bed1_w  = max(2.5, w * 0.16)
    bed2_w  = max(2.5, w * 0.14)
    bed3_w  = max(2.5, w * 0.14)
    kit_w   = max(2.5, w * 0.15)
    liv_w   = w - bed1_w - bed2_w - bed3_w - kit_w
    # Тыльный ряд: прихожая | гардероб | кладовая | ванная | туалет
    back_total = wardrobe_w + storage_w + bath_w + toilet_w
    hallway_w = w - back_total
    return [
        # Фасадный ряд — 3 спальни + гостиная + кухня
        {"kind": "bedroom",  "name_ru": "Спальня 1", "x": 0,                                          "y": 0, "w": bed1_w, "d": living_d},
        {"kind": "bedroom",  "name_ru": "Спальня 2", "x": bed1_w,                                     "y": 0, "w": bed2_w, "d": living_d},
        {"kind": "bedroom",  "name_ru": "Спальня 3", "x": bed1_w + bed2_w,                            "y": 0, "w": bed3_w, "d": living_d},
        {"kind": "living",   "name_ru": "Гостиная",  "x": bed1_w + bed2_w + bed3_w,                   "y": 0, "w": liv_w,  "d": living_d},
        {"kind": "kitchen",  "name_ru": "Кухня",     "x": bed1_w + bed2_w + bed3_w + liv_w,           "y": 0, "w": kit_w,  "d": living_d},
        # Тыльный ряд
        {"kind": "hallway",  "name_ru": "Прихожая",  "x": 0,                                                "y": living_d, "w": hallway_w,  "d": hall_d},
        {"kind": "wardrobe", "name_ru": "Гардероб",  "x": hallway_w,                                        "y": living_d, "w": wardrobe_w, "d": hall_d},
        {"kind": "storage",  "name_ru": "Кладовая",  "x": hallway_w + wardrobe_w,                           "y": living_d, "w": storage_w,  "d": hall_d},
        {"kind": "bathroom", "name_ru": "Ванная",    "x": hallway_w + wardrobe_w + storage_w,               "y": living_d, "w": bath_w,     "d": hall_d},
        {"kind": "toilet",   "name_ru": "Туалет",    "x": hallway_w + wardrobe_w + storage_w + bath_w,      "y": living_d, "w": toilet_w,   "d": hall_d},
    ]


_ROOM_BUILDERS = {
    "studio": _rooms_for_studio,
    "1k":     _rooms_for_1k,
    "2k":     _rooms_for_2k,
    "3k":     _rooms_for_3k,
    "4k":     _rooms_for_4k,
}


def _pack_side(usable_w: float, mix_remaining: list[str]) -> list[tuple[str, float]]:
    """Greedy-упаковка квартир переменной ширины на одну сторону секции.

    Берёт типы из mix_remaining по порядку, пытается уложить target widths.
    Если влезает не весь target_total — fallback на min widths.
    После укладки растягивает оставшийся слабак равномерно между квартирами,
    чтобы заполнить usable_w без зазоров.

    Возвращает [(apt_type, apt_width), ...] для одной стороны.
    """
    if not mix_remaining or usable_w <= 0:
        return []

    # ── Шаг 1: жадно укладываем по target widths ──
    packing: list[tuple[str, float]] = []
    used_w = 0.0
    for apt_type in mix_remaining:
        target = _TARGET_APT_W.get(apt_type, 9.0)
        if used_w + target <= usable_w + 0.3:
            packing.append((apt_type, target))
            used_w += target
        else:
            break

    # ── Шаг 2: если ничего не влезло с target — пробуем с min ──
    if not packing:
        for apt_type in mix_remaining:
            mn = _MIN_APT_W.get(apt_type, 7.0)
            if used_w + mn <= usable_w + 0.3:
                packing.append((apt_type, mn))
                used_w += mn
            else:
                break

    # ── Шаг 3: добавить ещё одну квартиру с min, если есть запас ≥ min ──
    next_idx = len(packing)
    while next_idx < len(mix_remaining):
        candidate = mix_remaining[next_idx]
        mn = _MIN_APT_W.get(candidate, 7.0)
        if used_w + mn <= usable_w + 0.3:
            packing.append((candidate, mn))
            used_w += mn
            next_idx += 1
        else:
            break

    if not packing:
        return []

    # ── Шаг 4: растянуть равномерно, чтобы заполнить весь usable_w ──
    slack = usable_w - used_w
    if slack > 0.05:
        each = slack / len(packing)
        packing = [(t, w + each) for t, w in packing]

    return packing


# ── Single-family раскладки (частный дом / коттедж) ──────────────────────


def _rooms_for_single_family_house(
    w: float, d: float,
    *,
    n_bedrooms: int = 2,
    n_bathrooms: int | None = None,
    has_garage: bool = False,
) -> list[dict]:
    """Раскладка частного дома.

    Архитектурный паттерн (важно для читаемого 2D-плана):
      ┌──────────┬─────────────────────────────────────────────────┐
      │          │  Гостиная           │  Кухня (+ Столовая)       │
      │  Гараж   │  (дневная зона у фасада, окна на юг)            │
      │  (опц.)  ├─────────────────────────────────────────────────┤
      │          │  Прихожая / коридор                             │
      │          ├─────────────────────────────────────────────────┤
      │          │ Спальня 1 │ Спальня 2 │ ... │ Сан.узел 1 │ ...  │
      │          │  (ночная зона в глубине, окна на север)         │
      └──────────┴─────────────────────────────────────────────────┘

    Координаты в системе квартиры: y=0 = фасад (юг), y=d = тыл (север).
    Гараж как отдельный блок слева (x=0), занимает ~30% ширины.

    n_bathrooms: если None — выводим по числу спален (1 спальня → 1 ванная,
    2 → 1, 3 → 2, 4+ → 2).
    """
    if n_bathrooms is None:
        n_bathrooms = 1 if n_bedrooms <= 2 else 2

    # Гараж — отдельный блок слева, если он есть и дом достаточно широкий
    garage_w = 0.0
    if has_garage and w >= 11.0:
        garage_w = min(6.5, max(3.5, w * 0.30))   # 30% ширины, в пределах 3.5..6.5 м

    house_w = w - garage_w

    # Глубина: 3 ленты — дневная (у фасада) / коридор / ночная (в глубине)
    hall_d  = min(1.8, max(1.2, d * 0.14))         # коридор-прихожая
    front_d = (d - hall_d) * 0.52                  # дневная зона
    back_d  = d - hall_d - front_d                 # ночная зона

    rooms: list[dict] = []

    # ── Гараж ─────────────────────────────────────────────────────────
    if garage_w > 0:
        rooms.append({
            "kind": "garage", "name_ru": "Гараж",
            "x": 0.0, "y": 0.0, "w": garage_w, "d": d,
        })

    house_x0 = garage_w

    # ── Дневная зона (y=0, фасад): Гостиная + Кухня ──────────────────
    living_w  = house_w * 0.55
    kitchen_w = house_w - living_w
    rooms.append({
        "kind": "living", "name_ru": "Гостиная",
        "x": house_x0, "y": 0.0, "w": living_w, "d": front_d,
    })
    rooms.append({
        "kind": "kitchen", "name_ru": "Кухня",
        "x": house_x0 + living_w, "y": 0.0, "w": kitchen_w, "d": front_d,
    })

    # ── Прихожая / коридор (между дневной и ночной) ──────────────────
    rooms.append({
        "kind": "hallway", "name_ru": "Прихожая",
        "x": house_x0, "y": front_d, "w": house_w, "d": hall_d,
    })

    # ── Ночная зона (y=front_d+hall_d, в глубине): Спальни + санузлы ──
    back_y = front_d + hall_d
    bath_w_each = min(2.2, max(1.6, house_w * 0.12))
    baths_total_w = bath_w_each * n_bathrooms
    bedrooms_total_w = max(2.0, house_w - baths_total_w)
    bed_w_each = bedrooms_total_w / max(1, n_bedrooms)

    x = house_x0
    for i in range(n_bedrooms):
        name = "Спальня" if n_bedrooms == 1 else f"Спальня {i + 1}"
        rooms.append({
            "kind": "bedroom", "name_ru": name,
            "x": x, "y": back_y, "w": bed_w_each, "d": back_d,
        })
        x += bed_w_each
    for i in range(n_bathrooms):
        name = "Сан.узел" if n_bathrooms == 1 else f"Сан.узел {i + 1}"
        rooms.append({
            "kind": "bathroom", "name_ru": name,
            "x": x, "y": back_y, "w": bath_w_each, "d": back_d,
        })
        x += bath_w_each

    return rooms

# ── Определение типа квартиры по площади и целевому миксу ─────────────────


def _apt_type_from_area(area_m2: float) -> str:
    if area_m2 < 42:
        return "studio"
    if area_m2 < 57:
        return "1k"
    if area_m2 < 80:
        return "2k"
    if area_m2 < 105:
        return "3k"
    return "4k"


# ── Параметрическая генерация планировки ──────────────────────────────────


# Минимальная глубина для двухсторонней секции:
# юг 4 + коридор 1.4 + север 4 + 2 несущие стены 0.8 ≈ 10.2.
# С запасом на нормальные квартиры берём 12 м как переход в галерейный режим.
_GALLERY_THRESHOLD_M = 12.0


def _generate_single_family_floor(
    inner_w: float, inner_d: float,
    *,
    n_bedrooms: int = 2,
    n_bathrooms: int | None = None,
    has_garage: bool = False,
) -> LayoutFloor:
    """Layout для частного дома — одна квартира на весь этаж.

    Без ядер (нет лифта/лестницы подъезда), без коридора секции, без
    выделения «КВ.1». Раскладка строится через
    _rooms_for_single_family_house с правильным архитектурным паттерном:
    гараж сбоку, дневная зона у фасада, ночная зона в глубине, коридор
    между ними.
    """
    rooms_raw = _rooms_for_single_family_house(
        inner_w, inner_d,
        n_bedrooms=n_bedrooms,
        n_bathrooms=n_bathrooms,
        has_garage=has_garage,
    )
    rooms = [LayoutRoom(**r) for r in rooms_raw]

    # Тип квартиры по числу спален (для UI-метки)
    if n_bedrooms <= 0:
        apt_type = "studio"
    elif n_bedrooms == 1:
        apt_type = "1k"
    elif n_bedrooms == 2:
        apt_type = "2k"
    else:
        apt_type = "3k"

    # В частном доме обе кромки (S и N) — внешний фасад: спальни в глубине
    # получают окна на N, а гостиная/кухня у фасада — на S.
    _add_apertures(
        rooms, inner_d,
        exterior_side="S", interior_side="N",
        extra_facade_sides=("N",),
    )
    for room in rooms:
        _add_furniture(room, exterior_side="S")

    apartment = LayoutApartment(
        type_code=apt_type,
        number=1,
        x=0.0, y=0.0,
        w=round(inner_w, 3),
        d=round(inner_d, 3),
        rooms=rooms,
    )

    # «Фейковая» секция-обёртка: без коридора, без ядер. Существующий
    # фронт всегда ожидает массив sections.
    section = LayoutSection(
        index=0,
        x_start=0.0,
        width=round(inner_w, 3),
        # Коридор «за пределами» этажа — фронт ничего не нарисует
        corridor_y=round(inner_d + 1.0, 3),
        corridor_d=0.0,
        cores=[],            # ⚡ Главная фишка: пустой список → никакого ЛИФТА/ЛЕСТНИЦЫ
        apartments=[apartment],
    )
    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=[section],
    )


# ── T-shape типология: 2 крупных квартиры + 3 стандартных ────────────────


def _apt_type_rank(apt_type: str) -> int:
    """Для сортировки от меньших к большим."""
    return {"studio": 0, "1k": 1, "2k": 2, "3k": 3, "4k": 4}.get(apt_type, 0)


def _generate_t_shape_floor(
    inner_w: float, inner_d: float,
    mix: list[str],
) -> LayoutFloor:
    """Т-типология: 2 крупных квартиры наверху + 3 стандартных внизу.

    Архитектурный паттерн комфорт+/бизнес ЖК в КЗ/РФ:

      ┌──────────────────┬─────────┬──────────────────┐
      │                  │ Лифт |  │                  │
      │  Крупная кв.     │ Лестн.  │   Крупная кв.    │
      │  (2-3к + лоджия) │ (узкий  │  (2-3к + лоджия) │
      │                  │ верт.   │                  │
      │                  │ блок)   │                  │
      ├──────────────────┴─────────┴──────────────────┤
      │  Коридор секции (горизонтальный)              │
      ├──────────────┬───────────────┬────────────────┤
      │   Кв. 3      │    Кв. 4      │    Кв. 5       │
      │  (1к / 2к)   │   (1к / 2к)   │   (1к / 2к)    │
      └──────────────┴───────────────┴────────────────┘

    Крупные квартиры на «привилегированной» стороне получают типы 2k/3k.
    Нижний ряд — компактные 1k/2k.
    """
    bear_t = _BEAR_T
    # Зональное деление по Y
    corridor_d = 1.6
    # Делим оставшееся между верхом и низом примерно поровну (с приоритетом верху)
    usable_d = inner_d - 2 * bear_t - corridor_d
    top_zone_d = max(6.5, usable_d * 0.52)
    bottom_zone_d = usable_d - top_zone_d
    if bottom_zone_d < 5.5:
        bottom_zone_d = 5.5
        top_zone_d = usable_d - bottom_zone_d

    # Y-границы зон
    corridor_y = bear_t + bottom_zone_d
    top_y_start = corridor_y + corridor_d

    # ── Узкое вертикальное ядро (лифт + лестница раздельно) в центре ──
    lift_w, lift_d = 2.0, 2.2
    stair_w, stair_d = 2.5, 5.0
    core_strip_w = lift_w + stair_w + 0.5   # промежуток 50 см между лифтом и лестницей
    core_strip_x = (inner_w - core_strip_w) / 2

    # Размещение внутри top_zone — у внешней (фасадной) стены, выравнено по Y
    core_y_base = inner_d - bear_t - max(lift_d, stair_d)
    cores = [
        LayoutCore(
            kind="lift_passenger",
            x=round(core_strip_x, 3),
            y=round(inner_d - lift_d - bear_t, 3),
            w=lift_w, d=lift_d,
        ),
        LayoutCore(
            kind="stair",
            x=round(core_strip_x + lift_w + 0.5, 3),
            y=round(inner_d - stair_d - bear_t, 3),
            w=stair_w, d=stair_d,
        ),
    ]
    del core_y_base  # placeholder for future logic

    # ── Подбор типов: 2 крупных наверху, 3 поменьше внизу ──
    mix_sorted = sorted(mix, key=_apt_type_rank, reverse=True) if mix else []
    while len(mix_sorted) < 5:
        mix_sorted.append("2k")
    top_types = mix_sorted[:2]
    bottom_types = mix_sorted[2:5]

    apartments: list[LayoutApartment] = []
    apt_num = 1

    # ── Верхний ряд: 2 крупных квартиры по бокам от ядра ──
    top_apt_w = (inner_w - core_strip_w - 2 * bear_t) / 2
    top_apt_d = top_zone_d
    top_left_x = bear_t
    top_right_x = core_strip_x + core_strip_w

    for apt_type, apt_x in [(top_types[0], top_left_x), (top_types[1], top_right_x)]:
        rooms_raw = _ROOM_BUILDERS[apt_type](top_apt_w, top_apt_d)
        rooms = [LayoutRoom(**r) for r in rooms_raw]
        # Фасад — север (y = apt.y + apt.d ≈ inner_d). Раскладки кладут жилые на
        # y=0 ⇒ для северных квартир инвертируем по Y, как в обычной секционке.
        for r in rooms:
            r.y = round(top_apt_d - r.y - r.d, 3)
        _add_apertures(rooms, top_apt_d, exterior_side="N", interior_side="S")
        _add_balconies(rooms, top_apt_d, apt_type, exterior_side="N")
        for room in rooms:
            _add_furniture(room, exterior_side="N")

        apartments.append(LayoutApartment(
            type_code=apt_type, number=apt_num,
            x=round(apt_x, 3), y=round(top_y_start, 3),
            w=round(top_apt_w, 3), d=round(top_apt_d, 3),
            rooms=rooms,
        ))
        apt_num += 1

    # ── Нижний ряд: 3 стандартные квартиры ──
    bottom_apt_w = (inner_w - 2 * bear_t) / 3
    bottom_apt_d = bottom_zone_d

    for i, apt_type in enumerate(bottom_types):
        ax = bear_t + i * bottom_apt_w
        rooms_raw = _ROOM_BUILDERS[apt_type](bottom_apt_w, bottom_apt_d)
        rooms = [LayoutRoom(**r) for r in rooms_raw]
        # Фасад — юг (y=0 в системе квартиры). Раскладки уже подходят, без инверсии.
        _add_apertures(rooms, bottom_apt_d, exterior_side="S", interior_side="N")
        _add_balconies(rooms, bottom_apt_d, apt_type, exterior_side="S")
        for room in rooms:
            _add_furniture(room, exterior_side="S")

        apartments.append(LayoutApartment(
            type_code=apt_type, number=apt_num,
            x=round(ax, 3), y=round(bear_t, 3),
            w=round(bottom_apt_w, 3), d=round(bottom_apt_d, 3),
            rooms=rooms,
        ))
        apt_num += 1

    section = LayoutSection(
        index=0,
        x_start=0.0,
        width=round(inner_w, 3),
        corridor_y=round(corridor_y, 3),
        corridor_d=corridor_d,
        cores=cores,
        apartments=apartments,
    )
    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=[section],
    )


def _split_mix_by_depth_asymmetric(
    mix: list[str],
) -> tuple[list[str], list[str]]:
    """Разделить общий mix на южный (крупные) и северный (компактные).

    Юг — глубокая сторона, держит крупные форматы 2к/3к/4к.
    Север — мелкая сторона, держит studio/1к.

    Если одна группа пуста — делим вторую пополам (вырожденный случай,
    asymmetric теряет смысл, но не падаем).
    """
    big = [t for t in mix if t in ("2k", "3k", "4k")]
    small = [t for t in mix if t in ("studio", "1k")]
    if not big and not small:
        return [], []
    if not big:
        half = len(small) // 2
        return small[:half], small[half:]
    if not small:
        half = (len(big) + 1) // 2
        return big[:half], big[half:]
    return big, small


def _solve_asymmetric_depths(
    inner_d: float, depth_ratio: float = _ASYM_RATIO_DEFAULT,
) -> tuple[float, float, float] | None:
    """Решить (apt_d_s, apt_d_n, corr_y) под заданное depth_ratio = S/N.

    Возвращает None если геометрия физически не вмещает asymmetric_depth
    с минимальными нормативными глубинами (тогда dispatcher делает fallback
    на симметричную).
    """
    corr_d = max(_CORR_MIN_D, _CORE_D)
    usable_d = inner_d - corr_d - 2 * _BEAR_T

    if usable_d < _ASYM_N_MIN + _ASYM_S_MIN:
        # Не помещается даже минимум — pereбираем геометрию
        return None

    # apt_d_n = usable / (1 + ratio); apt_d_s = ratio * apt_d_n
    apt_d_n_raw = usable_d / (1 + depth_ratio)
    apt_d_s_raw = depth_ratio * apt_d_n_raw

    # Clamp к нормативным пределам
    apt_d_n = max(_ASYM_N_MIN, min(_ASYM_N_MAX, apt_d_n_raw))
    apt_d_s = max(_ASYM_S_MIN, min(_ASYM_S_MAX, apt_d_s_raw))

    # После clamp могло «осесть» — оставшийся slack отдаём южной стороне,
    # пока не упрёмся в _ASYM_S_MAX, иначе северной.
    actual_used = apt_d_s + apt_d_n
    slack = usable_d - actual_used
    if slack > 0.01:
        room_s = _ASYM_S_MAX - apt_d_s
        room_n = _ASYM_N_MAX - apt_d_n
        give_s = min(slack, room_s)
        apt_d_s += give_s
        slack -= give_s
        if slack > 0.01:
            apt_d_n += min(slack, room_n)

    corr_y = round(_BEAR_T + apt_d_s, 3)
    return round(apt_d_s, 3), round(apt_d_n, 3), corr_y


def _generate_asymmetric_depth_floor(
    inner_w: float, inner_d: float,
    inputs: MarketingInputs,
    *,
    depth_ratio: float = _ASYM_RATIO_DEFAULT,
) -> LayoutFloor | None:
    """Секция с асимметричной глубиной: юг глубже севера.

    На юге — крупные форматы (2к/3к/4к) с большей глубиной, на севере —
    компактные (студии/1к) с минимальной глубиной. Мокрые зоны обеих
    сторон прижаты к коридору → общие стояки канализации.

    Возвращает None, если геометрия не вмещает минимальные нормативные
    глубины (тогда dispatcher делает fallback на симметричную).

    Архитектурные референсы: ПИК-1 (~7.2/5.4 м), ПИК-2 (~8.0/5.0),
    Самолёт типовая (~7.5/5.5), Highvill Park (~8.5/5.5), BI Family Nest
    (~7.0/5.0), Bazis Алмалы (~7.0/5.0).

    Нормативные ограничения:
      • СП 23-102-2003 п. 5.3 — глубина жилой комнаты с одним окном
        ≤ 2.5 × высоты светопроёма ≈ 6 м. Поэтому южная квартира глубиной
        > 6 м строится как «жилая комната у фасада + мокрая зона у коридора».
      • СП 54.13330.2022 п. 5.11 — мин. жилая комната 14 м² (1к), 16 м² (2к+).
      • СанПиН 2.2.1/2.1.1.1076-01 — инсоляция через хотя бы одну комнату.
    """
    solved = _solve_asymmetric_depths(inner_d, depth_ratio)
    if solved is None:
        log.info(
            "asymmetric_depth: inner_d=%.2f too shallow for ratio=%.2f, "
            "falling back to symmetric", inner_d, depth_ratio,
        )
        return None
    apt_d_s, apt_d_n, corr_y = solved
    corr_d = max(_CORR_MIN_D, _CORE_D)

    n_sect = max(1, inputs.sections)
    sect_w = inner_w / n_sect

    # Mix: split на S (крупные) и N (компактные)
    mix_all = _resolve_mix(inputs, n_sect, sect_w, apt_d_s, apt_d_n, sides=2)
    mix_s, mix_n = _split_mix_by_depth_asymmetric(mix_all)

    sections: list[LayoutSection] = []
    apt_num = 1

    for si in range(n_sect):
        x0 = round(si * sect_w, 3)
        wall_l = _BEAR_T if si == 0 else _FIRE_T / 2
        wall_r = _BEAR_T if si == n_sect - 1 else _FIRE_T / 2
        apt_x0 = x0 + wall_l
        apt_x1 = x0 + sect_w - wall_r
        usable_w = apt_x1 - apt_x0

        # Ядро по центру (как в symmetric) — внутри corridor strip
        core_cx = x0 + sect_w / 2
        core_x = round(core_cx - _CORE_W / 2, 3)
        core_d = _CORE_D
        core_y = corr_y
        cores = _make_cores(
            core_x, core_y, inputs.lifts_passenger, inputs.lifts_freight, core_d=core_d,
        )

        # Две стороны с разными mix и глубинами
        sides_spec: list[tuple[float, float, list[str]]] = [
            (round(_BEAR_T, 3),         apt_d_s, mix_s),
            (round(corr_y + corr_d, 3), apt_d_n, mix_n),
        ]

        apartments: list[LayoutApartment] = []
        for side_y, apt_d, side_mix in sides_spec:
            side_packing = _pack_side(usable_w, side_mix)
            for _ in range(len(side_packing)):
                if side_mix:
                    side_mix.pop(0)

            if not side_packing:
                fallback_w = max(_MIN_APT_W["1k"], min(usable_w, _TARGET_APT_W["1k"]))
                fallback_t = _apt_type_from_area(fallback_w * apt_d)
                side_packing = [(fallback_t, fallback_w)]
                slack = usable_w - fallback_w
                if slack > 0.05:
                    side_packing = [(fallback_t, fallback_w + slack)]

            ax_cursor = apt_x0
            for ai, (apt_type, apt_w) in enumerate(side_packing):
                ax = round(ax_cursor, 3)
                aw = round(apt_w, 3)
                ax_cursor += apt_w

                rooms_raw = _ROOM_BUILDERS[apt_type](aw, apt_d)
                rooms = [LayoutRoom(**r) for r in rooms_raw]

                exterior_side: str = "S" if side_y < corr_y else "N"
                interior_side: str = "N" if side_y < corr_y else "S"

                if exterior_side == "N":
                    for r in rooms:
                        r.y = round(apt_d - r.y - r.d, 3)

                _add_apertures(rooms, apt_d, exterior_side, interior_side)
                _add_balconies(rooms, apt_d, apt_type, exterior_side)
                for room in rooms:
                    _add_furniture(room, exterior_side)

                if ai % 2 == 1:
                    _mirror_rooms_x(rooms, aw)

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

    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=sections,
    )


def _generate_double_core_floor(
    inner_w: float, inner_d: float,
    inputs: MarketingInputs,
) -> LayoutFloor | None:
    """Длинная секция (>42 м) с двумя ядрами на 0.22L и 0.78L.

    Применяется когда:
      • длина секции > 42 м (СП 1.13130 табл. 3: максимум 40 м между
        лестницами для I-II степ. огнестойкости С0, +2 м запас);
      • или общая площадь квартир этажа > 500 м² (СП 1.13130 п. 6.1.1).

    Ядра позиционируются в долях длины: x1=0.22L, x2=0.78L. Каждое ядро
    «обслуживает» свою половину секции; коридор сквозной, рекомендуется
    разделить противопожарной перегородкой 2-го типа по центру между ними
    (сама перегородка пока не моделируется в схеме — отображается только
    в визуализаторе).

    Возвращает None если:
      • inner_d недостаточна для двухсторонней секции (fallback на gallery
        или symmetric)

    Архитектурные референсы: ПИК (Саларьево парк, Бунинские луга, Перовское,
    Варшавское ш. 141), Самолёт (Прокшино, Алхимово), ФСК «Архитектор»,
    Bazis-A NEOPARK, Highvill Park/Ishim.

    Нормативное обоснование:
      • СП 1.13130.2020 п. 6.1.1 — ≥2 эвак. выхода при площади > 500 м²
      • СП 1.13130.2020 табл. 3 — 40 м между лестницами (I-II, С0)
      • СП 1.13130.2020 п. 6.1.9 — ПП-перегородки 2-го типа каждые ≤30 м
      • СП 54.13330.2022 п. 4.7 — коридор ≥1.6 м при длине > 40 м
      • СНиП РК 2.02-05-2009 — аналог СП 1.13130 РФ
    """
    # Принудительно одна длинная секция — игнорируем inputs.sections.
    # Если пользователь явно хочет multi-section на длинном пятне — пусть
    # выбирает symmetric.
    sect_w = inner_w

    if inner_w < _DOUBLE_CORE_MIN_W:
        log.info(
            "double_core: inner_w=%.2f < %.2f (рекомендуемый минимум). "
            "Продолжаем по явному выбору пользователя.",
            inner_w, _DOUBLE_CORE_MIN_W,
        )

    if inner_w > _DOUBLE_CORE_MAX_W:
        log.warning(
            "double_core: inner_w=%.2f > %.2f (рекомендуемый максимум). "
            "Желательно добавить 3-е ядро или ПП-стену; продолжаем без них.",
            inner_w, _DOUBLE_CORE_MAX_W,
        )

    if inner_d < _GALLERY_THRESHOLD_M:
        # Слишком мелко для двухстороннего коридора — нет смысла в double_core
        log.info(
            "double_core: inner_d=%.2f < %.2f (gallery threshold), fallback",
            inner_d, _GALLERY_THRESHOLD_M,
        )
        return None

    # Геометрия коридора — как в symmetric: corridor strip = max(min норма, core_d)
    corr_d = max(_DOUBLE_CORE_CORR_W, _CORE_D)
    corr_y = round((inner_d - corr_d) / 2, 3)
    apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
    apt_d_n = max(4.0, round(inner_d - corr_y - corr_d - _BEAR_T, 3))

    # Mix для всего этажа (одна секция, 2 стороны)
    n_sect = 1
    mix = _resolve_mix(inputs, n_sect, sect_w, apt_d_s, apt_d_n, sides=2)

    # Стены секции — с обеих сторон по _BEAR_T (single-section здание; если
    # double_core входит в комплекс — пользователь объявит sections=1)
    wall_l = _BEAR_T
    wall_r = _BEAR_T
    apt_x0 = wall_l
    apt_x1 = sect_w - wall_r
    usable_w = apt_x1 - apt_x0

    # ── Два ядра: позиции по X в долях секции ──
    core1_cx = _DOUBLE_CORE_X1_RATIO * sect_w
    core2_cx = _DOUBLE_CORE_X2_RATIO * sect_w
    core1_x = round(core1_cx - _CORE_W / 2, 3)
    core2_x = round(core2_cx - _CORE_W / 2, 3)

    # Распределение лифтов между ядрами:
    # ядро 1 получает ceil(N/2), ядро 2 получает floor(N/2)
    # Каждое ядро всегда получает 1 лестницу (см. _make_cores)
    pass_each = max(1, inputs.lifts_passenger // 2)
    pass_extra = inputs.lifts_passenger - pass_each  # для ядра 2
    freight_each = inputs.lifts_freight // 2
    freight_extra = inputs.lifts_freight - freight_each

    cores: list[LayoutCore] = []
    cores.extend(_make_cores(
        core1_x, corr_y,
        n_pass=pass_each, n_freight=freight_each,
        core_d=_CORE_D,
    ))
    cores.extend(_make_cores(
        core2_x, corr_y,
        n_pass=pass_extra, n_freight=freight_extra,
        core_d=_CORE_D,
    ))

    # ── Apartments на двух сторонах ──
    apartments: list[LayoutApartment] = []
    apt_num = 1

    sides_spec = [
        (round(_BEAR_T, 3),         apt_d_s),
        (round(corr_y + corr_d, 3), apt_d_n),
    ]
    for side_y, apt_d in sides_spec:
        side_packing = _pack_side(usable_w, mix)
        for _ in range(len(side_packing)):
            if mix:
                mix.pop(0)

        if not side_packing:
            fallback_w = max(_MIN_APT_W["1k"], min(usable_w, _TARGET_APT_W["1k"]))
            fallback_t = _apt_type_from_area(fallback_w * apt_d)
            side_packing = [(fallback_t, fallback_w)]
            slack = usable_w - fallback_w
            if slack > 0.05:
                side_packing = [(fallback_t, fallback_w + slack)]

        ax_cursor = apt_x0
        for ai, (apt_type, apt_w) in enumerate(side_packing):
            ax = round(ax_cursor, 3)
            aw = round(apt_w, 3)
            ax_cursor += apt_w

            rooms_raw = _ROOM_BUILDERS[apt_type](aw, apt_d)
            rooms = [LayoutRoom(**r) for r in rooms_raw]

            exterior_side: str = "S" if side_y < corr_y else "N"
            interior_side: str = "N" if side_y < corr_y else "S"

            if exterior_side == "N":
                for r in rooms:
                    r.y = round(apt_d - r.y - r.d, 3)

            _add_apertures(rooms, apt_d, exterior_side, interior_side)
            _add_balconies(rooms, apt_d, apt_type, exterior_side)
            for room in rooms:
                _add_furniture(room, exterior_side)

            if ai % 2 == 1:
                _mirror_rooms_x(rooms, aw)

            apartments.append(LayoutApartment(
                type_code=apt_type,
                number=apt_num,
                x=ax, y=side_y,
                w=aw, d=round(apt_d, 3),
                rooms=rooms,
            ))
            apt_num += 1

    section = LayoutSection(
        index=0,
        x_start=0.0,
        width=round(sect_w, 3),
        corridor_y=corr_y,
        corridor_d=round(corr_d, 3),
        cores=cores,
        apartments=apartments,
    )
    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=[section],
    )


def _generate_tower_floor(
    inner_w: float, inner_d: float,
    inputs: MarketingInputs,
) -> LayoutFloor | None:
    """Башенная типология: 4 угловые квартиры вокруг центрального ядра.

    Архитектурный паттерн:

      ┌──────────┬──────────┬──────────┐
      │          │          │          │
      │  APT-1   │  CORE    │  APT-2   │   ← север (фасад)
      │  NW      │  лифт×2  │  NE      │
      │  N+W     │  лестн   │  N+E     │
      ├──────────┤  холл    ├──────────┤
      │          │  7.5×7.5 │          │
      │  APT-3   │          │  APT-4   │   ← юг (фасад)
      │  SW      │          │  SE      │
      │  S+W     │          │  S+E     │
      └──────────┴──────────┴──────────┘
        фасад W              фасад E

    Все 4 квартиры — угловые (окна на 2 фасада). Ядро занимает центральный
    квадрат пятна. Нет длинного коридора подъезда — только лифтовый холл
    внутри ядра.

    Возвращает None если пятно слишком мало (apt_w или apt_d < 5 м).

    Архитектурные референсы: Esentai Apartments (Алматы), Highvill Astana
    блок F, ORDA Tower, Mercury City Tower, Capital Towers (Москва),
    серия КОПЭ-Башня (ПИК/ДСК-2), И-155Б (СУ-155).

    Нормативное обоснование:
      • СП 54.13330.2022 п. 7.2.4 — от двери квартиры до незадым. л/к ≤12 м
        (в tower расстояние всегда меньше — апартаменты примыкают к ядру)
      • СП 54.13330.2022 п. 7.2.5 — ширина холла ≥1.4 м, для длинных >40 м ≥1.6
      • СП 1.13130.2020 п. 4.4.16 — H >28 м: лестницы незадымляемые (H1/H2/H3)
      • СП 1.13130.2020 п. 4.4.14 — H >28 м: ≥2 эвак. выхода с этажа
      • СНиП РК 3.02-43-2007 — лифты ≥2 (10–19 эт.), ≥3 (20+ эт.)
    """
    if inner_w < _TOWER_W_MIN or inner_d < _TOWER_D_MIN:
        log.info(
            "tower: inner=%.1fx%.1f below recommended %sx%s",
            inner_w, inner_d, _TOWER_W_MIN, _TOWER_D_MIN,
        )
        return None

    core_w = _TOWER_CORE_W
    core_d = _TOWER_CORE_D
    core_x = round((inner_w - core_w) / 2, 3)
    core_y = round((inner_d - core_d) / 2, 3)

    # Габариты квартир-углов
    apt_w = round((inner_w - core_w) / 2, 3)
    apt_d = round((inner_d - core_d) / 2, 3)

    if apt_w < 5.0 or apt_d < 5.0:
        log.info("tower: apt dimensions too small (%.2fx%.2f)", apt_w, apt_d)
        return None

    # Mix: всегда 4 квартиры. Берём 4 крупнейших из запрошенного mix.
    mix_all = _resolve_mix(inputs, 1, inner_w, apt_d, apt_d, sides=2)
    mix_sorted = sorted(mix_all, key=_apt_type_rank, reverse=True) if mix_all else []
    while len(mix_sorted) < 4:
        mix_sorted.append("2k")
    apt_types = mix_sorted[:4]

    # ── Ядро в центре пятна ──
    # Расширенное ядро 7.5×7.5: 2 пасс. лифта + 1 груз. + лестница H2 + холл
    cores = _make_cores(
        core_x, core_y,
        n_pass=max(1, inputs.lifts_passenger),
        n_freight=max(0, inputs.lifts_freight),
        core_d=core_d,
    )

    # ── 4 квартиры в углах ──
    # corner_label, y_origin, exterior_main, exterior_extra, invert_y, mirror_x
    apt_configs = [
        ("NW", core_y + core_d, "N", "W", True,  False),
        ("NE", core_y + core_d, "N", "E", True,  True),
        ("SW", 0.0,             "S", "W", False, False),
        ("SE", 0.0,             "S", "E", False, True),
    ]

    apartments: list[LayoutApartment] = []
    for i, (corner, y_origin, ext_main, ext_extra, invert_y, mirror_x) in enumerate(apt_configs):
        apt_type = apt_types[i]
        apt_x = 0.0 if corner.endswith("W") else round(core_x + core_w, 3)

        rooms_raw = _ROOM_BUILDERS[apt_type](apt_w, apt_d)
        rooms = [LayoutRoom(**r) for r in rooms_raw]

        # Инверсия по Y для северных квартир: жилые комнаты строятся на y=0,
        # для N квартиры y=0 — это сторона к ядру, а N-фасад на y=apt_d.
        if invert_y:
            for r in rooms:
                r.y = round(apt_d - r.y - r.d, 3)

        # Зеркалирование X для «восточных» квартир — ВЫПОЛНЯЕМ ДО apertures,
        # чтобы _make_window_on_facade корректно распознавал E-стену.
        # Если мирорить после apertures, окна добавляются «вслепую» на исходных
        # W-комнатах, потом mirror перебрасывает их с W на E, но проверка
        # «room.x+room.w==apt_w» для E-фасада была выполнена ДО mirror и
        # для исходных W-комнат всегда возвращала false.
        if mirror_x:
            _mirror_rooms_x(rooms, apt_w)

        interior_side = "S" if ext_main == "N" else "N"

        # Apertures: основной фасад (N/S) + дополнительный угловой (W/E).
        # Угловые комнаты получают окна сразу на 2 фасада (panoramic corner).
        _add_apertures(
            rooms, apt_d,
            exterior_side=ext_main, interior_side=interior_side,
            apt_w=apt_w,
            extra_facade_sides=(ext_extra,),
            allow_multiple_windows=True,
        )

        # Лоджия на основном фасаде (премиум-башни почти всегда имеют лоджии)
        _add_balconies(rooms, apt_d, apt_type, ext_main)

        for room in rooms:
            _add_furniture(room, ext_main)

        apartments.append(LayoutApartment(
            type_code=apt_type,
            number=i + 1,
            x=round(apt_x, 3),
            y=round(y_origin, 3),
            w=apt_w, d=apt_d,
            rooms=rooms,
        ))

    # Schema: «коридор» = полоса в Y, где сидит ядро. corridor_d = core_d,
    # настоящего корридора нет (лифтовый холл внутри ядра).
    section = LayoutSection(
        index=0,
        x_start=0.0,
        width=round(inner_w, 3),
        corridor_y=round(core_y, 3),
        corridor_d=round(core_d, 3),
        cores=cores,
        apartments=apartments,
    )
    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=[section],
    )


def _build_apt_block(
    apt_type: str, apt_w: float, apt_d: float,
    apt_x: float, apt_y: float,
    apt_num: int,
    *,
    exterior_side: str,
    interior_side: str,
    mirror_index: int = 0,
    section_apt_w_for_apertures: float | None = None,
    extra_facade_sides: tuple[str, ...] = (),
    allow_multiple_windows: bool = False,
) -> LayoutApartment:
    """Собрать LayoutApartment с типовой раскладкой: rooms → invert(N) →
    apertures → balconies → furniture → mirror(odd index).

    Вынесено в helper, потому что почти все секционные функции делают одно
    и то же на стадии «собрать квартиру внутри секции».
    """
    rooms_raw = _ROOM_BUILDERS[apt_type](apt_w, apt_d)
    rooms = [LayoutRoom(**r) for r in rooms_raw]

    if exterior_side == "N":
        for r in rooms:
            r.y = round(apt_d - r.y - r.d, 3)

    _add_apertures(
        rooms, apt_d, exterior_side, interior_side,
        apt_w=section_apt_w_for_apertures or apt_w,
        extra_facade_sides=extra_facade_sides,
        allow_multiple_windows=allow_multiple_windows,
    )
    _add_balconies(rooms, apt_d, apt_type, exterior_side)
    for room in rooms:
        _add_furniture(room, exterior_side)

    if mirror_index % 2 == 1:
        _mirror_rooms_x(rooms, apt_w)

    return LayoutApartment(
        type_code=apt_type,                # type: ignore[arg-type]
        number=apt_num,
        x=round(apt_x, 3), y=round(apt_y, 3),
        w=round(apt_w, 3), d=round(apt_d, 3),
        rooms=rooms,
    )


def _generate_core_shifted_floor(
    inner_w: float, inner_d: float,
    inputs: MarketingInputs,
    *,
    offset_ratio: float = _CORE_SHIFTED_OFFSET,
) -> LayoutFloor | None:
    """Секция с ядром, смещённым к торцу (offset_ratio от центра по X).

    Архитектурный паттерн (авторская/премиум-типология):

      ┌─────────┬───────┬──────────────────────────────────┐
      │  SMALL  │       │            BIG (3к/4к/PH)        │
      │  (1к/2к)│ CORE  │  угловые окна на 3 фасада        │
      │  S apt  │ shift │  S apt (большая)                 │
      ├─────────┤  to   ├──────────────────────────────────┤
      │ corridor│ left  │   corridor (продолжение)         │
      ├─────────┤       ├──────────────────────────────────┤
      │  SMALL  │       │            BIG (3к/4к/PH)        │
      │  N apt  │       │  N apt (большая)                 │
      └─────────┴───────┴──────────────────────────────────┘

    Реальные референсы: Меганом, Скуратов (Садовые кварталы, Остоженка),
    ФСК «Архитектор», Highvill, BAZIS-A PRIMAVERA. Точные смещения в %
    застройщики не публикуют — диапазон 0.25-0.35 выведен по планировкам
    премиум-проектов и норме 12 м тупикового коридора (СП 1.13130).

    КРИТИЧНО: при длине крупной зоны (right_w) > 12 м, без дымоудаления
    и без второго эвак. выхода, типология **формально нарушает СП 1.13130**.
    В этой реализации мы это логируем как warning, но всё равно строим
    (пользователь явно выбрал режим). Для соответствия нормам нужен
    второй эвак. выход на дальнем торце (будущее улучшение).
    """
    if inner_w < _CORE_SHIFTED_W_MIN:
        log.info(
            "core_shifted: inner_w=%.2f < %.2f, but proceeding",
            inner_w, _CORE_SHIFTED_W_MIN,
        )

    n_sect = 1
    sect_w = inner_w

    gallery_mode = inner_d < _GALLERY_THRESHOLD_M

    if gallery_mode:
        corr_d = max(_CORR_MIN_D, 1.4)
        corr_y = round(inner_d - corr_d - _BEAR_T, 3)
        apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
        apt_d_n = 0.0
    else:
        corr_d = max(_CORR_MIN_D, _CORE_D)
        corr_y = round((inner_d - corr_d) / 2, 3)
        apt_d_s = max(4.0, round(corr_y - _BEAR_T, 3))
        apt_d_n = max(4.0, round(inner_d - corr_y - corr_d - _BEAR_T, 3))

    # Ядро смещено на offset_ratio от левого края секции
    core_cx = offset_ratio * sect_w
    core_x = round(core_cx - _CORE_W / 2, 3)
    if gallery_mode:
        core_d_zone = min(_CORE_D, corr_y)
        core_y = round(corr_y - core_d_zone, 3)
    else:
        core_d_zone = _CORE_D
        core_y = corr_y

    cores = _make_cores(
        core_x, core_y,
        n_pass=max(1, inputs.lifts_passenger),
        n_freight=max(0, inputs.lifts_freight),
        core_d=core_d_zone,
    )

    # Зоны: левая (короткая) и правая (длинная) от ядра
    left_x0 = _BEAR_T
    left_x1 = core_x
    left_w = max(0.0, left_x1 - left_x0)

    right_x0 = core_x + _CORE_W
    right_x1 = sect_w - _BEAR_T
    right_w = max(0.0, right_x1 - right_x0)

    if right_w > 12.0:
        log.warning(
            "core_shifted: right zone %.2fм > 12 м, по СП 1.13130 нужен "
            "второй эвак. выход (не моделируется в этой версии).",
            right_w,
        )

    # Mix split: 3к/4к → правая зона; studio/1к/2к → левая зона
    mix_all = _resolve_mix(
        inputs, n_sect, sect_w, apt_d_s, apt_d_n,
        sides=1 if gallery_mode else 2,
    )
    mix_big = [t for t in mix_all if t in ("3k", "4k")]
    mix_small = [t for t in mix_all if t in ("studio", "1k", "2k")]

    # Если запрошенный mix не содержит крупных — используем 2к как fallback
    # для правой зоны (даём пользователю что-то крупное, иначе типология
    # теряет смысл).
    if not mix_big:
        mix_big = ["3k", "3k"] if right_w >= 13 else ["2k", "2k"]

    apartments: list[LayoutApartment] = []
    apt_num = 1

    if gallery_mode:
        sides_spec = [(round(_BEAR_T, 3), apt_d_s)]
    else:
        sides_spec = [
            (round(_BEAR_T, 3),         apt_d_s),
            (round(corr_y + corr_d, 3), apt_d_n),
        ]

    for side_y, apt_d in sides_spec:
        # Левая зона (короткая) — мелкие
        left_packing: list[tuple[str, float]] = (
            _pack_side(left_w, mix_small) if left_w > 4.0 else []
        )
        for _ in range(len(left_packing)):
            if mix_small:
                mix_small.pop(0)

        # Правая зона (длинная) — крупные
        right_packing: list[tuple[str, float]] = (
            _pack_side(right_w, mix_big) if right_w > 0 else []
        )
        for _ in range(len(right_packing)):
            if mix_big:
                mix_big.pop(0)

        # Fallback: если справа пусто и есть запас mix_small — заполняем им
        if not right_packing and right_w > 4.0:
            right_packing = _pack_side(right_w, mix_small)
            for _ in range(len(right_packing)):
                if mix_small:
                    mix_small.pop(0)

        ext = "S" if side_y < corr_y else "N"
        ent = "N" if side_y < corr_y else "S"

        # Размещаем левую зону
        ax_cursor = left_x0
        for ai, (apt_type, aw) in enumerate(left_packing):
            apartments.append(_build_apt_block(
                apt_type, aw, apt_d, ax_cursor, side_y, apt_num,
                exterior_side=ext, interior_side=ent, mirror_index=ai,
            ))
            ax_cursor += aw
            apt_num += 1

        # Размещаем правую зону
        ax_cursor = right_x0
        for ai, (apt_type, aw) in enumerate(right_packing):
            apartments.append(_build_apt_block(
                apt_type, aw, apt_d, ax_cursor, side_y, apt_num,
                exterior_side=ext, interior_side=ent, mirror_index=ai,
            ))
            ax_cursor += aw
            apt_num += 1

    section = LayoutSection(
        index=0,
        x_start=0.0,
        width=round(sect_w, 3),
        corridor_y=corr_y,
        corridor_d=round(corr_d, 3),
        cores=cores,
        apartments=apartments,
    )
    return LayoutFloor(
        width_m=round(inner_w, 3),
        depth_m=round(inner_d, 3),
        sections=[section],
    )


def generate_floor_layout(inputs: MarketingInputs) -> LayoutFloor:
    """Сгенерировать планировку этажа — параметрически + GPT-4o для типов квартир.

    Структура здания (ядра, коридоры, границы секций) вычисляется детерминированно.
    GPT-4o используется для назначения типов квартир согласно заданному миксу
    и для структурированного вывода в виде LayoutFloor.

    Три режима:
      • single_family (inputs.building_type == "single_family") — частный
        дом / коттедж. Без ядер, без коридора подъезда, одна «квартира»
        на весь этаж с типовой раскладкой комнат.
      • секционный (depth ≥ 12 м, multi_family) — квартиры с двух сторон
        коридора по центру.
      • галерейный (depth < 12 м, multi_family) — коридор у северной
        стены, квартиры только с южной стороны (лучшая инсоляция).
        Используется для общежитий, апарт-отелей, узких корпусов
        социального жилья.
    """
    inner_w = max(6.0, inputs.site_width_m - 2 * inputs.setback_side_m)
    inner_d = max(6.0, inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m)

    # ── Single-family режим: одна квартира на этаж, без подъезда ──
    if getattr(inputs, "building_type", "multi_family") == "single_family":
        return _generate_single_family_floor(
            inner_w, inner_d,
            n_bedrooms=getattr(inputs, "bedrooms", 2),
            n_bathrooms=getattr(inputs, "bathrooms", None),
            has_garage=getattr(inputs, "has_garage", False),
        )

    # ── T-shape типология: 2 крупных + 3 стандартных ──
    if getattr(inputs, "floor_typology", "symmetric") == "t_shape":
        # Подготавливаем mix как в обычной симметричной секции
        n_sect_mix = max(1, inputs.sections)
        sect_w_mix = inner_w / n_sect_mix
        gallery_mix = inner_d < _GALLERY_THRESHOLD_M
        mix = _resolve_mix(
            inputs, n_sect_mix, sect_w_mix,
            apt_d_s=max(4.0, inner_d / 2 - 1),
            apt_d_n=max(4.0, inner_d / 2 - 1),
            sides=1 if gallery_mix else 2,
        )
        return _generate_t_shape_floor(inner_w, inner_d, mix)

    # ── Asymmetric depth: юг глубже севера ──
    # Широтная секция с разной глубиной юг/север. На юге крупные форматы
    # (2к/3к/4к), на севере компактные (студии/1к). Подробности — в
    # _generate_asymmetric_depth_floor() и docs/TYPOLOGIES_HANDOFF.md.
    if getattr(inputs, "floor_typology", "symmetric") == "asymmetric_depth":
        result = _generate_asymmetric_depth_floor(inner_w, inner_d, inputs)
        if result is not None:
            return result
        # Геометрия не вместила минимальные нормативные глубины ⇒ fallback
        # на симметричную ниже.

    # ── Double-core: длинная секция с двумя ядрами ──
    # Применяется для длинных секций (>42 м), где одного центрального ядра
    # не хватает по пожарным нормам (СП 1.13130 табл. 3: ≤40 м между л/к).
    if getattr(inputs, "floor_typology", "symmetric") == "double_core":
        result = _generate_double_core_floor(inner_w, inner_d, inputs)
        if result is not None:
            return result
        # Геометрия не вместила (узкая глубина) ⇒ fallback на симметричную.

    # ── Tower: 4 угловые квартиры вокруг центрального ядра ──
    # Премиум/бизнес-башенная типология. Подробности — в _generate_tower_floor().
    if getattr(inputs, "floor_typology", "symmetric") == "tower":
        result = _generate_tower_floor(inner_w, inner_d, inputs)
        if result is not None:
            return result
        # Пятно слишком мало для башни ⇒ fallback на симметричную/галерейную.

    # ── Core-shifted: ядро смещено к торцу ──
    # Авторская/премиум-типология. Подробности — в _generate_core_shifted_floor().
    if getattr(inputs, "floor_typology", "symmetric") == "core_shifted":
        result = _generate_core_shifted_floor(inner_w, inner_d, inputs)
        if result is not None:
            return result

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
        # Двухсторонняя секция: коридор по центру.
        # Ширина corridor strip = max(минимальная норма, глубина ядра) — чтобы
        # лифт+лестница помещались ВНУТРИ corridor zone и не накладывались на
        # квартиры. Это превращает простой коридор в «лифтовый холл».
        corr_d = max(_CORR_MIN_D, _CORE_D)
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
            # В symmetric ядро ВНУТРИ corridor strip (corr_d сейчас расширен
            # до глубины ядра). Cores не накладываются на квартиры.
            core_d = _CORE_D
            core_y = corr_y
        cores = _make_cores(core_x, core_y, inputs.lifts_passenger, inputs.lifts_freight, core_d=core_d)

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
            # ── Pack apartments with variable width per type (Phase C) ──
            # mix содержит запрошенные типы (studio/1k/2k/3k) в порядке.
            # Берём следующий кусок и укладываем greedy по target widths.
            # Studio 7м, 1к 9м, 2к 12м, 3к 15м → реалистичный МКД-микс.
            side_packing = _pack_side(usable_w, mix)
            # Снимаем использованные квартиры из mix
            for _ in range(len(side_packing)):
                if mix:
                    mix.pop(0)

            # Fallback если mix исчерпан или _resolve_mix вернул пустой
            if not side_packing:
                # Подбираем тип по площади «средней» квартиры на этой стороне
                fallback_w = max(_MIN_APT_W["1k"], min(usable_w, _TARGET_APT_W["1k"]))
                fallback_t = _apt_type_from_area(fallback_w * apt_d)
                side_packing = [(fallback_t, fallback_w)]
                slack = usable_w - fallback_w
                if slack > 0.05:
                    side_packing = [(fallback_t, fallback_w + slack)]

            ax_cursor = apt_x0
            for ai, (apt_type, apt_w) in enumerate(side_packing):
                ax = round(ax_cursor, 3)
                aw = round(apt_w, 3)
                ax_cursor += apt_w

                rooms_raw = _ROOM_BUILDERS[apt_type](aw, apt_d)
                rooms = [LayoutRoom(**r) for r in rooms_raw]

                # Где у этой квартиры фасадная (наружная) и где внутренняя
                # (к коридору) стена. В двухсторонней секции:
                #   южная квартира → фасад S, коридор N
                #   северная квартира → фасад N, коридор S
                # В галерейном — квартиры только с юга, коридор N.
                exterior_side: str = "S" if side_y < corr_y else "N"
                interior_side: str = "N" if side_y < corr_y else "S"

                # Раскладки _rooms_for_* кладут жилые комнаты на y=0
                # (фасадная кромка квартиры) и Прихожую на y=d. Это правильно
                # для южных квартир (y=0 = south = facade). Для северных
                # инвертируем — там фасад это y=d (north).
                if exterior_side == "N":
                    for r in rooms:
                        r.y = round(apt_d - r.y - r.d, 3)

                _add_apertures(rooms, apt_d, exterior_side, interior_side)
                # Лоджии — врезаем в фасадные жилые комнаты после apertures,
                # чтобы корректно перенести окна на внешнюю стену лоджии.
                _add_balconies(rooms, apt_d, apt_type, exterior_side)
                for room in rooms:
                    _add_furniture(room, exterior_side)

                # Чётные квартиры (1-я, 3-я, …) зеркалим по X — норма МКД
                # «мокрые зоны спина к спине» + визуально соседи различимы.
                if ai % 2 == 1:
                    _mirror_rooms_x(rooms, aw)

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
    "wardrobe", "storage",
})
"""Какие комнаты должны иметь хотя бы одну дверь (для попадания внутрь)."""


def _add_apertures(
    rooms: list[LayoutRoom],
    apt_d: float,
    exterior_side: str,   # "S" — низ Y, "N" — верх Y
    interior_side: str,   # противоположная exterior_side
    *,
    apt_w: float | None = None,   # требуется для W/E facades (tower)
    extra_facade_sides: tuple[str, ...] = (),
    allow_multiple_windows: bool = False,  # True для угловых (tower) — окна на 2 фасада
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

    extra_facade_sides — дополнительные стороны, которые тоже считаются
    внешним фасадом (для частного дома, где и S, и N — фасады).
    """
    # Найдём прихожую (для определения куда вешать двери комнат)
    hallway = next((r for r in rooms if r.kind == "hallway"), None)

    facade_sides = (exterior_side, *extra_facade_sides)

    for room in rooms:
        # ── Окна ─────────────────────────────────────────────────────
        if room.kind in _WINDOW_KINDS:
            for side in facade_sides:
                window = _make_window_on_facade(room, apt_d, side, apt_w=apt_w)
                if window is not None:
                    room.windows.append(window)
                    if not allow_multiple_windows:
                        break  # одной стороны достаточно (для непанорамных)

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


# ── Зеркало по оси X (для соседних квартир МКД) ──────────────────────────


def _mirror_rooms_x(rooms: list[LayoutRoom], apt_w: float) -> None:
    """Отразить раскладку по оси X (in-place).

    Архитектурная норма МКД: соседние квартиры зеркалят друг друга, чтобы
    мокрые зоны (кухня, санузлы) встали спина к спине — общий стояк
    сантехники между двумя квартирами = экономия инженерки. Заодно
    визуально соседние квартиры различаются.
    """
    for r in rooms:
        r.x = round(apt_w - r.x - r.w, 3)
        # Мебель внутри комнаты — тоже отражаем по X
        for f in r.furniture:
            f.x = round(r.w - f.x - f.w, 3)
        # Двери и окна на S/N стене (горизонтальной) — смещение offset
        # отсчитывается от W-кромки. После mirror W↔E, offset меняется.
        # Для W/E стен — стена «меняет сторону»: W становится E и наоборот.
        for d in r.doors:
            if d.side == "W":
                d.side = "E"
            elif d.side == "E":
                d.side = "W"
            elif d.side in ("S", "N"):
                d.offset = round(r.w - d.offset - d.width, 3)
            # Петля тоже меняет сторону при mirror
            d.hinge = "right" if d.hinge == "left" else "left"
        for win in r.windows:
            if win.side == "W":
                win.side = "E"
            elif win.side == "E":
                win.side = "W"
            elif win.side in ("S", "N"):
                win.offset = round(r.w - win.offset - win.width, 3)


# ── Балконы / лоджии (Phase B) ────────────────────────────────────────────


_LOGGIA_D = 1.4           # глубина лоджии (м), типично для МКД РК/РФ
_LOGGIA_MIN_REMAIN_D = 2.5  # минимальная глубина комнаты ПОСЛЕ выреза
_BALCONY_DOOR_W = 0.9     # ширина балконной двери


def _add_balconies(
    rooms: list[LayoutRoom],
    apt_d: float,
    apt_type: str,
    exterior_side: str,    # "S" или "N" — где фасад квартиры
) -> None:
    """Добавить лоджии к фасадным жилым комнатам квартиры (in-place).

    Алгоритм:
      1. Найти жилые комнаты, физически касающиеся внешнего фасада.
      2. Отсортировать — гостиная первой, спальни потом.
      3. Для studio/1k — 1 лоджия (у гостиной).
         Для 2k/3k — 2 лоджии (у гостиной + у одной спальни).
      4. Вырезать из комнаты полосу глубиной _LOGGIA_D со стороны фасада,
         сама комната сдвигается вглубь.
      5. Перенести окно, которое было на фасадной стене комнаты, на
         внешнюю стену лоджии (физически окно осталось на том же месте,
         но теперь принадлежит лоджии).
      6. Добавить балконную дверь между комнатой и лоджией.
    """
    n_target = 1 if apt_type in ("studio", "1k") else 2

    # Кандидаты: жилые комнаты, касающиеся фасада с запасом глубины
    candidates: list[LayoutRoom] = []
    for room in rooms:
        if room.kind not in ("living", "bedroom"):
            continue
        if exterior_side == "S":
            touches_facade = abs(room.y) < 0.01
        else:  # "N"
            touches_facade = abs(room.y + room.d - apt_d) < 0.01
        if not touches_facade:
            continue
        if room.d < _LOGGIA_D + _LOGGIA_MIN_REMAIN_D:
            continue
        candidates.append(room)

    # Гостиная приоритетнее спален
    candidates.sort(key=lambda r: 0 if r.kind == "living" else 1)

    new_balconies: list[LayoutRoom] = []
    for parent in candidates[:n_target]:
        if exterior_side == "S":
            balcony_y = parent.y      # лоджия на фасаде S (y=0 в системе квартиры)
            new_parent_y = parent.y + _LOGGIA_D
        else:
            balcony_y = parent.y + parent.d - _LOGGIA_D
            new_parent_y = parent.y   # parent.y не двигается, уменьшается только d

        balcony = LayoutRoom(
            kind="balcony",
            name_ru="Лоджия",
            x=parent.x,
            y=round(balcony_y, 3),
            w=parent.w,
            d=_LOGGIA_D,
        )

        # Перенос окон с фасадной стороны parent → balcony.
        # На balcony окно остаётся на той же стороне (это та же физическая
        # стена дома, просто теперь принадлежит лоджии).
        for window in parent.windows[:]:
            if window.side == exterior_side:
                parent.windows.remove(window)
                balcony.windows.append(window)

        # Балконная дверь на parent: на той стороне, где теперь лоджия
        # (бывшая фасадная сторона — теперь стена parent ↔ balcony).
        bd_offset = max(0.1, (parent.w - _BALCONY_DOOR_W) / 2)
        parent.doors.append(LayoutDoor(
            side=exterior_side,           # type: ignore[arg-type]
            offset=round(bd_offset, 3),
            width=_BALCONY_DOOR_W,
            swing="in",
            hinge="left",
        ))

        # Сжимаем parent
        parent.y = round(new_parent_y, 3)
        parent.d = round(parent.d - _LOGGIA_D, 3)

        new_balconies.append(balcony)

    rooms.extend(new_balconies)


def _make_window_on_facade(
    room: LayoutRoom, apt_d: float, exterior_side: str,
    *, apt_w: float | None = None,
) -> LayoutWindow | None:
    """Окно на фасадной стене комнаты, если она физически касается фасада.

    Для W/E фасадов нужно передать apt_w (ширину квартиры). Без него
    функция вернёт None — backward-совместимо для S/N-only callers.
    """
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
    elif exterior_side == "W":
        if apt_w is None or room.x > 0.01:
            return None
        side = "W"
        stretch = room.d
    elif exterior_side == "E":
        if apt_w is None or abs(room.x + room.w - apt_w) > 0.01:
            return None
        side = "E"
        stretch = room.d
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


# ── Мебель ────────────────────────────────────────────────────────────────


# Стандартные размеры мебели (метры, в неповёрнутом виде: width × depth)
_FURN_SIZES: dict[str, tuple[float, float]] = {
    "bed":          (1.6, 2.0),
    "wardrobe":     (2.0, 0.6),
    "nightstand":   (0.5, 0.4),
    "sofa":         (2.4, 0.9),
    "coffee_table": (1.1, 0.6),
    "tv":           (1.4, 0.2),
    "stove":        (0.6, 0.6),
    "sink":         (0.8, 0.6),
    "fridge":       (0.6, 0.65),
    "dining_table": (1.4, 0.8),
    "bathtub":      (1.7, 0.7),
    "toilet":       (0.4, 0.7),
    "washbasin":    (0.6, 0.45),
    "armchair":     (0.8, 0.85),
}


def _add_furniture(room: LayoutRoom, exterior_side: str) -> None:
    """Расставить детерминированно мебель внутри room (in-place).

    Логика — упрощённая, для визуальной правдоподобности:
      • Кровать/диван — спинкой к стене, противоположной окну
      • В кухне — кухонный фронт вдоль одной из боковых стен
      • В сан.узлах — ванна/унитаз/раковина по разным стенам
    """
    rw, rd = room.w, room.d
    # back_y — y-координата стены, противоположной окну (фасаду)
    # Если фасад S (окно внизу) → back_wall наверху (y близко к rd)
    # Если фасад N → back_wall внизу (y = 0)
    if exterior_side == "S":
        back_y_pos = "top"        # мебель «спинкой к северной стене»
    else:
        back_y_pos = "bottom"     # мебель «спинкой к южной стене»

    items: list[LayoutFurniture] = []

    if room.kind == "bedroom":
        # Кровать у дальней от окна стены, по центру по X
        bed_w, bed_d = _FURN_SIZES["bed"]
        if rw >= bed_w + 0.4 and rd >= bed_d + 0.8:
            bx = (rw - bed_w) / 2
            by = (rd - bed_d - 0.1) if back_y_pos == "top" else 0.1
            items.append(LayoutFurniture(
                kind="bed", x=round(bx, 3), y=round(by, 3),
                w=bed_w, d=bed_d, rotation=0,
            ))
            # Прикроватные тумбы — слева и справа от кровати
            ns_w, ns_d = _FURN_SIZES["nightstand"]
            ns_y = by + (bed_d - ns_d) / 2
            if bx - ns_w >= 0.05:
                items.append(LayoutFurniture(
                    kind="nightstand", x=round(bx - ns_w - 0.05, 3),
                    y=round(ns_y, 3), w=ns_w, d=ns_d, rotation=0,
                ))
            if bx + bed_w + ns_w <= rw - 0.05:
                items.append(LayoutFurniture(
                    kind="nightstand", x=round(bx + bed_w + 0.05, 3),
                    y=round(ns_y, 3), w=ns_w, d=ns_d, rotation=0,
                ))
        # Шкаф — у боковой стены, если место есть
        wb_w, wb_d = _FURN_SIZES["wardrobe"]
        if rw >= wb_w + 0.4 and rd >= 3.5:
            wb_x = (rw - wb_w) / 2
            wb_y = 0.0 if back_y_pos == "top" else rd - wb_d
            items.append(LayoutFurniture(
                kind="wardrobe", x=round(wb_x, 3), y=round(wb_y, 3),
                w=wb_w, d=wb_d, rotation=0,
            ))

    elif room.kind == "living":
        # Диван спинкой к back-стене, по центру
        s_w, s_d = _FURN_SIZES["sofa"]
        if rw >= s_w + 0.3 and rd >= s_d + 1.0:
            sx = (rw - s_w) / 2
            sy = (rd - s_d - 0.1) if back_y_pos == "top" else 0.1
            items.append(LayoutFurniture(
                kind="sofa", x=round(sx, 3), y=round(sy, 3),
                w=s_w, d=s_d, rotation=0,
            ))
            # Журнальный столик перед диваном (отступ 0.4 м)
            ct_w, ct_d = _FURN_SIZES["coffee_table"]
            ct_x = (rw - ct_w) / 2
            ct_y = (sy - ct_d - 0.4) if back_y_pos == "top" else (sy + s_d + 0.4)
            if ct_y >= 0 and ct_y + ct_d <= rd:
                items.append(LayoutFurniture(
                    kind="coffee_table", x=round(ct_x, 3), y=round(ct_y, 3),
                    w=ct_w, d=ct_d, rotation=0,
                ))
            # ТВ у противоположной стены
            tv_w, tv_d = _FURN_SIZES["tv"]
            tv_x = (rw - tv_w) / 2
            tv_y = 0.05 if back_y_pos == "top" else (rd - tv_d - 0.05)
            items.append(LayoutFurniture(
                kind="tv", x=round(tv_x, 3), y=round(tv_y, 3),
                w=tv_w, d=tv_d, rotation=0,
            ))

    elif room.kind == "kitchen":
        # Кухонный фронт — непрерывная столешница 0.6 м у стены, противоположной окну.
        # На ней последовательно (без зазоров) стоят: холодильник, плита, мойка.
        # «Холодильник-плита-мойка» — стандартный фронт по СП и эргономике.
        counter_d = 0.6
        counter_y = 0.0 if back_y_pos == "bottom" else rd - counter_d
        fridge_w = _FURN_SIZES["fridge"][0]
        stove_w  = _FURN_SIZES["stove"][0]
        sink_w   = _FURN_SIZES["sink"][0]
        appliances_w = fridge_w + stove_w + sink_w   # 2.0 м минимум
        # Столешница: тянем максимум до конца стены (минимум — длина приборов + 0.4 м столешницы между ними).
        counter_w = min(rw - 0.2, max(appliances_w + 0.6, rw * 0.6))
        counter_x = 0.1
        items.append(LayoutFurniture(
            kind="kitchen_counter", x=counter_x, y=round(counter_y, 3),
            w=round(counter_w, 3), d=counter_d, rotation=0,
        ))
        # Раскладка приборов: fridge → stove → sink, упёрты в левый край счётчика.
        x = counter_x
        for kind, kw in (("fridge", fridge_w), ("stove", stove_w), ("sink", sink_w)):
            if x + kw > counter_x + counter_w - 0.001:
                break
            items.append(LayoutFurniture(
                kind=kind, x=round(x, 3), y=round(counter_y, 3),
                w=kw, d=counter_d, rotation=0,
            ))
            x += kw
        # Обеденный стол по центру свободной зоны (за фронтом)
        dt_w, dt_d = _FURN_SIZES["dining_table"]
        free_d = rd - counter_d
        if rw >= dt_w + 0.4 and free_d >= dt_d + 0.5:
            dt_x = (rw - dt_w) / 2
            # центр оставшейся зоны
            if back_y_pos == "bottom":
                free_y0 = counter_d
            else:
                free_y0 = 0.0
            dt_y = free_y0 + (free_d - dt_d) / 2
            items.append(LayoutFurniture(
                kind="dining_table", x=round(dt_x, 3), y=round(dt_y, 3),
                w=dt_w, d=dt_d, rotation=0,
            ))

    elif room.kind == "bathroom":
        # Ванна вдоль длинной стены
        b_w, b_d = _FURN_SIZES["bathtub"]
        if rw >= b_w + 0.2 and rd >= b_d + 0.4:
            items.append(LayoutFurniture(
                kind="bathtub", x=round((rw - b_w) / 2, 3), y=0.05,
                w=b_w, d=b_d, rotation=0,
            ))
            # Унитаз и раковина — у противоположной стены, рядом
            t_w, t_d = _FURN_SIZES["toilet"]
            wb_w2, wb_d2 = _FURN_SIZES["washbasin"]
            row_y = rd - max(t_d, wb_d2) - 0.05
            total = t_w + wb_w2 + 0.1
            row_x = (rw - total) / 2
            items.append(LayoutFurniture(
                kind="toilet", x=round(row_x, 3), y=round(row_y + (max(t_d, wb_d2) - t_d), 3),
                w=t_w, d=t_d, rotation=0,
            ))
            items.append(LayoutFurniture(
                kind="washbasin", x=round(row_x + t_w + 0.1, 3),
                y=round(row_y + (max(t_d, wb_d2) - wb_d2), 3),
                w=wb_w2, d=wb_d2, rotation=0,
            ))
        else:
            # Маленький сан.узел: только унитаз и раковина
            t_w, t_d = _FURN_SIZES["toilet"]
            wb_w2, wb_d2 = _FURN_SIZES["washbasin"]
            if rw >= t_w + 0.1 and rd >= t_d + 0.1:
                items.append(LayoutFurniture(
                    kind="toilet", x=0.05, y=0.05,
                    w=t_w, d=t_d, rotation=0,
                ))
            if rw >= t_w + wb_w2 + 0.2 and rd >= max(t_d, wb_d2) + 0.1:
                items.append(LayoutFurniture(
                    kind="washbasin", x=round(t_w + 0.15, 3), y=0.05,
                    w=wb_w2, d=wb_d2, rotation=0,
                ))

    elif room.kind == "toilet":
        t_w, t_d = _FURN_SIZES["toilet"]
        wb_w2, wb_d2 = _FURN_SIZES["washbasin"]
        if rw >= t_w + 0.1 and rd >= t_d + 0.1:
            items.append(LayoutFurniture(
                kind="toilet", x=round((rw - t_w) / 2, 3),
                y=round(rd - t_d - 0.1, 3),
                w=t_w, d=t_d, rotation=0,
            ))
        if rw >= wb_w2 + 0.1 and rd >= t_d + wb_d2 + 0.2:
            items.append(LayoutFurniture(
                kind="washbasin", x=round((rw - wb_w2) / 2, 3), y=0.05,
                w=wb_w2, d=wb_d2, rotation=0,
            ))

    # hallway / loggia / storage — пустые

    room.furniture.extend(items)


# ── Вспомогательные функции ───────────────────────────────────────────────


def _make_cores(
    core_x: float, core_y: float,
    n_pass: int, n_freight: int,
    *,
    core_d: float = _CORE_D,
) -> list[LayoutCore]:
    """Сформировать ядро секции: пассажирские лифты + лестница + грузовые.

    Минимум 1 пассажирский лифт и 1 лестница всегда. Грузовой лифт
    включается только если n_freight ≥ 1.
    """
    cores: list[LayoutCore] = []
    x = core_x
    # Компактные размеры — лифт квадратный 1.8×2.0, лестница 2.5×3.
    # Все помещаются в core_d=3м зону (лифтовый холл).
    lift_p_w = 1.8
    lift_f_w = 2.1
    stair_w  = 2.5
    lift_d = min(2.0, core_d)
    freight_d = min(lift_f_w, core_d)
    stair_d = core_d   # лестница на всю глубину corridor strip

    n_pass_eff = max(1, n_pass)
    n_freight_eff = max(0, n_freight)   # допускаем 0 грузовых

    for _ in range(n_pass_eff):
        cores.append(LayoutCore(kind="lift_passenger", x=round(x, 3), y=core_y, w=lift_p_w, d=lift_d))
        x += lift_p_w

    cores.append(LayoutCore(kind="stair", x=round(x, 3), y=core_y, w=stair_w, d=stair_d))
    x += stair_w

    for _ in range(n_freight_eff):
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
        "4k":     getattr(inputs, "k4_pct", 0.0),
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
