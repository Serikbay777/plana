"""Проверка процента застройки: сумма пятен / площадь участка <= КИТ.

Источник: ГПЗУ -> `Site.gpzu.max_coverage_pct`. Если в ГПЗУ значение не
указано — валидатор молча пропускает.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from .base import Violation


def check(project: Project) -> Iterable[Violation]:
    gpzu_max = project.site.gpzu.max_coverage_pct
    if gpzu_max is None or gpzu_max <= 0:
        return

    actual = project.coverage_pct
    if actual > gpzu_max:
        yield Violation(
            rule="coverage.exceeded",
            severity="error",
            message=(
                f"Процент застройки {actual:.1f}% превышает предельный по "
                f"ГПЗУ ({gpzu_max:.1f}%)."
            ),
            norm="ГПЗУ, предельный процент застройки",
            actual=actual,
            expected=gpzu_max,
        )
    elif actual > gpzu_max * 0.9:
        yield Violation(
            rule="coverage.near_limit",
            severity="info",
            message=(
                f"Процент застройки {actual:.1f}% близок к лимиту ГПЗУ "
                f"({gpzu_max:.1f}%) — запас < 10%."
            ),
            norm="ГПЗУ, предельный процент застройки",
            actual=actual,
            expected=gpzu_max,
        )


__all__ = ["check"]
