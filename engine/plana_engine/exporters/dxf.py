"""DXF-экспорт плана этажа (ТЗ §3.6, §10.4 «Этап 4 Экспорт»).

Структура слоёв (стандарт архитектурного DXF):
    0                  — default
    WALL_BEARING       — несущие стены (наружные + ядро) — color 1 (red)
    WALL_PARTITION     — внутренние перегородки (между квартирами) — color 7
    DOOR               — двери — color 6 (magenta)
    WINDOW             — окна — color 5 (blue)
    FIXTURE            — сантехника, кухонные блоки — color 8 (gray)
    ZONE_FILL          — заливка квартирных зон — color 9
    TEXT_APT           — подписи квартир (КВ № и площади) — color 7
    DIM                — размерные линии — color 7
    GRID               — оси и сетка — color 8

Все координаты — в метрах. AutoCAD единицы по умолчанию ставим в meters.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

from ..types import (
    Corridor, CoreSpec, PlacedTile, PlacedZone, Plan, Polygon,
)


# Толщины стен (по нормам), м
EXTERIOR_WALL_THICKNESS = 0.4    # наружные несущие
PARTITION_THICKNESS     = 0.12   # межквартирные
DOOR_OPENING_WIDTH      = 0.9
WINDOW_THICKNESS        = 0.25


# ---------------------------------------------------------------------------
# Layer / linetype setup
# ---------------------------------------------------------------------------


def _setup_layers(doc: ezdxf.document.Drawing) -> None:
    layers = doc.layers
    specs = [
        # name, color, linetype, lineweight (in 0.01mm)
        ("WALL_BEARING",   1, "Continuous", 50),   # 0.50 мм
        ("WALL_PARTITION", 7, "Continuous", 25),
        ("DOOR",           6, "Continuous", 25),
        ("WINDOW",         5, "Continuous", 25),
        ("FIXTURE",        8, "Continuous", 18),
        ("ZONE_FILL",      9, "Continuous", 13),
        ("TEXT_APT",       7, "Continuous", 25),
        ("DIM",            7, "Continuous", 18),
        ("GRID",           8, "DASHED",     13),
    ]
    for name, color, ltype, lw in specs:
        if name in layers:
            continue
        layers.add(name=name, color=color, linetype=ltype, lineweight=lw)


def _setup_dimstyle(doc: ezdxf.document.Drawing) -> None:
    """Стиль размерных линий: подходит для архитектурного плана 1:100."""
    name = "PLANA_ARCH"
    if name in doc.dimstyles:
        return
    s = doc.dimstyles.new(name)
    s.dxf.dimtxt   = 0.35     # высота текста
    s.dxf.dimasz   = 0.25     # размер стрелок
    s.dxf.dimexo   = 0.06     # вынос линии
    s.dxf.dimexe   = 0.18     # выступ за основную
    s.dxf.dimgap   = 0.08     # зазор текст/линия
    s.dxf.dimdec   = 2        # 2 знака после запятой
    s.dxf.dimscale = 1.0


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------


def _poly_pts(p: Polygon) -> list[tuple[float, float]]:
    return [(pt.x, pt.y) for pt in p.exterior]


def _draw_exterior_walls(msp, contour: Polygon) -> None:
    """Наружные стены — две концентрические полилинии (внутренний + внешний контур)
    с заштрихованным пространством между ними. Стандартная архитектурная нотация.
    """
    outer = _poly_pts(contour)
    # Внешний контур
    msp.add_lwpolyline(
        outer + [outer[0]],
        close=True,
        dxfattribs={"layer": "WALL_BEARING"},
    )
    # Внутренний контур (со смещением EXTERIOR_WALL_THICKNESS внутрь)
    inner = _offset_polygon(outer, -EXTERIOR_WALL_THICKNESS)
    msp.add_lwpolyline(
        inner + [inner[0]],
        close=True,
        dxfattribs={"layer": "WALL_BEARING"},
    )
    # Штриховка стены (между outer и inner)
    hatch = msp.add_hatch(color=1, dxfattribs={"layer": "WALL_BEARING"})
    hatch.set_pattern_fill("ANSI31", scale=0.5)
    hatch.paths.add_polyline_path(outer + [outer[0]], is_closed=True, flags=1)  # exterior
    hatch.paths.add_polyline_path(inner + [inner[0]], is_closed=True, flags=0)  # hole


def _offset_polygon(
    pts: list[tuple[float, float]], distance: float
) -> list[tuple[float, float]]:
    """Аккуратное смещение прямоугольной полилинии. Для произвольных полигонов
    нужно использовать Shapely buffer; в MVP контур всегда прямоугольный."""
    if not pts:
        return pts
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    if distance < 0:  # внутрь
        d = -distance
        return [
            (minx + d, miny + d),
            (maxx - d, miny + d),
            (maxx - d, maxy - d),
            (minx + d, maxy - d),
        ]
    return [
        (minx - distance, miny - distance),
        (maxx + distance, miny - distance),
        (maxx + distance, maxy + distance),
        (minx - distance, maxy + distance),
    ]


def _draw_core(msp, core: CoreSpec) -> None:
    pts = _poly_pts(core.polygon)
    msp.add_lwpolyline(pts + [pts[0]], close=True,
                       dxfattribs={"layer": "WALL_BEARING"})
    # Лестничные ступени — горизонтальные линии внутри ядра
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    w = maxx - minx
    h = maxy - miny
    stair_w = w * 0.45
    stair_h = h * 0.78
    sx = minx + (w - stair_w) / 2
    sy = miny + (h - stair_h) / 2
    treads = 12
    for i in range(1, treads):
        y = sy + (stair_h / treads) * i
        msp.add_line((sx, y), (sx + stair_w, y),
                     dxfattribs={"layer": "WALL_PARTITION"})
    # подпись «ЛЛУ»
    msp.add_text(
        "ЛЛУ",
        dxfattribs={"layer": "TEXT_APT", "height": 0.45},
    ).set_placement(
        (minx + w / 2, miny + h - 0.35),
        align=TextEntityAlignment.MIDDLE_CENTER,
    )


def _draw_corridor(msp, corridor: Corridor) -> None:
    pts = _poly_pts(corridor.polygon)
    msp.add_lwpolyline(pts + [pts[0]], close=True,
                       dxfattribs={"layer": "WALL_PARTITION"})


def _draw_apartment(msp, tile: PlacedTile) -> None:
    pts = _poly_pts(tile.polygon)
    # Контур квартиры — межквартирная стена
    msp.add_lwpolyline(pts + [pts[0]], close=True,
                       dxfattribs={"layer": "WALL_PARTITION"})

    # Зоны квартиры — заливка hatch
    for z in tile.zones:
        zpts = _poly_pts(z.polygon)
        if len(zpts) < 3:
            continue
        msp.add_lwpolyline(zpts + [zpts[0]], close=True,
                           dxfattribs={"layer": "ZONE_FILL"})
        if z.kind.value in ("kitchen", "bathroom"):
            hatch = msp.add_hatch(color=8, dxfattribs={"layer": "ZONE_FILL"})
            hatch.set_pattern_fill("ANSI32", scale=0.35)
            hatch.paths.add_polyline_path(zpts + [zpts[0]], is_closed=True)
        # Сантехника
        if z.kind.value == "bathroom":
            _draw_bathroom_fixtures(msp, z)
        elif z.kind.value == "kitchen":
            _draw_kitchen_fixtures(msp, z)

    # Дверь
    if tile.door_world:
        _draw_door(msp, tile)

    # Окна на фасадной стороне
    _draw_windows(msp, tile)

    # Подпись квартиры в центре
    bx_min = min(p[0] for p in pts)
    by_min = min(p[1] for p in pts)
    bx_max = max(p[0] for p in pts)
    by_max = max(p[1] for p in pts)
    cx = (bx_min + bx_max) / 2
    cy = (by_min + by_max) / 2
    msp.add_text(
        f"КВ №{tile.apt_number}",
        dxfattribs={"layer": "TEXT_APT", "height": 0.45},
    ).set_placement((cx, cy + 0.25), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text(
        f"S общ. {tile.area:.2f} м²",
        dxfattribs={"layer": "TEXT_APT", "height": 0.32},
    ).set_placement((cx, cy - 0.4), align=TextEntityAlignment.MIDDLE_CENTER)
    if tile.living_area > 0:
        msp.add_text(
            f"S жил. {tile.living_area:.2f} м²",
            dxfattribs={"layer": "TEXT_APT", "height": 0.28},
        ).set_placement((cx, cy - 0.85), align=TextEntityAlignment.MIDDLE_CENTER)


def _draw_door(msp, tile: PlacedTile) -> None:
    if tile.door_world is None:
        return
    door = tile.door_world
    # дверь — линия + дуга открытия. Створка идёт «вдоль фасада», открывается внутрь.
    e = tile.facade_edge
    dx = e.b.x - e.a.x
    dy = e.b.y - e.a.y
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    # нормаль внутрь здания (CCW): -uy, ux
    nx, ny = -uy, ux
    # инвертируем нормаль если нужно (для нижнего ряда нормаль вверх, для верхнего вниз)
    # door расположена на коридорной стене → наружу от тайла, к коридору
    # створка длиной DOOR_OPENING_WIDTH вдоль фасадной оси (ux, uy)
    end_x = door.x + ux * DOOR_OPENING_WIDTH
    end_y = door.y + uy * DOOR_OPENING_WIDTH
    msp.add_line(
        (door.x, door.y), (end_x, end_y),
        dxfattribs={"layer": "DOOR"},
    )
    # дуга открытия 90° внутрь квартиры
    cx, cy = door.x, door.y
    start_angle = math.degrees(math.atan2(uy, ux))
    end_angle = start_angle - 90  # внутрь
    msp.add_arc(
        center=(cx, cy),
        radius=DOOR_OPENING_WIDTH,
        start_angle=end_angle,
        end_angle=start_angle,
        dxfattribs={"layer": "DOOR"},
    )


def _draw_windows(msp, tile: PlacedTile) -> None:
    e = tile.facade_edge
    pts = _poly_pts(tile.polygon)
    bx_min = min(p[0] for p in pts)
    by_min = min(p[1] for p in pts)
    bx_max = max(p[0] for p in pts)
    by_max = max(p[1] for p in pts)
    w = bx_max - bx_min
    h = by_max - by_min

    # определяем фасадную сторону тайла по середине facade_edge
    fmidx = (e.a.x + e.b.x) / 2
    fmidy = (e.a.y + e.b.y) / 2
    cx = (bx_min + bx_max) / 2
    cy = (by_min + by_max) / 2

    # горизонтальный фасад → окна на нижней или верхней грани
    if abs(fmidy - by_min) < abs(fmidy - by_max):
        win_y = by_min
    else:
        win_y = by_max - WINDOW_THICKNESS

    # 2 окна равномерно
    win_w = min(1.6, w * 0.28)
    for ratio in (0.25, 0.75):
        wx = bx_min + ratio * w - win_w / 2
        msp.add_lwpolyline(
            [
                (wx, win_y),
                (wx + win_w, win_y),
                (wx + win_w, win_y + WINDOW_THICKNESS),
                (wx, win_y + WINDOW_THICKNESS),
                (wx, win_y),
            ],
            close=True,
            dxfattribs={"layer": "WINDOW"},
        )
        # перекладина окна
        msp.add_line(
            (wx, win_y + WINDOW_THICKNESS / 2),
            (wx + win_w, win_y + WINDOW_THICKNESS / 2),
            dxfattribs={"layer": "WINDOW"},
        )
    # подавляем неиспользуемые переменные
    _ = cx, cy, h


def _draw_bathroom_fixtures(msp, z: PlacedZone) -> None:
    pts = _poly_pts(z.polygon)
    bx_min = min(p[0] for p in pts)
    by_min = min(p[1] for p in pts)
    bx_max = max(p[0] for p in pts)
    by_max = max(p[1] for p in pts)
    w = bx_max - bx_min
    h = by_max - by_min
    if w < 1.4 or h < 1.4:
        return
    # ванна
    tub_w = min(1.6, w * 0.55)
    tub_h = 0.7
    msp.add_lwpolyline(
        _rect(bx_min + 0.15, by_max - 0.15 - tub_h, tub_w, tub_h),
        close=True, dxfattribs={"layer": "FIXTURE"},
    )
    # унитаз
    toilet_w, toilet_h = 0.45, 0.7
    msp.add_lwpolyline(
        _rect(bx_max - toilet_w - 0.15, by_max - 0.15 - toilet_h, toilet_w, toilet_h),
        close=True, dxfattribs={"layer": "FIXTURE"},
    )
    # раковина
    sink_w, sink_h = 0.55, 0.4
    msp.add_lwpolyline(
        _rect(bx_min + 0.15, by_min + 0.15, sink_w, sink_h),
        close=True, dxfattribs={"layer": "FIXTURE"},
    )


def _draw_kitchen_fixtures(msp, z: PlacedZone) -> None:
    pts = _poly_pts(z.polygon)
    bx_min = min(p[0] for p in pts)
    by_min = min(p[1] for p in pts)
    bx_max = max(p[0] for p in pts)
    by_max = max(p[1] for p in pts)
    w = bx_max - bx_min
    h = by_max - by_min
    if w < 1.4 or h < 1.4:
        return
    sink_w, sink_h = 0.6, 0.45
    stove_w, stove_h = 0.6, 0.55
    # размещаем у дальней от центра тайла стены — будет заполняться правильно для обоих рядов
    counter_y = by_min + 0.1
    msp.add_lwpolyline(
        _rect(bx_min + 0.2, counter_y, sink_w, sink_h),
        close=True, dxfattribs={"layer": "FIXTURE"},
    )
    msp.add_circle(
        (bx_min + 0.2 + sink_w / 2, counter_y + sink_h / 2),
        radius=0.13, dxfattribs={"layer": "FIXTURE"},
    )
    msp.add_lwpolyline(
        _rect(bx_min + 1.0, counter_y, stove_w, stove_h),
        close=True, dxfattribs={"layer": "FIXTURE"},
    )
    # 4 конфорки
    for dx in (0.2, 0.4):
        for dy in (0.15, 0.4):
            msp.add_circle(
                (bx_min + 1.0 + dx, counter_y + stove_h - dy),
                radius=0.08, dxfattribs={"layer": "FIXTURE"},
            )
    _ = w, h


def _rect(x: float, y: float, w: float, h: float) -> list[tuple[float, float]]:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]


def _draw_dimensions(msp, plan: Plan) -> None:
    """Размерные линии: габарит здания + габарит каждой квартиры по фасаду."""
    contour = plan.floor_polygon
    pts = _poly_pts(contour)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)

    # габарит по ширине (снизу)
    msp.add_linear_dim(
        base=(minx + (maxx - minx) / 2, miny - 1.5),
        p1=(minx, miny),
        p2=(maxx, miny),
        dimstyle="PLANA_ARCH",
        dxfattribs={"layer": "DIM"},
    ).render()
    # габарит по глубине (слева)
    msp.add_linear_dim(
        base=(minx - 1.5, miny + (maxy - miny) / 2),
        p1=(minx, miny),
        p2=(minx, maxy),
        angle=90,
        dimstyle="PLANA_ARCH",
        dxfattribs={"layer": "DIM"},
    ).render()
    # ширина каждой квартиры по фасаду (для нижнего ряда)
    south_tiles = [t for t in plan.tiles
                   if (t.facade_edge.a.y + t.facade_edge.b.y) / 2 < (miny + maxy) / 2]
    south_tiles.sort(key=lambda t: min(p.x for p in t.polygon.exterior))
    for t in south_tiles:
        tpts = _poly_pts(t.polygon)
        tminx = min(p[0] for p in tpts)
        tmaxx = max(p[0] for p in tpts)
        msp.add_linear_dim(
            base=(tminx + (tmaxx - tminx) / 2, miny - 0.6),
            p1=(tminx, miny),
            p2=(tmaxx, miny),
            dimstyle="PLANA_ARCH",
            dxfattribs={"layer": "DIM"},
        ).render()


def _draw_title_block(msp, plan: Plan) -> None:
    contour = plan.floor_polygon
    pts = _poly_pts(contour)
    minx = min(p[0] for p in pts)
    maxy = max(p[1] for p in pts)
    msp.add_text(
        f"Plana · поэтажный план · вариант: {plan.preset.value}",
        dxfattribs={"layer": "TEXT_APT", "height": 0.55},
    ).set_placement((minx, maxy + 1.5),
                    align=TextEntityAlignment.LEFT)
    msp.add_text(
        f"Квартир на этаже: {plan.metrics.apt_count} · "
        f"Жилая S: {plan.metrics.saleable_area:.1f} м² · "
        f"КИТ: {plan.metrics.saleable_ratio*100:.0f}%",
        dxfattribs={"layer": "TEXT_APT", "height": 0.32},
    ).set_placement((minx, maxy + 0.85),
                    align=TextEntityAlignment.LEFT)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def export_plan_to_dxf(plan: Plan, path: Path | str) -> Path:
    """Сохранить план в DXF-файл, открывается в AutoCAD/LibreCAD/QCAD."""
    doc = ezdxf.new("R2018", setup=True)
    doc.units = 6  # METERS
    _setup_layers(doc)
    _setup_dimstyle(doc)
    msp = doc.modelspace()

    _draw_title_block(msp, plan)
    _draw_exterior_walls(msp, plan.floor_polygon)
    for c in plan.corridors:
        _draw_corridor(msp, c)
    _draw_core(msp, plan.core)
    for tile in plan.tiles:
        _draw_apartment(msp, tile)
    _draw_dimensions(msp, plan)

    out = Path(path)
    doc.saveas(out)
    return out


def dxf_bytes(plan: Plan) -> bytes:
    """Вернуть DXF в виде bytes (для отдачи через HTTP без записи на диск)."""
    doc = ezdxf.new("R2018", setup=True)
    doc.units = 6
    _setup_layers(doc)
    _setup_dimstyle(doc)
    msp = doc.modelspace()

    _draw_title_block(msp, plan)
    _draw_exterior_walls(msp, plan.floor_polygon)
    for c in plan.corridors:
        _draw_corridor(msp, c)
    _draw_core(msp, plan.core)
    for tile in plan.tiles:
        _draw_apartment(msp, tile)
    _draw_dimensions(msp, plan)

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
