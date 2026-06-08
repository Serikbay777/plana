"""Высота-1 cost-движка: УКРУПНЁННАЯ расчётная стоимость на стадии посадки.

Метод соответствует НДЦС РК 8.01-08-2022 п.6.3 для пред-проектной стадии:
укрупнённые показатели стоимости (УПСС, ₸ за м² общей площади) × мощность
объекта → «расчётная стоимость». Это ЗАЩИЩАЕМАЯ головная цифра для go/no-go и
ставки за участок — НО НЕ сметная стоимость и НЕ сертифицированная смета.

Поверх базовой стоимости строится прозрачный Сводный-сметный-расчёт-стек
(лимитированные затраты + резерв + ПИР + НДС). КРИТИЧНО: УПСС уже включает
накладные расходы и сметную прибыль, поэтому overhead_profit_pct по умолчанию 0 —
иначе двойной счёт (известная ошибка, флаг рисёрча).

Точность стадии посадки честно показывается диапазоном (AACE Class 5,
−20%/+30%, расширяемо до −30%/+50%), никогда одной «точной» цифрой.

ДАННЫЕ: официальные УСН РК 8.02-04 (по регионам) платные/привязаны к ПО. Здесь —
конфигурируемая таблица ставок с ПЛЕЙСХОЛДЕРАМИ из открытых бенчмарков
stat.gov.kz (себестоимость м²). Каждая ставка помечена official=False; заменяется
на лицензированный УПСС без изменения логики.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# ── Дисклеймеры / тексты ────────────────────────────────────────────────────

_DISCLAIMER = (
    "Расчётная стоимость (укрупнённый показатель стадии посадки), НЕ сметная "
    "стоимость. Не является сертифицированной сметой — требует подтверждения "
    "аттестованным сметчиком и Госэкспертизой РК. Точность: AACE Class 5 "
    "(концептуальная оценка)."
)

_ESTIMATE_CLASS = "AACE Class 5 (concept screening)"


# ── Ставки (плейсхолдеры) ───────────────────────────────────────────────────


class RegionRate(BaseModel):
    """Укрупнённая ставка ₸ за м² общей площади по региону и типу."""

    region: str
    building_type: str
    rate_per_m2: float
    price_level: str = "2025-placeholder"
    official: bool = False
    source: str = "stat.gov.kz benchmark (placeholder, не официальный УПСС РК)"


# Плейсхолдер-таблица: бенчмарки себестоимости м² (stat.gov.kz, ~2025-2026).
# НЕ официальный УСН РК 8.02-04. Ключ — регион; тип пока только residential.
_PLACEHOLDER_RATES_KZT_PER_M2: dict[str, float] = {
    "default": 256_000.0,
    "Алматы":  290_000.0,
    "Астана":  280_000.0,
    "Шымкент": 305_000.0,
    "Актобе":  144_000.0,
}


def get_region_rate(
    region: str,
    building_type: str = "residential",
    rate_table: dict[str, float] | None = None,
) -> RegionRate:
    """Вернуть ставку ₸/м² по региону (fallback на 'default')."""
    table = rate_table if rate_table is not None else _PLACEHOLDER_RATES_KZT_PER_M2
    rate = table.get(region, table.get("default", 0.0))
    return RegionRate(
        region=region, building_type=building_type, rate_per_m2=float(rate),
    )


# ── Коэффициенты класса/конструктива + паркинг (плейсхолдеры v0) ─────────────
#
# Это ВРЕМЕННЫЕ множители тупой версии, НЕ из официального УСН РК. Региональный
# показатель уже усреднён; здесь грубо разносим его по классу жилья и материалу.
# Заменяются на коэффициенты из лицензированного сборника без смены логики.

_CLASS_FACTORS: dict[str, float] = {
    "эконом": 1.0,
    "комфорт": 1.15,
    "бизнес": 1.4,
    "премиум": 1.7,
    "люкс": 2.0,
}

_CONSTRUCTION_FACTORS: dict[str, float] = {
    "панель": 0.9,
    "каркас": 1.0,
    "монолит": 1.0,
    "монолит_каркас": 1.0,
    "кирпич": 1.1,
}

# Ориентировочная стоимость одного машино-места (₸), всё включено. Плейсхолдер.
_PLACEHOLDER_PARKING_RATE_KZT = 5_000_000.0


def get_class_factor(residential_class: str | None) -> float:
    """Множитель класса жилья (1.0 если не задан/неизвестен)."""
    if not residential_class:
        return 1.0
    return _CLASS_FACTORS.get(residential_class.strip().lower(), 1.0)


def get_construction_factor(construction_type: str | None) -> float:
    """Множитель конструктива (1.0 если не задан/неизвестен)."""
    if not construction_type:
        return 1.0
    return _CONSTRUCTION_FACTORS.get(construction_type.strip().lower(), 1.0)


# ── Конфиг build-up (Сводный сметный расчёт) ────────────────────────────────


class CostBuildupConfig(BaseModel):
    """Проценты надбавок Сводного сметного расчёта.

    overhead_profit_pct = 0 по умолчанию: УПСС уже включает НР + сметную
    прибыль; добавлять их сверху = двойной счёт.
    """

    overhead_profit_pct: float = 0.0   # НР + сметная прибыль (в УПСС уже включены)
    limited_costs_pct: float = 6.0     # лимитированные (врем. здания, зимнее удорожание) — placeholder
    design_survey_pct: float = 0.0     # ПИР (проектно-изыскательские) — опц.
    contingency_pct: float = 2.0       # резерв на непредвиденные
    vat_pct: float = 12.0              # НДС РК
    class_low_pct: float = -20.0       # AACE Class 5: нижняя граница диапазона
    class_high_pct: float = 30.0       # верхняя граница


# ── Результат ───────────────────────────────────────────────────────────────


class CostLine(BaseModel):
    label: str
    amount: float
    note: str = ""


class AggregateCostEstimate(BaseModel):
    """Укрупнённая расчётная стоимость стадии посадки (с диапазоном)."""

    region: str
    building_type: str
    gfa_m2: float
    rate_per_m2: float
    rate_official: bool
    price_level: str

    base_construction: float            # УПСС × GFA × коэф. + паркинг (СМР, вкл. НР+прибыль)
    building_base: float = 0.0          # GFA × ставка × класс × конструктив (без паркинга)
    class_factor: float = 1.0
    construction_factor: float = 1.0
    parking_spaces: int = 0
    parking_cost: float = 0.0
    buildup: list[CostLine] = Field(default_factory=list)
    subtotal_ex_vat: float
    vat: float
    total: float
    total_low: float                    # граница диапазона Class-5
    total_high: float

    currency: str = "KZT"
    estimate_class: str = _ESTIMATE_CLASS
    is_certified_smeta: bool = False
    disclaimer: str = _DISCLAIMER
    warnings: list[str] = Field(default_factory=list)


def _r(x: float) -> float:
    """Округление до целого тенге."""
    return round(float(x), 0)


def estimate_aggregate_cost(
    *,
    gfa_m2: float,
    region: str = "default",
    building_type: str = "residential",
    residential_class: str | None = None,
    construction_type: str | None = None,
    parking_spaces: int = 0,
    parking_rate_per_space: float | None = None,
    rate_table: dict[str, float] | None = None,
    config: CostBuildupConfig | None = None,
) -> AggregateCostEstimate:
    """Укрупнённая расчётная стоимость: GFA × УПСС × коэф. + паркинг + стек ССР + диапазон."""
    cfg = config or CostBuildupConfig()
    rr = get_region_rate(region, building_type, rate_table)

    class_factor = get_class_factor(residential_class)
    constr_factor = get_construction_factor(construction_type)
    building_base = gfa_m2 * rr.rate_per_m2 * class_factor * constr_factor

    parking_spaces = max(0, int(parking_spaces or 0))
    parking_rate = (
        parking_rate_per_space if parking_rate_per_space is not None
        else _PLACEHOLDER_PARKING_RATE_KZT
    )
    parking_cost = parking_spaces * parking_rate

    # Паркинг входит в базу СМР → на него тоже начислятся резерв и НДС.
    base = building_base + parking_cost

    buildup: list[CostLine] = []

    overhead = base * cfg.overhead_profit_pct / 100.0
    if overhead:
        buildup.append(CostLine(
            label="Накладные расходы + сметная прибыль",
            amount=_r(overhead),
            note="Обычно уже включены в укрупнённый показатель — оставлять 0.",
        ))
    s1 = base + overhead

    limited = s1 * cfg.limited_costs_pct / 100.0
    if limited:
        buildup.append(CostLine(
            label="Лимитированные затраты",
            amount=_r(limited),
            note="Временные здания/сооружения, зимнее удорожание и т.п. (placeholder %).",
        ))

    design = s1 * cfg.design_survey_pct / 100.0
    if design:
        buildup.append(CostLine(
            label="Проектно-изыскательские работы (ПИР)",
            amount=_r(design),
        ))

    s2 = s1 + limited + design

    contingency = s2 * cfg.contingency_pct / 100.0
    if contingency:
        buildup.append(CostLine(
            label="Резерв на непредвиденные",
            amount=_r(contingency),
        ))

    subtotal_ex_vat = s2 + contingency
    vat = subtotal_ex_vat * cfg.vat_pct / 100.0
    total = subtotal_ex_vat + vat

    warnings: list[str] = []
    if not rr.official:
        warnings.append(
            f"Ставка {rr.rate_per_m2:,.0f} ₸/м² — ПЛЕЙСХОЛДЕР ({rr.source}); "
            "заменить на лицензированный УСН РК 8.02-04 по региону."
        )
    if parking_cost > 0:
        warnings.append(
            f"Паркинг учтён ОЦЕНОЧНО: {parking_spaces} мест × {parking_rate:,.0f} ₸ "
            "(плейсхолдер). Прочие вне-зданиевые затраты (внешние сети, выносы, "
            "благоустройство) НЕ включены — могут быть 10–20% итога."
        )
    else:
        warnings.append(
            "Вне-зданиевые затраты НЕ включены (внешние сети, выносы, благоустройство, "
            "подземный паркинг) — добавить отдельно, могут быть 15–30% итога."
        )
    if class_factor != 1.0 or constr_factor != 1.0:
        warnings.append(
            f"Коэффициенты класс={class_factor:g} / конструктив={constr_factor:g} — "
            "ПЛЕЙСХОЛДЕРЫ, не из официального УСН РК."
        )
    if cfg.overhead_profit_pct == 0.0:
        warnings.append(
            "НР + сметная прибыль считаются включёнными в укрупнённый показатель "
            "(overhead_profit_pct=0) во избежание двойного счёта."
        )

    return AggregateCostEstimate(
        region=rr.region, building_type=rr.building_type,
        gfa_m2=round(float(gfa_m2), 2),
        rate_per_m2=rr.rate_per_m2, rate_official=rr.official,
        price_level=rr.price_level,
        base_construction=_r(base),
        building_base=_r(building_base),
        class_factor=class_factor,
        construction_factor=constr_factor,
        parking_spaces=parking_spaces,
        parking_cost=_r(parking_cost),
        buildup=buildup,
        subtotal_ex_vat=_r(subtotal_ex_vat),
        vat=_r(vat),
        total=_r(total),
        total_low=_r(total * (1 + cfg.class_low_pct / 100.0)),
        total_high=_r(total * (1 + cfg.class_high_pct / 100.0)),
        warnings=warnings,
    )


# ── Мощность объекта из IFC ──────────────────────────────────────────────────


class CapacityMetrics(BaseModel):
    gfa_m2: float          # общая площадь (Σ площадей перекрытий) — прокси
    storeys: int
    footprint_m2: float    # площадь пятна (один этаж)


def capacity_from_ifc(model: Any) -> CapacityMetrics:
    """Вывести метрики мощности из IFC: GFA ≈ Σ NetArea перекрытий, этажи —
    число IfcBuildingStorey."""
    from ifcopenshell.util.element import get_psets

    storeys = max(1, len(model.by_type("IfcBuildingStorey")))
    slab_area = 0.0
    for slab in model.by_type("IfcSlab"):
        q = get_psets(slab, qtos_only=True).get("Qto_SlabBaseQuantities")
        if q:
            slab_area += float(q.get("NetArea", 0.0))
    return CapacityMetrics(
        gfa_m2=round(slab_area, 2),
        storeys=storeys,
        footprint_m2=round(slab_area / storeys, 2) if storeys else 0.0,
    )


def estimate_aggregate_cost_from_ifc(
    ifc: Any,
    *,
    region: str = "default",
    building_type: str = "residential",
    residential_class: str | None = None,
    construction_type: str | None = None,
    parking_spaces: int = 0,
    parking_rate_per_space: float | None = None,
    rate_table: dict[str, float] | None = None,
    config: CostBuildupConfig | None = None,
) -> AggregateCostEstimate:
    """Удобный путь: IFC (модель/bytes/str) → метрики мощности → расчётная стоимость."""
    import ifcopenshell

    if isinstance(ifc, (bytes, bytearray)):
        model = ifcopenshell.file.from_string(bytes(ifc).decode("utf-8"))
    elif isinstance(ifc, str):
        model = ifcopenshell.file.from_string(ifc)
    else:
        model = ifc

    cap = capacity_from_ifc(model)
    return estimate_aggregate_cost(
        gfa_m2=cap.gfa_m2, region=region, building_type=building_type,
        residential_class=residential_class, construction_type=construction_type,
        parking_spaces=parking_spaces, parking_rate_per_space=parking_rate_per_space,
        rate_table=rate_table, config=config,
    )
