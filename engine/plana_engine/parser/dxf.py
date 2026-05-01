"""DXF-парсер контура этажа (минимальная имплементация).

Стратегия для MVP:
1. Открыть DXF через `ezdxf`.
2. Найти первый замкнутый LWPOLYLINE / POLYLINE (предполагаем — это контур
   этажа). Если в файле несколько — берём самый большой по площади.
3. Извлечь вершины, нормализовать в начало координат (origin = bbox min).

Внутренние пустоты (атриумы, шахты) пока не учитываются — это в Этапе 2.
DWG не поддерживается напрямую (ezdxf читает только DXF), для DWG → DXF
заказчик должен сконвертировать в Autodesk DWG TrueView или Teigha.
"""

from __future__ import annotations

from pathlib import Path

from ..types import Point, Polygon


def parse_dxf(path: Path | str) -> Polygon:
    """Извлечь самый большой замкнутый полигон из DXF и вернуть `Polygon`."""
    try:
        import ezdxf
    except ImportError as e:
        raise RuntimeError("ezdxf is required for DXF parsing") from e

    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()

    candidates: list[list[tuple[float, float]]] = []

    for entity in msp.query("LWPOLYLINE POLYLINE"):
        try:
            if entity.dxftype() == "LWPOLYLINE":
                if not entity.closed:
                    continue
                pts = [(p[0], p[1]) for p in entity.get_points("xy")]
            else:  # POLYLINE
                if not entity.is_closed:
                    continue
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
        except Exception:
            continue
        if len(pts) >= 3:
            candidates.append(pts)

    if not candidates:
        raise ValueError(f"no closed polylines found in {path}")

    # выбираем самый большой по абсолютной площади (shoelace)
    def signed_area(pts: list[tuple[float, float]]) -> float:
        s = 0.0
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + [pts[0]]):
            s += x0 * y1 - x1 * y0
        return s / 2.0

    best = max(candidates, key=lambda p: abs(signed_area(p)))
    if signed_area(best) < 0:
        best = best[::-1]  # обеспечиваем CCW

    # нормализация: origin = bbox min
    xs = [p[0] for p in best]
    ys = [p[1] for p in best]
    ox, oy = min(xs), min(ys)
    normalized = [Point(x=x - ox, y=y - oy) for x, y in best]

    # убираем дубликат последней точки если есть
    if normalized and normalized[0].x == normalized[-1].x and normalized[0].y == normalized[-1].y:
        normalized = normalized[:-1]

    return Polygon(exterior=normalized, holes=[])
