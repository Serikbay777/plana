"""Проверка предельной высоты зданий по ГПЗУ + спец-ТУ для жилых > 75 м.

Источник: `Site.gpzu.max_height_m` (если задано). Для жилых зданий выше
75 м — СНиП РК 3.02-43-2007 п. 1.2 требует специальных технических условий.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from ..types import BuildingPurpose
from .base import Violation


_RESIDENTIAL_SPECIAL_CONDITIONS_THRESHOLD = 75.0  # СНиП РК 3.02-43-2007 п. 1.2


def check(project: Project) -> Iterable[Violation]:
    gpzu_max = project.site.gpzu.max_height_m

    for i, b in enumerate(project.buildings):
        if gpzu_max is not None and gpzu_max > 0 and b.height_m > gpzu_max:
            yield Violation(
                rule="height.exceeded_gpzu",
                severity="error",
                message=(
                    f"Высота здания #{i+1} ({b.height_m:.1f} м) превышает "
                    f"предельную по ГПЗУ ({gpzu_max:.1f} м)."
                ),
                norm="ГПЗУ, предельная высота",
                actual=b.height_m,
                expected=gpzu_max,
                target=f"building[{i}]",
            )

        if (
            b.purpose
            in (BuildingPurpose.RESIDENTIAL, BuildingPurpose.MIXED_USE)
            and b.height_m > _RESIDENTIAL_SPECIAL_CONDITIONS_THRESHOLD
        ):
            yield Violation(
                rule="height.special_conditions",
                severity="warning",
                message=(
                    f"Жилое здание #{i+1} ({b.height_m:.1f} м) выше 75 м — "
                    f"требуются специальные технические условия."
                ),
                norm="СНиП РК 3.02-43-2007 п. 1.2",
                actual=b.height_m,
                expected=_RESIDENTIAL_SPECIAL_CONDITIONS_THRESHOLD,
                target=f"building[{i}]",
            )


__all__ = ["check"]
