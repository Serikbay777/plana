"""Cost-движок plana: геометрия (IFC) → объёмы → (далее) расходность → стоимость.

Слой 1 (этот пакет, сейчас): qto.py — агрегатор количеств из Qto_*BaseQuantities
в структурированную ведомость объёмов работ (BillOfQuantities).

Планируемые слои поверх:
  - concept_structure.py — параметрический конструктив (фундамент/сейсмика) для объёмов;
  - norms/ — версионируемое подмножество ЭСН РК / ССЦ / УПСС по ключу ВК-001;
  - engine.py — расходность (ЭСН) + цены (ССЦ) → прямые затраты;
  - svod.py — Сводный сметный расчёт (НР + прибыль + лимитированные + НДС).
"""

from .aggregate_cost import (
    AggregateCostEstimate,
    CapacityMetrics,
    CostBuildupConfig,
    CostLine,
    RegionRate,
    capacity_from_ifc,
    estimate_aggregate_cost,
    estimate_aggregate_cost_from_ifc,
    get_region_rate,
)
from .qto import BillOfQuantities, QtyLine, aggregate_quantities, quantities_from_ifc

__all__ = [
    # qto (Высота-0: объёмы)
    "BillOfQuantities",
    "QtyLine",
    "aggregate_quantities",
    "quantities_from_ifc",
    # aggregate cost (Высота-1: укрупнённая расчётная стоимость)
    "AggregateCostEstimate",
    "CapacityMetrics",
    "CostBuildupConfig",
    "CostLine",
    "RegionRate",
    "capacity_from_ifc",
    "estimate_aggregate_cost",
    "estimate_aggregate_cost_from_ifc",
    "get_region_rate",
]
