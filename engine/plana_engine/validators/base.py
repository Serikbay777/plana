"""Базовые типы для валидаторов архитектурного проекта.

Каждый валидатор — функция `check(project: Project) -> Iterable[Violation]`.
Список нарушений собирается раннером (`validators.runner.validate_project`)
и возвращается из эндпоинта `/validate/project`.

Severity:
    error    — нарушение нормы, проект не пройдёт экспертизу как есть
    warning  — формально проходит, но риск или нестандарт
    info     — справочная заметка, не блокирует

Norm — ссылка на конкретный пункт нормативного документа РК
(см. `research/kz-norms/` для базы).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


Severity = Literal["error", "warning", "info"]


class Violation(BaseModel):
    """Одно зафиксированное нарушение / предупреждение / заметка."""

    rule: str                       # короткий ключ: "setback", "coverage", "room.min_area"
    severity: Severity              # "error" | "warning" | "info"
    message: str                    # человекочитаемое описание (RU)
    norm: str = ""                  # ссылка на СН/СП РК или пункт ГПЗУ
    actual: float | None = None     # наблюдаемое значение
    expected: float | None = None   # требуемое значение (предел/min)
    target: str = ""                # на что ссылается: "building[0]", "floor[3]/apt[5]/room[1]"


__all__ = ["Severity", "Violation"]
