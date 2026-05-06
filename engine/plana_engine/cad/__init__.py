"""CAD-генерация (.dxf) — параллельный пайплайн рядом с AI-чертежами.

В отличие от gpt-image (картинка), здесь рисуем РЕАЛЬНУЮ ГЕОМЕТРИЮ:
точные координаты, слои, размерные цепочки. Архитектор открывает в
AutoCAD и сразу работает.

Закрывает ТЗ-пункты:
    2.4  Размещение квартир/лифтов/лестниц/инж. блоков (точно по координатам)
    2.6  Оптимизация полезной/жилой площади (фактический расчёт по геометрии)
    2.8  Экспорт CAD (вместо только PDF)
    5.2  Поэтажные схемы (DXF идеален)
    5.7  Материалы для архитекторов и проектировщиков
"""

from .floorplan_dxf import (
    FloorPlanDxfBuilder, FloorPlanMetrics,
    build_floorplan_dxf, compute_floorplan_metrics,
)

__all__ = [
    "FloorPlanDxfBuilder", "FloorPlanMetrics",
    "build_floorplan_dxf", "compute_floorplan_metrics",
]
