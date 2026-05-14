"""Проверка предельной этажности по ГПЗУ.

Источник: `Site.gpzu.max_floors`. Если не указано — пропускаем.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation


def check(project: Project) -> Iterable[Violation]:
    gpzu_max = project.site.gpzu.max_floors
    if gpzu_max is None or gpzu_max <= 0:
        return

    for i, b in enumerate(project.buildings):
        if b.floors_count > gpzu_max:
            yield Violation(
                rule="floors.exceeded",
                severity="error",
                message=(
                    f"Этажность здания #{i+1} ({b.floors_count}) превышает "
                    f"предельную по ГПЗУ ({gpzu_max})."
                ),
                norm="ГПЗУ, предельная этажность",
                actual=float(b.floors_count),
                expected=float(gpzu_max),
                target=f"building[{i}]",
            )


__all__ = ["check"]
