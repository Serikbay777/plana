"""Verify Высота-1: укрупнённая расчётная стоимость.

Checks the ССР build-up math, the no-double-count default (УПСС already
embeds НР+прибыль), the honest range + non-certified labelling, region
fallback, and the IFC-driven capacity path.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from plana_engine.cad.floorplan_ifc import build_ifc_from_layout
from plana_engine.cad.layout_schema import (
    LayoutApartment, LayoutFloor, LayoutRoom, LayoutSection,
)
from plana_engine.cost import (
    CostBuildupConfig,
    estimate_aggregate_cost,
    estimate_aggregate_cost_from_ifc,
    get_region_rate,
)


def test_buildup_math_and_no_double_count() -> None:
    est = estimate_aggregate_cost(gfa_m2=1000.0, region="default")
    rate = get_region_rate("default").rate_per_m2
    base = 1000.0 * rate
    assert abs(est.base_construction - base) < 1.0

    # default config: overhead/profit OFF (no double count) -> no such line
    labels = {ln.label for ln in est.buildup}
    assert not any("Накладные" in lbl for lbl in labels)

    # subtotal = base * (1+limited) * (1+contingency); vat on top
    expected_subtotal = base * 1.06 * 1.02
    assert abs(est.subtotal_ex_vat - round(expected_subtotal, 0)) < 5.0
    assert abs(est.vat - round(est.subtotal_ex_vat * 0.12, 0)) < 5.0
    assert abs(est.total - (est.subtotal_ex_vat + est.vat)) < 5.0


def test_range_and_not_certified() -> None:
    est = estimate_aggregate_cost(gfa_m2=500.0, region="Алматы")
    assert est.total_low < est.total < est.total_high
    assert abs(est.total_low - round(est.total * 0.8, 0)) < 5.0
    assert abs(est.total_high - round(est.total * 1.3, 0)) < 5.0
    assert est.is_certified_smeta is False
    assert "НЕ сметная" in est.disclaimer or "не является сертифиц" in est.disclaimer.lower()
    assert est.estimate_class.startswith("AACE Class 5")


def test_placeholder_and_offbuilding_warnings() -> None:
    est = estimate_aggregate_cost(gfa_m2=100.0)
    assert est.rate_official is False
    joined = " ".join(est.warnings)
    assert "ПЛЕЙСХОЛДЕР" in joined
    assert "Вне-зданиевые" in joined
    assert "двойного счёта" in joined


def test_region_fallback() -> None:
    rr = get_region_rate("Некоторый-несуществующий-регион")
    assert rr.rate_per_m2 == get_region_rate("default").rate_per_m2


def test_overhead_toggle_adds_line() -> None:
    """If overhead/profit is explicitly enabled, it must appear as a line."""
    cfg = CostBuildupConfig(overhead_profit_pct=20.0)
    est = estimate_aggregate_cost(gfa_m2=100.0, config=cfg)
    assert any("Накладные" in ln.label for ln in est.buildup)


def _layout() -> LayoutFloor:
    return LayoutFloor(
        width_m=12.0, depth_m=10.0,
        sections=[
            LayoutSection(
                index=0, x_start=0.0, width=12.0, corridor_y=5.0, corridor_d=1.6,
                apartments=[
                    LayoutApartment(
                        type_code="2k", number=1, x=0.5, y=0.5, w=11.0, d=4.0,
                        rooms=[
                            LayoutRoom(kind="living", name_ru="Гостиная",
                                       x=0.0, y=0.0, w=6.0, d=4.0),
                            LayoutRoom(kind="kitchen", name_ru="Кухня",
                                       x=6.0, y=0.0, w=5.0, d=4.0),
                        ],
                    ),
                ],
            ),
        ],
    )


def test_from_ifc_capacity() -> None:
    ifc_bytes = build_ifc_from_layout(_layout(), n_floors=3)
    est = estimate_aggregate_cost_from_ifc(ifc_bytes, region="Астана")
    # 3 storeys × 12×10 footprint = 360 m² GFA proxy (slab NetArea sum)
    assert abs(est.gfa_m2 - 360.0) < 1.0
    assert est.total > 0
    assert est.region == "Астана"


def _summary() -> None:
    est = estimate_aggregate_cost(gfa_m2=2400.0, region="Алматы")
    print("\n── Укрупнённая расчётная стоимость (Высота-1) ──")
    print(f"  Регион: {est.region} · GFA {est.gfa_m2:.0f} м² · {est.rate_per_m2:,.0f} ₸/м²"
          f" ({'офиц.' if est.rate_official else 'плейсхолдер'})")
    print(f"  Базовая (СМР): {est.base_construction:,.0f} ₸")
    for ln in est.buildup:
        print(f"    + {ln.label}: {ln.amount:,.0f} ₸")
    print(f"  Итого без НДС: {est.subtotal_ex_vat:,.0f} ₸")
    print(f"  НДС 12%:       {est.vat:,.0f} ₸")
    print(f"  ИТОГО:         {est.total:,.0f} ₸")
    print(f"  Диапазон ({est.estimate_class}): "
          f"{est.total_low:,.0f} … {est.total_high:,.0f} ₸")
    print(f"  Сертифицированная смета: {est.is_certified_smeta}")
    for w in est.warnings:
        print(f"  ⚠ {w}")


if __name__ == "__main__":
    test_buildup_math_and_no_double_count()
    test_range_and_not_certified()
    test_placeholder_and_offbuilding_warnings()
    test_region_fallback()
    test_overhead_toggle_adds_line()
    test_from_ifc_capacity()
    _summary()
    print("\nALL CHECKS PASSED")
