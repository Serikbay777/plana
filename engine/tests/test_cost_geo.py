"""Координаты посадки → регион (тупая версия гео-резолвера).

Проверяет: известный город резолвится в себя, точка рядом с городом —
в него, координаты вне РК падают на 'default', и что nearest_city отдаёт
расстояние.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from plana_engine.cost import nearest_city, region_from_coords


def test_known_cities_resolve_to_themselves() -> None:
    assert region_from_coords(43.2389, 76.8897) == "Алматы"
    assert region_from_coords(51.1605, 71.4704) == "Астана"
    assert region_from_coords(42.3417, 69.5901) == "Шымкент"
    assert region_from_coords(50.2839, 57.1670) == "Актобе"


def test_point_near_almaty() -> None:
    # точка в черте Алматы (смещена на ~8 км) → всё ещё Алматы
    assert region_from_coords(43.30, 76.95) == "Алматы"


def test_far_point_falls_back_to_default() -> None:
    # координаты вне РК (пересечение экватора и Гринвича) → default
    assert region_from_coords(0.0, 0.0) == "default"


def test_nearest_city_returns_name_and_distance() -> None:
    name, km = nearest_city(43.2389, 76.8897)
    assert name == "Алматы"
    assert km < 5.0


if __name__ == "__main__":
    test_known_cities_resolve_to_themselves()
    test_point_near_almaty()
    test_far_point_falls_back_to_default()
    test_nearest_city_returns_name_and_distance()
    print("ALL CHECKS PASSED")
