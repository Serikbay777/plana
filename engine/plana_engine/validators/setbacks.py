"""Проверка отступов: пятно застройки должно лежать внутри участка
после buffer(-setback).

Источник: СН РК 3.01-01-2013 «Градостроительство», СП РК 3.01-101-2013
(отступы, линии регулирования застройки), плюс параметры конкретного ГПЗУ.

Реализация:
    Берём минимальный отступ среди front/side/rear (worst-case изотропный
    буфер). Если building.footprint выходит за buffer(-min) контура участка —
    нарушение.

    Это conservative-проверка: реальные отступы анизотропные (разные с
    каждой стороны). Точную проверку добавим позже через 4 отдельных
    LineString'а сторон + distance, когда понадобится тонкая дифференциация
    "выступ только с фронта" vs "выступ со стороны".
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation


def check(project: Project) -> Iterable[Violation]:
    s = project.site.setbacks
    setbacks_declared = [
        ("front", s.front_m),
        ("side", s.side_m),
        ("rear", s.rear_m),
    ]
    nonzero = [(k, v) for k, v in setbacks_declared if v > 0]
    if not nonzero:
        return

    min_name, min_setback = min(nonzero, key=lambda kv: kv[1])
    boundary = project.site.boundary
    allowed = boundary.buffer(-min_setback)

    if allowed.is_empty:
        yield Violation(
            rule="setback.buffer_empty",
            severity="error",
            message=(
                f"Отступ {min_setback:.1f} м ({min_name}) больше половины "
                f"участка — застраивать негде."
            ),
            norm="СН РК 3.01-01-2013, отступы от линии застройки",
            actual=min_setback,
            expected=None,
        )
        return

    for i, b in enumerate(project.buildings):
        if not allowed.contains(b.footprint):
            yield Violation(
                rule="setback.outside",
                severity="error",
                message=(
                    f"Здание #{i+1} выступает за линию регулирования "
                    f"застройки (минимальный отступ {min_setback:.1f} м, "
                    f"сторона: {min_name})."
                ),
                norm="СП РК 3.01-101-2013, отступы по ГПЗУ",
                actual=None,
                expected=min_setback,
                target=f"building[{i}]",
            )


__all__ = ["check"]
