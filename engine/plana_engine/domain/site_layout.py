"""Схематичная раскладка зон посадки (шаг 2b).

Из СВОБОДНОЙ части участка (участок − пятна застройки) нарезаем наземный
паркинг и озеленение по ТРЕБУЕМОЙ площади (площади — из норм, см. norms.py).
Геометрия иллюстративная: горизонтальные полосы, подрезанные под форму участка
(паркинг снизу, озеленение сверху из остатка). Это НЕ финальная планировка, а
наглядный баланс «нормы → остаток под дом». Всё в локальных метрах участка.
"""

from __future__ import annotations

from shapely.geometry import MultiPolygon, Polygon, box
from shapely.ops import unary_union


def _area_band(poly: Polygon | MultiPolygon, target_area: float, *, from_top: bool):
    """Полоса poly по горизонтали с площадью ≈ target_area.

    from_top=True — срезаем сверху (y от линии до верха), иначе снизу.
    Линию среза ищем бинарным поиском (площадь монотонна по y).
    """
    if poly.is_empty or target_area <= 0:
        return Polygon()
    total = poly.area
    if target_area >= total:
        return poly
    minx, miny, maxx, maxy = poly.bounds
    lo, hi = miny, maxy
    band: Polygon | MultiPolygon = Polygon()
    for _ in range(40):
        mid = (lo + hi) / 2.0
        clip = box(minx, mid, maxx, maxy) if from_top else box(minx, miny, maxx, mid)
        band = poly.intersection(clip)
        a = band.area
        if abs(a - target_area) < total * 1e-4:
            break
        if from_top:
            # меньше площади сверху → опускаем линию (полоса растёт)
            hi, lo = (mid, lo) if a < target_area else (hi, mid)
        else:
            lo, hi = (mid, hi) if a < target_area else (lo, mid)
    return band


def _rings(geom) -> list[list[list[float]]]:
    """shapely geom → плоский список колец (внешние + дырки).

    Дырки важны: свободная зона = участок − пятно имеет отверстие на месте дома,
    его надо вернуть, иначе зона зальёт пятно. На отрисовке кольца объединяются
    в один path с fill-rule=evenodd (вложенное кольцо = дырка).
    """
    if geom is None or geom.is_empty:
        return []
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out: list[list[list[float]]] = []
    for p in polys:
        if p.is_empty or p.area <= 0:
            continue
        out.append([[round(x, 2), round(y, 2)] for x, y in p.exterior.coords])
        for hole in p.interiors:
            out.append([[round(x, 2), round(y, 2)] for x, y in hole.coords])
    return out


def layout_site_zones(
    site: Polygon,
    footprints: list[Polygon],
    parking_area_m2: float,
    green_area_m2: float,
) -> dict[str, list[list[list[float]]]]:
    """Кольца зон озеленения и наземного паркинга в свободной части участка.

    Паркинг режем снизу, озеленение — сверху из остатка. Если зоны не влезают
    в свободную площадь — отрисуется столько, сколько помещается (перебор уже
    подсвечивает баланс в UI).
    """
    fps = [f for f in footprints if f is not None and not f.is_empty]
    free = site.difference(unary_union(fps)) if fps else site
    if free.is_empty:
        return {"green": [], "parking": []}
    parking = _area_band(free, parking_area_m2, from_top=False)
    rest = free.difference(parking) if not parking.is_empty else free
    green = _area_band(rest, green_area_m2, from_top=True)
    return {"green": _rings(green), "parking": _rings(parking)}
