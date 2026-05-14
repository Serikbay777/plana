"""Раннер всех зарегистрированных валидаторов.

Каждый валидатор — модуль с функцией `check(project) -> Iterable[Violation]`.
Регистрация — явно через список `_VALIDATORS` (никакого магического discovery).

Если валидатор крашится — ловим, превращаем в `severity="warning"` запись,
чтобы один сломанный чек не валил всю проверку.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from ..domain import Project
from . import coverage, floors, height, rooms, setbacks
from .base import Violation


_ValidatorFn = Callable[[Project], Iterable[Violation]]

_VALIDATORS: list[tuple[str, _ValidatorFn]] = [
    ("setbacks", setbacks.check),
    ("coverage", coverage.check),
    ("height",   height.check),
    ("floors",   floors.check),
    ("rooms",    rooms.check),
]


def validate_project(project: Project) -> list[Violation]:
    """Прогнать все валидаторы по проекту и собрать список нарушений."""
    out: list[Violation] = []
    for name, fn in _VALIDATORS:
        try:
            out.extend(fn(project))
        except Exception as exc:  # noqa: BLE001
            out.append(Violation(
                rule=f"validator.{name}.crashed",
                severity="warning",
                message=f"Валидатор «{name}» упал: {exc}",
            ))
    return out


__all__ = ["validate_project"]
