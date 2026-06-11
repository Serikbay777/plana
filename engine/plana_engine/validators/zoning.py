"""Проверка соответствия назначения здания функциональной зоне участка.

Источник зоны: `Site.functional_zone` из градрегламента GIS (слой
«Градостроительный регламент»: Жилая / Коммерческая / Социальная / Иная).
Отвечает на вопрос UX «можно ли тут строить ЖК». Если зона не задана —
валидатор молчит (данных нет).
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project
from ..types import BuildingPurpose
from .base import Violation

_HOUSING_PURPOSES = {BuildingPurpose.RESIDENTIAL, BuildingPurpose.MIXED_USE}


def _zone_kind(raw: str) -> str:
    """Нормализовать «грязное» значение зоны (учёт опечатки «Жилапя»)."""
    z = (raw or "").strip().lower()
    if not z:
        return ""
    if z.startswith("жил"):          # Жилая, Жилапя (опечатка в данных GIS)
        return "residential"
    if z.startswith("коммерч"):
        return "commercial"
    if z.startswith("социальн"):
        return "social"
    return "other"                    # «Иная» и прочее


def check(project: Project) -> Iterable[Violation]:
    kind = _zone_kind(project.site.functional_zone)
    if not kind:
        return  # зона не определена — молчим

    has_housing = any(b.purpose in _HOUSING_PURPOSES for b in project.buildings)
    if not has_housing:
        return

    zone_label = project.site.functional_zone

    if kind == "social":
        # Грубый публичный слой зон ненадёжен → не «нельзя», а «расходится».
        yield Violation(
            rule="zoning.zone_conflict",
            severity="warning",
            message=(
                f"Данные ГИС расходятся: назначение жилое, но функциональная "
                f"зона «{zone_label}» (социальная). Слой зон грубый — уточните "
                f"по ПДП/ГПЗУ участка."
            ),
            norm="Градостроительный регламент, функциональная зона",
        )
    elif kind == "commercial":
        yield Violation(
            rule="zoning.housing_needs_mixed_use",
            severity="warning",
            message=(
                f"Участок в коммерческой зоне «{zone_label}» — жильё возможно "
                f"только в составе смешанного назначения; проверьте регламент."
            ),
            norm="Градостроительный регламент, функциональная зона",
        )
    elif kind == "other":
        yield Violation(
            rule="zoning.zone_not_residential",
            severity="warning",
            message=(
                f"Участок в зоне «{zone_label}» (не жилая) — допустимость "
                f"жилья требует уточнения по градрегламенту."
            ),
            norm="Градостроительный регламент, функциональная зона",
        )


__all__ = ["check"]
