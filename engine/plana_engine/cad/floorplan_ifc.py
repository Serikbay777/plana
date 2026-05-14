"""IFC-генератор плана этажа из доменной модели Project.

Закрывает ТЗ-пункт 2.8 / 5.4 «Экспорт в BIM». Параллельный пайплайн рядом
с DXF-builder'ом (`cad/floorplan_dxf.py`): берёт `Project`, выдаёт IFC4
байты, готовые к открытию в Revit / ArchiCAD / BIMcollab / SimpleBIM.

Структура IFC:
    IfcProject
      └── IfcSite (без геометрии — контейнер участка)
          └── IfcBuilding (один на каждое здание Project.buildings)
              └── IfcBuildingStorey × N (с правильным Elevation)
                  ├── IfcWall × M  (периметр пятна, по сегментам exterior)
                  └── IfcSpace × 1 (placeholder пятна — заполнится в P5
                                    реальными apartments/rooms)

Единицы: METERS (SI default ifcopenshell). Координаты в метрах в локальной
системе участка (origin (0,0) — нижний-левый угол).

GUID-ы генерируются автоматически через `ifcopenshell.api.root.create_entity`.

Ограничения текущей версии:
    • Footprint предполагается замкнутым полигоном (rectangular из bridge —
      рабочий случай). Если придёт сложная геометрия с островами или
      MultiPolygon — работает только по exterior первого полигона.
    • Стены — простой extruded box без дверных / оконных проёмов.
    • IfcSpace — голый placeholder без зон комнат. Расширится в P5.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from shapely.geometry import Polygon as ShPolygon

from ..domain import Building, Project


# ── константы ─────────────────────────────────────────────────────────────


_WALL_THICKNESS_M = 0.4         # несущая стена 400 мм (соответствует DXF builder)
_DEFAULT_STOREY_HEIGHT_M = 3.0  # типовая высота этажа жилого здания РК


# ── публичная точка входа ─────────────────────────────────────────────────


def build_floorplan_ifc(project: Project, *, schema: str = "IFC4") -> bytes:
    """Сериализовать `Project` в IFC4-байты.

    Бросает `RuntimeError` если ifcopenshell не установлен или внутри
    случилось что-то непредвиденное.
    """
    try:
        import ifcopenshell
        import ifcopenshell.api.aggregate
        import ifcopenshell.api.context
        import ifcopenshell.api.geometry
        import ifcopenshell.api.project
        import ifcopenshell.api.root
        import ifcopenshell.api.spatial
        import ifcopenshell.api.unit
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "ifcopenshell не установлен — добавь его в pyproject.toml"
        ) from e

    model = ifcopenshell.api.project.create_file(version=schema)

    # 1. Корневой проект + единицы + представления.
    ifc_project = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcProject", name="plana-generated",
    )
    length_unit = ifcopenshell.api.unit.add_si_unit(
        model, unit_type="LENGTHUNIT",
    )
    area_unit = ifcopenshell.api.unit.add_si_unit(
        model, unit_type="AREAUNIT",
    )
    volume_unit = ifcopenshell.api.unit.add_si_unit(
        model, unit_type="VOLUMEUNIT",
    )
    ifcopenshell.api.unit.assign_unit(
        model, units=[length_unit, area_unit, volume_unit],
    )

    model_ctx = ifcopenshell.api.context.add_context(
        model, context_type="Model",
    )
    body_ctx = ifcopenshell.api.context.add_context(
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_ctx,
    )

    # 2. Site — один на проект.
    site = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcSite", name="Site",
    )
    ifcopenshell.api.aggregate.assign_object(
        model, relating_object=ifc_project, products=[site],
    )

    # 3. Buildings, Storeys, Walls, Spaces.
    for bi, building in enumerate(project.buildings):
        _emit_building(
            model=model,
            ifc=ifcopenshell,
            site=site,
            body_ctx=body_ctx,
            building=building,
            index=bi,
        )

    # 4. Сериализация в bytes.
    return model.wrapped_data.to_string().encode("utf-8")


# ── builder helpers ───────────────────────────────────────────────────────


def _emit_building(
    *,
    model: Any,
    ifc: Any,
    site: Any,
    body_ctx: Any,
    building: Building,
    index: int,
) -> None:
    """Создать IfcBuilding + N storeys + по 4+ стены и 1 space на каждый."""
    bldg = ifc.api.root.create_entity(
        model, ifc_class="IfcBuilding", name=f"Building {index + 1}",
    )
    ifc.api.aggregate.assign_object(
        model, relating_object=site, products=[bldg],
    )

    n_floors = max(1, building.floors_count)
    total_height = building.height_m or (n_floors * _DEFAULT_STOREY_HEIGHT_M)
    storey_h = total_height / n_floors if n_floors > 0 else _DEFAULT_STOREY_HEIGHT_M

    footprint = building.footprint
    if not isinstance(footprint, ShPolygon) or footprint.is_empty:
        return

    # Берём exterior без замыкающей точки (shapely дублирует первую в конце).
    exterior_coords = list(footprint.exterior.coords)
    if len(exterior_coords) < 4:
        return
    if exterior_coords[0] == exterior_coords[-1]:
        exterior_coords = exterior_coords[:-1]

    for floor_idx in range(n_floors):
        z = floor_idx * storey_h
        storey = ifc.api.root.create_entity(
            model, ifc_class="IfcBuildingStorey",
            name=f"Floor {floor_idx + 1}",
        )
        # Устанавливаем Elevation атрибут (numeric).
        storey.Elevation = float(z)

        ifc.api.aggregate.assign_object(
            model, relating_object=bldg, products=[storey],
        )

        # Перенос storey на высоту z — все потомки наследуют placement.
        ifc.api.geometry.edit_object_placement(
            model, product=storey,
            matrix=_translation_matrix(0.0, 0.0, z),
        )

        # 4+ периметральные стены.
        walls = _emit_perimeter_walls(
            model=model, ifc=ifc, body_ctx=body_ctx,
            exterior_coords=exterior_coords,
            height=storey_h,
            thickness=_WALL_THICKNESS_M,
            storey_index=floor_idx,
        )
        if walls:
            ifc.api.spatial.assign_container(
                model, relating_structure=storey, products=walls,
            )

        # Space placeholder (вся площадь этажа).
        space = ifc.api.root.create_entity(
            model, ifc_class="IfcSpace",
            name=f"Floor {floor_idx + 1} space",
        )
        ifc.api.aggregate.assign_object(
            model, relating_object=storey, products=[space],
        )


def _emit_perimeter_walls(
    *,
    model: Any,
    ifc: Any,
    body_ctx: Any,
    exterior_coords: list[tuple[float, float]],
    height: float,
    thickness: float,
    storey_index: int,
) -> list[Any]:
    """Создать стены по сегментам exterior.

    Каждый сегмент = одна IfcWall, размещённая в (x0, y0, z) с поворотом
    по yaw-углу сегмента. Локальная ось X стены идёт вдоль сегмента,
    длина = расстоянию между точками.
    """
    walls: list[Any] = []
    n = len(exterior_coords)
    for i in range(n):
        x0, y0 = exterior_coords[i]
        x1, y1 = exterior_coords[(i + 1) % n]
        dx = x1 - x0
        dy = y1 - y0
        length = math.hypot(dx, dy)
        if length < 0.1:
            continue
        yaw = math.atan2(dy, dx)

        wall = ifc.api.root.create_entity(
            model, ifc_class="IfcWall",
            name=f"W-{storey_index + 1}-{i + 1}",
        )

        ifc.api.geometry.edit_object_placement(
            model, product=wall,
            matrix=_placement_matrix(x0, y0, 0.0, yaw),
        )

        wall_repr = ifc.api.geometry.add_wall_representation(
            model,
            context=body_ctx,
            length=float(length),
            height=float(height),
            thickness=float(thickness),
        )
        ifc.api.geometry.assign_representation(
            model, product=wall, representation=wall_repr,
        )

        walls.append(wall)
    return walls


# ── matrix helpers ────────────────────────────────────────────────────────


def _translation_matrix(x: float, y: float, z: float) -> np.ndarray:
    """4x4 матрица чистого переноса."""
    m = np.eye(4)
    m[0, 3] = x
    m[1, 3] = y
    m[2, 3] = z
    return m


def _placement_matrix(x: float, y: float, z: float, yaw_rad: float) -> np.ndarray:
    """4x4 матрица: перенос + поворот вокруг Z на yaw радиан."""
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    m = np.eye(4)
    m[0, 0] = c
    m[0, 1] = -s
    m[1, 0] = s
    m[1, 1] = c
    m[0, 3] = x
    m[1, 3] = y
    m[2, 3] = z
    return m


__all__ = ["build_floorplan_ifc"]
