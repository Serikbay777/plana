"""Pytest fixtures: эталонные LayoutFloor для регрессии IFC-конвертера.

Покрытие:
  - minimal_layout  : 1 секция, 2 квартиры, 7 комнат, проёмы → Phase 3a/3b/3c
  - full_layout     : 1 секция, 8 квартир (как в реал-юзкейсе из брифа)

Любые правки floorplan_ifc.py должны эти фикстуры не ломать.
"""
from __future__ import annotations

import pytest

from plana_engine.cad.layout_schema import (
    LayoutApartment, LayoutCore, LayoutDoor, LayoutFloor,
    LayoutRoom, LayoutSection, LayoutWindow,
)


@pytest.fixture
def minimal_layout() -> LayoutFloor:
    """1 секция × 2 квартиры × 7 комнат × 2 двери × 3 окна.

    Это копия make_test_layout() из engine/scripts/phase0_baseline.py.
    """
    return LayoutFloor(
        width_m=24.0,
        depth_m=14.0,
        sections=[
            LayoutSection(
                index=0,
                x_start=0.0,
                width=24.0,
                corridor_y=6.0,
                corridor_d=1.6,
                cores=[
                    LayoutCore(kind="lift_passenger", x=11.0, y=6.5, w=1.5, d=1.5),
                    LayoutCore(kind="stair",          x=13.0, y=4.5, w=2.1, d=5.5),
                ],
                apartments=[
                    LayoutApartment(
                        type_code="2k", number=1,
                        x=0.4, y=0.4, w=10.0, d=5.6,
                        rooms=[
                            LayoutRoom(kind="living",   name_ru="Гостиная", x=0.0, y=0.0, w=4.5, d=5.6,
                                       windows=[LayoutWindow(side="S", offset=1.0, width=1.8)]),
                            LayoutRoom(kind="kitchen",  name_ru="Кухня",    x=4.5, y=0.0, w=3.0, d=3.0,
                                       windows=[LayoutWindow(side="S", offset=0.6, width=1.5)]),
                            LayoutRoom(kind="bedroom",  name_ru="Спальня",  x=7.5, y=0.0, w=2.5, d=3.5,
                                       doors=[LayoutDoor(side="N", offset=0.5, width=0.9)]),
                            LayoutRoom(kind="bathroom", name_ru="Санузел",  x=4.5, y=3.0, w=2.0, d=2.6,
                                       doors=[LayoutDoor(side="N", offset=0.5, width=0.7)]),
                        ],
                    ),
                    LayoutApartment(
                        type_code="1k", number=2,
                        x=13.6, y=8.0, w=10.0, d=5.6,
                        rooms=[
                            LayoutRoom(kind="living",   name_ru="Гостиная", x=0.0, y=0.0, w=5.0, d=5.6,
                                       windows=[LayoutWindow(side="N", offset=1.0, width=1.8)]),
                            LayoutRoom(kind="kitchen",  name_ru="Кухня",    x=5.0, y=0.0, w=3.0, d=3.0),
                            LayoutRoom(kind="bathroom", name_ru="Санузел",  x=5.0, y=3.0, w=2.0, d=2.6),
                        ],
                    ),
                ],
            ),
        ],
    )


@pytest.fixture
def two_sections_layout() -> LayoutFloor:
    """2 секции с противопожарной стеной между ними."""
    return LayoutFloor(
        width_m=30.0,
        depth_m=14.0,
        sections=[
            LayoutSection(
                index=i, x_start=15.0 * i, width=15.0,
                corridor_y=6.0, corridor_d=1.6,
                cores=[
                    LayoutCore(kind="lift_passenger",
                               x=15.0 * i + 6.5, y=6.5, w=1.5, d=1.5),
                ],
                apartments=[
                    LayoutApartment(
                        type_code="1k", number=2 * i + 1,
                        x=15.0 * i + 0.4, y=0.4, w=14.0, d=5.6,
                        rooms=[
                            LayoutRoom(kind="living", name_ru="Гостиная",
                                       x=0.0, y=0.0, w=7.0, d=5.6),
                            LayoutRoom(kind="kitchen", name_ru="Кухня",
                                       x=7.0, y=0.0, w=4.0, d=2.8),
                            LayoutRoom(kind="bathroom", name_ru="Санузел",
                                       x=7.0, y=2.8, w=4.0, d=2.8),
                        ],
                    ),
                ],
            )
            for i in range(2)
        ],
    )
