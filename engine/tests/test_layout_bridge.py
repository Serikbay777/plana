"""Verify the layout_to_project adapter (the linchpin reversing bridge.py
floors=[]): it populates real per-room geometry into domain.Project, maps every
generator room kind, and makes rooms.check fire on a too-small room.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from plana_engine.cad.layout_schema import (
    LayoutApartment, LayoutCore, LayoutFloor, LayoutRoom, LayoutSection,
)
from plana_engine.domain import layout_to_project
from plana_engine.domain.layout_bridge import ROOM_KIND_MAP
from plana_engine.validators.runner import validate_project
from plana_engine.visualizer.marketing_prompt import MarketingInputs


def _inputs() -> MarketingInputs:
    return MarketingInputs(site_width_m=20.0, site_depth_m=14.0)


def _layout(living_w: float = 5.0, living_d: float = 5.0) -> LayoutFloor:
    return LayoutFloor(
        width_m=20.0, depth_m=14.0,
        sections=[LayoutSection(
            index=0, x_start=0.0, width=20.0, corridor_y=6.0, corridor_d=1.6,
            cores=[LayoutCore(kind="stair", x=8.0, y=6.0, w=4.0, d=1.6)],
            apartments=[LayoutApartment(
                type_code="2k", number=1, x=0.5, y=0.5, w=9.0, d=5.0,
                rooms=[
                    LayoutRoom(kind="living", name_ru="Гостиная",
                               x=0.0, y=0.0, w=living_w, d=living_d),
                    LayoutRoom(kind="bedroom", name_ru="Спальня",
                               x=5.0, y=0.0, w=4.0, d=5.0),
                    LayoutRoom(kind="bathroom", name_ru="Сан.узел",
                               x=0.0, y=5.0, w=2.0, d=2.0),
                ],
            )],
        )],
    )


def test_adapter_populates_one_floor_with_real_geometry() -> None:
    proj = layout_to_project(_layout(), _inputs())
    b = proj.buildings[0]
    assert len(b.floors) == 1                      # ONE typical floor, not n_floors copies
    floor = b.floors[0]
    assert len(floor.apartments) == 1
    rooms = floor.apartments[0].rooms
    assert len(rooms) == 3
    living = next(r for r in rooms if r.name == "Гостиная")
    assert abs(living.area_m2 - 25.0) < 1e-6       # polygon area == w*d
    assert {r.kind for r in rooms} == {"living", "bedroom", "bath"}  # bathroom -> bath
    assert len(floor.cores) == 1
    assert len(floor.corridors) == 1
    assert floor.efficiency_pct > 0                # metrics now compute on real geometry


def test_too_small_room_triggers_rooms_violation() -> None:
    # living 3×3 = 9 m² < 15 m² (СНиП РК 3.02-43-2007) — first-ever room check
    proj = layout_to_project(_layout(living_w=3.0, living_d=3.0), _inputs())
    violations = validate_project(proj)
    assert any(v.rule == "room.min_area.living" for v in violations), \
        f"expected a living min-area violation; got {[v.rule for v in violations]}"


# Kinds the generator's _rooms_for_* templates emit (layout_generator.py). If the
# generator gains a new kind, add it here — an unmapped kind is silently skipped
# by rooms.py (`if rule is None: continue`), hiding violations.
_GENERATOR_ROOM_KINDS = {
    "living", "bedroom", "kitchen", "hallway", "bathroom",
    "toilet", "storage", "wardrobe", "balcony", "commercial",
}


def test_room_kind_map_covers_all_generator_kinds() -> None:
    missing = _GENERATOR_ROOM_KINDS - set(ROOM_KIND_MAP)
    assert not missing, (
        f"generator room kinds missing from ROOM_KIND_MAP (rooms.check would "
        f"silently skip them): {missing}"
    )
