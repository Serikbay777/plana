"""5 целевых функций (пресетов) согласно ТЗ §2.3.

Каждый пресет — функция, которая берёт список кандидатов-тайлов для слота
и выбирает лучший с точки зрения своей цели:

- `MAX_USEFUL_AREA`: максимизировать суммарную площадь квартир (выход м²)
- `MAX_APT_COUNT`: максимизировать число квартир (мелкая нарезка)
- `MAX_AVG_AREA`: максимизировать среднюю площадь (крупная нарезка)
- `BALANCED_MIX`: придерживаться `target_mix`, контролируя долю по типам
- `MAX_INSOLATION`: на южном фасаде ставить квартиры с большим жилым ядром

Пресет возвращает `(score, tile)` — выбирается тайл с максимальным score.
Если кандидатов нет — `None`.
"""

from __future__ import annotations

from collections import Counter

from .types import AptType, PresetKey, TargetMix, TileSpec
from .geometry.slots import Slot
from .algo.tile import candidate_tiles_for_slot, slot_facing_orientation


# ---------------------------------------------------------------------------
# Состояние, которое передаётся между слотами одного варианта
# ---------------------------------------------------------------------------


class PresetState:
    """Накопительное состояние укладки. Нужно для пресетов, которые зависят
    от уже размещённых тайлов (BALANCED_MIX, MAX_AVG_AREA с потолком и т.д.)."""

    def __init__(self, target_mix: TargetMix | None = None):
        self.placed_by_type: Counter[AptType] = Counter()
        self.target_mix = target_mix


# ---------------------------------------------------------------------------
# Скоринг — каждая функция возвращает float, чем выше — тем лучше.
# ---------------------------------------------------------------------------


def _score_max_useful_area(t: TileSpec, slot: Slot, st: PresetState) -> float:
    # «полезной» считаем фактическую площадь, которая ляжет в слот
    actual = slot.width * slot.depth
    # бонус за плотность (чтобы не любил «пустые» широкие слоты)
    return actual + 0.001 * (t.area - actual)


def _score_max_apt_count(t: TileSpec, slot: Slot, st: PresetState) -> float:
    # этот скоринг работает на уровне НАРЕЗКИ слотов — там предпочтение узким слотам.
    # на уровне выбора тайла из кандидатов слота — берём наименьший
    return -t.area


def _score_max_avg_area(t: TileSpec, slot: Slot, st: PresetState) -> float:
    return t.area


def _score_balanced_mix(t: TileSpec, slot: Slot, st: PresetState) -> float:
    """Чем больше отклонение текущей доли от целевой — тем выше штраф.
    Выбираем тайл, который приближает фактический микс к целевому."""
    if not st.target_mix:
        return -t.area  # без целевого микса — компромисс ближе к среднему

    placed_total = sum(st.placed_by_type.values()) + 1  # +1 для текущего кандидата
    # симулируем: что будет с долями, если мы поставим этот тайл?
    new_counts = dict(st.placed_by_type)
    new_counts[t.apt_type] = new_counts.get(t.apt_type, 0) + 1

    target_for_type = {
        AptType.STUDIO: st.target_mix.studio,
        AptType.K1: st.target_mix.k1,
        AptType.EURO1: st.target_mix.k1 / 2,    # делим евро между k1 и k2
        AptType.K2: st.target_mix.k2,
        AptType.EURO2: st.target_mix.k2 / 2,
        AptType.K3: st.target_mix.k3,
        AptType.EURO3: st.target_mix.k3 / 2,
        AptType.K4: st.target_mix.k3 / 4,
    }
    # сумма абсолютных отклонений
    err = 0.0
    for apt, cnt in new_counts.items():
        actual_share = cnt / placed_total
        target = target_for_type.get(apt, 0.0)
        err += abs(actual_share - target)
    return -err


def _score_max_insolation(t: TileSpec, slot: Slot, st: PresetState) -> float:
    """Южный фасад → большой жилой блок (студии/евро/большие квартиры).
    Северный → узкие квартиры (студии)."""
    facing = slot_facing_orientation(slot)
    south = facing in ("S", "SE", "SW")

    living_area = sum(z.w * z.h for z in t.zones if z.kind.value == "living")
    bedroom_area = sum(z.w * z.h for z in t.zones if z.kind.value == "bedroom")
    daylit = living_area + 0.6 * bedroom_area

    if south:
        return daylit                          # на юге — максимум дневного света
    return -daylit                             # на севере — наоборот, минимум


# ---------------------------------------------------------------------------
# Регистр пресетов
# ---------------------------------------------------------------------------


_SCORERS = {
    PresetKey.MAX_USEFUL_AREA: _score_max_useful_area,
    PresetKey.MAX_APT_COUNT:   _score_max_apt_count,
    PresetKey.MAX_AVG_AREA:    _score_max_avg_area,
    PresetKey.BALANCED_MIX:    _score_balanced_mix,
    PresetKey.MAX_INSOLATION:  _score_max_insolation,
}


PRESET_LABELS: dict[PresetKey, str] = {
    PresetKey.MAX_USEFUL_AREA: "Максимум полезной площади",
    PresetKey.MAX_APT_COUNT:   "Максимум числа квартир",
    PresetKey.MAX_AVG_AREA:    "Максимум средней площади",
    PresetKey.BALANCED_MIX:    "Сбалансированная квартирография",
    PresetKey.MAX_INSOLATION:  "Максимум инсоляции",
}


PRESET_DESCRIPTIONS: dict[PresetKey, str] = {
    PresetKey.MAX_USEFUL_AREA:
        "Оптимизирует отношение жилой площади к общей площади этажа. "
        "Подходит для эконом-сегмента, где важна выручка с этажа.",
    PresetKey.MAX_APT_COUNT:
        "Приоритет мелких квартир (студии, 1-комн). Максимум юнитов на этаж.",
    PresetKey.MAX_AVG_AREA:
        "Приоритет крупных квартир (3-комн, евро-3, 4-комн). Премиум-сегмент.",
    PresetKey.BALANCED_MIX:
        "Распределение по типам близко к заданному в `target_mix`. "
        "Если `target_mix` не задан — равномерное.",
    PresetKey.MAX_INSOLATION:
        "Большие квартиры ориентированы на южный фасад, мелкие — на северный. "
        "Выгодно в премиум-сегменте за счёт +8–12% к цене за м².",
}


# ---------------------------------------------------------------------------
# Внешний API
# ---------------------------------------------------------------------------


def pick_tile_for_slot(
    catalog: tuple[TileSpec, ...],
    slot: Slot,
    preset: PresetKey,
    state: PresetState,
) -> TileSpec | None:
    """Выбрать лучший тайл из каталога для данного слота под пресет."""
    cands = candidate_tiles_for_slot(catalog, slot)
    if not cands:
        return None
    scorer = _SCORERS[preset]
    best = max(cands, key=lambda t: scorer(t, slot, state))
    return best
