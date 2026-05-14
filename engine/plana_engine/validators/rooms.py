"""Проверка минимальных площадей помещений в квартирах.

Источник: СНиП РК 3.02-43-2007 «Жилые здания» п. 5.5 (общие комнаты,
спальни, кухни). Берём минимумы для классов III-IV — это lower bound.

В P3 этот валидатор почти не сработает: бридж из MarketingInputs пока
не строит этажную геометрию квартир (`Floor.apartments == []`). Готов к
P5, когда AI-генератор начнёт писать в `Project` реальные квартиры.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..domain import Project, RoomKind
from .base import Violation


# Минимальные площади помещений (м²) по СНиП РК 3.02-43-2007 п. 5.5.
_MIN_AREA: dict[RoomKind, tuple[float, str]] = {
    "living":         (15.0, "СНиП РК 3.02-43-2007 п. 5.5.6 (общая комната >= 15 м²)"),
    "bedroom":        (8.0,  "СНиП РК 3.02-43-2007 п. 5.5.8 (спальня на 1 чел. >= 8 м²)"),
    "kitchen":        (6.0,  "СНиП РК 3.02-43-2007 п. 5.5.10 (кухня >= 6 м²)"),
    "kitchen_living": (16.0, "СНиП РК 3.02-43-2007 п. 5.5.6 (общая комната >= 16 м² для 2К+)"),
    # bath/wc/hall/loggia/balcony/storage/wardrobe — нормированы по ширине,
    # минимум площади как такового нет.
}


def check(project: Project) -> Iterable[Violation]:
    for bi, b in enumerate(project.buildings):
        for fi, floor in enumerate(b.floors):
            for ai, apt in enumerate(floor.apartments):
                for ri, room in enumerate(apt.rooms):
                    rule = _MIN_AREA.get(room.kind)
                    if rule is None:
                        continue
                    min_area, norm_ref = rule
                    if room.area_m2 < min_area:
                        room_label = room.name or room.kind
                        yield Violation(
                            rule=f"room.min_area.{room.kind}",
                            severity="error",
                            message=(
                                f"Площадь помещения «{room_label}» "
                                f"({room.area_m2:.1f} м²) меньше минимума по "
                                f"СНиП ({min_area} м²)."
                            ),
                            norm=norm_ref,
                            actual=room.area_m2,
                            expected=min_area,
                            target=(
                                f"building[{bi}]/floor[{fi}]/"
                                f"apartment[{ai}]/room[{ri}]"
                            ),
                        )


__all__ = ["check"]
