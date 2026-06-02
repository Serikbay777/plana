"""Агрегатор количеств (QTO) из IFC → ведомость объёмов по элементам.

Читает Qto_*BaseQuantities, которые floorplan_ifc навешивает на каждый элемент
(стены/перекрытия/помещения/двери/окна), и сворачивает их в структурированную
ведомость BillOfQuantities: объёмы стен по толщинам, объём перекрытий, площади
помещений, количество и площадь дверей/окон.

Это слой 1 cost-движка: ГЕОМЕТРИЯ → ОБЪЁМЫ. Намеренно НЕ присваивает материалы
и цены — это делают следующие слои (ЭСН РК — расходность, ССЦ — цены). Здесь
только то, что строго выводится из геометрии модели.

Группировка стен по толщине — это будущий мост к материалам: несущие/противо-
пожарные (t>=0.30) обычно бетон/кирпич, перегородки (t<0.30) — иной материал и
иная расценка. Сейчас мы лишь РАЗДЕЛЯЕМ их по толщине, не называя материал.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# Порог толщины (м), выше которого стена считается несущей/конструктивной.
_STRUCTURAL_WALL_T = 0.30


class QtyLine(BaseModel):
    """Одна строка ведомости — агрегат по типу (и толщине) элемента."""

    key: str                    # человекочитаемый ключ строки, напр. "IfcWall t=0.40м"
    element_class: str          # IFC-класс: IfcWall / IfcSlab / IfcSpace / IfcDoor / IfcWindow
    unit: str                   # единица головного количества: "м³" | "м²" | "шт"
    count: int = 0              # число элементов в строке
    net_volume_m3: float = 0.0  # суммарный NetVolume (для стен/перекрытий)
    net_area_m2: float = 0.0    # площадь: боковая (стены) / пола (помещения) / проёма (двери-окна)
    quantity: float = 0.0       # головное количество в `unit`


class BillOfQuantities(BaseModel):
    """Ведомость объёмов работ, выведенная из геометрии IFC."""

    lines: list[QtyLine] = Field(default_factory=list)
    total_structural_volume_m3: float = 0.0   # перекрытия + несущие стены (t>=0.30)
    total_partition_volume_m3: float = 0.0     # перегородки (t<0.30)
    total_wall_side_area_m2: float = 0.0       # площадь стен (база для отделки)
    total_floor_area_m2: float = 0.0           # сумма NetFloorArea помещений
    door_count: int = 0
    window_count: int = 0


def aggregate_quantities(model: Any) -> BillOfQuantities:
    """Свернуть Qto_*BaseQuantities всех элементов модели в BillOfQuantities."""
    from ifcopenshell.util.element import get_psets

    boq = BillOfQuantities()

    # ── стены: группируем по толщине (округлённой до 1 см) ──
    wall_buckets: dict[float, QtyLine] = {}
    for wall in model.by_type("IfcWall"):
        q = get_psets(wall, qtos_only=True).get("Qto_WallBaseQuantities")
        if not q:
            continue
        t = round(float(q.get("Width", 0.0)), 2)
        vol = float(q.get("NetVolume", 0.0))
        side = float(q.get("NetSideArea", 0.0))

        line = wall_buckets.get(t)
        if line is None:
            line = QtyLine(key=f"IfcWall t={t:.2f}м", element_class="IfcWall", unit="м³")
            wall_buckets[t] = line
        line.count += 1
        line.net_volume_m3 += vol
        line.net_area_m2 += side
        line.quantity = round(line.net_volume_m3, 3)

        if t >= _STRUCTURAL_WALL_T:
            boq.total_structural_volume_m3 += vol
        else:
            boq.total_partition_volume_m3 += vol
        boq.total_wall_side_area_m2 += side

    # ── перекрытия ──
    slab_line = QtyLine(key="IfcSlab", element_class="IfcSlab", unit="м³")
    for slab in model.by_type("IfcSlab"):
        q = get_psets(slab, qtos_only=True).get("Qto_SlabBaseQuantities")
        if not q:
            continue
        vol = float(q.get("NetVolume", 0.0))
        slab_line.count += 1
        slab_line.net_volume_m3 += vol
        slab_line.net_area_m2 += float(q.get("NetArea", 0.0))
        boq.total_structural_volume_m3 += vol
    slab_line.quantity = round(slab_line.net_volume_m3, 3)

    # ── помещения (для площадных метрик / УПСС) ──
    space_line = QtyLine(key="IfcSpace", element_class="IfcSpace", unit="м²")
    for sp in model.by_type("IfcSpace"):
        q = get_psets(sp, qtos_only=True).get("Qto_SpaceBaseQuantities")
        if not q:
            continue
        area = float(q.get("NetFloorArea", 0.0))
        space_line.count += 1
        space_line.net_area_m2 += area
        space_line.net_volume_m3 += float(q.get("NetVolume", 0.0))
        boq.total_floor_area_m2 += area
    space_line.quantity = round(space_line.net_area_m2, 3)

    # ── двери / окна (штуки + площадь проёма) ──
    door_line = QtyLine(key="IfcDoor", element_class="IfcDoor", unit="шт")
    for d in model.by_type("IfcDoor"):
        q = get_psets(d, qtos_only=True).get("Qto_DoorBaseQuantities") or {}
        door_line.count += 1
        door_line.net_area_m2 += float(q.get("Area", 0.0))
    door_line.quantity = float(door_line.count)
    boq.door_count = door_line.count

    win_line = QtyLine(key="IfcWindow", element_class="IfcWindow", unit="шт")
    for w in model.by_type("IfcWindow"):
        q = get_psets(w, qtos_only=True).get("Qto_WindowBaseQuantities") or {}
        win_line.count += 1
        win_line.net_area_m2 += float(q.get("Area", 0.0))
    win_line.quantity = float(win_line.count)
    boq.window_count = win_line.count

    # ── собрать строки (стены — по убыванию объёма; пустые пропускаем) ──
    lines = sorted(wall_buckets.values(), key=lambda ln: -ln.net_volume_m3)
    for ln in (slab_line, space_line, door_line, win_line):
        if ln.count:
            lines.append(ln)
    boq.lines = lines

    boq.total_structural_volume_m3 = round(boq.total_structural_volume_m3, 3)
    boq.total_partition_volume_m3 = round(boq.total_partition_volume_m3, 3)
    boq.total_wall_side_area_m2 = round(boq.total_wall_side_area_m2, 3)
    boq.total_floor_area_m2 = round(boq.total_floor_area_m2, 3)
    return boq


def quantities_from_ifc(ifc: Any) -> BillOfQuantities:
    """Принять ifcopenshell.file ИЛИ IFC-bytes/str и вернуть ведомость объёмов."""
    import ifcopenshell

    if isinstance(ifc, (bytes, bytearray)):
        model = ifcopenshell.file.from_string(bytes(ifc).decode("utf-8"))
    elif isinstance(ifc, str):
        model = ifcopenshell.file.from_string(ifc)
    else:
        model = ifc
    return aggregate_quantities(model)
