"""Доменная модель plana — Pydantic-схемы для архитектурного проекта.

Это **источник истины**: и AI-генератор, и интерактивный редактор, и
импортёры CAD/IFC/PDF, и рендереры (DXF/PDF/IFC) — все работают на этой
модели. Pydantic даёт сериализацию в JSON / валидацию / типобезопасность.
Геометрия — нативные shapely-объекты через `PolygonField` (WKT в JSON).

Иерархия:
    Project
      └── Site (контур участка + ГПЗУ + отступы)
      └── Buildings[]
            └── Floors[]
                  ├── Apartments[]
                  │     └── Rooms[]
                  ├── Cores[]      (лифты/лестницы)
                  ├── Shafts[]     (инженерные шахты)
                  └── Corridors[]

Все полигоны хранятся в **местных метрических координатах** (метры),
origin (0,0) — нижний-левый угол участка. SRS не используется (это не GIS).

Метрики (`area_*`) считаются on-the-fly через shapely — никаких ручных
произведений габаритов. Если геометрия изменилась — метрика обновится.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..types import BuildingPurpose
from ._shapely_adapter import PolygonField


# ── общие config ────────────────────────────────────────────────────────────

_GEOM_CONFIG = ConfigDict(arbitrary_types_allowed=True)


# ── Site-уровень ────────────────────────────────────────────────────────────


class Setbacks(BaseModel):
    """Отступы от границ участка до здания (метры)."""

    front_m: float = 0.0
    side_m: float = 0.0
    rear_m: float = 0.0


class GpzuConstraints(BaseModel):
    """Ограничения из ГПЗУ (то, что задаёт регулятор).

    Параллель `importers.gpzu.GpzuExtraction`, но проксированная в domain.
    Заполняется бриджом из GpzuExtraction либо вручную из формы.
    """

    max_height_m: float | None = None
    max_floors: int | None = None
    max_coverage_pct: float | None = None
    max_far: float | None = None  # коэф. использования территории (КИТ)
    purpose_allowed: list[str] = Field(default_factory=list)
    notes: str = ""


class Site(BaseModel):
    """Участок: контур + ГПЗУ-ограничения + красные линии + отступы."""

    model_config = _GEOM_CONFIG

    boundary: PolygonField
    setbacks: Setbacks = Field(default_factory=Setbacks)
    gpzu: GpzuConstraints = Field(default_factory=GpzuConstraints)
    red_lines: list[PolygonField] = Field(default_factory=list)

    @property
    def area_m2(self) -> float:
        return float(self.boundary.area)


# ── Помещения ───────────────────────────────────────────────────────────────


RoomKind = Literal[
    "living",          # жилая комната / гостиная
    "bedroom",         # спальня
    "kitchen",         # кухня изолированная
    "kitchen_living",  # кухня-гостиная (евро)
    "bath",            # совмещённый санузел / ванная
    "wc",              # туалет отдельно
    "hall",            # прихожая / коридор внутри квартиры
    "loggia",          # лоджия
    "balcony",         # балкон
    "storage",         # кладовая
    "wardrobe",        # гардеробная
    "other",
]


class Room(BaseModel):
    """Одно помещение в квартире."""

    model_config = _GEOM_CONFIG

    kind: RoomKind
    polygon: PolygonField
    name: str = ""                          # "Гостиная", "Спальня 1"
    insolation_required: bool = False       # требуется по СНиП РК инсоляция
    natural_light_required: bool = False    # требуется естественное освещение

    @property
    def area_m2(self) -> float:
        return float(self.polygon.area)


# ── Квартира ────────────────────────────────────────────────────────────────


ApartmentType = Literal[
    "studio",
    "k1", "euro1",
    "k2", "euro2",
    "k3", "euro3",
    "k4",
]


class Apartment(BaseModel):
    """Квартира — набор комнат + тип."""

    type_code: ApartmentType
    rooms: list[Room] = Field(default_factory=list)
    label: str = ""                         # "Кв. №3-15"

    @property
    def area_total_m2(self) -> float:
        return sum(r.area_m2 for r in self.rooms)

    @property
    def area_living_m2(self) -> float:
        """Сумма жилых комнат (без кухни/санузла/коридора/балкона)."""
        living_kinds = {"living", "bedroom", "kitchen_living"}
        return sum(r.area_m2 for r in self.rooms if r.kind in living_kinds)


# ── Вспомогательные блоки этажа ─────────────────────────────────────────────


CoreKind = Literal["lift", "stair", "stair_lift", "fire_stair"]


class Core(BaseModel):
    """Лифтовое или лестничное ядро (МОП — место общего пользования)."""

    model_config = _GEOM_CONFIG

    kind: CoreKind
    polygon: PolygonField
    label: str = ""                         # "Л-1", "ЛЛК-1"
    capacity_persons: int = 0               # вместимость лифта (пассажиров)

    @property
    def area_m2(self) -> float:
        return float(self.polygon.area)


ShaftPurpose = Literal["plumbing", "ventilation", "electrical", "mixed"]


class Shaft(BaseModel):
    """Инженерная шахта (сантехническая / вентиляционная / электрическая)."""

    model_config = _GEOM_CONFIG

    polygon: PolygonField
    purpose: ShaftPurpose = "mixed"
    label: str = ""

    @property
    def area_m2(self) -> float:
        return float(self.polygon.area)


# ── Этаж ────────────────────────────────────────────────────────────────────


class Floor(BaseModel):
    """Один этаж здания."""

    model_config = _GEOM_CONFIG

    level: int                              # 1, 2, 3 ... (1 = первый)
    z_offset_m: float = 0.0                 # абсолютная высота низа от 0
    apartments: list[Apartment] = Field(default_factory=list)
    cores: list[Core] = Field(default_factory=list)
    shafts: list[Shaft] = Field(default_factory=list)
    corridors: list[PolygonField] = Field(default_factory=list)

    @property
    def area_apartments_m2(self) -> float:
        return sum(a.area_total_m2 for a in self.apartments)

    @property
    def area_living_m2(self) -> float:
        return sum(a.area_living_m2 for a in self.apartments)

    @property
    def area_cores_m2(self) -> float:
        return sum(c.area_m2 for c in self.cores)

    @property
    def area_corridors_m2(self) -> float:
        return sum(float(p.area) for p in self.corridors)

    @property
    def area_total_m2(self) -> float:
        """Сумма квартир + ядра + коридоры. Не учитывает шахты внутри ядер."""
        return self.area_apartments_m2 + self.area_cores_m2 + self.area_corridors_m2

    @property
    def efficiency_pct(self) -> float:
        """Эффективность планировки = живая площадь / общая площадь × 100%."""
        total = self.area_total_m2
        if total <= 0:
            return 0.0
        return round(self.area_living_m2 / total * 100, 1)


# ── Здание ──────────────────────────────────────────────────────────────────


class Building(BaseModel):
    """Одно здание на участке — пятно застройки + этажи."""

    model_config = _GEOM_CONFIG

    footprint: PolygonField                 # пятно застройки (план первого этажа)
    purpose: BuildingPurpose = BuildingPurpose.RESIDENTIAL
    height_m: float = 0.0
    floors_count: int = 1
    sections_count: int = 1                 # количество подъездов
    floors: list[Floor] = Field(default_factory=list)

    @property
    def footprint_area_m2(self) -> float:
        return float(self.footprint.area)


# ── Проект ──────────────────────────────────────────────────────────────────


class Project(BaseModel):
    """Корень доменной модели — Site + Buildings."""

    site: Site
    buildings: list[Building] = Field(default_factory=list)

    @property
    def site_area_m2(self) -> float:
        return self.site.area_m2

    @property
    def total_footprint_m2(self) -> float:
        return sum(b.footprint_area_m2 for b in self.buildings)

    @property
    def coverage_pct(self) -> float:
        """Процент застройки = пятна / участок × 100%."""
        if self.site_area_m2 <= 0:
            return 0.0
        return round(self.total_footprint_m2 / self.site_area_m2 * 100, 1)


__all__ = [
    "ApartmentType",
    "Apartment",
    "Building",
    "Core",
    "CoreKind",
    "Floor",
    "GpzuConstraints",
    "Project",
    "Room",
    "RoomKind",
    "Setbacks",
    "Shaft",
    "ShaftPurpose",
    "Site",
]
