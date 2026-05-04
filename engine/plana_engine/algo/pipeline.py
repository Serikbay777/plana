"""Главный пайплайн генерации одного варианта (ТЗ §5.1, 6 шагов).

Прогоняет один из 5 пресетов по контуру и возвращает `Plan`.
"""

from __future__ import annotations

import time

from ..catalog import get_catalog
from ..norms import Norms, get_norms
from ..presets import (
    PresetState, pick_tile_for_slot, PRESET_LABELS, PRESET_DESCRIPTIONS,
)
from ..types import (
    AptType, GenerateRequest, Plan, PlanMetrics, PlacedTile, PresetKey, TileSpec,
)
from ..geometry.facades import edge_orientation
from ..geometry.polygon import polygon_area, polygon_edges
from ..geometry.slots import cut_facade_into_slots
from ..parser import parse_rect

from .core import place_core
from .corridor import lay_corridors, FacadeBelt
from .engineering import place_engineering_rooms
from .tile import place_tile_in_slot, fits_slot

# чтобы не импортировать validator до его готовности — отложенный импорт
def _check_norms_lazy(plan_dict, norms):
    from ..validator import check_plan
    return check_plan(plan_dict, norms)


# ---------------------------------------------------------------------------
# Сервисное: оценка средней ширины слота для нарезки
# ---------------------------------------------------------------------------


def _slot_params_for_preset(preset: PresetKey) -> tuple[float, float]:
    """Под каждый пресет — своя средняя ширина слота И глубина пояса.

    Значения подобраны так, чтобы:
    1. На разных пресетах получались действительно разные планы (ТЗ §2.2)
    2. Каждая квартира выглядела архитектурно разумно (фасад ≥ типового тайла)
    3. КИТ растёт плавно от max_apt_count (мелкие → много коридора) к max_avg_area
    """
    if preset == PresetKey.MAX_APT_COUNT:
        return (5.0, 6.4)         # узкие неглубокие → студии 25/32, 1K-38
    if preset == PresetKey.MAX_AVG_AREA:
        return (11.0, 8.2)        # широкие глубокие → 3K-95, 4K-110
    if preset == PresetKey.MAX_USEFUL_AREA:
        return (7.5, 7.4)          # 2K-52 — лучшее соотношение площади к фасаду
    if preset == PresetKey.MAX_INSOLATION:
        return (8.0, 7.6)          # E2-58 — большая гостиная на юг
    # BALANCED_MIX
    return (6.8, 7.2)              # компромисс между E1/2K/1K


# ---------------------------------------------------------------------------
# Метрики
# ---------------------------------------------------------------------------


def compute_metrics(
    floor_area: float,
    core_area: float,
    corridor_total_area: float,
    corridor_total_length: float,
    tiles: list[PlacedTile],
    south_oriented_idx: set[int],
    edges,
) -> PlanMetrics:
    saleable = sum(t.area for t in tiles)
    apt_count = len(tiles)
    avg = saleable / apt_count if apt_count else 0.0

    by_type: dict[AptType, int] = {a: 0 for a in AptType}
    for t in tiles:
        by_type[t.apt_type] = by_type.get(t.apt_type, 0) + 1

    # доля квартир, фасад которых смотрит на ю/ю-в/ю-з
    south_apts = 0
    for t in tiles:
        # facade_edge tiles store the edge by reference — сравним с направлениями south_oriented_idx
        # упрощённо: считаем по ориентации ребра
        o = edge_orientation(t.facade_edge)
        if o in ("S", "SE", "SW"):
            south_apts += 1
    south_share = south_apts / apt_count if apt_count else 0.0

    insolation_score = south_share  # упрощённая эвристика для демо

    return PlanMetrics(
        floor_area=round(floor_area, 1),
        saleable_area=round(saleable, 1),
        saleable_ratio=round(saleable / floor_area, 3) if floor_area else 0.0,
        apt_count=apt_count,
        avg_apt_area=round(avg, 1),
        apt_by_type={k: v for k, v in by_type.items() if v > 0},
        south_oriented_share=round(south_share, 3),
        insolation_score=round(insolation_score, 3),
        core_area=round(core_area, 1),
        corridor_area=round(corridor_total_area, 1),
        corridor_length=round(corridor_total_length, 1),
    )


# ---------------------------------------------------------------------------
# Один вариант
# ---------------------------------------------------------------------------


