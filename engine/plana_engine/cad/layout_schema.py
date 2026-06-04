"""Pydantic-схема структурированной планировки этажа.

Используется двумя потребителями:
  - layout_generator.py  → structured_output от GPT-4o
  - floorplan_ifc.py     → build_ifc_from_layout()
  - main.py              → /generate/floor-layout + /export/floorplan-ifc
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


Side = Literal["S", "N", "W", "E"]
ApartmentTypeCode = Literal["studio", "1k", "2k", "3k", "4k"]
"""Сторона комнаты/квартиры:
   S — южная (low Y)   N — северная (high Y)
   W — западная (low X)   E — восточная (high X)
"""


class LayoutDoor(BaseModel):
    """Дверь, привязанная к одной из четырёх стен комнаты."""
    side: Side
    offset: float
    """Расстояние от южной (для W/E) или западной (для S/N) кромки стены (м)"""
    width: float = 0.9
    """Ширина проёма (м). По умолчанию стандартная межкомнатная 0.9 м."""
    swing: Literal["in", "out"] = "in"
    """Открывание: внутрь комнаты (in) или наружу (out)."""
    hinge: Literal["left", "right"] = "left"
    """С какой стороны проёма петли (если смотреть со стороны open-направления)."""


class LayoutWindow(BaseModel):
    """Окно на одной из стен комнаты (обычно внешней)."""
    side: Side
    offset: float
    width: float = 1.5


FurnitureKind = Literal[
    # спальня
    "bed", "wardrobe", "nightstand",
    # гостиная
    "sofa", "coffee_table", "tv",
    # кухня
    "stove", "sink", "fridge", "dining_table", "kitchen_counter",
    # сан.узел
    "bathtub", "toilet", "washbasin",
    # прочее
    "armchair",
]


class LayoutFurniture(BaseModel):
    """Элемент мебели/оборудования внутри комнаты.

    Координаты x, y — левый-нижний угол bounding box объекта в системе
    координат комнаты (не квартиры). Поворот 0/90/180/270 относится к
    отрисовке иконки; bounding box (w×d) уже учитывает поворот.
    """
    kind: FurnitureKind
    x: float
    y: float
    w: float
    d: float
    rotation: int = 0       # 0/90/180/270, против часовой


class LayoutRoom(BaseModel):
    kind: str
    """Функция помещения: living / bedroom / kitchen / bathroom / toilet / hallway / loggia / storage"""
    name_ru: str
    """Название на русском: «Гостиная», «Спальня», «Кухня», …"""
    x: float
    """Левый край относительно начала квартиры (м)"""
    y: float
    """Нижний край относительно начала квартиры (м)"""
    w: float
    """Ширина по оси X (м)"""
    d: float
    """Глубина по оси Y (м)"""
    doors: list[LayoutDoor] = []
    windows: list[LayoutWindow] = []
    furniture: list[LayoutFurniture] = []

    @property
    def area_m2(self) -> float:
        return round(self.w * self.d, 1)


class LayoutApartment(BaseModel):
    type_code: ApartmentTypeCode
    number: int
    x: float
    """Абсолютная координата в здании (м)"""
    y: float
    w: float
    d: float
    rooms: list[LayoutRoom] = []

    @property
    def area_m2(self) -> float:
        return round(self.w * self.d, 1)


class LayoutCore(BaseModel):
    kind: Literal["lift_passenger", "lift_freight", "stair"]
    x: float
    y: float
    w: float
    d: float


class LayoutSection(BaseModel):
    index: int
    x_start: float
    """Левый край секции в системе координат здания (м)"""
    width: float
    corridor_y: float
    """Y-координата нижнего края коридора"""
    corridor_d: float
    """Ширина коридора (м), КМК ≥ 1.4"""
    cores: list[LayoutCore] = []
    apartments: list[LayoutApartment] = []


class LayoutFloor(BaseModel):
    """Планировка типового этажа — результат GPT-4o structured output."""
    schema_version: int = 1   # migration hook; additive — old payloads default to 1
    width_m: float
    depth_m: float
    sections: list[LayoutSection] = []
    outline: list[tuple[float, float]] | None = None
    """Полигональный контур этажа (по часовой стрелке от левого нижнего угла).

    Если None — наружный контур = прямоугольник width_m × depth_m (по умолчанию).
    Если задан — рендерер должен использовать его вместо прямоугольника.
    Используется для T-/L-/U-/прочих неравномерных контуров (t_shape с выступом
    наверху, угловые секции и т.п.). Координаты в той же системе что и квартиры
    (метры от левого нижнего угла этажа)."""


# ─── ALBUM (Sprint 1 «Альбом-генератор») ─────────────────────────────────


AlbumSheetKind = Literal[
    # Vector / технические (Sprint 1 + 2):
    "title",              # Титульный лист
    "general_data",       # Общие данные / параметры проекта (таблица)
    "floor_plan",         # План этажа
    "basement_plan",      # План подвала (Sprint 2)
    "roof_plan",          # План кровли (Sprint 2)
    "section",            # Разрез 1-1 / 2-2 (Sprint 2)
    "facade",             # Фасад (Sprint 2)
    "room_explication",   # Экспликация помещений (таблица)
    "doors_spec",         # Спецификация дверей (таблица)
    "windows_spec",       # Спецификация окон (таблица)
    # gpt-image декоративные (Sprint 3):
    "hero_render",        # Hero-рендер фасада
    "masterplan",         # Аэровид/мастерплан
]


class AlbumSheet(BaseModel):
    """Один лист альбома. Контент специфичен типу — для floor_plan
    используем общий layout у LayoutAlbum, для таблиц — вычисляется на
    лету из того же layout, для hero/masterplan — gpt-image на фронте.
    """
    kind: AlbumSheetKind
    title: str                     # «План типового этажа», «Спецификация дверей»
    floor_number: int | None = None    # для plan-листов: 1, 2, ... или None
    section_label: str | None = None   # для section: «1-1», «2-2»
    facade_side: Literal["S", "N", "E", "W"] | None = None  # для facade


class LayoutAlbum(BaseModel):
    """Альбом — комплект чертежей одного проекта.

    Sprint 1: единый layout (для всех планов одинаковый), несколько
    одинаковых planов на разные этажи, плюс таблицы.
    Sprint 2: добавятся раздельные layouts для подвала/кровли/разрезов.
    """
    project_name: str
    layout: LayoutFloor
    floors_total: int = 1            # сколько этажей в проекте
    sheets: list[AlbumSheet] = []
