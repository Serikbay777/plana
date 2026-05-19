"""Мост MarketingInputs → Project.

Берёт плоский form-state (`MarketingInputs`) и собирает из него минимальную
доменную модель: контур участка прямоугольником W×D, пятно застройки внутри
с учётом отступов, одно здание с N этажами без вложенной геометрии квартир.

Это бридж совместимости — существующие эндпоинты `/visualize/*` и `/export/*`
продолжают принимать `VisualizeFromInputsRequest`/`MarketingInputs`, но
внутренние расчёты (метрики, валидаторы, AI-генератор) будут работать на
доменной модели.

Когда у нас появится UI-редактор и реальный импорт DXF/IFC — пользовательская
геометрия попадёт прямо в `Project`, а MarketingInputs останется только для
старого prompt-driven флоу.
"""

from __future__ import annotations

from shapely import Polygon as ShPolygon

from ..types import BuildingPurpose
from ..visualizer.marketing_prompt import MarketingInputs
from .model import (
    Building, GpzuConstraints, Project, Setbacks, Site,
)


def _rect(x: float, y: float, w: float, h: float) -> ShPolygon:
    """Прямоугольник через 4 угла (по часовой стрелке от нижнего-левого)."""
    return ShPolygon([
        (x,     y),
        (x + w, y),
        (x + w, y + h),
        (x,     y + h),
    ])


def marketing_to_project(inputs: MarketingInputs) -> Project:
    """Собрать `Project` из формы.

    Контур участка — прямоугольник W×D или свободный полигон из inputs.site_polygon.
    Пятно застройки — inner rect после отступов внутри bbox полигона.
    """
    if inputs.site_polygon and len(inputs.site_polygon) >= 3:
        site_boundary = ShPolygon([(x, y) for x, y in inputs.site_polygon])
        bbox = site_boundary.bounds  # (minx, miny, maxx, maxy)
        W = bbox[2] - bbox[0]
        D = bbox[3] - bbox[1]
    else:
        W = max(0.0, inputs.site_width_m)
        D = max(0.0, inputs.site_depth_m)
        site_boundary = _rect(0.0, 0.0, W, D)

    # Пятно застройки после отступов. Стороны:
    #   front = настлой, сторона y=0 (низ листа)
    #   rear  = противоположная, y=D
    #   side  = обе боковые
    inner_x = inputs.setback_side_m
    inner_y = inputs.setback_front_m
    inner_w = W - 2 * inputs.setback_side_m
    inner_d = D - inputs.setback_front_m - inputs.setback_rear_m

    if inner_w <= 0 or inner_d <= 0:
        # Отступы съели всё или MarketingInputs пришёл без отступов —
        # пятно равно участку, чтобы метрики не делились на ноль.
        building_footprint = site_boundary
    else:
        building_footprint = _rect(inner_x, inner_y, inner_w, inner_d)

    try:
        purpose = BuildingPurpose(inputs.purpose)
    except ValueError:
        purpose = BuildingPurpose.RESIDENTIAL

    setbacks = Setbacks(
        front_m=inputs.setback_front_m,
        side_m=inputs.setback_side_m,
        rear_m=inputs.setback_rear_m,
    )

    gpzu = GpzuConstraints(
        max_height_m=inputs.max_height_m or None,
        max_coverage_pct=inputs.max_coverage_pct or None,
        # max_floors / max_far / purpose_allowed нет в форме — None
    )

    site = Site(boundary=site_boundary, setbacks=setbacks, gpzu=gpzu)

    building = Building(
        footprint=building_footprint,
        purpose=purpose,
        height_m=float(inputs.floors) * 3.0,  # ~3 м/этаж, груботок
        floors_count=inputs.floors,
        sections_count=max(1, inputs.sections),
        floors=[],  # этажную геометрию здесь не строим — это работа P5
    )

    return Project(site=site, buildings=[building])


__all__ = ["marketing_to_project"]
