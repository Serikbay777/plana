"""DXF import summary for P2 CAD-import MVP.

The importer intentionally starts conservative: it reads ASCII DXF through
`ezdxf`, extracts document/layer/entity metadata, computes a practical 2D
bounding box for common floor-plan entities, and emits a small preview payload.

It does not yet convert CAD entities into semantic Rooms/Walls/Doors. That is
the P5/P6 layer once the model and editor are ready.
"""

from __future__ import annotations

import io
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .._platform import avoid_windows_wmi_platform_probe

avoid_windows_wmi_platform_probe()

import ezdxf
from ezdxf.lldxf.const import DXFError


class DxfImportError(RuntimeError):
    """Raised when a DXF cannot be decoded or parsed."""


@dataclass
class DxfBounds:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        return self.max_y - self.min_y

    def to_dict(self) -> dict[str, float]:
        return {
            "min_x": round(self.min_x, 4),
            "min_y": round(self.min_y, 4),
            "max_x": round(self.max_x, 4),
            "max_y": round(self.max_y, 4),
            "width": round(self.width, 4),
            "height": round(self.height, 4),
        }


@dataclass
class DxfLayerSummary:
    name: str
    entity_count: int
    color: int | None
    linetype: str | None
    is_off: bool
    is_frozen: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "entity_count": self.entity_count,
            "color": self.color,
            "linetype": self.linetype,
            "is_off": self.is_off,
            "is_frozen": self.is_frozen,
        }


@dataclass
class DxfImportSummary:
    filename: str
    dxf_version: str
    units: int | None
    units_name: str
    entity_count: int
    layer_count: int
    layers: list[DxfLayerSummary]
    entity_types: dict[str, int]
    bounds: DxfBounds | None
    preview_entities: list[dict[str, Any]]
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "dxf_version": self.dxf_version,
            "units": self.units,
            "units_name": self.units_name,
            "entity_count": self.entity_count,
            "layer_count": self.layer_count,
            "layers": [layer.to_dict() for layer in self.layers],
            "entity_types": self.entity_types,
            "bounds": self.bounds.to_dict() if self.bounds else None,
            "preview_entities": self.preview_entities,
            "warnings": self.warnings,
        }


class _BoundsBuilder:
    def __init__(self) -> None:
        self.min_x = math.inf
        self.min_y = math.inf
        self.max_x = -math.inf
        self.max_y = -math.inf

    def add_point(self, x: float, y: float) -> None:
        self.min_x = min(self.min_x, x)
        self.min_y = min(self.min_y, y)
        self.max_x = max(self.max_x, x)
        self.max_y = max(self.max_y, y)

    def add_circle(self, x: float, y: float, r: float) -> None:
        self.add_point(x - r, y - r)
        self.add_point(x + r, y + r)

    def finish(self) -> DxfBounds | None:
        if not math.isfinite(self.min_x):
            return None
        return DxfBounds(self.min_x, self.min_y, self.max_x, self.max_y)


_UNITS: dict[int, str] = {
    0: "Unitless",
    1: "Inches",
    2: "Feet",
    3: "Miles",
    4: "Millimeters",
    5: "Centimeters",
    6: "Meters",
    7: "Kilometers",
    8: "Microinches",
    9: "Mils",
    10: "Yards",
    11: "Angstroms",
    12: "Nanometers",
    13: "Microns",
    14: "Decimeters",
}


def inspect_dxf(dxf_bytes: bytes, *, filename: str = "upload.dxf") -> DxfImportSummary:
    """Parse a DXF file and return a compact CAD-import summary."""
    if not dxf_bytes:
        raise DxfImportError("empty DXF")
    if dxf_bytes[:22] == b"AutoCAD Binary DXF\r\n\x1a\x00":
        raise DxfImportError("binary DXF is not supported in P2 MVP; save as ASCII DXF")

    text = _decode_dxf_text(dxf_bytes)
    try:
        doc = ezdxf.read(io.StringIO(text))
    except DXFError as e:
        raise DxfImportError(f"DXF parse failed: {e}") from e
    except Exception as e:
        raise DxfImportError(f"DXF import failed: {e}") from e

    msp = doc.modelspace()
    entities = list(msp)
    layer_entity_counts: Counter[str] = Counter()
    entity_types: Counter[str] = Counter()
    bounds = _BoundsBuilder()
    preview_entities: list[dict[str, Any]] = []
    warning_counts: Counter[str] = Counter()

    for entity in entities:
        dxftype = entity.dxftype()
        layer = _safe_layer(entity)
        layer_entity_counts[layer] += 1
        entity_types[dxftype] += 1
        try:
            preview = _inspect_entity(entity, bounds)
            if preview and len(preview_entities) < 700:
                preview_entities.append(preview)
        except Exception:
            warning_counts[dxftype] += 1

    known_preview = {"LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC"}
    unsupported = {
        dxftype: count
        for dxftype, count in entity_types.items()
        if dxftype not in known_preview
    }
    warnings: list[str] = []
    if unsupported:
        top = ", ".join(
            f"{name}x{count}"
            for name, count in sorted(unsupported.items(), key=lambda item: (-item[1], item[0]))[:8]
        )
        warnings.append(f"Preview is simplified for unsupported entities: {top}")
    if warning_counts:
        top = ", ".join(f"{name}x{count}" for name, count in warning_counts.items())
        warnings.append(f"Some entities could not be inspected for bounds: {top}")
    if len(preview_entities) >= 700:
        warnings.append("Preview was truncated to 700 entities for UI responsiveness")

    units = int(getattr(doc, "units", 0) or 0)
    layer_table = {layer.dxf.name: layer for layer in doc.layers}
    layers = [
        _summarize_layer(name, layer_entity_counts[name], layer_table.get(name))
        for name in sorted(layer_entity_counts)
    ]

    return DxfImportSummary(
        filename=filename,
        dxf_version=doc.dxfversion,
        units=units,
        units_name=_UNITS.get(units, f"Unknown ({units})"),
        entity_count=len(entities),
        layer_count=len(layers),
        layers=layers,
        entity_types=dict(sorted(entity_types.items())),
        bounds=bounds.finish(),
        preview_entities=preview_entities,
        warnings=warnings,
    )


