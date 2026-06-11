"""Проверка КИТ: общая поэтажная площадь / площадь участка <= max_far.

КИТ (коэффициент использования территории, он же FAR) — ключевой лимит
плотности из ПДП/ГПЗУ. Источник: `Site.gpzu.max_far`. Если в ГПЗУ значение
не указано (None / 0) — валидатор молча пропускает.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation


def check(project: Project) -> Iterable[Violation]:
    gpzu_max = project.site.gpzu.max_far
    if gpzu_max is None or gpzu_max <= 0:
        return

    actual = project.far
    if actual > gpzu_max:
        yield Violation(
            rule="far.exceeded",
            severity="error",
            message=(
                f"КИТ {actual:.2f} превышает предельный по ГПЗУ/ПДП "
                f"({gpzu_max:.2f})."
            ),
            norm="ГПЗУ/ПДП, КИТ (коэффициент использования территории)",
            actual=actual,
            expected=gpzu_max,
        )
    elif actual > gpzu_max * 0.9:
        yield Violation(
            rule="far.near_limit",
            severity="info",
            message=(
                f"КИТ {actual:.2f} близок к лимиту ГПЗУ/ПДП "
                f"({gpzu_max:.2f}) — запас < 10%."
            ),
            norm="ГПЗУ/ПДП, КИТ (коэффициент использования территории)",
            actual=actual,
            expected=gpzu_max,
        )


__all__ = ["check"]
