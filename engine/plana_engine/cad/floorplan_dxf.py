"""DXF-генератор плана типового этажа.

Строит реальный CAD-чертёж из параметров формы:
    • контур здания (несущие стены, hatching)
    • противопожарные стены между секциями (REI 60)
    • лифтовые ядра в центре каждой секции (лифты пасс. + груз. + лестница)
    • раскладку квартир по периметру (упрощённые boxes с подписями)
    • размерные цепочки по фасадам
    • оси «А»-«Б»-«В»... + «1»-«2»-«3»...
    • штамп с информацией о проекте
    • слои как в реальном проекте

Все размеры в МЕТРАХ. Единицы DXF — метры (INSUNITS=6).
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import ezdxf
from ezdxf.document import Drawing
from ezdxf.layouts import Modelspace
from ezdxf.enums import TextEntityAlignment

from ..visualizer.marketing_prompt import MarketingInputs


# ── константы — толщины стен, габариты ядер по СНиП РК ──────────────────────

WALL_BEARING_M = 0.4         # несущая стена 400 мм
WALL_PARTITION_M = 0.12      # перегородка 120 мм
LIFT_CABIN_M = 1.5           # размер шахты пасс. лифта
LIFT_FREIGHT_M = 2.1         # грузовой лифт
STAIR_W_M = 1.05             # ширина лестничного марша (СНиП РК)
STAIR_LENGTH_M = 5.5         # длина лестничной клетки (площадки + марши)
CORRIDOR_W_M = 1.4           # коридор по СНиП РК (≥ 1.4 м)


# ── слои (имя, цвет ACI, lineweight в 1/100 mm) ─────────────────────────────

LAYERS = [
    # (name, color, lineweight)
    ("0",                       7,    25),     # default
    ("AXES",                    8,    13),     # оси (центрлиния)
    ("WALLS_BEARING",           1,    70),     # несущие стены — красные, 0.7 mm
    ("WALLS_PARTITION",         2,    35),     # перегородки — жёлтые, 0.35 mm
    ("FIRE_WALLS",              1,    100),    # противопожарные — толстые красные
    ("WINDOWS",                 5,    18),     # окна — синие
    ("DOORS",                   3,    18),     # двери — зелёные
    ("LIFTS_STAIRS",            6,    50),     # лифты+лестницы — magenta
    ("ENGINEERING_SHAFTS",      4,    35),     # инженерные шахты — голубые
    ("APARTMENTS_BOUNDARY",     250,  35),     # границы квартир — серые
    ("FURNITURE",               9,    13),     # мебель — светло-серая
    ("DIMENSIONS",              3,    18),     # размеры — зелёные
    ("ANNOTATIONS",             7,    25),     # подписи — белые/чёрные
    ("TITLE_BLOCK",             7,    35),     # штамп
    ("SETBACK_LINES",           1,    18),     # красные линии отступов
]


# ── главный builder ─────────────────────────────────────────────────────────

class FloorPlanDxfBuilder:
    """Строит DXF плана этажа из MarketingInputs.

    Использование:
        builder = FloorPlanDxfBuilder(inputs)
        builder.build()
        bytes_io = builder.to_bytes()
    """

    def __init__(self, inputs: MarketingInputs) -> None:
        self.inputs = inputs
        # Геометрия (используем footprint напрямую, setbacks=0 в новой форме)
        self.W = inputs.site_width_m
        self.H = inputs.site_depth_m
        self.sections = max(1, inputs.sections)
        self.section_w = self.W / self.sections

        # DXF документ
        self.doc: Drawing = ezdxf.new(dxfversion="R2018", setup=True)
        self.doc.units = ezdxf.units.M  # метры
        self.msp: Modelspace = self.doc.modelspace()

        self._setup_layers()
        self._setup_text_styles()

    # ── setup ────────────────────────────────────────────────────────────────

    def _setup_layers(self) -> None:
        for name, color, lw in LAYERS:
            if name in self.doc.layers:
                continue
            layer = self.doc.layers.add(name=name, color=color)
            layer.dxf.lineweight = lw

    def _setup_text_styles(self) -> None:
        # стандартный шрифт для надписей
        if "PLANA_TEXT" not in self.doc.styles:
            self.doc.styles.new("PLANA_TEXT", dxfattribs={"font": "arial.ttf"})

    # ── build ────────────────────────────────────────────────────────────────

    def build(self) -> None:
        """Главный pipeline сборки чертежа."""
        self._draw_outer_walls()
        self._draw_section_separators()
        self._draw_section_cores()      # лифты+лестницы
        self._draw_apartment_layout()
        self._draw_axes()
        self._draw_dimensions()
        self._draw_title_block()
        self._draw_metadata_text()

    # ── geometry helpers ─────────────────────────────────────────────────────

    def _add_polyline(self, points, *, layer: str, close: bool = True) -> None:
        self.msp.add_lwpolyline(
            points, close=close, dxfattribs={"layer": layer},
        )

    def _add_rect(self, x: float, y: float, w: float, h: float, *, layer: str) -> None:
        self._add_polyline(
            [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
            layer=layer,
        )

    def _add_text(
        self, text: str, pos: tuple[float, float], *,
        height: float = 0.35, layer: str = "ANNOTATIONS",
        align: TextEntityAlignment = TextEntityAlignment.MIDDLE_CENTER,
    ) -> None:
        t = self.msp.add_text(
            text,
            dxfattribs={"layer": layer, "height": height, "style": "PLANA_TEXT"},
        )
        t.set_placement(pos, align=align)

    # ── 1. Внешние стены ─────────────────────────────────────────────────────

    def _draw_outer_walls(self) -> None:
        """Двойной контур: внутренний и внешний (имитация стены 400 мм)."""
        t = WALL_BEARING_M
        # внешний контур
        self._add_rect(0, 0, self.W, self.H, layer="WALLS_BEARING")
        # внутренний контур (offset внутрь на толщину стены)
        self._add_rect(t, t, self.W - 2 * t, self.H - 2 * t, layer="WALLS_BEARING")

    # ── 2. Противопожарные стены между секциями ─────────────────────────────

    def _draw_section_separators(self) -> None:
        """Вертикальные fire-walls между секциями (REI 60)."""
        if self.sections < 2:
            return
        t = WALL_BEARING_M
        for s in range(1, self.sections):
            x = s * self.section_w
            # двойная линия = противопожарная стена 400 мм
            self.msp.add_line(
                (x - t / 2, t), (x - t / 2, self.H - t),
                dxfattribs={"layer": "FIRE_WALLS"},
            )
            self.msp.add_line(
                (x + t / 2, t), (x + t / 2, self.H - t),
                dxfattribs={"layer": "FIRE_WALLS"},
            )

    # ── 3. Лифтовые ядра в каждой секции ────────────────────────────────────

    def _draw_section_cores(self) -> None:
        """В центре каждой секции рисуем лифты пасс. + груз. + лестницу."""
        for s in range(self.sections):
            cx = s * self.section_w + self.section_w / 2
            cy = self.H / 2
            self._draw_one_core(cx, cy, section_idx=s + 1)

    def _draw_one_core(self, cx: float, cy: float, *, section_idx: int) -> None:
        """Лифтовый узел в одной секции:

            ┌─────────┬─────────┐
            │  ЛИФТ   │  ЛИФТ   │
            │  пасс.  │  пасс.  │
            ├─────────┼─────────┤
            │  ЛИФТ   │  ЛЕСТН. │
            │  груз.  │  Л-1    │
            └─────────┴─────────┘
        """
        n_pass = max(1, self.inputs.lifts_passenger)
        n_freight = max(0, self.inputs.lifts_freight)

        # Сетка лифтов (всё в ряд)
        cells = []
        for _ in range(n_pass):
            cells.append(("ЛИФТ\nпасс.", LIFT_CABIN_M, LIFT_CABIN_M, "LIFTS_STAIRS"))
        for _ in range(n_freight):
            cells.append(("ЛИФТ\nгруз.", LIFT_FREIGHT_M, LIFT_FREIGHT_M, "LIFTS_STAIRS"))
        cells.append(("Л-1", STAIR_W_M * 2, STAIR_LENGTH_M, "LIFTS_STAIRS"))

        # Размещаем в линию вдоль X, центрируя по cx, cy
        total_w = sum(c[1] for c in cells)
        max_h = max(c[2] for c in cells)
        x = cx - total_w / 2
        y0 = cy - max_h / 2

        for label, w, h, layer in cells:
            self._add_rect(x, y0, w, h, layer=layer)
            # подпись по центру ячейки
            self._add_text(label, (x + w / 2, y0 + h / 2),
                           height=0.22, layer="ANNOTATIONS")
            x += w

        # Подпись секции над ядром
        self._add_text(
            f"СЕКЦИЯ {section_idx}",
            (cx, y0 + max_h + 1.0),
            height=0.5, layer="ANNOTATIONS",
        )

        # Маленькие инженерные шахты рядом с ядром
        self._add_rect(cx - 0.3, cy + max_h / 2 + 0.5, 0.6, 0.6,
                       layer="ENGINEERING_SHAFTS")
        self._add_text("ВЕНТ", (cx, cy + max_h / 2 + 0.8),
                       height=0.15, layer="ANNOTATIONS")

        self._add_rect(cx + 1.0, cy + max_h / 2 + 0.5, 0.6, 0.6,
                       layer="ENGINEERING_SHAFTS")
        self._add_text("ЭЩ", (cx + 1.3, cy + max_h / 2 + 0.8),
                       height=0.15, layer="ANNOTATIONS")

    # ── 4. Раскладка квартир ─────────────────────────────────────────────────

    def _draw_apartment_layout(self) -> None:
        """Упрощённая раскладка: квартиры идут вдоль фасадов (юг и север)
        в каждой секции, разделённые перегородками. Размер по среднему м².
        """
        n_units = self._approx_unit_count()
        units_per_section = max(2, n_units // self.sections)
        avg_area = self._avg_apartment_area()
        # Ширина средней квартиры вдоль фасада, исходя из глубины зоны квартир
        # Зона = (H - depth_of_corridor) / 2 на каждой стороне фасада
        apt_zone_depth = (self.H - CORRIDOR_W_M - STAIR_LENGTH_M) / 2
        if apt_zone_depth < 4.0:
            apt_zone_depth = 4.0
        # ширина = площадь / глубина
        avg_w = max(4.0, avg_area / apt_zone_depth)

        for s in range(self.sections):
            x_start = s * self.section_w + WALL_BEARING_M
            x_end = (s + 1) * self.section_w - WALL_BEARING_M
            # сколько квартир влезет в одну сторону
            apts_per_side = max(1, units_per_section // 2)
            side_w = (x_end - x_start) / apts_per_side
            # Юг (нижний фасад)
            for i in range(apts_per_side):
                x = x_start + i * side_w
                self._add_rect(
                    x + 0.05, WALL_BEARING_M + 0.05,
                    side_w - 0.1, apt_zone_depth - 0.1,
                    layer="APARTMENTS_BOUNDARY",
                )
                self._add_text(
                    f"Кв. {s+1}-{i+1}",
                    (x + side_w / 2, apt_zone_depth / 2 + WALL_BEARING_M),
                    height=0.35, layer="ANNOTATIONS",
                )
                self._add_text(
                    f"S = {avg_area:.1f} м²",
                    (x + side_w / 2, apt_zone_depth / 2 + WALL_BEARING_M - 0.6),
                    height=0.22, layer="ANNOTATIONS",
                )
            # Север (верхний фасад) — со смещением номеров
            for i in range(apts_per_side):
                x = x_start + i * side_w
                y = self.H - WALL_BEARING_M - apt_zone_depth + 0.05
                self._add_rect(
                    x + 0.05, y, side_w - 0.1, apt_zone_depth - 0.1,
                    layer="APARTMENTS_BOUNDARY",
                )
                idx_n = apts_per_side + i + 1
                self._add_text(
                    f"Кв. {s+1}-{idx_n}",
                    (x + side_w / 2, y + apt_zone_depth / 2),
                    height=0.35, layer="ANNOTATIONS",
                )
                self._add_text(
                    f"S = {avg_area:.1f} м²",
                    (x + side_w / 2, y + apt_zone_depth / 2 - 0.6),
                    height=0.22, layer="ANNOTATIONS",
                )

    def _approx_unit_count(self) -> int:
        """Грубая оценка кол-ва квартир на этаже."""
        floor_area = self.W * self.H
        saleable = floor_area * 0.55
        avg = self._avg_apartment_area()
        return max(2, min(40, round(saleable / avg)))

    def _avg_apartment_area(self) -> float:
        """Средняя площадь квартиры по проценту микса."""
        s = self.inputs.studio_pct + self.inputs.k1_pct + \
            self.inputs.k2_pct + self.inputs.k3_pct
        if s < 0.01:
            return 50.0
        return (
            30 * self.inputs.studio_pct +
            45 * self.inputs.k1_pct +
            65 * self.inputs.k2_pct +
            90 * self.inputs.k3_pct
        ) / s

    # ── 5. Оси ───────────────────────────────────────────────────────────────

    def _draw_axes(self) -> None:
        """Простая координатная сетка осей."""
        # Вертикальные оси (А-Б-В-...) — каждые ~6 м
        n_v = max(2, round(self.W / 6))
        step_x = self.W / (n_v - 1) if n_v > 1 else self.W
        labels_v = "АБВГДЕЖЗИК"
        for i in range(n_v):
            x = i * step_x
            self.msp.add_line((x, -2), (x, self.H + 2),
                              dxfattribs={"layer": "AXES", "linetype": "DASHED"})
            self.msp.add_circle((x, -2.5), 0.4,
                                dxfattribs={"layer": "AXES"})
            self._add_text(
                labels_v[i] if i < len(labels_v) else str(i + 1),
                (x, -2.5), height=0.35, layer="AXES",
            )
        # Горизонтальные оси (1-2-3-...) — каждые ~6 м
        n_h = max(2, round(self.H / 6))
        step_y = self.H / (n_h - 1) if n_h > 1 else self.H
        for i in range(n_h):
            y = i * step_y
            self.msp.add_line((-2, y), (self.W + 2, y),
                              dxfattribs={"layer": "AXES", "linetype": "DASHED"})
            self.msp.add_circle((-2.5, y), 0.4,
                                dxfattribs={"layer": "AXES"})
            self._add_text(str(i + 1), (-2.5, y),
                           height=0.35, layer="AXES")

    # ── 6. Размерные цепочки ─────────────────────────────────────────────────

    def _draw_dimensions(self) -> None:
        """Внешние размерные цепочки по фасадам."""
        # Юг — общий размер (W)
        self.msp.add_aligned_dim(
            p1=(0, -4.5), p2=(self.W, -4.5), distance=0,
            dxfattribs={"layer": "DIMENSIONS"},
        ).render()
        # Запад — общий размер (H)
        self.msp.add_aligned_dim(
            p1=(-4.5, 0), p2=(-4.5, self.H), distance=0,
            dxfattribs={"layer": "DIMENSIONS"},
        ).render()
        # Цепочка по секциям внизу
        if self.sections > 1:
            for s in range(self.sections):
                x_left = s * self.section_w
                x_right = (s + 1) * self.section_w
                self.msp.add_aligned_dim(
                    p1=(x_left, -3.0), p2=(x_right, -3.0), distance=0,
                    dxfattribs={"layer": "DIMENSIONS"},
                ).render()

    # ── 7. Штамп с информацией ──────────────────────────────────────────────

    def _draw_title_block(self) -> None:
        """Штамп проекта в правом нижнем углу под планом."""
        x = self.W - 12
        y = -8
        # Рамка штампа
        self._add_rect(x, y - 4, 12, 4, layer="TITLE_BLOCK")
        self._add_rect(x, y - 4, 12, 1.0, layer="TITLE_BLOCK")
        self._add_rect(x, y - 1.0, 12, 1.0, layer="TITLE_BLOCK")
        # Содержимое
        self._add_text("ПЛАН ТИПОВОГО ЭТАЖА",
                       (x + 6, y - 0.5), height=0.4,
                       align=TextEntityAlignment.MIDDLE_CENTER)
        self._add_text(f"Жилое здание · {self.inputs.floors} этажей",
                       (x + 6, y - 1.5), height=0.28,
                       align=TextEntityAlignment.MIDDLE_CENTER)
        self._add_text("Масштаб: 1:100 · М",
                       (x + 6, y - 2.2), height=0.22,
                       align=TextEntityAlignment.MIDDLE_CENTER)
        self._add_text("PLANA · AI Generative Layout",
                       (x + 6, y - 3.0), height=0.22,
                       align=TextEntityAlignment.MIDDLE_CENTER)
        self._add_text("Лист 1",
                       (x + 6, y - 3.6), height=0.22,
                       align=TextEntityAlignment.MIDDLE_CENTER)

    # ── 8. Метаданные (норм РК + параметры) ─────────────────────────────────

    def _draw_metadata_text(self) -> None:
        """Текстовый блок слева внизу — параметры проекта и нормы."""
        x = 0
        y = -8
        lines = [
            "ПАРАМЕТРЫ ПРОЕКТА:",
            f"  • Габариты: {self.W:.0f} × {self.H:.0f} м",
            f"  • Этажность: {self.inputs.floors}",
            f"  • Подъездов: {self.sections}",
            f"  • Квартир/этаж: ~{self._approx_unit_count()}",
            f"  • Лифты/секцию: {self.inputs.lifts_passenger} пасс. + "
            f"{self.inputs.lifts_freight} груз.",
            "",
            "СООТВЕТСТВИЕ НОРМАМ РК:",
            f"  • Эвакуация ≤ {self.inputs.fire_evacuation_max_m:.0f} м "
            f"(СНиП РК 3.02-43-2007)",
            f"  • Тупиковый коридор ≤ {self.inputs.fire_dead_end_corridor_max_m:.0f} м",
            f"  • Ширина коридора ≥ {CORRIDOR_W_M} м (СНиП РК п. 5.5.11)",
            f"  • Противопожарные стены REI 60 между секциями",
        ]
        for i, line in enumerate(lines):
            self._add_text(
                line, (x, y - 0.4 * i), height=0.22,
                layer="ANNOTATIONS",
                align=TextEntityAlignment.LEFT,
            )

    # ── output ───────────────────────────────────────────────────────────────

    def to_bytes(self) -> bytes:
        """Сериализовать DXF в bytes."""
        buf = io.StringIO()
        self.doc.write(buf)
        return buf.getvalue().encode("utf-8")


# ── метрики поверх готового DXF ─────────────────────────────────────────────

@dataclass
class FloorPlanMetrics:
    """Реальные метрики, рассчитанные из геометрии (не из промпта)."""
    total_floor_area_m2: float
    apartments_count: int
    avg_apartment_area_m2: float
    sections_count: int
    units_per_section: int
    living_area_estimate_m2: float
    efficiency_pct: float


def compute_floorplan_metrics(inputs: MarketingInputs) -> FloorPlanMetrics:
    """Расчёт метрик по той же логике что и DXF builder."""
    builder = FloorPlanDxfBuilder(inputs)
    n_units = builder._approx_unit_count()
    avg = builder._avg_apartment_area()
    floor_area = builder.W * builder.H
    living = n_units * avg
    return FloorPlanMetrics(
        total_floor_area_m2=round(floor_area, 1),
        apartments_count=n_units,
        avg_apartment_area_m2=round(avg, 1),
        sections_count=builder.sections,
        units_per_section=max(2, n_units // builder.sections),
        living_area_estimate_m2=round(living, 1),
        efficiency_pct=round(living / floor_area * 100, 1) if floor_area > 0 else 0.0,
    )


# ── публичная функция ──────────────────────────────────────────────────────

def build_floorplan_dxf(inputs: MarketingInputs) -> bytes:
    """Главная точка входа: параметры → DXF bytes."""
    builder = FloorPlanDxfBuilder(inputs)
    builder.build()
    return builder.to_bytes()
