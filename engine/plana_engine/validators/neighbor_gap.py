"""Проверка противопожарного разрыва до соседних зданий.

Минимальное расстояние между зданиями по СНиП РК 3.01-01 (противопожарные
разрывы) зависит от степени огнестойкости: 6–15 м. Точную степень соседей из
GIS мы не знаем, поэтому проверяем против минимального норматива (6 м) и выдаём
warning (не error). Источник соседей: `Site.neighbors` (полигоны в локальном
фрейме участка, из importers.site_context). Если соседей нет — молчит.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation

_MIN_FIRE_GAP_M = 6.0   # минимальный противопожарный разрыв, СНиП РК 3.01-01
_MIN_NEIGHBOR_AREA_M2 = 10.0  # отсечь шум (киоски/навесы) из «Существующих зданий»


def check(project: Project) -> Iterable[Violation]:
    neighbors = [n for n in project.site.neighbors if n.area >= _MIN_NEIGHBOR_AREA_M2]
    if not neighbors:
        return

    for i, b in enumerate(project.buildings):
        # ближайший сосед
        nearest = min(neighbors, key=lambda n: b.footprint.distance(n))
        gap = b.footprint.distance(nearest)
        if gap < _MIN_FIRE_GAP_M:
            yield Violation(
                rule="neighbor_gap.too_close",
                severity="warning",
                message=(
                    f"Пятно здания #{i+1} в {gap:.1f} м от соседнего строения — "
                    f"меньше минимального противопожарного разрыва "
                    f"({_MIN_FIRE_GAP_M:.0f} м)."
                ),
                norm="СНиП РК 3.01-01, противопожарные разрывы",
                actual=round(gap, 1),
                expected=_MIN_FIRE_GAP_M,
                target=f"building[{i}]",
            )


__all__ = ["check"]
