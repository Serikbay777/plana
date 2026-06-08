"""Тупая версия v0 поверх УПСС: множители класса/конструктива + паркинг.

Дополняет test_cost_aggregate.py (там — базовый стек ССР). Здесь проверяем,
что новые параметры масштабируют базу, паркинг входит в базу и проходит через
НДС/резерв, неизвестные значения нейтральны, и сохраняется обратная совместимость.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from plana_engine.cost import (
    estimate_aggregate_cost,
    get_class_factor,
    get_construction_factor,
    get_region_rate,
)


def test_class_factor_scales_base() -> None:
    econ = estimate_aggregate_cost(gfa_m2=1000.0, region="Алматы", residential_class="эконом")
    prem = estimate_aggregate_cost(gfa_m2=1000.0, region="Алматы", residential_class="премиум")
    assert prem.building_base > econ.building_base
    assert abs(prem.building_base / econ.building_base - 1.7) < 0.01
    assert prem.class_factor == 1.7


def test_unknown_class_is_neutral() -> None:
    est = estimate_aggregate_cost(gfa_m2=1000.0, region="Алматы", residential_class="чтотоещё")
    assert est.class_factor == 1.0


def test_construction_factor_panel_vs_brick() -> None:
    panel = estimate_aggregate_cost(gfa_m2=1000.0, construction_type="панель")
    brick = estimate_aggregate_cost(gfa_m2=1000.0, construction_type="кирпич")
    assert brick.building_base > panel.building_base
    assert panel.construction_factor == 0.9
    assert brick.construction_factor == 1.1


def test_parking_enters_base_and_flows_through_stack() -> None:
    no_park = estimate_aggregate_cost(gfa_m2=1000.0, region="Алматы")
    park = estimate_aggregate_cost(
        gfa_m2=1000.0, region="Алматы",
        parking_spaces=50, parking_rate_per_space=5_000_000.0,
    )
    assert park.parking_cost == 50 * 5_000_000.0
    # паркинг прибавлен к базе СМР
    assert abs(park.base_construction - (no_park.base_construction + park.parking_cost)) < 5.0
    # и потому итог вырос больше, чем на голую стоимость паркинга (НДС/резерв сверху)
    assert park.total - no_park.total > park.parking_cost


def test_parking_changes_warning() -> None:
    park = estimate_aggregate_cost(gfa_m2=1000.0, parking_spaces=10)
    no_park = estimate_aggregate_cost(gfa_m2=1000.0)
    assert any("Паркинг учтён" in w for w in park.warnings)
    assert any("Вне-зданиевые" in w for w in no_park.warnings)


def test_factor_helpers_case_insensitive() -> None:
    assert get_class_factor(None) == 1.0
    assert get_class_factor("Премиум") == 1.7
    assert get_construction_factor("Кирпич") == 1.1
    assert get_construction_factor(None) == 1.0


def test_backward_compatible_default_call() -> None:
    # без новых параметров: база == GFA × ставка, коэффициенты нейтральны, паркинга нет
    est = estimate_aggregate_cost(gfa_m2=1000.0, region="default")
    assert abs(est.base_construction - 1000.0 * get_region_rate("default").rate_per_m2) < 1.0
    assert est.class_factor == 1.0
    assert est.construction_factor == 1.0
    assert est.parking_cost == 0.0


if __name__ == "__main__":
    for _fn in [
        test_class_factor_scales_base,
        test_unknown_class_is_neutral,
        test_construction_factor_panel_vs_brick,
        test_parking_enters_base_and_flows_through_stack,
        test_parking_changes_warning,
        test_factor_helpers_case_insensitive,
        test_backward_compatible_default_call,
    ]:
        _fn()
    print("ALL CHECKS PASSED")
