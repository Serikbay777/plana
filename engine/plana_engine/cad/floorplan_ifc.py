"""IFC-генератор плана этажа из доменной модели Project.

Структура IFC:
    IfcProject
      └── IfcSite
          └── IfcBuilding
              └── IfcBuildingStorey × N
                  ├── IfcSlab          — перекрытие этажа (200 мм)
                  ├── IfcWall ×M       — периметр (400 мм несущие)
                  ├── IfcWall ×S       — противопожарные стены между секциями
                  ├── IfcWall × core   — стены ядра (лифты + лестница) в каждой секции
                  ├── IfcWall × corr   — коридорные стены (север / юг)
                  └── IfcSpace × apt   — пространства квартир (прямоугольные зоны)

Единицы: METERS (SI).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from shapely.geometry import Polygon as ShPolygon

from ..domain import Building, Project
from .layout_schema import LayoutFloor


# ── константы ─────────────────────────────────────────────────────────────

_WALL_BEAR_T     = 0.40   # несущая стена 400 мм
_WALL_FIRE_T     = 0.40   # противопожарная стена REI-60 400 мм
_WALL_PART_T     = 0.12   # перегородка 120 мм
_SLAB_T          = 0.20   # перекрытие 200 мм
_DEFAULT_H       = 3.00   # высота этажа по умолчанию
_CORE_H_LIFT_P   = 1.50   # пассажирский лифт  1.5×1.5 м
_CORE_H_LIFT_F   = 2.10   # грузовой лифт      2.1×2.1 м
_CORE_STAIR_W    = 2.10   # лестничная клетка  2.1×5.5 м
_CORE_STAIR_D    = 5.50
_CORRIDOR_MIN    = 1.40   # минимальная ширина коридора


# ── публичная точка входа ─────────────────────────────────────────────────


def build_floorplan_ifc(project: Project, *, schema: str = "IFC4") -> bytes:
    """Сериализовать Project в IFC4-байты."""
    try:
        import ifcopenshell
        import ifcopenshell.api.aggregate
        import ifcopenshell.api.context
        import ifcopenshell.api.geometry
        import ifcopenshell.api.project
        import ifcopenshell.api.root
        import ifcopenshell.api.spatial
        import ifcopenshell.api.unit
    except ImportError as e:
        raise RuntimeError("ifcopenshell не установлен") from e

    model = ifcopenshell.api.project.create_file(version=schema)

    ifc_project = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcProject", name="plana-generated",
    )
    ifcopenshell.api.unit.assign_unit(model, units=[
        ifcopenshell.api.unit.add_si_unit(model, unit_type="LENGTHUNIT"),
        ifcopenshell.api.unit.add_si_unit(model, unit_type="AREAUNIT"),
        ifcopenshell.api.unit.add_si_unit(model, unit_type="VOLUMEUNIT"),
    ])

    model_ctx = ifcopenshell.api.context.add_context(model, context_type="Model")
    body_ctx  = ifcopenshell.api.context.add_context(
        model, context_type="Model",
        context_identifier="Body", target_view="MODEL_VIEW", parent=model_ctx,
    )

    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.aggregate.assign_object(
        model, relating_object=ifc_project, products=[site],
    )

    for bi, building in enumerate(project.buildings):
        _emit_building(
            model=model, ifc=ifcopenshell, site=site, body_ctx=body_ctx,
            building=building, index=bi,
        )

    return model.wrapped_data.to_string().encode("utf-8")


# ── building ──────────────────────────────────────────────────────────────


def _emit_building(
    *, model: Any, ifc: Any, site: Any, body_ctx: Any,
    building: Building, index: int,
) -> None:
    bldg = ifc.api.root.create_entity(
        model, ifc_class="IfcBuilding", name=f"Building {index + 1}",
    )
    ifc.api.aggregate.assign_object(model, relating_object=site, products=[bldg])

    n_floors  = max(1, building.floors_count)
    total_h   = building.height_m or (n_floors * _DEFAULT_H)
    storey_h  = total_h / n_floors
    n_sect    = max(1, building.sections_count)

    footprint = building.footprint
    if not isinstance(footprint, ShPolygon) or footprint.is_empty:
        return

    bbox = footprint.bounds          # (minx, miny, maxx, maxy)
    W    = bbox[2] - bbox[0]
    D    = bbox[3] - bbox[1]

    exterior = list(footprint.exterior.coords)
    if exterior[0] == exterior[-1]:
        exterior = exterior[:-1]
    if len(exterior) < 3:
        return

    for floor_idx in range(n_floors):
        z = floor_idx * storey_h
        storey = ifc.api.root.create_entity(
            model, ifc_class="IfcBuildingStorey",
            name=f"Этаж {floor_idx + 1}",
        )
        storey.Elevation = float(z)
        ifc.api.aggregate.assign_object(model, relating_object=bldg, products=[storey])
        ifc.api.geometry.edit_object_placement(
            model, product=storey, matrix=_translation(0, 0, z),
        )

        products: list[Any] = []
        spaces:   list[Any] = []

        # 1. Перекрытие этажа
        slab = _make_slab(model, ifc, body_ctx, W, D, _SLAB_T, floor_idx, z_storey=z)
        products.append(slab)

        # 2. Периметральные несущие стены
        products.extend(_make_perimeter_walls(
            model, ifc, body_ctx, exterior, storey_h, _WALL_BEAR_T, floor_idx,
            z_storey=z,
        ))

        # 3. Противопожарные стены между секциями
        section_w = W / n_sect
        for s in range(1, n_sect):
            x = s * section_w
            products.extend(_make_fire_wall(
                model, ifc, body_ctx, x, D, storey_h, _WALL_FIRE_T, floor_idx, s,
                z_storey=z,
            ))

        # 4. Ядра (лифты + лестница) в каждой секции
        for s in range(n_sect):
            cx = section_w / 2 + s * section_w
            cy = D / 2
            products.extend(_make_core_walls(
                model, ifc, body_ctx, cx, cy, storey_h, floor_idx, s,
                z_storey=z,
            ))

        # 5. Коридорные стены (только если есть место)
        corr_walls = _make_corridor_walls(
            model, ifc, body_ctx, D, section_w, n_sect,
            storey_h, floor_idx,
            z_storey=z,
        )
        products.extend(corr_walls)

        # 6. Пространства квартир
        spaces.extend(_make_apartment_spaces(
            model, ifc, body_ctx, storey,
            D, section_w, n_sect,
            z_storey=z,
        ))

        if products:
            ifc.api.spatial.assign_container(
                model, relating_structure=storey, products=products,
            )


# ── slab ──────────────────────────────────────────────────────────────────


def _make_slab(
    model: Any, ifc: Any, body_ctx: Any,
    W: float, D: float, thickness: float, floor_idx: int,
    z_storey: float = 0.0,
    *,
    outline: list[tuple[float, float]] | None = None,
) -> Any:
    """Перекрытие этажа. Если outline задан (T-/L-/U-форма) — используется
    его полигон, иначе прямоугольник W×D (backward-compat)."""
    slab = ifc.api.root.create_entity(
        model, ifc_class="IfcSlab",
        name=f"Slab-{floor_idx + 1}",
    )
    ifc.api.geometry.edit_object_placement(
        model, product=slab, matrix=_translation(0, 0, z_storey - thickness),
    )
    pts = outline if outline is not None else [(0, 0), (W, 0), (W, D), (0, D)]
    shape = _rect_extrusion(model, body_ctx, pts, thickness)
    ifc.api.geometry.assign_representation(model, product=slab, representation=shape)
    return slab


# ── perimeter walls ────────────────────────────────────────────────────────


def _make_perimeter_walls(
    model: Any, ifc: Any, body_ctx: Any,
    exterior: list[tuple[float, float]],
    height: float, thickness: float, floor_idx: int,
    z_storey: float = 0.0,
) -> list[Any]:
    walls: list[Any] = []
    n = len(exterior)
    for i in range(n):
        x0, y0 = exterior[i]
        x1, y1 = exterior[(i + 1) % n]
        dx, dy  = x1 - x0, y1 - y0
        length  = math.hypot(dx, dy)
        if length < 0.1:
            continue
        yaw = math.atan2(dy, dx)
        wall = ifc.api.root.create_entity(
            model, ifc_class="IfcWall",
            name=f"W-{floor_idx + 1}-{i + 1}",
        )
        ifc.api.geometry.edit_object_placement(
            model, product=wall, matrix=_placement(x0, y0, z_storey, yaw),
        )
        repr_ = ifc.api.geometry.add_wall_representation(
            model, context=body_ctx,
            length=float(length), height=float(height), thickness=float(thickness),
        )
        ifc.api.geometry.assign_representation(model, product=wall, representation=repr_)
        walls.append(wall)
    return walls


# ── fire walls ────────────────────────────────────────────────────────────


def _make_fire_wall(
    model: Any, ifc: Any, body_ctx: Any,
    x: float, D: float, height: float, thickness: float,
    floor_idx: int, sect_idx: int,
    z_storey: float = 0.0,
) -> list[Any]:
    """Вертикальная противопожарная стена на x, вдоль оси Y."""
    wall = ifc.api.root.create_entity(
        model, ifc_class="IfcWall",
        name=f"FW-{floor_idx + 1}-{sect_idx}",
    )
    # стена идёт вдоль Y → угол π/2
    ifc.api.geometry.edit_object_placement(
        model, product=wall,
        matrix=_placement(x - thickness / 2, 0, z_storey, math.pi / 2),
    )
    repr_ = ifc.api.geometry.add_wall_representation(
        model, context=body_ctx,
        length=float(D), height=float(height), thickness=float(thickness),
    )
    ifc.api.geometry.assign_representation(model, product=wall, representation=repr_)
    return [wall]


# ── core walls ────────────────────────────────────────────────────────────


def _make_core_walls(
    model: Any, ifc: Any, body_ctx: Any,
    cx: float, cy: float,
    height: float, floor_idx: int, sect_idx: int,
    z_storey: float = 0.0,
) -> list[Any]:
    """Ящик ядра (пассажирский лифт + лестница + грузовой лифт) в виде 4 IfcWall."""
    # Размеры суммарного ядра
    core_w = _CORE_H_LIFT_P + _CORE_H_LIFT_F + _CORE_STAIR_W + 0.8  # ~6.5 м
    core_d = max(_CORE_STAIR_D, _CORE_H_LIFT_F)                      # ~5.5 м
    t = _WALL_BEAR_T

    x0 = cx - core_w / 2
    y0 = cy - core_d / 2
    x1 = cx + core_w / 2
    y1 = cy + core_d / 2

    segments = [
        (x0, y0, x1, y0, 0.0),           # south
        (x1, y0, x1, y1, math.pi / 2),   # east
        (x1, y1, x0, y1, math.pi),       # north
        (x0, y1, x0, y0, -math.pi / 2),  # west
    ]

    walls: list[Any] = []
    for si, (ax, ay, bx, by, yaw) in enumerate(segments):
        length = math.hypot(bx - ax, by - ay)
        if length < 0.1:
            continue
        wall = ifc.api.root.create_entity(
            model, ifc_class="IfcWall",
            name=f"Core-{floor_idx + 1}-{sect_idx}-{si}",
        )
        ifc.api.geometry.edit_object_placement(
            model, product=wall, matrix=_placement(ax, ay, z_storey, yaw),
        )
        repr_ = ifc.api.geometry.add_wall_representation(
            model, context=body_ctx,
            length=float(length), height=float(height), thickness=float(t),
        )
        ifc.api.geometry.assign_representation(model, product=wall, representation=repr_)
        walls.append(wall)

    return walls


# ── corridor walls ────────────────────────────────────────────────────────


def _make_corridor_walls(
    model: Any, ifc: Any, body_ctx: Any,
    D: float, section_w: float, n_sect: int,
    height: float, floor_idx: int,
    z_storey: float = 0.0,
) -> list[Any]:
    """Горизонтальные стены, отделяющие коридор от квартир.

    Коридор — в центре секции. Квартиры — с южной и северной стороны.
    Стены по всей ширине здания (минус зазор у ядра).
    """
    core_w   = _CORE_H_LIFT_P + _CORE_H_LIFT_F + _CORE_STAIR_W + 0.8
    core_d   = max(_CORE_STAIR_D, _CORE_H_LIFT_F)
    apt_d    = max(4.0, (D - _CORRIDOR_MIN - core_d) / 2)
    t        = _WALL_PART_T

    y_south = _WALL_BEAR_T + apt_d          # стена между квартирами юга и коридором
    y_north = D - _WALL_BEAR_T - apt_d      # стена между коридором и квартирами севера

    walls: list[Any] = []
    for s in range(n_sect):
        cx = section_w / 2 + s * section_w
        gap_x0 = cx - core_w / 2 - 0.2
        gap_x1 = cx + core_w / 2 + 0.2
        x0_sect = s * section_w + _WALL_BEAR_T
        x1_sect = (s + 1) * section_w - _WALL_BEAR_T

        for y_corr, name_sfx in [(y_south, "S"), (y_north, "N")]:
            # Левый сегмент (до ядра)
            seg_len_l = gap_x0 - x0_sect
            if seg_len_l > 0.3:
                w = ifc.api.root.create_entity(
                    model, ifc_class="IfcWall",
                    name=f"CW-{floor_idx+1}-{s}-{name_sfx}-L",
                )
                ifc.api.geometry.edit_object_placement(
                    model, product=w, matrix=_placement(x0_sect, y_corr, z_storey, 0),
                )
                repr_ = ifc.api.geometry.add_wall_representation(
                    model, context=body_ctx,
                    length=float(seg_len_l), height=float(height), thickness=float(t),
                )
                ifc.api.geometry.assign_representation(model, product=w, representation=repr_)
                walls.append(w)

            # Правый сегмент (после ядра)
            seg_len_r = x1_sect - gap_x1
            if seg_len_r > 0.3:
                w = ifc.api.root.create_entity(
                    model, ifc_class="IfcWall",
                    name=f"CW-{floor_idx+1}-{s}-{name_sfx}-R",
                )
                ifc.api.geometry.edit_object_placement(
                    model, product=w, matrix=_placement(gap_x1, y_corr, z_storey, 0),
                )
                repr_ = ifc.api.geometry.add_wall_representation(
                    model, context=body_ctx,
                    length=float(seg_len_r), height=float(height), thickness=float(t),
                )
                ifc.api.geometry.assign_representation(model, product=w, representation=repr_)
                walls.append(w)

    return walls


# ── apartment spaces ──────────────────────────────────────────────────────


def _make_apartment_spaces(
    model: Any, ifc: Any, body_ctx: Any, storey: Any,
    D: float, section_w: float, n_sect: int,
    z_storey: float = 0.0,
) -> list[Any]:
    """IfcSpace на каждую квартирную зону (прямоугольная аппроксимация)."""
    core_d = max(_CORE_STAIR_D, _CORE_H_LIFT_F)
    apt_d  = max(4.0, (D - _CORRIDOR_MIN - core_d) / 2)
    t_bear = _WALL_BEAR_T

    spaces: list[Any] = []
    apt_number = 1

    for s in range(n_sect):
        x0_sect = s * section_w + t_bear
        x1_sect = (s + 1) * section_w - t_bear
        usable_w = x1_sect - x0_sect

        # Сколько квартир с каждой стороны: 1..3 в зависимости от ширины секции
        n_apts = max(1, round(usable_w / 7.0))  # ~7м на квартиру
        apt_w  = usable_w / n_apts

        for _, (y_start, y_end) in enumerate([
            (t_bear,            t_bear + apt_d),               # юг
            (D - t_bear - apt_d, D - t_bear),                  # север
        ]):
            for ai in range(n_apts):
                xa = x0_sect + ai * apt_w
                xb = xa + apt_w
                ya = y_start
                yb = y_end

                area_m2 = round((xb - xa) * (yb - ya), 1)
                # Тип по площади
                if area_m2 < 38:
                    apt_type = "Ст"
                elif area_m2 < 55:
                    apt_type = "1К"
                elif area_m2 < 75:
                    apt_type = "2К"
                else:
                    apt_type = "3К"

                sp = ifc.api.root.create_entity(
                    model, ifc_class="IfcSpace",
                    name=f"Кв. {apt_number} ({apt_type}, {area_m2} м²)",
                )
                ifc.api.geometry.edit_object_placement(
                    model, product=sp, matrix=_translation(xa, ya, z_storey),
                )
                # Геометрия пространства — тонкий объём на высоту этажа
                shape = _rect_extrusion(
                    model, body_ctx,
                    [(0, 0), (xb - xa, 0), (xb - xa, yb - ya), (0, yb - ya)],
                    height=2.7,  # чистая высота помещения
                )
                ifc.api.geometry.assign_representation(model, product=sp, representation=shape)
                ifc.api.aggregate.assign_object(
                    model, relating_object=storey, products=[sp],
                )
                spaces.append(sp)
                apt_number += 1

    return spaces


# ── geometry helpers ──────────────────────────────────────────────────────


def _rect_extrusion(
    model: Any, body_ctx: Any,
    pts_2d: list[tuple[float, float]],
    height: float,
) -> Any:
    """IfcProductDefinitionShape из прямоугольника + ExtrudedAreaSolid."""
    ifc_pts = [model.createIfcCartesianPoint([float(x), float(y)]) for x, y in pts_2d]
    ifc_pts.append(ifc_pts[0])  # замкнуть
    polyline  = model.createIfcPolyline(ifc_pts)
    profile   = model.createIfcArbitraryClosedProfileDef("AREA", None, polyline)
    direction = model.createIfcDirection([0.0, 0.0, 1.0])
    placement = model.createIfcAxis2Placement3D(
        model.createIfcCartesianPoint([0.0, 0.0, 0.0]), None, None,
    )
    solid = model.createIfcExtrudedAreaSolid(profile, placement, direction, float(height))
    shape_repr = model.createIfcShapeRepresentation(body_ctx, "Body", "SweptSolid", [solid])
    return model.createIfcProductDefinitionShape(None, None, [shape_repr])


# ── matrix helpers ────────────────────────────────────────────────────────


def _translation(x: float, y: float, z: float) -> np.ndarray:
    m = np.eye(4)
    m[0, 3] = x; m[1, 3] = y; m[2, 3] = z
    return m


def _placement(x: float, y: float, z: float, yaw_rad: float) -> np.ndarray:
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    m = np.eye(4)
    m[0, 0] = c;  m[0, 1] = -s
    m[1, 0] = s;  m[1, 1] =  c
    m[0, 3] = x;  m[1, 3] = y; m[2, 3] = z
    return m


# ── generic wall-segment helper (Phase 3b) ────────────────────────────────


def _make_wall_segment(
    model: Any, ifc: Any, body_ctx: Any,
    x0: float, y0: float, x1: float, y1: float,
    *, thickness: float, height: float, z_storey: float, name: str,
) -> Any:
    """Один отрезок стены от (x0,y0) до (x1,y1). Возвращает IfcWall или None
    если отрезок короче 10 см."""
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length < 0.1:
        return None
    yaw = math.atan2(dy, dx)
    wall = ifc.api.root.create_entity(model, ifc_class="IfcWall", name=name)
    ifc.api.geometry.edit_object_placement(
        model, product=wall, matrix=_placement(x0, y0, z_storey, yaw),
    )
    repr_ = ifc.api.geometry.add_wall_representation(
        model, context=body_ctx,
        length=float(length), height=float(height), thickness=float(thickness),
    )
    ifc.api.geometry.assign_representation(model, product=wall, representation=repr_)
    return wall


def _make_rect_walls(
    model: Any, ifc: Any, body_ctx: Any,
    x: float, y: float, w: float, d: float,
    *, thickness: float, height: float, z_storey: float, name_prefix: str,
) -> list[Any]:
    """4 стены вокруг прямоугольника. SW-угол (x,y), размер w×d."""
    segs = [
        (x,     y,     x + w, y,     "S"),
        (x + w, y,     x + w, y + d, "E"),
        (x + w, y + d, x,     y + d, "N"),
        (x,     y + d, x,     y,     "W"),
    ]
    out: list[Any] = []
    for ax, ay, bx, by, sfx in segs:
        wall = _make_wall_segment(
            model, ifc, body_ctx, ax, ay, bx, by,
            thickness=thickness, height=height, z_storey=z_storey,
            name=f"{name_prefix}-{sfx}",
        )
        if wall is not None:
            out.append(wall)
    return out


# ── Stена с проёмами для дверей/окон (Phase 3c) ──────────────────────────

_DOOR_HEAD_H   = 2.10   # высота дверного проёма от пола
_WIN_SILL_H    = 0.90   # подоконник
_WIN_HEAD_H    = 2.40   # верх окна
_PANEL_T       = 0.04   # толщина дверной/оконной панели (для геометрии)


def _make_wall_with_openings(
    model: Any, ifc: Any, body_ctx: Any,
    x0: float, y0: float, x1: float, y1: float,
    *, openings: list[dict], thickness: float, height: float,
    z_storey: float, name_prefix: str,
) -> list[Any]:
    """Стена от (x0,y0) до (x1,y1) с проёмами для дверей/окон.

    openings: список словарей [{offset, width, kind, sill_h, head_h, label}]
    отсортированный по offset. kind = 'door' | 'window'.

    Возвращает список созданных IfcWall сегментов + IfcDoor/IfcWindow.
    """
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length < 0.1:
        return []
    yaw = math.atan2(dy, dx)
    ux, uy = dx / length, dy / length  # unit vector вдоль стены

    out: list[Any] = []
    cursor = 0.0

    for i, op in enumerate(openings):
        off = max(0.0, min(op["offset"], length))
        w_op = min(op["width"], length - off)
        if w_op <= 0.05:
            continue

        # 1. Сегмент стены ДО проёма (полная высота)
        if off - cursor > 0.05:
            sx, sy = x0 + ux * cursor, y0 + uy * cursor
            ex, ey = x0 + ux * off,    y0 + uy * off
            w = _make_wall_segment(
                model, ifc, body_ctx, sx, sy, ex, ey,
                thickness=thickness, height=height, z_storey=z_storey,
                name=f"{name_prefix}-pre{i}",
            )
            if w is not None:
                out.append(w)

        # 2. Подоконник (только для окон, sill > 0)
        if op["sill_h"] > 0.05:
            sx, sy = x0 + ux * off,           y0 + uy * off
            ex, ey = x0 + ux * (off + w_op),  y0 + uy * (off + w_op)
            w = _make_wall_segment(
                model, ifc, body_ctx, sx, sy, ex, ey,
                thickness=thickness, height=op["sill_h"], z_storey=z_storey,
                name=f"{name_prefix}-sill{i}",
            )
            if w is not None:
                out.append(w)

        # 3. Перемычка (над проёмом)
        lintel_h = height - op["head_h"]
        if lintel_h > 0.05:
            sx, sy = x0 + ux * off,           y0 + uy * off
            ex, ey = x0 + ux * (off + w_op),  y0 + uy * (off + w_op)
            w = _make_wall_segment(
                model, ifc, body_ctx, sx, sy, ex, ey,
                thickness=thickness, height=lintel_h,
                z_storey=z_storey + op["head_h"],
                name=f"{name_prefix}-lin{i}",
            )
            if w is not None:
                out.append(w)

        # 4. Сама дверь/окно — тонкая панель внутри проёма
        ifc_class = "IfcDoor" if op["kind"] == "door" else "IfcWindow"
        ent = ifc.api.root.create_entity(model, ifc_class=ifc_class, name=op["label"])
        op_x, op_y = x0 + ux * off, y0 + uy * off
        ifc.api.geometry.edit_object_placement(
            model, product=ent,
            matrix=_placement(op_x, op_y, z_storey + op["sill_h"], yaw),
        )
        # Геометрия панели: тонкий брусок, центрированный по толщине стены
        panel_h = op["head_h"] - op["sill_h"]
        off_t = (thickness - _PANEL_T) / 2
        shape = _rect_extrusion(
            model, body_ctx,
            [(0.0, off_t), (w_op, off_t),
             (w_op, off_t + _PANEL_T), (0.0, off_t + _PANEL_T)],
            panel_h,
        )
        ifc.api.geometry.assign_representation(model, product=ent, representation=shape)
        out.append(ent)

        cursor = off + w_op

    # 5. Финальный сегмент после последнего проёма
    if length - cursor > 0.05:
        sx, sy = x0 + ux * cursor, y0 + uy * cursor
        w = _make_wall_segment(
            model, ifc, body_ctx, sx, sy, x1, y1,
            thickness=thickness, height=height, z_storey=z_storey,
            name=f"{name_prefix}-post",
        )
        if w is not None:
            out.append(w)

    return out


def _make_room_walls_with_openings(
    model: Any, ifc: Any, body_ctx: Any,
    x: float, y: float, w: float, d: float,
    *, doors: list[Any], windows: list[Any],
    thickness: float, height: float, z_storey: float, name_prefix: str,
) -> list[Any]:
    """4 стены вокруг прямоугольника комнаты с проёмами для дверей/окон.

    doors/windows — LayoutDoor/LayoutWindow со side ∈ {S,E,N,W} и offset/width.
    """
    sides: dict[str, list[dict]] = {"S": [], "E": [], "N": [], "W": []}
    for door in doors:
        sides[door.side].append({
            "offset": float(door.offset), "width": float(door.width),
            "kind": "door", "sill_h": 0.0, "head_h": _DOOR_HEAD_H,
            "label": f"{name_prefix}-{door.side}-door",
        })
    for win in windows:
        sides[win.side].append({
            "offset": float(win.offset), "width": float(win.width),
            "kind": "window", "sill_h": _WIN_SILL_H, "head_h": _WIN_HEAD_H,
            "label": f"{name_prefix}-{win.side}-window",
        })

    side_endpoints = {
        "S": (x,     y,     x + w, y    ),
        "E": (x + w, y,     x + w, y + d),
        "N": (x + w, y + d, x,     y + d),
        "W": (x,     y + d, x,     y    ),
    }
    out: list[Any] = []
    for side, (sx0, sy0, sx1, sy1) in side_endpoints.items():
        ops = sorted(sides[side], key=lambda o: o["offset"])
        out.extend(_make_wall_with_openings(
            model, ifc, body_ctx, sx0, sy0, sx1, sy1,
            openings=ops, thickness=thickness, height=height,
            z_storey=z_storey, name_prefix=f"{name_prefix}-{side}",
        ))
    return out


# ── IFC из структурированной планировки (AI-generated layout) ─────────────


def build_ifc_from_layout(
    layout: LayoutFloor,
    *,
    n_floors: int = 1,
    storey_h: float = 3.0,
    schema: str = "IFC4",
) -> bytes:
    """Построить IFC4 из LayoutFloor (structured GPT-4o output).

    В отличие от build_floorplan_ifc (параметрическая модель) здесь каждая
    комната — отдельный IfcSpace с реальными координатами и типом.
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
    except ImportError as e:
        raise RuntimeError("ifcopenshell не установлен") from e

    W = layout.width_m
    D = layout.depth_m

    model = ifcopenshell.api.project.create_file(version=schema)
    ifc_project = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcProject", name="plana-generated",
    )
    ifcopenshell.api.unit.assign_unit(model, units=[
        ifcopenshell.api.unit.add_si_unit(model, unit_type="LENGTHUNIT"),
        ifcopenshell.api.unit.add_si_unit(model, unit_type="AREAUNIT"),
        ifcopenshell.api.unit.add_si_unit(model, unit_type="VOLUMEUNIT"),
    ])

    model_ctx = ifcopenshell.api.context.add_context(model, context_type="Model")
    body_ctx  = ifcopenshell.api.context.add_context(
        model, context_type="Model",
        context_identifier="Body", target_view="MODEL_VIEW", parent=model_ctx,
    )

    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.aggregate.assign_object(
        model, relating_object=ifc_project, products=[site],
    )
    bldg = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcBuilding", name="Building 1",
    )
    ifcopenshell.api.aggregate.assign_object(
        model, relating_object=site, products=[bldg],
    )

    _CORE_LABEL = {
        "lift_passenger": "Лифт пасс.",
        "lift_freight":   "Лифт груз.",
        "stair":          "Лестница",
    }

    for floor_idx in range(n_floors):
        z = floor_idx * storey_h
        storey = ifcopenshell.api.root.create_entity(
            model, ifc_class="IfcBuildingStorey",
            name=f"Этаж {floor_idx + 1}",
        )
        storey.Elevation = float(z)
        ifcopenshell.api.aggregate.assign_object(
            model, relating_object=bldg, products=[storey],
        )
        ifcopenshell.api.geometry.edit_object_placement(
            model, product=storey, matrix=_translation(0, 0, z),
        )

        structural: list[Any] = []

        # 1. Перекрытие — следует outline-полигону если он есть (T-/L-/U-форма)
        outline_pts: list[tuple[float, float]] | None = (
            [(float(x), float(y)) for x, y in layout.outline]
            if layout.outline else None
        )
        slab = _make_slab(
            model, ifcopenshell, body_ctx, W, D, _SLAB_T, floor_idx,
            z_storey=z, outline=outline_pts,
        )
        structural.append(slab)

        # 2. Периметральные несущие стены — также по outline или bbox
        exterior = outline_pts if outline_pts is not None else [
            (0.0, 0.0), (W, 0.0), (W, D), (0.0, D),
        ]
        structural.extend(_make_perimeter_walls(
            model, ifcopenshell, body_ctx, exterior, storey_h, _WALL_BEAR_T, floor_idx,
            z_storey=z,
        ))

        # 3. Противопожарные стены между секциями
        for sect in layout.sections:
            if sect.index > 0:
                structural.extend(_make_fire_wall(
                    model, ifcopenshell, body_ctx,
                    sect.x_start, D, storey_h, _WALL_FIRE_T,
                    floor_idx, sect.index,
                    z_storey=z,
                ))

        # 3b. Внутренние стены (Phase 3b)
        for sect in layout.sections:
            # 3b.1 Стены ядра (лифт + лестница) — обводим LayoutCore
            for ci, core in enumerate(sect.cores):
                structural.extend(_make_rect_walls(
                    model, ifcopenshell, body_ctx,
                    core.x, core.y, core.w, core.d,
                    thickness=_WALL_BEAR_T, height=storey_h, z_storey=z,
                    name_prefix=f"Core-{floor_idx+1}-{sect.index+1}-{ci+1}",
                ))
                # Phase 3c: для лестниц добавляем IfcStair-маркер (схематично,
                # как extruded блок внутри ядра — реальная геометрия ступеней
                # выходит за рамки этой версии).
                if core.kind == "stair":
                    stair = ifcopenshell.api.root.create_entity(
                        model, ifc_class="IfcStair",
                        name=f"Stair-{floor_idx+1}-{sect.index+1}",
                    )
                    inner_t = _WALL_BEAR_T  # отступ внутрь от стен ядра
                    ifcopenshell.api.geometry.edit_object_placement(
                        model, product=stair,
                        matrix=_translation(core.x + inner_t, core.y + inner_t, z),
                    )
                    sw = max(0.1, core.w - 2 * inner_t)
                    sd = max(0.1, core.d - 2 * inner_t)
                    shape = _rect_extrusion(
                        model, body_ctx,
                        [(0.0, 0.0), (sw, 0.0), (sw, sd), (0.0, sd)],
                        storey_h - 0.2,
                    )
                    ifcopenshell.api.geometry.assign_representation(
                        model, product=stair, representation=shape,
                    )
                    structural.append(stair)
            # 3b.2 Стены коридора — север и юг секционного коридора
            corr_x0 = sect.x_start
            corr_x1 = sect.x_start + sect.width
            corr_y_south = sect.corridor_y
            corr_y_north = sect.corridor_y + sect.corridor_d
            for y_corr, sfx in [(corr_y_south, "S"), (corr_y_north, "N")]:
                wall = _make_wall_segment(
                    model, ifcopenshell, body_ctx,
                    corr_x0, y_corr, corr_x1, y_corr,
                    thickness=_WALL_PART_T, height=storey_h, z_storey=z,
                    name=f"Corr-{floor_idx+1}-{sect.index+1}-{sfx}",
                )
                if wall is not None:
                    structural.append(wall)
            # 3b.3 Стены комнат — 4 сегмента вокруг каждого LayoutRoom
            # Phase 3c: с проёмами для дверей/окон вместо сплошных стен.
            for apt in sect.apartments:
                for ri, room in enumerate(apt.rooms):
                    rx = apt.x + room.x
                    ry = apt.y + room.y
                    structural.extend(_make_room_walls_with_openings(
                        model, ifcopenshell, body_ctx,
                        rx, ry, room.w, room.d,
                        doors=room.doors, windows=room.windows,
                        thickness=_WALL_PART_T, height=storey_h, z_storey=z,
                        name_prefix=f"Room-{floor_idx+1}-{sect.index+1}-{apt.number}-{ri+1}",
                    ))

        ifcopenshell.api.spatial.assign_container(
            model, relating_structure=storey, products=structural,
        )

        # 4. Пространства (агрегируем в этаж)
        for sect in layout.sections:
            # Коридор
            corr_sp = _make_space_rect(
                model, ifcopenshell, body_ctx,
                f"Коридор {floor_idx + 1}-{sect.index + 1}",
                sect.x_start, sect.corridor_y,
                sect.width, sect.corridor_d, 2.4,
                z_storey=z,
            )
            ifcopenshell.api.aggregate.assign_object(
                model, relating_object=storey, products=[corr_sp],
            )

            # Ядро (лифты + лестница)
            for core in sect.cores:
                label = f"{_CORE_LABEL.get(core.kind, 'Ядро')} {floor_idx + 1}-{sect.index + 1}"
                core_sp = _make_space_rect(
                    model, ifcopenshell, body_ctx,
                    label, core.x, core.y, core.w, core.d, storey_h,
                    z_storey=z,
                )
                ifcopenshell.api.aggregate.assign_object(
                    model, relating_object=storey, products=[core_sp],
                )

            # Комнаты квартир
            for apt in sect.apartments:
                apt_label = {
                    "studio": "Студия", "1k": "1К", "2k": "2К", "3k": "3К",
                }.get(apt.type_code, apt.type_code.upper())
                for room in apt.rooms:
                    room_sp = _make_space_rect(
                        model, ifcopenshell, body_ctx,
                        f"{room.name_ru} (кв.{apt.number} {apt_label})",
                        apt.x + room.x, apt.y + room.y,
                        room.w, room.d, 2.7,
                        z_storey=z,
                    )
                    ifcopenshell.api.aggregate.assign_object(
                        model, relating_object=storey, products=[room_sp],
                    )

    return model.wrapped_data.to_string().encode("utf-8")


# ── space helper ──────────────────────────────────────────────────────────


def _make_space_rect(
    model: Any, ifc: Any, body_ctx: Any,
    name: str,
    x: float, y: float, w: float, d: float,
    height: float,
    z_storey: float = 0.0,
) -> Any:
    sp = ifc.api.root.create_entity(model, ifc_class="IfcSpace", name=name)
    ifc.api.geometry.edit_object_placement(
        model, product=sp, matrix=_translation(x, y, z_storey),
    )
    shape = _rect_extrusion(model, body_ctx, [(0, 0), (w, 0), (w, d), (0, d)], height)
    ifc.api.geometry.assign_representation(model, product=sp, representation=shape)
    return sp


__all__ = ["build_floorplan_ifc", "build_ifc_from_layout"]
