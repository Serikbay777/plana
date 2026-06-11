"""Проверка красных линий: пятно застройки не должно их пересекать.

Красная линия (ЗК РК / градрегламент) — граница между застраиваемой территорией
и территорией общего пользования (улицы, проезды). Здание не может её
пересекать. Источник: `Site.red_lines` (полилинии, в локальном фрейме участка,
из importers.site_context). Если линий нет — валидатор молчит.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation

_EPS_M = 0.05  # порог длины пересечения, чтобы игнорировать касание в точке


def check(project: Project) -> Iterable[Violation]:
    red_lines = project.site.red_lines
    if not red_lines:
        return

    for i, b in enumerate(project.buildings):
        for line in red_lines:
            inter = b.footprint.intersection(line)
            if not inter.is_empty and inter.length > _EPS_M:
                yield Violation(
                    rule="red_lines.crossed",
                    severity="error",
                    message=(
                        f"Пятно здания #{i+1} пересекает красную линию "
                        f"(длина пересечения {inter.length:.1f} м) — застройка "
                        f"выходит за границу территории общего пользования."
                    ),
                    norm="ЗК РК / градрегламент, красные линии",
                    actual=round(inter.length, 1),
                    target=f"building[{i}]",
                )
                break  # одной фиксации на здание достаточно


__all__ = ["check"]
