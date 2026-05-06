"""CAD-модуль (.dxf через ezdxf) — две параллельные сущности.

В отличие от gpt-image (растровая картинка), здесь рисуем РЕАЛЬНУЮ
ГЕОМЕТРИЮ: точные координаты, слои, размерные цепочки. Архитектор
открывает в AutoCAD и сразу работает.

Здесь живут два независимых пайплайна:

1. **Floor-plan DXF** (`floorplan_dxf.py`) — экспорт всего этажа ЖК:
   секции, лифтовые ядра, оси, размерные цепи, штамп, нормоконтроль РК.
   Эндпоинт `POST /export/floorplan-dxf`. Работает рядом с AI-чертежами
   как «технический» формат вывода.

   Закрывает ТЗ-пункты:
       2.4  Размещение квартир/лифтов/лестниц/инж. блоков (точно по координатам)
       2.6  Оптимизация полезной/жилой площади (фактический расчёт по геометрии)
       2.8  Экспорт CAD (вместо только PDF)
       5.2  Поэтажные схемы (DXF идеален)
       5.7  Материалы для архитекторов и проектировщиков

2. **Apartment pre-planning DXF** (`writer.py` + `schema.py` + `template.py`) —
   пред-планировка одной квартиры как заготовка для доработки в AutoCAD.
   Эндпоинт `POST /generate/apartment-preplan`. Phase 1 — хардкод 1-комн.
   6×4 м для проверки совместимости. Фазы 2–4 — параметры → раскладка
   комнат → валидатор.
"""

from .floorplan_dxf import (
    FloorPlanDxfBuilder, FloorPlanMetrics,
    build_floorplan_dxf, compute_floorplan_metrics,
)
from .schema import ApartmentSpec, AptType, WindowSide
from .writer import build_apartment_dxf

__all__ = [
    # Floor-plan (ЖК этаж целиком)
    "FloorPlanDxfBuilder", "FloorPlanMetrics",
    "build_floorplan_dxf", "compute_floorplan_metrics",
    # Apartment pre-planning (одна квартира)
    "ApartmentSpec", "AptType", "WindowSide", "build_apartment_dxf",
]
