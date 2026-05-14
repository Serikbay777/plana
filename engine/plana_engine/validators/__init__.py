"""Валидаторы архитектурного проекта поверх доменной модели + KZ-норм.

Использование:
    from plana_engine.validators import validate_project, Violation
    from plana_engine.domain import marketing_to_project

    project = marketing_to_project(inputs)
    violations = validate_project(project)

Текущий набор:
    setbacks  — пятно внутри site.buffer(-min_setback)
    coverage  — coverage_pct <= gpzu.max_coverage_pct
    height    — building.height_m <= gpzu.max_height_m + спец-ТУ для 75+
    floors    — building.floors_count <= gpzu.max_floors
    rooms     — минимальные площади помещений по СНиП РК 3.02-43-2007

База норм: research/kz-norms/.
"""

from __future__ import annotations

from .base import Severity, Violation
from .runner import validate_project

__all__ = ["Severity", "Violation", "validate_project"]
