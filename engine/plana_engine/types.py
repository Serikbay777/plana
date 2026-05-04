"""Доменные типы движка Plana.

Все геометрические величины — в **метрах**. Координаты: декартовы, +x вправо, +y вверх.
Все площади — в **квадратных метрах** (м²).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Геометрия
# ---------------------------------------------------------------------------


class Point(BaseModel):
    """Точка в плоскости этажа."""

    model_config = ConfigDict(frozen=True)

    x: float
    y: float

    def as_tuple(self) -> tuple[float, float]:
        return (self.x, self.y)


class Polygon(BaseModel):
    """Замкнутый полигон. Первая и последняя точка не дублируются.

    `holes` — внутренние пустоты (например, шахты, атриумы), могут быть пустым списком.
    """

    exterior: list[Point] = Field(min_length=3)
    holes: list[list[Point]] = Field(default_factory=list)

    def as_tuples(self) -> tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]:
        ext = [p.as_tuple() for p in self.exterior]
        hls = [[p.as_tuple() for p in h] for h in self.holes]
        return ext, hls


class EdgeType(str, Enum):
    """Тип ребра контура этажа."""

    FACADE = "facade"      # внешняя стена с возможностью оконных проёмов
    PARTY = "party"        # межквартирная / внутренняя
    UNKNOWN = "unknown"


class Edge(BaseModel):
    """Ребро полигона этажа. Размер вдоль ребра — `length` (м)."""

    a: Point
    b: Point
    type: EdgeType = EdgeType.UNKNOWN
    length: float


# ---------------------------------------------------------------------------
# Каталог квартир (тайлы)
# ---------------------------------------------------------------------------


class AptType(str, Enum):
    """Класс квартиры — нужен для расчёта структуры (5 пресетов)."""

    STUDIO = "studio"
    K1 = "k1"
    EURO1 = "euro1"
    K2 = "k2"
    EURO2 = "euro2"
    K3 = "k3"
    EURO3 = "euro3"
    K4 = "k4"


class TileSpec(BaseModel):
    """Параметрический шаблон квартиры (запись из catalog.yaml).

    Все размеры — в метрах. Допуски ±10% применяются к `width` и `depth`
    при укладке. `area` — целевая площадь квартиры (без коридора).

    Внутреннее зонирование (кухня, санузел) задаётся фиксированно
    относительно входной двери и фасада — см. поле `zones`.
    """

    code: str                                      # S-25, 1K-38, и т.д.
    apt_type: AptType
    label: str                                     # «Студия 25 м²» — для UI
    area: float                                    # м²
    width: float                                   # вдоль фасада, м
    depth: float                                   # перпендикулярно фасаду, м
    tolerance: float = 0.10                        # ±10% по умолчанию
    door_offset: float = 0.4                       # смещение двери от ближнего края, м
    zones: list[Zone] = Field(default_factory=list)


class ZoneKind(str, Enum):
    KITCHEN = "kitchen"
    BATHROOM = "bathroom"
    LIVING = "living"
    BEDROOM = "bedroom"
    HALL = "hall"
    LOGGIA = "loggia"


class Zone(BaseModel):
    """Внутреннее зонирование внутри тайла. Координаты — относительно левого
    нижнего угла тайла (тайл уложен фасадом вниз: y=0 — фасад, y=depth — коридор)."""

    kind: ZoneKind
    x: float
    y: float
    w: float
    h: float


TileSpec.model_rebuild()


# ---------------------------------------------------------------------------
# Здание / этаж / план
# ---------------------------------------------------------------------------


class CoreSpec(BaseModel):
    """Лифтово-лестничный узел и инженерные шахты."""

    polygon: Polygon
    lifts: int = 1
    stairs: int = 1
    has_shaft: bool = True


class EngineeringKind(str, Enum):
    """Тип инженерного помещения первого этажа / подвала."""
    ITP = "itp"                    # индивидуальный тепловой пункт
    ELECTRICAL = "electrical"      # электрощитовая
    WASTE = "waste"                # мусорокамера
    VENT = "vent"                  # венткамера
    PUMP = "pump"                  # насосная


class EngineeringRoom(BaseModel):
    """Инженерное помещение, размещаемое на первом этаже у ядра.

    Не входит в `saleable_area` метрик, но учитывается в `floor_area` и
    отображается отдельным слоем на плане. Размещение — рядом с core,
    на стороне противоположной коридору, чтобы не обрезать квартиры.
    """
    kind: EngineeringKind
    polygon: Polygon
    label: str
    area: float


class CorridorKind(str, Enum):
    LINEAR = "linear"          # прямой коридор вдоль здания
    RING = "ring"              # кольцевой / замкнутый
    CENTRAL = "central"        # центральный холл (для башен)


class Corridor(BaseModel):
    polygon: Polygon
    kind: CorridorKind
    length: float


class PlacedZone(BaseModel):
    """Зона тайла в МИРОВЫХ координатах после укладки.

    `polygon` — четырёхугольник в мировых координатах (после вращения и
    масштабирования из локальных коорд тайла). Это позволяет фронту рисовать
    зоны напрямую без знаний о повороте/масштабировании тайла.
    """

    kind: ZoneKind
    polygon: Polygon
    label: str = ""


class PlacedTile(BaseModel):
    """Тайл, уложенный в слот плана. Координаты — абсолютные в системе этажа."""

    spec_code: str             # ссылка на TileSpec.code
    apt_type: AptType
    label: str
    polygon: Polygon
    area: float                # фактическая (после допусков)
    width: float
    depth: float
    facade_edge: Edge          # к какому ребру фасада привязан тайл
    zones: list[PlacedZone] = Field(default_factory=list)
    apt_number: int = 0        # 1..N — порядковый номер квартиры на этаже
    door_world: Point | None = None
    """Положение входной двери в мировых координатах (на коридорной стене)."""
    living_area: float = 0.0   # сумма площадей жилых зон (living + bedroom)


class Plan(BaseModel):
    """Один сгенерированный вариант планировки этажа."""

    floor_polygon: Polygon
    core: CoreSpec
    corridors: list[Corridor]
    tiles: list[PlacedTile]
    engineering_rooms: list[EngineeringRoom] = Field(default_factory=list)
    metrics: PlanMetrics
    norms: NormsReport
    preset: PresetKey


# ---------------------------------------------------------------------------
# Метрики (выходная сравнительная таблица)
# ---------------------------------------------------------------------------


class PlanMetrics(BaseModel):
    """Метрики, выводимые в сравнительной таблице (см. ТЗ §3.5)."""

    floor_area: float                              # общая S этажа, м²
    saleable_area: float                           # ∑ площадей квартир, м²
    saleable_ratio: float                          # saleable / floor (КИТ-аналог)
    apt_count: int
    avg_apt_area: float
    apt_by_type: dict[AptType, int]
    south_oriented_share: float                    # доля квартир с юж/ю-з фасадом
    insolation_score: float                        # 0..1, простая эвристика
    core_area: float
    corridor_area: float
    corridor_length: float


# ---------------------------------------------------------------------------
# Нормоконтроль
# ---------------------------------------------------------------------------


NormSeverity = Literal["info", "warning", "error"]


class NormViolation(BaseModel):
    rule_id: str                                   # «corridor.min_width»
    severity: NormSeverity
    message: str
    location: Point | None = None


class NormsReport(BaseModel):
    """Результат прогона `validator.check_plan()`."""

    passed: bool
    violations: list[NormViolation]


# ---------------------------------------------------------------------------
# Пресеты (целевые функции)
# ---------------------------------------------------------------------------


class PresetKey(str, Enum):
    """5 целевых функций согласно ТЗ §2.3."""

    MAX_USEFUL_AREA = "max_useful_area"            # максимум полезной площади
    MAX_APT_COUNT = "max_apt_count"                # максимум числа квартир
    MAX_AVG_AREA = "max_avg_area"                  # максимум средней площади
    BALANCED_MIX = "balanced_mix"                  # сбалансированная квартирография
    MAX_INSOLATION = "max_insolation"              # максимум инсоляции


# ---------------------------------------------------------------------------
# Входной запрос на генерацию
# ---------------------------------------------------------------------------


class BuildingPurpose(str, Enum):
    """В MVP реализован только `RESIDENTIAL`."""

    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"                      # отложено
    MIXED_USE = "mixed_use"                        # отложено
    HOTEL = "hotel"                                # отложено


class TargetMix(BaseModel):
    """Целевая квартирография (опционально, в виде долей 0..1)."""

    studio: float = 0.0
    k1: float = 0.0
    k2: float = 0.0
    k3: float = 0.0


class GenerateRequest(BaseModel):
    """Входной запрос: контур + параметры. Контур может прийти как явный полигон
    или как ссылка на загруженный DXF/PDF (поле `source_file_id`)."""

    floor_polygon: Polygon | None = None
    source_file_id: str | None = None
    purpose: BuildingPurpose = BuildingPurpose.RESIDENTIAL
    floors: int = 1                                # для расчёта итогов «по объекту»
    target_mix: TargetMix | None = None
    seed: int | None = None
    """Random seed — пока алгоритм детерминированный, поле зарезервировано
    под Этап 2 ТЗ (DEAP-оптимизатор). Гарантирует воспроизводимость, когда
    добавится стохастический поиск."""
    south_facade_indices: list[int] = Field(default_factory=list)
    """Индексы рёбер `Polygon.exterior`, ориентированных на юг (для инсоляции).
    Если пусто — определяется автоматически по нижней грани bbox."""


class GenerateResponse(BaseModel):
    """Ответ на /generate — 5 планов, каждый под свой пресет."""

    request_id: str
    variants: list[Plan]                           # длина = 5
    elapsed_ms: int


# ---------------------------------------------------------------------------
# Forward refs — Pydantic 2 нужно пересобрать модели
# ---------------------------------------------------------------------------

Plan.model_rebuild()
PlanMetrics.model_rebuild()
NormsReport.model_rebuild()
