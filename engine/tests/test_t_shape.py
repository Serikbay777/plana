"""Регрессия для T-shape типологии (Phase T).

Фиксирует:
  - 5 квартир на этаж (2 крупных сверху + 3 стандартных снизу)
  - Раздельные lift + stair (а не один блок 6.5м как в symmetric)
  - Крупные квартиры наверху больше по площади чем нижние
  - Горизонтальный коридор + вертикальное ядро в центре
  - Все квартиры внутри footprint, без зазоров и наложений
"""
from __future__ import annotations

from plana_engine.visualizer.layout_generator import generate_floor_layout
from plana_engine.visualizer.marketing_prompt import MarketingInputs


def _t_shape_inputs() -> MarketingInputs:
    """Бриф 29×16 + комфорт+ T-типология."""
    return MarketingInputs(
        site_width_m=35, site_depth_m=22,        # site - setbacks(3 each) = 29×16
        setback_front_m=3, setback_side_m=3, setback_rear_m=3,
        floors=4, sections=1, building_type="multi_family",
        lifts_passenger=1, lifts_freight=0,
        studio_pct=0.2, k1_pct=0.3, k2_pct=0.3, k3_pct=0.2,
        floor_typology="t_shape",
    )


# ── Структура T-shape ───────────────────────────────────────────────


def test_t_shape_produces_5_apartments():
    layout = generate_floor_layout(_t_shape_inputs())
    n_apts = sum(len(s.apartments) for s in layout.sections)
    assert n_apts == 5, f"T-shape должна давать ровно 5 квартир, получили {n_apts}"


def test_t_shape_has_2_large_top_3_smaller_bottom():
    """Top — 2 крупных, bottom — 3 стандартных. Top больше по площади."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    apts = sect.apartments
    corridor_y = sect.corridor_y

    top = [a for a in apts if a.y > corridor_y]
    bottom = [a for a in apts if a.y < corridor_y]
    assert len(top) == 2, f"наверху ожидали 2, получили {len(top)}"
    assert len(bottom) == 3, f"внизу ожидали 3, получили {len(bottom)}"

    avg_top_area = sum(a.w * a.d for a in top) / 2
    avg_bottom_area = sum(a.w * a.d for a in bottom) / 3
    assert avg_top_area > avg_bottom_area, (
        f"Верхние квартиры должны быть больше нижних: "
        f"top={avg_top_area:.1f}, bottom={avg_bottom_area:.1f}"
    )


# ── Узкое вертикальное ядро (lift + stair раздельно) ────────────────


def test_lift_and_stair_separate():
    """В T-shape лифт и лестница — два отдельных core, а не один блок."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    kinds = [c.kind for c in sect.cores]
    assert "lift_passenger" in kinds, "Нет пассажирского лифта"
    assert "stair" in kinds, "Нет лестницы"
    # Они должны быть РАЗНЫЕ объекты, не один блок
    assert len(sect.cores) >= 2, f"Ожидали ≥2 core, получили {len(sect.cores)}"


def test_core_is_in_top_zone():
    """Лифт и лестница расположены в верхней зоне (выше коридора)."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    for core in sect.cores:
        assert core.y > sect.corridor_y, (
            f"Core {core.kind} ниже коридора: y={core.y}, corridor_y={sect.corridor_y}"
        )


def test_core_is_narrow_strip_centered():
    """Ядро узкое (≤6м вместе) и по центру по X."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    cores = sect.cores
    leftmost = min(c.x for c in cores)
    rightmost = max(c.x + c.w for c in cores)
    core_strip_w = rightmost - leftmost
    assert core_strip_w <= 6.0, f"Ядро слишком широкое: {core_strip_w} м"
    # По центру по X (с допуском 1м)
    center_of_strip = (leftmost + rightmost) / 2
    assert abs(center_of_strip - layout.width_m / 2) < 1.0, (
        f"Ядро не центрировано: центр {center_of_strip}, ожидали {layout.width_m/2}"
    )


# ── Корректность геометрии ──────────────────────────────────────────


def test_no_overlapping_apartments():
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    apts = sect.apartments
    for i, a in enumerate(apts):
        for b in apts[i + 1:]:
            # Проверка bbox-пересечения
            overlap_x = max(0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
            overlap_y = max(0, min(a.y + a.d, b.y + b.d) - max(a.y, b.y))
            assert overlap_x * overlap_y < 0.01, (
                f"Квартиры #{a.number} и #{b.number} пересекаются"
            )


def test_apartments_inside_footprint():
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    for apt in sect.apartments:
        assert apt.x >= 0 and apt.y >= 0, f"Apt #{apt.number} с отрицательными координатами"
        assert apt.x + apt.w <= layout.width_m + 0.01
        assert apt.y + apt.d <= layout.depth_m + 0.01


def test_t_shape_balconies_present():
    """В T-shape тоже работают лоджии — у каждой квартиры хотя бы одна."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    for apt in sect.apartments:
        balconies = [r for r in apt.rooms if r.kind == "balcony"]
        assert len(balconies) >= 1, f"Apt #{apt.number} ({apt.type_code}) без лоджии"


def test_t_shape_bigger_apts_have_more_rooms():
    """Верхние крупные квартиры имеют больше комнат чем нижние стандартные."""
    layout = generate_floor_layout(_t_shape_inputs())
    sect = layout.sections[0]
    corridor_y = sect.corridor_y
    top_avg_rooms = sum(len(a.rooms) for a in sect.apartments if a.y > corridor_y) / 2
    bottom_avg_rooms = sum(len(a.rooms) for a in sect.apartments if a.y < corridor_y) / 3
    assert top_avg_rooms >= bottom_avg_rooms, (
        f"Верхние крупные должны иметь ≥ комнат: "
        f"top={top_avg_rooms}, bottom={bottom_avg_rooms}"
    )


# ── Symmetric не должна сломаться (default behavior) ────────────────


def test_symmetric_still_default():
    """Без явного floor_typology используется симметричная — было 6 квартир."""
    inputs = MarketingInputs(
        site_width_m=40, site_depth_m=26,
        setback_front_m=5, setback_side_m=5, setback_rear_m=5,
        floors=4, sections=1, building_type="multi_family",
        lifts_passenger=2, lifts_freight=0,
        studio_pct=0.3, k1_pct=0.4, k2_pct=0.3,
        # floor_typology НЕ задан → должна быть symmetric (default)
    )
    layout = generate_floor_layout(inputs)
    n_apts = sum(len(s.apartments) for s in layout.sections)
    assert n_apts >= 5, f"Symmetric должна давать ≥5 (комфорт), получили {n_apts}"
    # Должно быть 1 объединённое ядро (как раньше), не 2 раздельных
    sect = layout.sections[0]
    # В symmetric ядре более 1 элемента (пасс. лифт + лестница в одном ряду)
    # но они идут в одну линию рядом друг с другом, общая высота как у обычного
    # core ≈ 5.5м. Это отличается от T-shape где лифт квадратный 2.2м.
    has_square_lift = any(
        c.kind == "lift_passenger" and abs(c.w - 2.0) < 0.1 and abs(c.d - 2.2) < 0.1
        for c in sect.cores
    )
    assert not has_square_lift, "Symmetric не должна иметь T-shape ядро"
