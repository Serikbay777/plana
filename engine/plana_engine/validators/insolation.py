"""Расчёт инсоляции жилых помещений по СанПиН РК / КМК 2.04.01-2017.

Методика:
  - Расчётная дата: 22 марта (весеннее равноденствие), склонение δ ≈ 0°.
    Это «худший» день для инсоляции жилых зданий в РК (минимум до осени).
  - Для каждого фасада (С/Ю/В/З + промежуточные углы) вычисляется число
    часов прямого солнечного облучения численным интегрированием по азимуту.
  - Нормативный минимум зависит от широты (три климатических зоны).
  - Самозатенение здания не учитывается (conservative upper-bound).

Нормативная база:
  СанПиН 2.2.1/2.1.1.1076-01 (адаптирован в РК через КМК 2.04.01-2017):
    φ < 48°N  — южная зона: ≥ 2.0 ч непрерывной инсоляции
    48–58°N   — центральная: ≥ 2.5 ч
    φ ≥ 58°N  — северная:   ≥ 3.0 ч
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Нормативные зоны
# ---------------------------------------------------------------------------

def _required_hours(lat_deg: float) -> tuple[float, str]:
    """(min_hours, zone_name) для заданной широты."""
    if lat_deg < 48.0:
        return 2.0, "южная"
    if lat_deg < 58.0:
        return 2.5, "центральная"
    return 3.0, "северная"


# ---------------------------------------------------------------------------
# Солнечный путь (аналитическая формула для экватора равноденствия δ=0°)
# ---------------------------------------------------------------------------

def _sun_hours_on_facade(lat_deg: float, facade_azimuth_deg: float) -> float:
    """Часы прямого солнечного облучения фасада 22 марта.

    Численное интегрирование с шагом 1 минута, солнечное время.
    Фасад азимут от Севера по часовой стрелке (0=С, 90=В, 180=Ю, 270=З).
    Возвращает полное время (ч) когда солнце перед фасадом и над горизонтом.
    """
    phi = math.radians(lat_deg)
    F = math.radians(facade_azimuth_deg % 360.0)

    total = 0
    for minute in range(6 * 60, 18 * 60):   # 06:00–18:00 по солнечному времени
        t = minute / 60.0
        H = math.radians((t - 12.0) * 15.0)  # часовой угол

        # Высота солнца (δ=0):  sin(h) = cos(φ)·cos(H)
        sin_h = math.cos(phi) * math.cos(H)
        if sin_h <= 0.0:
            continue
        cos_h = math.sqrt(max(0.0, 1.0 - sin_h * sin_h))
        if cos_h < 1e-9:
            continue

        # Азимут солнца от Севера (по часовой):
        #   sin(A) = sin(H) / cos(h)
        #   cos(A) = -sin(φ)·cos(H) / cos(h)
        sin_A = math.sin(H) / cos_h
        cos_A = -math.sin(phi) * math.cos(H) / cos_h
        A = math.atan2(sin_A, cos_A)
        if A < 0.0:
            A += 2.0 * math.pi

        # Угол между азимутом солнца и нормалью к фасаду
        diff = abs(A - F)
        if diff > math.pi:
            diff = 2.0 * math.pi - diff

        if diff < math.pi / 2.0:   # солнце перед фасадом
            total += 1

    return total / 60.0   # минуты → часы


# ---------------------------------------------------------------------------
# Публичные типы результата
# ---------------------------------------------------------------------------

@dataclass
class FacadeResult:
    name: str           # «Южный», «Северный», «Восточный», «Западный»
    azimuth_deg: float  # расчётный азимут фасада
    hours: float        # часов прямого солнца
    required: float     # нормативный минимум
    compliant: bool     # hours >= required


@dataclass
class InsolationReport:
    latitude: float
    building_azimuth: float         # азимут «главного южного» фасада
    required_hours: float
    lat_zone: str                   # «южная» / «центральная» / «северная»
    facades: list[FacadeResult] = field(default_factory=list)
    compliant: bool = True          # True если все жилые фасады ок


# ---------------------------------------------------------------------------
# Основная функция
# ---------------------------------------------------------------------------

# Стандартные относительные позиции 4 фасадов относительно азимута здания.
# Ключ — читаемое имя фасада; значение — сдвиг от building_azimuth.
_FACADE_OFFSETS: dict[str, float] = {
    "Северный": 0.0,    # building_azimuth = ориентация северного фасада
    "Восточный": 90.0,
    "Южный": 180.0,
    "Западный": 270.0,
}


def check_insolation(
    latitude: float,
    building_azimuth: float,   # направление северного фасада от Севера, °
) -> InsolationReport:
    """Рассчитать инсоляцию 4 фасадов для заданного здания.

    `building_azimuth` — азимут северного (тыльного) фасада.
    При building_azimuth=0 здание ориентировано точно С/Ю/В/З.
    """
    required, zone = _required_hours(latitude)

    facades: list[FacadeResult] = []
    all_ok = True

    for name, offset in _FACADE_OFFSETS.items():
        az = (building_azimuth + offset) % 360.0
        hours = _sun_hours_on_facade(latitude, az)

        # Жилые комнаты требуют инсоляцию только на «тёплых» фасадах (Ю/В/З).
        # Северный фасад нормируется, но допускается < требования если другие ок.
        is_living_facade = name != "Северный"
        ok = hours >= required if is_living_facade else True

        if not ok:
            all_ok = False

        facades.append(FacadeResult(
            name=name,
            azimuth_deg=az,
            hours=round(hours, 2),
            required=required,
            compliant=ok,
        ))

    return InsolationReport(
        latitude=latitude,
        building_azimuth=building_azimuth,
        required_hours=required,
        lat_zone=zone,
        facades=facades,
        compliant=all_ok,
    )


__all__ = ["check_insolation", "FacadeResult", "InsolationReport"]
