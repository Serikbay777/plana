"""Phase 1 writer: хардкод 1-комнатной квартиры 6×4 м.

Цель — проверить end-to-end pipeline: Pydantic spec → ezdxf документ →
DXF bytes → HTTP-ответ → скачивание → открытие в AutoCAD без ошибок.

Геометрия фиксирована: спальня 2.5×4 м слева + гостиная-кухня 3.5×4 м
справа, разделённые перегородкой с дверью, входная дверь и окно.
Реальная раскладка из `ApartmentSpec` приедет в Phase 2.
"""

from __future__ import annotations

import datetime as _dt
import io

import ezdxf
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment
from ezdxf.layouts import Modelspace

from .schema import ApartmentSpec
from .template import (
    LAYERS, LW_TITLE, LW_WALL, LW_WALL_EXT,
    TEXT_HEIGHT_NOTE, TEXT_HEIGHT_ROOM_AREA, TEXT_HEIGHT_ROOM_LABEL,
    TEXT_HEIGHT_TITLE, TEXT_STYLE_FONT, TEXT_STYLE_NAME,
)


def build_apartment_dxf(spec: ApartmentSpec) -> bytes:
    """Сгенерировать DXF-байты пред-планировки квартиры.

    Phase 1: spec пока не используется для геометрии — writer выдаёт
    фиксированную 1-комн. 6×4 м. Возврат — UTF-8-кодированный текстовый
    DXF (формат R2010).
    """
    _ = spec  # Phase 2 начнёт читать поля

    doc = ezdxf.new(dxfversion="R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$LUNITS"] = 2   # десятичные единицы
    doc.header["$LUPREC"] = 0   # 0 знаков после запятой в линейных размерах

    _setup_layers(doc)
    _setup_text_style(doc)

    msp = doc.modelspace()
    _draw_phase1_apartment(msp)
    _draw_title_block(msp, project="ПРЕД-ПЛАНИРОВКА · 1-комн. ~24 м²")

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _setup_layers(doc: Drawing) -> None:
    for name, color in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=color)


def _setup_text_style(doc: Drawing) -> None:
    if TEXT_STYLE_NAME not in doc.styles:
        doc.styles.add(TEXT_STYLE_NAME, font=TEXT_STYLE_FONT)


# ---------------------------------------------------------------------------
# Геометрия Phase 1 (хардкод)
# ---------------------------------------------------------------------------


def _draw_phase1_apartment(msp: Modelspace) -> None:
    # ---- внешний контур: 6000 × 4000 мм ------------------------------------
    msp.add_lwpolyline(
        [(0, 0), (6000, 0), (6000, 4000), (0, 4000)],
        close=True,
        dxfattribs={"layer": "A-WALL-EXT", "lineweight": LW_WALL_EXT},
    )

    # ---- внутренняя перегородка x = 2500, разрыв 900 мм для двери ----------
    msp.add_line((2500, 0),    (2500, 1000),
                 dxfattribs={"layer": "A-WALL", "lineweight": LW_WALL})
    msp.add_line((2500, 1900), (2500, 4000),
                 dxfattribs={"layer": "A-WALL", "lineweight": LW_WALL})

    # дверь спальни — петля внизу, дуга открытия в гостиную
    msp.add_arc(
        center=(2500, 1000),
        radius=900,
        start_angle=0,
        end_angle=90,
        dxfattribs={"layer": "A-DOOR"},
    )
    msp.add_line((2500, 1000), (3400, 1000), dxfattribs={"layer": "A-DOOR"})

    # ---- входная дверь: символ внутри гостиной у точки (4000, 0) -----------
    # В Phase 3 будем пробивать настоящий проём в наружной стене.
    msp.add_arc(
        center=(4000, 0),
        radius=900,
        start_angle=0,
        end_angle=90,
        dxfattribs={"layer": "A-DOOR"},
    )
    msp.add_line((4000, 0), (4000, 900), dxfattribs={"layer": "A-DOOR"})

    # ---- окно на верхней стене: x = 4000 .. 5500 (1500 мм) -----------------
    msp.add_line((4000, 4000), (5500, 4000), dxfattribs={"layer": "A-WINDOW"})
    msp.add_line((4000, 3950), (5500, 3950), dxfattribs={"layer": "A-WINDOW"})
    msp.add_line((4000, 4000), (4000, 3950), dxfattribs={"layer": "A-WINDOW"})
    msp.add_line((5500, 4000), (5500, 3950), dxfattribs={"layer": "A-WINDOW"})

    # ---- подписи комнат ----------------------------------------------------
    _add_room_label(msp, x=1250, y=2300, name="Спальня",        area_m2=10.0)
    _add_room_label(msp, x=4250, y=2300, name="Гостиная-кухня", area_m2=14.0)


def _add_room_label(
    msp: Modelspace, *, x: float, y: float, name: str, area_m2: float,
) -> None:
    """Подпись комнаты: имя сверху, площадь снизу. Центрируется по (x, y)."""
    name_text = msp.add_text(
        name,
        dxfattribs={
            "layer": "A-TEXT",
            "style": TEXT_STYLE_NAME,
            "height": TEXT_HEIGHT_ROOM_LABEL,
        },
    )
    name_text.set_placement(
        (x, y + 100),
        align=TextEntityAlignment.MIDDLE_CENTER,
    )

    area_text = msp.add_text(
        f"{area_m2:.1f} м²",
        dxfattribs={
            "layer": "A-TEXT",
            "style": TEXT_STYLE_NAME,
            "height": TEXT_HEIGHT_ROOM_AREA,
        },
    )
    area_text.set_placement(
        (x, y - 250),
        align=TextEntityAlignment.MIDDLE_CENTER,
    )


def _draw_title_block(msp: Modelspace, *, project: str) -> None:
    """Простой штамп под планом — рамка + 2 строки текста."""
    x0, y0 = 0.0, -1200.0
    w, h = 4000.0, 800.0

    msp.add_lwpolyline(
        [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)],
        close=True,
        dxfattribs={"layer": "A-TITLE", "lineweight": LW_TITLE},
    )

    title = msp.add_text(
        project,
        dxfattribs={
            "layer": "A-TITLE",
            "style": TEXT_STYLE_NAME,
            "height": TEXT_HEIGHT_TITLE,
        },
    )
    title.set_placement((x0 + 200, y0 + h - 350), align=TextEntityAlignment.LEFT)

    today = _dt.date.today().isoformat()
    note = msp.add_text(
        f"plana · {today} · DRAFT (для доработки в AutoCAD)",
        dxfattribs={
            "layer": "A-TITLE",
            "style": TEXT_STYLE_NAME,
            "height": TEXT_HEIGHT_NOTE,
        },
    )
    note.set_placement((x0 + 200, y0 + 200), align=TextEntityAlignment.LEFT)
