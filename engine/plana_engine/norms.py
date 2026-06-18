"""Нормативная база посадки (KZ / г. Астана) — единый источник коэффициентов.

Назначение: собрать в ОДНОМ месте нормативные множители, которые сейчас
захардкожены по движку (saleable 0.55, parking 1.0, mix площадей 30/45/65/90),
и недостающие нормы (озеленение, обеспеченность). Это превращает 5 «слабых»
ТЭП (паркинг, квартиры, продаваемая площадь, объём, озеленение) в считаемые
из одного конфига по классу жилья.

ВАЖНО про статус данных:
- CLIMATE_ASTANA и OBESPECHENNOST — реальные цитируемые нормы (см. ссылки).
- CLASS_NORMS — ЧЕРНОВЫЕ коэффициенты по классам (помечены DRAFT). Точные
  значения берутся из: (а) ГПЗУ конкретного участка → importers/gpzu.py,
  (б) градрегламента маслихата Астаны №312/39-VI (24.09.2018, не оцифрован),
  (в) калибровки на реальных отводах (Zem_otvody_GU, ~235 живых ЖК).
  До калибровки это разумные дефолты, НЕ утверждённая политика.

Источники:
- СНиП РК 3.01-01 Ас-2007 «Планировка и застройка города Астаны» — озеленение,
  паркинг/АЗС, удалённость аэропорта.
- СНиП РК 3.01-01-2013 — обеспеченность соцобъектами (на 1000 чел).
- Генплан Астаны до 2035 (АСТАНАГЕНПЛАН, 2023) — жилобеспеченность 30 м²/чел,
  автомобилизация 350/1000 ≈ 1 авто/домохозяйство (домохозяйство = 3.1 чел),
  климатические константы (МС Нур-Султан), отопительный период 210 дней.
- СН РК 3.02-43-2007 п.1.2 — жилые >75 м требуют спец-ТУ (см. validators/height).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ── Класс жилья ───────────────────────────────────────────────────────────────


class HousingClass(str, Enum):
    """Класс жилья — девелоперская (BI Group) 5-ступенчатая шкала.

    стандарт < комфорт < комфорт+ < бизнес < премиум (по возрастанию класса).
    Выбрана как основная (продуктовое решение) — ближе к языку BI Group.

    ВНИМАНИЕ к данным: в гос-отводах (Zem_otvody_GU) и законодательстве РК
    другая шкала из 4 классов с ОБРАТНОЙ нумерацией: I=элит(высший) … IV=эконом
    (низший). normalize_housing_class() сводит обе шкалы в эту:
    эконом/IV→стандарт, комфорт/III→комфорт, бизнес/II→бизнес, элит/I→премиум.
    Поэтому «класс=4 / IV» в отводах = СТАНДАРТ (массовое жильё), не премиум.
    """

    STANDARD = "standard"          # стандарт (≈ эконом / IV)
    COMFORT = "comfort"            # комфорт (≈ III)
    COMFORT_PLUS = "comfort_plus"  # комфорт+
    BUSINESS = "business"          # бизнес (≈ II)
    PREMIUM = "premium"            # премиум (≈ элит / I)


# Нормализация «грязного» класса из отводов/форм/BI → enum.
# Принимает BI-названия, законные I–IV / эконом-элит, цифры. Класс приходит
# как "4", "IV", " IV", "комфорт", "премиум", "стандарт" и т.п.
_CLASS_ALIASES: dict[str, HousingClass] = {
    # стандарт ≈ эконом ≈ IV (низший)
    "стандарт": HousingClass.STANDARD, "standard": HousingClass.STANDARD,
    "эконом": HousingClass.STANDARD, "эконом-класс": HousingClass.STANDARD,
    "iv": HousingClass.STANDARD, "4": HousingClass.STANDARD,
    # комфорт ≈ III
    "комфорт": HousingClass.COMFORT, "comfort": HousingClass.COMFORT,
    "iii": HousingClass.COMFORT, "3": HousingClass.COMFORT,
    # комфорт+
    "комфорт+": HousingClass.COMFORT_PLUS, "комфортплюс": HousingClass.COMFORT_PLUS,
    "comfort+": HousingClass.COMFORT_PLUS, "comfortplus": HousingClass.COMFORT_PLUS,
    # бизнес ≈ II
    "бизнес": HousingClass.BUSINESS, "business": HousingClass.BUSINESS,
    "ii": HousingClass.BUSINESS, "2": HousingClass.BUSINESS,
    # премиум ≈ элит ≈ I (высший)
    "премиум": HousingClass.PREMIUM, "premium": HousingClass.PREMIUM,
    "элит": HousingClass.PREMIUM, "элитный": HousingClass.PREMIUM,
    "элит-класс": HousingClass.PREMIUM, "luxury": HousingClass.PREMIUM,
    "i": HousingClass.PREMIUM, "1": HousingClass.PREMIUM,
}


def normalize_housing_class(raw: str | None) -> HousingClass | None:
    """Привести грязное значение класса к enum. None если не распознано."""
    if not raw:
        return None
    key = str(raw).strip().lower().replace(" ", "").rstrip(".")
    return _CLASS_ALIASES.get(key)


# ── Нормы по классу жилья (DRAFT — до калибровки) ────────────────────────────


@dataclass(frozen=True)
class ClassNorms:
    """Нормативные коэффициенты для одного класса жилья.

    parking_per_apt   — машино-мест на квартиру (заменяет хардкод 1.0).
    saleable_ratio    — доля продаваемой площади от общей (заменяет 0.55).
    green_pct_of_plot — % озеленения участка (ориентир, уточняется ГПЗУ/ПДП).
    apt_area_m2       — типовые площади квартир (студия/1к/2к/3к), м².
    """

    parking_per_apt: float
    saleable_ratio: float
    green_pct_of_plot: float
    apt_area_m2: dict[str, float] = field(
        default_factory=lambda: {"studio": 30.0, "k1": 45.0, "k2": 65.0, "k3": 90.0}
    )


# parking_per_apt — КАЛИБРОВАН на 235 реальных отводах Астаны (Zem_otvody_GU,
#   2026-06-11): медиана namber_parcing/apart по классам = стандарт 0.7 (n=196),
#   комфорт 1.2 (n=10), бизнес 2.3 (n=5). Реальные стройки дают БОЛЬШЕ «законного
#   минимума» (эконом норм. ~0). Стандарт/комфорт — крепко; comfort+/premium нет
#   данных → монотонная интерполяция; бизнес n=5 → консервативно (1.9, не 2.3).
# saleable_ratio + apt_area_m2 — НЕ калиброваны (в отводах нет продаваемой
#   площади; living_area/house_area=0.34 — другой метрикой). Статус DRAFT,
#   уточнить по 312/39-VI + ГПЗУ. м²/чел якорь: эконом ~15→комфорт ≤18→элит >25.
CLASS_NORMS: dict[HousingClass, ClassNorms] = {
    HousingClass.STANDARD: ClassNorms(       # ≈ эконом (IV)
        parking_per_apt=0.7, saleable_ratio=0.62, green_pct_of_plot=12.0,
        apt_area_m2={"studio": 28.0, "k1": 40.0, "k2": 58.0, "k3": 78.0},
    ),
    HousingClass.COMFORT: ClassNorms(        # ≈ III
        parking_per_apt=1.2, saleable_ratio=0.58, green_pct_of_plot=16.0,
        apt_area_m2={"studio": 32.0, "k1": 45.0, "k2": 65.0, "k3": 90.0},
    ),
    HousingClass.COMFORT_PLUS: ClassNorms(   # между комфорт и бизнес (интерполяция)
        parking_per_apt=1.5, saleable_ratio=0.56, green_pct_of_plot=18.0,
        apt_area_m2={"studio": 36.0, "k1": 52.0, "k2": 74.0, "k3": 100.0},
    ),
    HousingClass.BUSINESS: ClassNorms(       # ≈ II (факт 2.3 при n=5 → консервативно)
        parking_per_apt=1.9, saleable_ratio=0.54, green_pct_of_plot=20.0,
        apt_area_m2={"studio": 42.0, "k1": 60.0, "k2": 85.0, "k3": 120.0},
    ),
    HousingClass.PREMIUM: ClassNorms(        # ≈ элит (I): нет данных, выше бизнеса
        parking_per_apt=2.3, saleable_ratio=0.50, green_pct_of_plot=24.0,
        apt_area_m2={"studio": 50.0, "k1": 72.0, "k2": 105.0, "k3": 150.0},
    ),
}

# Дефолт, когда класс не задан/не распознан (комфорт — самый частый).
DEFAULT_CLASS = HousingClass.COMFORT


def norms_for(housing_class: HousingClass | str | None) -> ClassNorms:
    """Вернуть нормы по классу; принимает enum, грязную строку или None."""
    if isinstance(housing_class, HousingClass):
        return CLASS_NORMS[housing_class]
    hc = normalize_housing_class(housing_class) or DEFAULT_CLASS
    return CLASS_NORMS[hc]


def parking_ratio(housing_class: HousingClass | str | None, override: float = 0.0) -> float:
    """Машино-мест на квартиру: явный ввод юзера (override > 0) или норма класса.

    override = 0 / None трактуется как «не задано → взять норму по классу»
    (стандарт 0.4 … премиум 1.8). Заменяет прежний плоский дефолт 1.0.
    """
    if override and override > 0:
        return override
    return norms_for(housing_class).parking_per_apt


def green_area_m2(site_area_m2: float, housing_class: HousingClass | str | None) -> float:
    """Нормативная площадь озеленения участка = площадь × %озеленения(класс).

    ТЭП на стадии посадки = норматив по классу (фактической геометрии озеленения
    ещё нет). Процент уточняется ГПЗУ/ПДП конкретного участка.
    """
    return site_area_m2 * norms_for(housing_class).green_pct_of_plot / 100.0


# Наземное машино-место с долей проезда/манёвра — DRAFT (≈2.5×5.3 стоянка +
# проезд/разворот). Уточнить по паркинг-нормам РК (см. ресерч норм / СН РК 3.01-01).
SURFACE_PARKING_SPACE_M2 = 25.0


def surface_parking_area_m2(spaces: float) -> float:
    """Площадь наземного паркинга, м² = число мест × норма места (с проездом)."""
    return max(0.0, spaces) * SURFACE_PARKING_SPACE_M2


def avg_apartment_area_m2(
    housing_class: HousingClass | str | None,
    studio_pct: float, k1_pct: float, k2_pct: float, k3_pct: float,
) -> float:
    """Средняя площадь квартиры по миксу типов (площади типов — из норм класса)."""
    s = studio_pct + k1_pct + k2_pct + k3_pct
    if s < 0.01:
        return 50.0
    a = norms_for(housing_class).apt_area_m2
    return (a["studio"] * studio_pct + a["k1"] * k1_pct
            + a["k2"] * k2_pct + a["k3"] * k3_pct) / s


def estimate_apartments(
    gfa_m2: float,
    housing_class: HousingClass | str | None,
    studio_pct: float, k1_pct: float, k2_pct: float, k3_pct: float,
) -> int:
    """Число квартир из общей площади: GFA × продаваемая доля / ср. площадь кв."""
    avg = avg_apartment_area_m2(housing_class, studio_pct, k1_pct, k2_pct, k3_pct)
    if avg <= 0:
        return 0
    saleable = gfa_m2 * norms_for(housing_class).saleable_ratio
    return max(0, round(saleable / avg))


# ── Обеспеченность (город / на жителя) — СНиП РК ──────────────────────────────
# Это НЕ геометрия участка, а проверка «хватает ли на жителей» (4-й слой посадки).

OBESPECHENNOST = {
    "green_m2_per_capita": 19.0,        # СНиП РК 3.01-01 Ас-2007 (парки 10 + жилрайон 6 + скверы 2.5 + детск. 0.5)
    "housing_m2_per_capita_target": 30.0,  # генплан-2035, расчётная цель (тек. 21.1)
    "cars_per_1000": 350,               # генплан-2035 на 2050 ≈ 1 авто/домохозяйство
    "household_persons": 3.1,           # генплан-2035
    # СНиП РК 3.01-01-2013, на 1000 чел:
    "polyclinic_visits_per_shift_per_1000": 21.3,
    "kindergarten_pct_of_preschool_children": 70.0,
    "sport_hall_m2_per_1000": 80.0,
    "pool_water_mirror_m2_per_1000": 25.0,
}


# ── Климатические константы Астаны (МС Нур-Султан) ────────────────────────────
# Вход в стоимость (теплопотребление) и ориентацию/инсоляцию.

CLIMATE_ASTANA = {
    "heating_days": 210,                # 29.09–26.04 (СП РК 2.04-01-2017)
    "t_max_c": 26.8,                    # средн. макс. июля
    "t_min_c": -18.4,                   # средн. мин. января
    "snow_cover_days": 150,
    "avg_pressure_hpa": 977.5,
    "dominant_wind": "ЮЗ/Ю",            # ЮЗ 21% + Ю 20%
    # подтопление: 75% территории УГВ<2м — поправка к стоимости фундамента
    "shallow_groundwater_share": 0.75,
}


__all__ = [
    "HousingClass",
    "ClassNorms",
    "CLASS_NORMS",
    "DEFAULT_CLASS",
    "OBESPECHENNOST",
    "CLIMATE_ASTANA",
    "normalize_housing_class",
    "norms_for",
    "green_area_m2",
    "parking_ratio",
    "SURFACE_PARKING_SPACE_M2",
    "surface_parking_area_m2",
    "avg_apartment_area_m2",
    "estimate_apartments",
]
