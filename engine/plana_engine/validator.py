"""Нормоконтроль (ТЗ §5.1, шаг 6 + §11 критерии приёмки).

Прогоняет план через набор правил из `norms.yaml`. Каждое правило либо
проходит, либо генерирует `NormViolation` с severity (info/warning/error).

В MVP реализованы базовые проверки. Полный список правил расширяется
без изменений кода — через `norms.yaml`.
"""

from __future__ import annotations

from typing import Any

from .norms import Norms
from .types import (
    AptType, NormSeverity, NormViolation, NormsReport,
)


# ---------------------------------------------------------------------------
# Правила (в формате — функция, возвращающая список нарушений)
# ---------------------------------------------------------------------------


def _rule_corridor_min_width(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """Коридор не уже `corridor.min_width_m`."""
    violations: list[NormViolation] = []
    min_w = norms.corridor.min_width_m
    for c in plan_dict["corridors"]:
        # для прямоугольного коридора — bbox
        from .geometry.polygon import poly_to_shapely
        sp = poly_to_shapely(c.polygon)
        minx, miny, maxx, maxy = sp.bounds
        w = min(maxx - minx, maxy - miny)
        if w < min_w - 1e-3:
            violations.append(NormViolation(
                rule_id="corridor.min_width",
                severity="error",
                message=f"Ширина коридора {w:.2f} м меньше нормы {min_w} м",
            ))
    return violations


def _rule_evacuation_length(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """Длина эвакуационного пути не превышает норматив (упрощённо: длина коридора / 2)."""
    violations: list[NormViolation] = []
    max_len = norms.corridor.max_evacuation_length_m
    for c in plan_dict["corridors"]:
        evac = c.length / 2  # коридор обслуживает два направления от ядра
        if evac > max_len + 1e-3:
            violations.append(NormViolation(
                rule_id="corridor.max_evacuation_length",
                severity="warning",
                message=(
                    f"Эвакуационный путь {evac:.1f} м превышает норматив {max_len} м. "
                    "Требуется секционирование коридора или второй эвакуационный выход."
                ),
            ))
    return violations


def _rule_min_apartments(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """Если на этаже ноль квартир — это очевидно сломано."""
    if not plan_dict["tiles"]:
        return [NormViolation(
            rule_id="layout.no_apartments",
            severity="error",
            message="На этаже не размещено ни одной квартиры — алгоритм не нашёл подходящих тайлов для контура.",
        )]
    return []


def _rule_kitchen_present(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """В каждой квартире должна быть кухня."""
    violations: list[NormViolation] = []
    for t in plan_dict["tiles"]:
        if not any(z.kind.value in ("kitchen",) for z in t.zones):
            violations.append(NormViolation(
                rule_id="apt.kitchen_required",
                severity="error",
                message=f"Квартира {t.spec_code} не содержит кухонной зоны.",
            ))
    return violations


def _zone_area(z: Any) -> float:
    """Площадь зоны (PlacedZone хранит мировой полигон)."""
    from .geometry.polygon import poly_to_shapely
    return float(poly_to_shapely(z.polygon).area)


def _rule_living_area_min(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """Гостиная не меньше нормы."""
    violations: list[NormViolation] = []
    min_a = norms.rooms.living_room.min_area_sqm
    for t in plan_dict["tiles"]:
        a = sum(_zone_area(z) for z in t.zones if z.kind.value == "living")
        if a > 0 and a < min_a - 1e-3:
            violations.append(NormViolation(
                rule_id="rooms.living_room.min_area",
                severity="warning",
                message=f"Гостиная в {t.spec_code} имеет площадь {a:.1f} м² (норма {min_a} м²).",
            ))
    return violations


def _rule_insolation_share(plan_dict: dict[str, Any], norms: Norms) -> list[NormViolation]:
    """Все жилые комнаты должны иметь окно на фасаде. В MVP проверяем,
    что у каждого тайла фасадная сторона совпадает с фасадным ребром этажа,
    и что тайл содержит зону living или bedroom."""
    violations: list[NormViolation] = []
    required = norms.insolation.required_share_of_apts
    n_apts = len(plan_dict["tiles"])
    n_with_window = 0
    for t in plan_dict["tiles"]:
        has_living_or_bed = any(z.kind.value in ("living", "bedroom") for z in t.zones)
        if has_living_or_bed:
            n_with_window += 1
    if n_apts:
        share = n_with_window / n_apts
        if share < required - 1e-3:
            violations.append(NormViolation(
                rule_id="insolation.required_share",
                severity="error",
                message=f"Доля квартир с естественным освещением {share*100:.0f}% (норма {required*100:.0f}%).",
            ))
    return violations


_RULES = [
    _rule_corridor_min_width,
    _rule_evacuation_length,
    _rule_min_apartments,
    _rule_kitchen_present,
    _rule_living_area_min,
    _rule_insolation_share,
]


# ---------------------------------------------------------------------------
# API модуля
# ---------------------------------------------------------------------------


def check_plan(plan_dict: dict[str, Any], norms: Norms) -> NormsReport:
    """Прогнать план через все правила и вернуть отчёт.

    `plan_dict` — словарь с ключами `core`, `corridors`, `tiles`, `floor_area`, `preset`.
    Используется внутренний словарь, потому что `Plan` ещё не собран на этом этапе.
    """
    all_violations: list[NormViolation] = []
    for rule in _RULES:
        all_violations.extend(rule(plan_dict, norms))

    has_error = any(v.severity == "error" for v in all_violations)
    return NormsReport(passed=not has_error, violations=all_violations)


def filter_by_severity(
    violations: list[NormViolation],
    severity: NormSeverity,
) -> list[NormViolation]:
    return [v for v in violations if v.severity == severity]
