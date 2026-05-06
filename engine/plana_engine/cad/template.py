"""Константы DXF-шаблона: слои AIA, единицы, текстовые стили.

Слои — упрощённый AIA CAD Layer Guidelines (residential).
Единицы — миллиметры (`$INSUNITS = 4`).
Текстовый стиль `PLANA` использует Arial TTF — корректно отображает
кириллицу в AutoCAD / BricsCAD.
"""

from __future__ import annotations


# Слои: имя → ACI цвет (1=red, 2=yellow, 3=green, 4=cyan, 5=blue, 7=white/black, 9=light grey).
LAYERS: dict[str, int] = {
    "A-WALL-EXT": 1,    # наружные несущие стены
    "A-WALL":     7,    # внутренние перегородки
    "A-DOOR":     5,    # двери
    "A-WINDOW":   4,    # окна
    "A-AREA":     9,    # площади / штриховки
    "A-TEXT":     3,    # подписи комнат
    "A-DIMS":     2,    # размерные цепи
    "A-TITLE":    7,    # рамка штампа
}

TEXT_STYLE_NAME = "PLANA"
TEXT_STYLE_FONT = "arial.ttf"  # AutoCAD подставит fallback при отсутствии

# Высоты текста (мм @ 1:1 в модельном пространстве).
TEXT_HEIGHT_ROOM_LABEL = 250
TEXT_HEIGHT_ROOM_AREA  = 180
TEXT_HEIGHT_TITLE      = 220
TEXT_HEIGHT_NOTE       = 140

# Толщины линий в DXF (units = 0.01 mm). Стандартные значения ISO.
LW_WALL_EXT = 50   # 0.50 mm
LW_WALL     = 25   # 0.25 mm
LW_TITLE    = 35   # 0.35 mm
