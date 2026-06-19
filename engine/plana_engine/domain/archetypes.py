"""Библиотека архетипов посадки (шаг 2c).

Каждый архетип по контуру участка (shapely Polygon, локальные метры) и параметрам
раскладывает ПЯТНА КОРПУСОВ (list[Polygon]). Это параметрические шаблоны
(строчная/линейная/Г-образная/периметр/башни), а не захардкоженные сценарии —
из их перебора × этажность генератор вариантов отбирает разнообразную пятёрку
(см. posadka_variant_ranking: diverse top-N, нормы = ограничения).

Геометрия схематична: работаем от bbox застраиваемой части (участок − setback),
все пятна подрезаются под реальный контур участка. Типовая глубина жилого
корпуса ≈ 14–16 м (двусторонний коридорный/секционный).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from shapely.geometry import MultiPolygon, Polygon, box

CORPUS_DEPTH_M = 15.0   # типовая глубина жилого корпуса
COURT_GAP_M = 24.0      # двор/разрыв между параллельными корпусами (инсоляция/пожарка)


def _inner(site: Polygon, setback: float) -> Polygon | MultiPolygon:
    """Застраиваемая часть = участок, сжатый на setback (отступ от границ)."""
    inner = site.buffer(-setback) if setback > 0 else site
    return inner if not inner.is_empty else site


def _clip(parts: list[Polygon], inner: Polygon | MultiPolygon) -> list[Polygon]:
    """Подрезать пятна под застраиваемую часть; выкинуть мусор/осколки."""
    out: list[Polygon] = []
    for p in parts:
        if p.is_empty:
            continue
        c = p.intersection(inner)
        if c.is_empty or c.area < 25.0:   # < 25 м² — осколок, не корпус
            continue
        geoms = c.geoms if isinstance(c, MultiPolygon) else [c]
        out.extend(g for g in geoms if g.area >= 25.0)
    return out


# ── Архетипы: (inner_bbox, depth) → пятна ────────────────────────────────────

def _single_block(inner, depth):
    minx, miny, maxx, maxy = inner.bounds
    w, h = maxx - minx, maxy - miny
    # компактный блок ~60% габарита, по центру
    bw, bh = w * 0.6, h * 0.6
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    return [box(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)]


def _linear_north(inner, depth):
    # один корпус вдоль длинной стороны у северного (верхнего) края — макс двор южнее
    minx, miny, maxx, maxy = inner.bounds
    return [box(minx, maxy - depth, maxx, maxy)]


def _double_strip(inner, depth):
    # две параллельные строчки с двором между ними
    minx, miny, maxx, maxy = inner.bounds
    top = box(minx, maxy - depth, maxx, maxy)
    bot = box(minx, miny, maxx, miny + depth)
    # если двор между ними слишком мал — оставляем одну
    if (maxy - depth) - (miny + depth) < COURT_GAP_M:
        return [top]
    return [top, bot]


def _l_shape(inner, depth):
    # Г-образно: вдоль верхней и левой границ
    minx, miny, maxx, maxy = inner.bounds
    top = box(minx, maxy - depth, maxx, maxy)
    left = box(minx, miny, minx + depth, maxy - depth)
    return [top, left]


def _perimeter(inner, depth):
    # периметральная застройка с внутренним двором (рамка корпусов)
    minx, miny, maxx, maxy = inner.bounds
    if (maxx - minx) < 2 * depth + COURT_GAP_M or (maxy - miny) < 2 * depth + COURT_GAP_M:
        return _l_shape(inner, depth)   # участок мал для двора → Г-образно
    top = box(minx, maxy - depth, maxx, maxy)
    bot = box(minx, miny, maxx, miny + depth)
    left = box(minx, miny + depth, minx + depth, maxy - depth)
    right = box(maxx - depth, miny + depth, maxx, maxy - depth)
    return [top, bot, left, right]


def _towers(inner, depth):
    # точечные башни: сетка 2×2 компактных пятен (~depth×depth)
    minx, miny, maxx, maxy = inner.bounds
    w, h = maxx - minx, maxy - miny
    s = max(depth, min(w, h) * 0.28)   # сторона башни
    parts = []
    xs = [minx + w * 0.27, minx + w * 0.73]
    ys = [miny + h * 0.27, miny + h * 0.73]
    for x in xs:
        for y in ys:
            parts.append(box(x - s / 2, y - s / 2, x + s / 2, y + s / 2))
    return parts


@dataclass(frozen=True)
class Archetype:
    key: str
    label: str
    build: Callable          # (inner, depth) → list[Polygon]
    emphasis: str            # за что отвечает (подсказка для подписи варианта)


ARCHETYPES: list[Archetype] = [
    Archetype("single_block", "Компактный блок", _single_block, "баланс"),
    Archetype("linear_north", "Линейный (двор южнее)", _linear_north, "двор/инсоляция"),
    Archetype("double_strip", "Строчная (2 корпуса)", _double_strip, "квартиры"),
    Archetype("l_shape", "Г-образный", _l_shape, "охват углов"),
    Archetype("perimeter", "Периметр с двором", _perimeter, "двор + площадь"),
    Archetype("towers", "Точечные башни", _towers, "паркинг/инсоляция"),
]


def generate_footprints(
    site: Polygon,
    archetype_key: str,
    *,
    setback_m: float = 5.0,
    corpus_depth_m: float = CORPUS_DEPTH_M,
) -> list[Polygon]:
    """Пятна корпусов архетипа на участке (подрезаны под контур − setback)."""
    arch = next((a for a in ARCHETYPES if a.key == archetype_key), None)
    if arch is None:
        return []
    inner = _inner(site, setback_m)
    parts = arch.build(inner, corpus_depth_m)   # build использует только inner.bounds
    return _clip(parts, inner)
