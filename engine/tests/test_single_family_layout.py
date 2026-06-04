"""Регрессия для single-family layout (Phase A2/A3).

Фиксирует:
  - Точное число спален в layout совпадает с n_bedrooms из брифа
  - Гараж присутствует тогда и только тогда, когда has_garage=True
  - Все жилые комнаты получают окна (S или N — в зависимости от позиции)
  - Все жилые комнаты + санузлы получают двери
  - Площади комнат адекватные (нет 10м-глубоких комнат)
"""
from __future__ import annotations

from plana_engine.visualizer.layout_generator import generate_floor_layout
from plana_engine.visualizer.marketing_prompt import MarketingInputs


def _build_inputs(
    *,
    bedrooms: int, has_garage: bool, bathrooms: int | None = None,
    site_w: float = 30.0, site_d: float = 22.0, setback: float = 5.0,
) -> MarketingInputs:
    return MarketingInputs(
        site_width_m=site_w, site_depth_m=site_d,
        setback_front_m=setback, setback_side_m=setback, setback_rear_m=setback,
        floors=1, purpose="residential", building_type="single_family",
        sections=1, studio_pct=0, k1_pct=0, k2_pct=0, k3_pct=0,
        lifts_passenger=0, lifts_freight=0, max_height_m=4,
        bedrooms=bedrooms,
        bathrooms=bathrooms if bathrooms is not None else (1 if bedrooms <= 2 else 2),
        has_garage=has_garage,
    )


def _all_rooms(layout):
    return [r for s in layout.sections for a in s.apartments for r in a.rooms]


# ── Структура раскладки ──────────────────────────────────────────────


def test_bedroom_count_matches_request():
    """Сколько спален в брифе — столько в layout (для 1–5 спален)."""
    for n in [1, 2, 3, 4, 5]:
        layout = generate_floor_layout(_build_inputs(bedrooms=n, has_garage=False))
        beds = [r for r in _all_rooms(layout) if r.kind == "bedroom"]
        assert len(beds) == n, f"Запросили {n} спален, получили {len(beds)}"


def test_garage_present_when_requested():
    """has_garage=True → в layout есть комната kind=garage."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    garages = [r for r in _all_rooms(layout) if r.kind == "garage"]
    assert len(garages) == 1, "Запросили гараж, его нет"
    assert garages[0].name_ru == "Гараж"
    # Гараж должен быть осмысленного размера: ≥3.5м ширины и ≥9 м²
    g = garages[0]
    assert g.w >= 3.5, f"Гараж слишком узкий: {g.w}m"
    assert g.w * g.d >= 9.0, f"Гараж слишком маленький: {g.w * g.d}m²"


def test_garage_absent_when_not_requested():
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=False))
    garages = [r for r in _all_rooms(layout) if r.kind == "garage"]
    assert len(garages) == 0, "Гараж не запрашивался, но появился"


def test_bathroom_count_default():
    """1–2 спальни → 1 санузел; 3+ спален → 2 санузла."""
    for n_beds, expected_baths in [(1, 1), (2, 1), (3, 2), (4, 2)]:
        layout = generate_floor_layout(_build_inputs(bedrooms=n_beds, has_garage=False))
        baths = [r for r in _all_rooms(layout) if r.kind == "bathroom"]
        assert len(baths) == expected_baths, (
            f"При {n_beds} спальнях ожидали {expected_baths} санузла, "
            f"получили {len(baths)}"
        )


def test_explicit_bathrooms_override():
    """Если bathrooms задан явно — используется он."""
    layout = generate_floor_layout(_build_inputs(bedrooms=2, has_garage=False, bathrooms=3))
    baths = [r for r in _all_rooms(layout) if r.kind == "bathroom"]
    assert len(baths) == 3


# ── Окна и двери ─────────────────────────────────────────────────────


def test_living_room_has_window():
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    living = next(r for r in _all_rooms(layout) if r.kind == "living")
    assert len(living.windows) >= 1, "Гостиная без окна — нарушение СНиП"


def test_kitchen_has_window():
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    kitchen = next(r for r in _all_rooms(layout) if r.kind == "kitchen")
    assert len(kitchen.windows) >= 1, "Кухня без окна"


def test_all_bedrooms_have_windows():
    """Каждая спальня должна иметь окно (СНиП требует естественного света)."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    for bed in (r for r in _all_rooms(layout) if r.kind == "bedroom"):
        assert len(bed.windows) >= 1, f"{bed.name_ru} без окна"


def test_all_habitable_rooms_have_doors():
    """Жилые и санузлы имеют дверь (иначе не зайдёшь)."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    for r in _all_rooms(layout):
        if r.kind in ("living", "kitchen", "bedroom", "bathroom"):
            assert len(r.doors) >= 1, f"{r.name_ru} без двери"


# ── Пропорции и размеры ──────────────────────────────────────────────


def test_no_oversized_rooms():
    """Ни одна комната не должна быть глубже 7 м — иначе планировка нереалистична."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    for r in _all_rooms(layout):
        if r.kind == "garage":
            continue  # гараж занимает всю глубину дома — это OK
        assert r.d <= 7.0, f"{r.name_ru} глубже 7 м ({r.d}) — стандарт планировки нарушен"


def test_rooms_fit_into_footprint():
    """Все комнаты помещаются внутрь footprint квартиры."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    apt = layout.sections[0].apartments[0]
    for r in apt.rooms:
        assert r.x >= 0 and r.y >= 0
        assert r.x + r.w <= apt.w + 0.01, f"{r.name_ru} выпирает по X"
        assert r.y + r.d <= apt.d + 0.01, f"{r.name_ru} выпирает по Y"


def test_areas_sum_to_footprint():
    """Сумма площадей комнат = footprint (без зазоров и наложений)."""
    layout = generate_floor_layout(_build_inputs(bedrooms=3, has_garage=True))
    apt = layout.sections[0].apartments[0]
    rooms_area = sum(r.w * r.d for r in apt.rooms)
    footprint = apt.w * apt.d
    # Допускаем 1% разницу на округления
    assert abs(rooms_area - footprint) / footprint < 0.01, (
        f"Сумма комнат {rooms_area:.1f} ≠ footprint {footprint:.1f}"
    )
