"""Регрессия для лоджий (Phase B).

Фиксирует:
  - studio/1k → 1 лоджия на квартиру
  - 2k/3k → 2 лоджии
  - Лоджия привязана к жилой комнате (living/bedroom), не к санузлу/кухне
  - Лоджия глубиной 1.4 м у фасадной кромки квартиры
  - Окно, которое было на фасаде parent, перенесено на лоджию
  - Parent получил балконную дверь
  - Лоджия не «выпирает» за пределы квартиры по Y
"""
from __future__ import annotations

from plana_engine.visualizer.layout_generator import generate_floor_layout
from plana_engine.visualizer.marketing_prompt import MarketingInputs


def _mkd_inputs(*, k1_pct: float = 0.0, k2_pct: float = 0.0, k3_pct: float = 0.0,
                studio_pct: float = 0.0) -> MarketingInputs:
    return MarketingInputs(
        site_width_m=40, site_depth_m=26,
        setback_front_m=5, setback_side_m=5, setback_rear_m=5,
        floors=4, sections=1, building_type="multi_family",
        lifts_passenger=2, lifts_freight=0,
        studio_pct=studio_pct, k1_pct=k1_pct, k2_pct=k2_pct, k3_pct=k3_pct,
    )


def _balconies_of(apt) -> list:
    return [r for r in apt.rooms if r.kind == "balcony"]


# ── Количество лоджий по типу квартиры ──────────────────────────────


def test_studio_has_one_balcony():
    layout = generate_floor_layout(_mkd_inputs(studio_pct=1.0))
    studios = [a for s in layout.sections for a in s.apartments if a.type_code == "studio"]
    assert len(studios) > 0, "не сгенерировались студии"
    for apt in studios:
        assert len(_balconies_of(apt)) == 1, (
            f"Студия должна иметь 1 лоджию, у Apt #{apt.number}: "
            f"{len(_balconies_of(apt))}"
        )


def test_1k_has_one_balcony():
    layout = generate_floor_layout(_mkd_inputs(k1_pct=1.0))
    k1 = [a for s in layout.sections for a in s.apartments if a.type_code == "1k"]
    assert len(k1) > 0
    for apt in k1:
        assert len(_balconies_of(apt)) == 1, (
            f"1k → 1 лоджия, у Apt #{apt.number}: {len(_balconies_of(apt))}"
        )


def test_2k_has_two_balconies():
    layout = generate_floor_layout(_mkd_inputs(k2_pct=1.0))
    k2 = [a for s in layout.sections for a in s.apartments if a.type_code == "2k"]
    assert len(k2) > 0
    for apt in k2:
        assert len(_balconies_of(apt)) == 2, (
            f"2k → 2 лоджии, у Apt #{apt.number}: {len(_balconies_of(apt))}"
        )


# ── Геометрия лоджии ────────────────────────────────────────────────


