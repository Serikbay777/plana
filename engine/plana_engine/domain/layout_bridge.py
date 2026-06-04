"""Мост LayoutFloor → Project (разворачивает bridge.py floors=[]).

`marketing_to_project` строит только Site + Building без этажной геометрии
(`floors=[]`), поэтому доменные валидаторы (rooms и т.п.) не срабатывают.
Этот адаптер берёт РЕАЛЬНУЮ геометрию из LayoutFloor (результат генератора
или правок SVG-редактора) и заполняет `building.floors` — после чего
`validate_project` начинает проверять комнаты, а метрики/смета считаются по
настоящей площади.

Канон геометрии — LayoutFloor; этот Project — ПРОИЗВОДНЫЙ вид для валидации
и метрик (не источник истины). Эмитим ОДИН типовой этаж, а не `n_floors`
копий — иначе нарушения дублируются по числу этажей.

Координаты комнат переводятся в абсолютные координаты здания
(`apt.x + room.x`, `apt.y + room.y`). Порядок комнат/квартир НЕ меняется
(фронт адресует их позиционно).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from shapely import Polygon as ShPolygon

from .bridge import marketing_to_project
from .model import Apartment, ApartmentType, Core, CoreKind, Floor, Room, RoomKind

if TYPE_CHECKING:  # избегаем циклического импорта (cad/visualizer тянут domain)
    from ..cad.layout_schema import LayoutFloor
    from ..visualizer.marketing_prompt import MarketingInputs
    from .model import Project


# Свободные строки `room.kind` из генератора → доменный RoomKind.
# ВАЖНО: rooms.py делает `if rule is None: continue` — НЕзамапленный kind
# молча пропускается (нарушения недосчитываются), а не падает. Поэтому любую
# неизвестную строку мапим явно в "other".
ROOM_KIND_MAP: dict[str, str] = {
    "living": "living",
    "bedroom": "bedroom",
    "kitchen": "kitchen",
    "kitchen_living": "kitchen_living",
    "kitchen-living": "kitchen_living",
    "euro_kitchen": "kitchen_living",
    "hallway": "hall",
    "hall": "hall",
    "corridor": "hall",
    "bathroom": "bath",
    "bath": "bath",
    "wc": "wc",
    "toilet": "wc",
    "loggia": "loggia",
    "balcony": "balcony",
    "storage": "storage",
    "pantry": "storage",
    "wardrobe": "wardrobe",
    "commercial": "other",
    "garage": "other",
    "other": "other",
}

# LayoutApartment.type_code → доменный ApartmentType.
APT_TYPE_MAP: dict[str, str] = {
    "studio": "studio",
    "1k": "k1",
    "2k": "k2",
    "3k": "k3",
    "4k": "k4",
}

# LayoutCore.kind → доменный CoreKind.
_CORE_KIND_MAP: dict[str, str] = {
    "lift_passenger": "lift",
    "lift_freight": "lift",
    "stair": "stair",
}


def _rect(x: float, y: float, w: float, h: float) -> ShPolygon:
    """Прямоугольник через 4 угла (от нижнего-левого, по часовой)."""
    return ShPolygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def layout_to_project(layout: "LayoutFloor", inputs: "MarketingInputs") -> "Project":
    """LayoutFloor (+ бриф `inputs` для Site/ГПЗУ-оболочки) → Project с одним
    заполненным типовым этажом."""
    project = marketing_to_project(inputs)
    if not project.buildings:
        return project
    building = project.buildings[0]

    apartments: list[Apartment] = []
    cores: list[Core] = []
    corridors: list[ShPolygon] = []

    for sect in layout.sections:
        if sect.corridor_d > 0 and sect.width > 0:
            corridors.append(
                _rect(sect.x_start, sect.corridor_y, sect.width, sect.corridor_d)
            )
        for core in sect.cores:
            cores.append(Core(
                kind=cast(CoreKind, _CORE_KIND_MAP.get(core.kind, "lift")),
                polygon=_rect(core.x, core.y, core.w, core.d),
            ))
        for apt in sect.apartments:
            rooms: list[Room] = []
            for room in apt.rooms:
                rooms.append(Room(
                    kind=cast(RoomKind, ROOM_KIND_MAP.get((room.kind or "").lower(), "other")),
                    polygon=_rect(apt.x + room.x, apt.y + room.y, room.w, room.d),
                    name=room.name_ru,
                ))
            apartments.append(Apartment(
                type_code=cast(ApartmentType, APT_TYPE_MAP.get(apt.type_code, "studio")),
                rooms=rooms,
                label=f"Кв. {apt.number}",
            ))

    # ОДИН типовой этаж (не n_floors копий — иначе нарушения множатся).
    building.floors = [Floor(
        level=1, z_offset_m=0.0,
        apartments=apartments, cores=cores, corridors=corridors,
    )]
    return project


__all__ = ["layout_to_project", "ROOM_KIND_MAP", "APT_TYPE_MAP"]
