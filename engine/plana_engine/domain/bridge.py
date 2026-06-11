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

import math

from shapely import Polygon as ShPolygon
from shapely.affinity import scale as _scale

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


def _largest_polygon(geom) -> ShPolygon:
    """Свести результат пересечения к одному Polygon (крупнейшему по площади).

    intersection может вернуть MultiPolygon/GeometryCollection — модель ждёт
    единый Polygon. Берём крупнейший кусок; пустое — отдаём как есть наверх.
    """
    gt = getattr(geom, "geom_type", "")
    if gt == "Polygon":
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]
    return max(polys, key=lambda g: g.area) if polys else geom


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

    # (1) Вписать пятно в РЕАЛЬНЫЙ контур участка. Для прямоугольника no-op,
    # для свободного/непрямоугольного отвода — обрезает по полигону, чтобы
    # застройка не вылезала за участок (иначе coverage > 100%).
    clipped = building_footprint.intersection(site_boundary)
    if not clipped.is_empty and clipped.area > 0:
        building_footprint = _largest_polygon(clipped)

    # (2) Ограничить пятно по проценту застройки (лимит из ПДП/ГПЗУ). Если
    # запроектированное пятно больше нормы — ужать к центроиду до нормы.
    cov = inputs.max_coverage_pct
    if cov and 0 < cov < 100:
        max_area = site_boundary.area * cov / 100.0
        if building_footprint.area > max_area > 0:
            f = math.sqrt(max_area / building_footprint.area)
            building_footprint = _scale(
                building_footprint, xfact=f, yfact=f, origin="centroid"
            )

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
        max_far=inputs.max_far or None,
        max_floors=inputs.max_floors or None,
        # purpose_allowed нет в форме — None
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