def test_balcony_depth_is_1_4m():
    layout = generate_floor_layout(_mkd_inputs(k2_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                assert abs(b.d - 1.4) < 0.01, f"Лоджия глубиной {b.d}, ожидалось 1.4"


def test_balcony_inside_apartment_footprint():
    """Лоджия не выпирает за пределы квартиры по X/Y."""
    layout = generate_floor_layout(_mkd_inputs(k2_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                assert b.x >= 0 and b.y >= 0, f"Лоджия с отрицательными координатами"
                assert b.x + b.w <= apt.w + 0.01
                assert b.y + b.d <= apt.d + 0.01


def test_balcony_touches_facade():
    """Лоджия касается одной из фасадных кромок квартиры (y=0 или y=apt.d)."""
    layout = generate_floor_layout(_mkd_inputs(k1_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                touches_s = abs(b.y) < 0.01
                touches_n = abs(b.y + b.d - apt.d) < 0.01
                assert touches_s or touches_n, (
                    f"Лоджия не касается фасада: y={b.y}, d={b.d}, apt.d={apt.d}"
                )


# ── Перенос окна и двери ────────────────────────────────────────────


def test_balcony_has_window():
    """Окно, бывшее на parent, должно перейти на лоджию."""
    layout = generate_floor_layout(_mkd_inputs(k1_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                assert len(b.windows) >= 1, (
                    f"Apt #{apt.number}: лоджия без окна — окно с parent не перенесли"
                )


def test_parent_room_lost_facade_window():
    """Жилая комната, у которой лоджия, не должна больше иметь окно на фасаде."""
    layout = generate_floor_layout(_mkd_inputs(k2_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            balconies = _balconies_of(apt)
            if not balconies:
                continue
            # Соседние родительские жилые — те, чей x совпадает с лоджией
            for b in balconies:
                # Находим родителя (одинаковый x, разные y)
                parent = next(
                    (r for r in apt.rooms
                     if r.kind in ("living", "bedroom")
                     and abs(r.x - b.x) < 0.01
                     and abs(r.w - b.w) < 0.01),
                    None,
                )
                assert parent is not None, "не нашли родителя лоджии"
                # Окон на фасадной стороне у parent быть не должно — они на лоджии
                facade_side = "S" if abs(b.y) < 0.01 else "N"
                facade_windows = [w for w in parent.windows if w.side == facade_side]
                assert len(facade_windows) == 0, (
                    f"Apt #{apt.number}: окно на parent осталось вместо переноса на лоджию"
                )


def test_parent_room_has_balcony_door():
    """Родительская жилая комната должна получить балконную дверь."""
    layout = generate_floor_layout(_mkd_inputs(k1_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                parent = next(
                    (r for r in apt.rooms
                     if r.kind in ("living", "bedroom")
                     and abs(r.x - b.x) < 0.01
                     and abs(r.w - b.w) < 0.01),
                    None,
                )
                assert parent is not None
                # На стороне, обращённой к лоджии, должна быть дверь
                facade_side = "S" if abs(b.y) < 0.01 else "N"
                balcony_doors = [d for d in parent.doors if d.side == facade_side]
                assert len(balcony_doors) >= 1, (
                    f"Apt #{apt.number}: балконной двери на parent нет"
                )


# ── Корректность типа parent ────────────────────────────────────────


def test_balcony_attached_to_living_or_bedroom():
    """Лоджия не должна оказаться у санузла/кухни/коридора."""
    layout = generate_floor_layout(_mkd_inputs(k2_pct=1.0))
    for sect in layout.sections:
        for apt in sect.apartments:
            for b in _balconies_of(apt):
                # Ищем все комнаты с тем же x — одна из них должна быть жилой
                neighbors_same_x = [
                    r for r in apt.rooms
                    if r.kind != "balcony"
                    and abs(r.x - b.x) < 0.01
                    and abs(r.w - b.w) < 0.01
                ]
                kinds = {r.kind for r in neighbors_same_x}
                assert kinds & {"living", "bedroom"}, (
                    f"Apt #{apt.number}: лоджия не примыкает к жилой (kinds={kinds})"
                )


# ── Phase C: переменная ширина квартир по типу ──────────────────────


def test_variable_width_30m_facade_gives_6_apts():
    """Бриф 30/40/30 на 30м фасаде даёт ~6 квартир комфорт-класса.

    Раньше (фикс ширина 7.5м) → 8 эконом-квартир по ~48 м². Сейчас —
    переменная ширина даёт ~6 квартир по 60-75 м².
    """
    layout = generate_floor_layout(_mkd_inputs(
        studio_pct=0.3, k1_pct=0.4, k2_pct=0.3,
    ))
    n_apts = sum(len(s.apartments) for s in layout.sections)
    assert 5 <= n_apts <= 7, (
        f"Ожидали 5-7 квартир на 30м фасаде комфорт-класса, получили {n_apts}"
    )


def test_apt_width_varies_by_type():
    """Студии должны быть уже двушек."""
    layout = generate_floor_layout(_mkd_inputs(
        studio_pct=0.5, k2_pct=0.5,
    ))
    studios = [a for s in layout.sections for a in s.apartments if a.type_code == "studio"]
    k2s = [a for s in layout.sections for a in s.apartments if a.type_code == "2k"]
    if studios and k2s:
        avg_studio_w = sum(a.w for a in studios) / len(studios)
        avg_k2_w = sum(a.w for a in k2s) / len(k2s)
        assert avg_studio_w < avg_k2_w, (
            f"Студии в среднем должны быть уже 2к: "
            f"studio={avg_studio_w:.1f}, 2k={avg_k2_w:.1f}"
        )


def test_apartments_fill_facade_without_gaps():
    """Сумма ширин квартир каждой стороны = usable_w (без зазоров)."""
    layout = generate_floor_layout(_mkd_inputs(
        studio_pct=0.3, k1_pct=0.4, k2_pct=0.3,
    ))
    for sect in layout.sections:
        # Группируем по стороне (y < 5 = юг, y >= 5 = север)
        south = [a for a in sect.apartments if a.y < 5]
        north = [a for a in sect.apartments if a.y >= 5]
        for side, label in [(south, "юг"), (north, "север")]:
            if not side:
                continue
            total_w = sum(a.w for a in side)
            # usable_w = sect.width - 2*_BEAR_T (грубо)
            expected_w = sect.width - 0.8
            assert abs(total_w - expected_w) < 0.5, (
                f"{label}: сумма квартир {total_w:.2f} ≠ usable_w {expected_w:.2f}"
            )