def _decode_dxf_text(dxf_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1251", "cp1252", "latin-1"):
        try:
            return dxf_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DxfImportError("cannot decode DXF text")


def _safe_layer(entity: Any) -> str:
    return str(getattr(entity.dxf, "layer", "0") or "0")


def _summarize_layer(name: str, count: int, layer: Any | None) -> DxfLayerSummary:
    if layer is None:
        return DxfLayerSummary(
            name=name,
            entity_count=count,
            color=None,
            linetype=None,
            is_off=False,
            is_frozen=False,
        )
    return DxfLayerSummary(
        name=name,
        entity_count=count,
        color=int(getattr(layer.dxf, "color", 7) or 7),
        linetype=str(getattr(layer.dxf, "linetype", "CONTINUOUS") or "CONTINUOUS"),
        is_off=bool(layer.is_off()),
        is_frozen=bool(layer.is_frozen()),
    )


def _inspect_entity(entity: Any, bounds: _BoundsBuilder) -> dict[str, Any] | None:
    dxftype = entity.dxftype()
    layer = _safe_layer(entity)

    if dxftype == "LINE":
        start = entity.dxf.start
        end = entity.dxf.end
        bounds.add_point(float(start.x), float(start.y))
        bounds.add_point(float(end.x), float(end.y))
        return {
            "type": "line",
            "layer": layer,
            "points": [[round(float(start.x), 4), round(float(start.y), 4)],
                       [round(float(end.x), 4), round(float(end.y), 4)]],
        }

    if dxftype == "LWPOLYLINE":
        points = [[float(x), float(y)] for x, y, *_ in entity.get_points("xy")]
        for x, y in points:
            bounds.add_point(x, y)
        return _polyline_preview(layer, points, bool(entity.closed))

    if dxftype == "POLYLINE":
        points = [[float(v.dxf.location.x), float(v.dxf.location.y)] for v in entity.vertices]
        for x, y in points:
            bounds.add_point(x, y)
        return _polyline_preview(layer, points, bool(entity.is_closed))

    if dxftype == "CIRCLE":
        center = entity.dxf.center
        radius = float(entity.dxf.radius)
        bounds.add_circle(float(center.x), float(center.y), radius)
        return {
            "type": "circle",
            "layer": layer,
            "center": [round(float(center.x), 4), round(float(center.y), 4)],
            "radius": round(radius, 4),
        }

    if dxftype == "ARC":
        center = entity.dxf.center
        radius = float(entity.dxf.radius)
        bounds.add_circle(float(center.x), float(center.y), radius)
        return {
            "type": "circle",
            "layer": layer,
            "center": [round(float(center.x), 4), round(float(center.y), 4)],
            "radius": round(radius, 4),
            "arc": True,
        }

    point = _representative_point(entity)
    if point is not None:
        bounds.add_point(point[0], point[1])
    return None


def _polyline_preview(layer: str, points: list[list[float]], closed: bool) -> dict[str, Any] | None:
    if not points:
        return None
    return {
        "type": "polyline",
        "layer": layer,
        "closed": closed,
        "points": [[round(x, 4), round(y, 4)] for x, y in points],
    }


def _representative_point(entity: Any) -> tuple[float, float] | None:
    for attr in ("insert", "location", "center"):
        if hasattr(entity.dxf, attr):
            point = getattr(entity.dxf, attr)
            return float(point.x), float(point.y)
    for attr in ("vtx0", "vtx1", "vtx2", "vtx3"):
        if hasattr(entity.dxf, attr):
            point = getattr(entity.dxf, attr)
            return float(point.x), float(point.y)
    return None


__all__ = [
    "DxfBounds",
    "DxfImportError",
    "DxfImportSummary",
    "DxfLayerSummary",
    "inspect_dxf",
]