def generate_variant(
    request: GenerateRequest,
    preset: PresetKey,
    norms: Norms | None = None,
    catalog: tuple[TileSpec, ...] | None = None,
) -> Plan:
    """Сгенерировать один план под указанный пресет."""
    norms = norms or get_norms()
    catalog = catalog or get_catalog()

    # Шаг 1 — контур
    if request.floor_polygon is not None:
        contour = request.floor_polygon
    else:
        # дефолт для тестов — прямоугольник 60×40
        contour = parse_rect(60, 40)

    floor_area = polygon_area(contour)
    edges = polygon_edges(contour)

    # Шаг 2 — ядро
    core = place_core(contour, norms, floors=request.floors, apt_count_estimate=8)
    from ..geometry.polygon import poly_to_shapely
    core_area = poly_to_shapely(core.polygon).area

    # параметры пресета: ширина слота и глубина пояса
    avg_slot_w, target_depth = _slot_params_for_preset(preset)

    # Шаг 3 — коридор + фасадные пояса (под целевую глубину пресета)
    corridor_plan = lay_corridors(contour, core, norms, target_apt_depth=target_depth)
    corridor_total_area = sum(poly_to_shapely(c.polygon).area for c in corridor_plan.corridors)
    corridor_total_length = sum(c.length for c in corridor_plan.corridors)

    state = PresetState(target_mix=request.target_mix)
    tiles: list[PlacedTile] = []

    for belt in corridor_plan.belts:
        slots = cut_facade_into_slots(
            belt.edge,
            apt_depth=belt.depth,
            min_slot_width=norms.tile.min_facade_width_m,
            max_slot_width=norms.tile.max_facade_width_m,
        )
        # подгоняем количество слотов под avg_slot_w
        if slots:
            ideal_n = max(1, round(belt.edge.length / avg_slot_w))
            if ideal_n != len(slots):
                w = belt.edge.length / ideal_n
                if norms.tile.min_facade_width_m <= w <= norms.tile.max_facade_width_m:
                    from ..geometry.slots import Slot
                    slots = [
                        Slot(edge=belt.edge, x_start=i * w, x_end=(i + 1) * w,
                             depth=belt.depth)
                        for i in range(ideal_n)
                    ]
        for slot in slots:
            spec = pick_tile_for_slot(catalog, slot, preset, state)
            if spec is None:
                continue
            placed = place_tile_in_slot(spec, slot)
            if placed is None:
                continue
            tiles.append(placed)
            state.placed_by_type[placed.apt_type] += 1

    # порядковые номера квартир на этаже (для UI «КВ №N»)
    for i, t in enumerate(tiles, start=1):
        t.apt_number = i

    # Шаг 6 — нормоконтроль
    metrics = compute_metrics(
        floor_area=floor_area,
        core_area=core_area,
        corridor_total_area=corridor_total_area,
        corridor_total_length=corridor_total_length,
        tiles=tiles,
        south_oriented_idx=set(),
        edges=edges,
    )

    # Инженерные помещения первого этажа — добавляем после tiles, на metrics не влияют.
    # Опционально: если placer упадёт, оставляем пустой список — это лучше, чем
    # поломать всю генерацию из-за декоративного слоя.
    try:
        engineering_rooms = place_engineering_rooms(core, contour)
    except Exception:
        engineering_rooms = []

    plan = Plan(
        floor_polygon=contour,
        core=core,
        corridors=corridor_plan.corridors,
        tiles=tiles,
        engineering_rooms=engineering_rooms,
        metrics=metrics,
        norms=_check_norms_lazy({
            "core": core,
            "corridors": corridor_plan.corridors,
            "tiles": tiles,
            "floor_area": floor_area,
            "preset": preset,
        }, norms),
        preset=preset,
    )
    return plan


# ---------------------------------------------------------------------------
# 5 вариантов разом
# ---------------------------------------------------------------------------


def generate_all_variants(request: GenerateRequest) -> tuple[list[Plan], int]:
    """Сгенерировать 5 вариантов — по одному на каждый пресет.

    Возвращает `(planы, elapsed_ms)`.
    """
    t0 = time.perf_counter()
    norms = get_norms()
    catalog = get_catalog()
    plans = [
        generate_variant(request, preset, norms, catalog)
        for preset in PresetKey
    ]
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return plans, elapsed_ms
