"""Размещение инженерных помещений первого этажа.

Эвристика для MVP: ИТП, электрощитовая и мусорокамера лепятся в ряд у
одной из граней core — той, у которой больше свободного места до фасада
здания. Не учитывает уже расставленные tiles — для компактного ядра в
стандартном корпусе вписывается между core и периметром. Площади идут
в Plan отдельным слоем и НЕ попадают в `saleable_area` метрик.
"""

from __future__ import annotations

from ..geometry.polygon import poly_to_shapely, rect_polygon
from ..types import (
    CoreSpec, EngineeringKind, EngineeringRoom, Polygon,
)


# (kind, label, ширина, глубина) — типовые компактные размеры
_ENG_ROOMS_SPEC: tuple[tuple[EngineeringKind, str, float, float], ...] = (
    (EngineeringKind.ITP,        "ИТП",         3.0, 2.0),
    (EngineeringKind.ELECTRICAL, "Электрощит",  2.5, 2.0),
    (EngineeringKind.WASTE,      "Мусор",       2.0, 1.5),
)


def _bbox(p: Polygon) -> tuple[float, float, float, float]:
    """min_x, min_y, max_x, max_y."""
    xs = [pt.x for pt in p.exterior]
    ys = [pt.y for pt in p.exterior]
    return min(xs), min(ys), max(xs), max(ys)


def place_engineering_rooms(core: CoreSpec, contour: Polygon) -> list[EngineeringRoom]:
    """Лепим инженерные комнаты в ряд у дальней грани core.

    Алгоритм:
      1. Считаем bbox core и bbox контура этажа.
      2. Из 4 сторон core выбираем ту, у которой больше зазор до периметра.
      3. Лепим вдоль этой стороны прямоугольники из `_ENG_ROOMS_SPEC`,
         с зазором 0.1 м между ними.

    Если у выбранной грани не хватает места по длине — помещения
    вылезут за core, но останутся внутри здания (что нормально, это
    «технические помещения первого этажа»).
    """
    c_min_x, c_min_y, c_max_x, c_max_y = _bbox(core.polygon)
    f_min_x, f_min_y, f_max_x, f_max_y = _bbox(contour)

    # Зазоры от core до фасада с каждой стороны
    gap_n = f_max_y - c_max_y     # к северной стене здания
    gap_s = c_min_y - f_min_y     # к южной
    gap_e = f_max_x - c_max_x     # к восточной
    gap_w = c_min_x - f_min_x     # к западной

    side = max(("n", gap_n), ("s", gap_s), ("e", gap_e), ("w", gap_w),
               key=lambda t: t[1])[0]

    # Ширина и глубина «полки» инженерки
    bench_w = max(w for _, _, w, _ in _ENG_ROOMS_SPEC) * 0  # not used
    rooms: list[EngineeringRoom] = []

    if side in ("n", "s"):
        # Полка горизонтальная (вдоль X), глубина вверх/вниз от core
        cursor_x = c_min_x
        for kind, label, w, d in _ENG_ROOMS_SPEC:
            if side == "n":
                y = c_max_y + 0.05
            else:
                y = c_min_y - 0.05 - d
            poly = rect_polygon(cursor_x, y, w, d)
            rooms.append(EngineeringRoom(
                kind=kind, polygon=poly, label=label, area=w * d,
            ))
            cursor_x += w + 0.1
    else:
        # Полка вертикальная (вдоль Y)
        cursor_y = c_min_y
        for kind, label, w, d in _ENG_ROOMS_SPEC:
            # для вертикальной полки меняем местами размеры — длинная сторона по Y
            rw, rd = d, w
            if side == "e":
                x = c_max_x + 0.05
            else:
                x = c_min_x - 0.05 - rw
            poly = rect_polygon(x, cursor_y, rw, rd)
            rooms.append(EngineeringRoom(
                kind=kind, polygon=poly, label=label, area=rw * rd,
            ))
            cursor_y += rd + 0.1

    # Финальный фильтр: оставляем только то, что не вышло за пределы здания.
    contour_sh = poly_to_shapely(contour)
    out: list[EngineeringRoom] = []
    for r in rooms:
        room_sh = poly_to_shapely(r.polygon)
        if contour_sh.contains(room_sh) or contour_sh.intersection(room_sh).area > room_sh.area * 0.95:
            out.append(r)
    return out
