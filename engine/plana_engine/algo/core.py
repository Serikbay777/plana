"""Размещение лифтово-лестничного узла (ТЗ §5.1, шаг 2).

Кандидат-позиция выбирается по критериям:
- соответствие нормам эвакуации (максимальная длина пути ≤ N м)
- компактность ядра
- близость к геометрическому центру для равномерного покрытия

В MVP — упрощённое размещение: ядро в центре по горизонтали, прижато к
середине здания. Для прямоугольных контуров этого достаточно. Для
сложных полигонов потребуется DEAP-поиск (Этап 2 ТЗ).
"""

from __future__ import annotations

from ..norms import Norms
from ..types import CoreSpec, Polygon
from ..geometry.polygon import poly_to_shapely, rect_polygon


def place_core(
    contour: Polygon,
    norms: Norms,
    floors: int = 1,
    apt_count_estimate: int = 8,
) -> CoreSpec:
    """Разместить лифтово-лестничный узел внутри контура.

    Габариты ядра считаются по нормам:
    - 1 лифт на каждые `core.min_lifts_per_floor_apts` квартир этажа
    - лестница: 2 марша × `core.min_stair_width_m` × ~3 м длиной
    - шахта (если этажность > порога) — 1.6 × 1.6 м

    Возвращает `CoreSpec` с полигоном ядра и метаданными.
    """
    sp = poly_to_shapely(contour)
    minx, miny, maxx, maxy = sp.bounds
    w_total = maxx - minx
    h_total = maxy - miny

    # размеры ядра
    n_lifts = max(1, (apt_count_estimate + norms.core.min_lifts_per_floor_apts - 1)
                  // norms.core.min_lifts_per_floor_apts)
    lift_w = max(1.6, norms.core.min_lift_shaft_m) * n_lifts
    stair_w = norms.core.min_stair_width_m * 2 + 0.4  # 2 марша + площадка
    shaft = floors > norms.core.shaft_required_for_storeys_above
    shaft_w = 1.2 if shaft else 0.0

    core_w = lift_w + stair_w + shaft_w + 0.4  # с учётом стенок
    core_h = 5.5  # эвакуационная глубина по нормам ~5–6 м

    # центрируем по X, прижимаем к середине здания по Y
    cx = minx + (w_total - core_w) / 2
    cy = miny + (h_total - core_h) / 2

    poly = rect_polygon(cx, cy, core_w, core_h)
    return CoreSpec(
        polygon=poly,
        lifts=n_lifts,
        stairs=norms.core.min_stairs_per_section,
        has_shaft=shaft,
    )
