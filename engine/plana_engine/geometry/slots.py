"""Нарезка фасадных рёбер на квартирные слоты (ТЗ §5.1, шаг 4).

После того как ядро размещено и коридор проложен, у нас остаются фасадные
зоны определённой глубины (между фасадом и коридором). Мы режем фасад на
прямоугольные «слоты» вдоль ребра — каждый слот примет один тайл.

В MVP это простое разбиение по фиксированной глубине. Шаг 2 — оптимизатор
будет тонко делить под целевую функцию.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..types import Edge, Point


@dataclass(frozen=True)
class Slot:
    """Прямоугольный слот для квартиры. Локальная система координат:
    `x` — вдоль фасада от точки `edge.a`, `y` — внутрь здания (по нормали).
    """
    edge: Edge                  # фасадное ребро
    x_start: float              # положение слота вдоль ребра, м
    x_end: float                # ditto, x_end > x_start
    depth: float                # глубина слота (внутрь здания), м
    facade_offset: float = 0.0  # отступ от фасада (если есть лоджия)

    @property
    def width(self) -> float:
        return self.x_end - self.x_start

    def origin_world(self) -> tuple[Point, tuple[float, float]]:
        """Вернуть мировую точку начала слота и единичный вектор «вдоль фасада».

        Точка соответствует углу слота, прижатому к фасаду со стороны `edge.a`.
        """
        e = self.edge
        dx = e.b.x - e.a.x
        dy = e.b.y - e.a.y
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        ox = e.a.x + ux * self.x_start
        oy = e.a.y + uy * self.x_start
        return Point(x=ox, y=oy), (ux, uy)


def cut_facade_into_slots(
    edge: Edge,
    apt_depth: float,
    min_slot_width: float = 3.0,
    max_slot_width: float = 12.0,
) -> list[Slot]:
    """Нарезать одно фасадное ребро на «равномерные» слоты по ширине.

    Это базовая нарезка для шага 5 алгоритма (укладка тайлов). Реальный
    оптимизатор (DEAP) подменит этот шаг — он будет резать фасад так, чтобы
    максимизировать целевую функцию пресета.
    """
    L = edge.length
    if L < min_slot_width:
        return []

    # стартовый расчёт: пытаемся уложить максимум слотов средней ширины
    target_w = (min_slot_width + max_slot_width) / 2
    n = max(1, int(L / target_w))
    w = L / n
    if w < min_slot_width:
        n -= 1
        if n <= 0:
            return []
        w = L / n
    if w > max_slot_width:
        n += 1
        w = L / n

    slots: list[Slot] = []
    for i in range(n):
        slots.append(
            Slot(
                edge=edge,
                x_start=i * w,
                x_end=(i + 1) * w,
                depth=apt_depth,
            )
        )
    return slots
