"""Импорт контекста участка из ArcGIS «GIS Saulet» (gis.esaulet.kz, Астана).

Закрывает вход №1 reorganizing.md — «план участка с прилежащими строениями,
дорогами/проездами, красными линиями». По bbox участка тянет из открытого
ArcGIS REST соседние объекты и проецирует их в ЛОКАЛЬНЫЙ метрический фрейм
участка (тот же, что у доменной модели: origin = нижний-левый угол bbox,
метры), чтобы геометрию можно было сравнивать с пятном застройки.

Источник (сервис `Открытый_контур`, проверено 2026-06-11):
    [15] Существующие здания   — соседние строения (polygon)
    [27] Проезжая часть        — дороги/проезды (polygon)
    [5]  Красные линии существующие — красные линии (polyline)

Анонимный доступ, без ключа. Проекция — равнопромежуточная на широте участка
(достаточно точно для соседского масштаба ≲ 1 км).
"""

from __future__ import annotations

import json
import math
import re
import ssl
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from shapely.geometry import LineString, Polygon

_SERVICE = "Открытый_контур"
_BASE = (
    "https://gis.esaulet.kz/server/rest/services/"
    + urllib.parse.quote(_SERVICE) + "/MapServer"
)

# id слоя ArcGIS → ключ результата
_LAYERS: dict[str, int] = {
    "neighbor_buildings": 15,  # Существующие здания (polygon)
    "roads": 27,               # Проезжая часть (polygon)
    "red_lines": 5,            # Красные линии существующие (polyline)
}
_ZONE_LAYER = 6  # Градостроительный регламент (функциональная зона по точке)
_PDP_BUILDINGS_LAYER = 7  # «Здания (ПДП)» — запланированные здания + этажность (FLOOR)

_EARTH_LAT_M = 110574.0  # метров на градус широты
_EARTH_LON_M = 111320.0  # метров на градус долготы на экваторе


class SiteContextError(RuntimeError):
    """Не удалось получить контекст участка из GIS."""


@dataclass
class SiteContext:
    """Окружение участка в ЛОКАЛЬНЫХ метрах (origin = bbox-min участка).

    neighbor_buildings / roads — shapely Polygon; red_lines — LineString.
    counts — сколько фич пришло по каждому слою (для диагностики/UI).
    """

    neighbor_buildings: list[Polygon] = field(default_factory=list)
    roads: list[Polygon] = field(default_factory=list)
    red_lines: list[LineString] = field(default_factory=list)
    functional_zone: str = ""   # «Жилая»/«Коммерческая»/«Социальная»/«Иная» (Градрегламент)
    pdp_floors: list[str] = field(default_factory=list)  # этажность по ПДП (как в ГИС, напр. «9», «7,9,12»)
    pdp_floors_max: int | None = None                    # максимальная этажность по ПДП
    counts: dict[str, int] = field(default_factory=dict)


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _query(layer_id: int, envelope: str, ctx: ssl.SSLContext, timeout: float) -> list[dict]:
    """Запросить фичи слоя в bbox-конверте (WGS84). Вернуть raw-геометрии."""
    params = {
        "where": "1=1",
        "geometry": envelope,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true", "geometryPrecision": "6",
        "outFields": "", "f": "json",
    }
    url = f"{_BASE}/{layer_id}/query?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=ctx) as resp:
            data = json.load(resp)
    except Exception as e:  # noqa: BLE001
        raise SiteContextError(f"слой {layer_id}: запрос упал: {e}") from e
    if "error" in data:
        raise SiteContextError(f"слой {layer_id}: {data['error']}")
    return data.get("features", [])


def fetch_site_context(
    parcel_ring_wgs84: list[list[float]],
    *,
    radius_m: float = 150.0,
    timeout: float = 60.0,
) -> SiteContext:
    """Получить окружение участка из GIS в локальных метрах участка.

    parcel_ring_wgs84 — кольцо участка [[lon, lat], ...] (как из API отводов).
    radius_m — насколько расширить bbox участка для поиска соседей.
    """
    if not parcel_ring_wgs84 or len(parcel_ring_wgs84) < 3:
        raise SiteContextError("нужно кольцо участка из ≥3 точек (WGS84)")

    lons = [p[0] for p in parcel_ring_wgs84]
    lats = [p[1] for p in parcel_ring_wgs84]
    lon0, lat0 = min(lons), min(lats)
    kx = _EARTH_LON_M * math.cos(math.radians(lat0))
    ky = _EARTH_LAT_M

    # bbox участка + буфер радиуса (в градусах)
    dlon = radius_m / kx
    dlat = radius_m / ky
    envelope = "{0},{1},{2},{3}".format(
        min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat
    )

    def to_local(pt: list[float]) -> tuple[float, float]:
        return ((pt[0] - lon0) * kx, (pt[1] - lat0) * ky)

    ctx = _ssl_ctx()
    out = SiteContext()

    # полигональные слои: rings → Polygon (берём внешнее кольцо)
    for key in ("neighbor_buildings", "roads"):
        feats = _query(_LAYERS[key], envelope, ctx, timeout)
        polys: list[Polygon] = []
        for f in feats:
            rings = (f.get("geometry") or {}).get("rings") or []
            if rings:
                poly = Polygon([to_local(pt) for pt in rings[0]])
                if poly.is_valid and poly.area > 0:
                    polys.append(poly)
        getattr(out, key).extend(polys)
        out.counts[key] = len(polys)

    # полилинейный слой: paths → LineString
    feats = _query(_LAYERS["red_lines"], envelope, ctx, timeout)
    lines: list[LineString] = []
    for f in feats:
        for path in (f.get("geometry") or {}).get("paths") or []:
            if len(path) >= 2:
                lines.append(LineString([to_local(pt) for pt in path]))
    out.red_lines.extend(lines)
    out.counts["red_lines"] = len(lines)

    # функциональная зона участка — точечный запрос по центроиду (WGS84)
    cx = sum(lons) / len(lons)
    cy = sum(lats) / len(lats)
    params = {
        "where": "1=1", "geometry": f"{cx},{cy}",
        "geometryType": "esriGeometryPoint", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "false", "outFields": "ZONE_",
        "resultRecordCount": "1", "f": "json",
    }
    url = f"{_BASE}/{_ZONE_LAYER}/query?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=ctx) as resp:
            zdata = json.load(resp)
        zfeats = zdata.get("features", [])
        if zfeats:
            out.functional_zone = (zfeats[0].get("attributes") or {}).get("ZONE_", "") or ""
    except Exception:  # noqa: BLE001 — зона необязательна, не валим весь контекст
        out.functional_zone = ""

    # этажность по ПДП — слой 7 «Здания (ПДП)»: здания, попадающие в контур участка.
    # Достоверный источник этажности (план города), особенно для пустых участков,
    # где у самого отвода поле floor не заполнено.
    try:
        parcel_poly = Polygon([(p[0], p[1]) for p in parcel_ring_wgs84])
        poly = json.dumps({"rings": [[[p[0], p[1]] for p in parcel_ring_wgs84]]})
        pparams = {
            "where": "1=1", "geometry": poly,
            "geometryType": "esriGeometryPolygon", "inSR": "4326", "outSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "returnGeometry": "true", "geometryPrecision": "6", "outFields": "FLOOR",
            "resultRecordCount": "50", "f": "json",
        }
        purl = f"{_BASE}/{_PDP_BUILDINGS_LAYER}/query?" + urllib.parse.urlencode(pparams)
        with urllib.request.urlopen(purl, timeout=timeout, context=ctx) as resp:
            pdata = json.load(resp)
        seen: list[str] = []
        nums: list[int] = []
        for f in pdata.get("features", []):
            rings = (f.get("geometry") or {}).get("rings") or []
            if not rings:
                continue
            try:
                centroid = Polygon(rings[0]).centroid
            except Exception:  # noqa: BLE001 — битая геометрия здания, пропускаем
                continue
            # только здания, чей ЦЕНТР внутри участка — иначе ловим соседей
            if not parcel_poly.contains(centroid):
                continue
            raw = str((f.get("attributes") or {}).get("FLOOR", "") or "").strip()
            if not raw:
                continue
            if raw not in seen:
                seen.append(raw)
            nums.extend(int(m) for m in re.findall(r"\d+", raw))
        out.pdp_floors = seen
        out.pdp_floors_max = max(nums) if nums else None
    except Exception:  # noqa: BLE001 — ПДП необязателен, не валим контекст
        pass

    return out


_OTVODY_URL = (
    "https://gis.esaulet.kz/server/rest/services/"
    "Hosted/Zemelnye_otvody_GU/FeatureServer/0/query"
)


def _fetch_geojson(query_url: str, bbox: tuple[float, float, float, float],
                   out_fields: str, limit: int, timeout: float = 60.0) -> dict:
    """Прокси geojson-запроса к GIS (server-side, обходит CORS/SSL браузера)."""
    west, south, east, north = bbox
    params = {
        "where": "1=1", "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true",
        "f": "geojson", "outFields": out_fields, "resultRecordCount": str(limit),
    }
    url = query_url + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=_ssl_ctx()) as resp:
            return json.load(resp)
    except Exception as e:  # noqa: BLE001
        raise SiteContextError(f"GIS geojson запрос упал: {e}") from e


def _esri_to_geojson(data: dict) -> dict:
    """ArcGIS JSON (rings + attributes) → GeoJSON FeatureCollection."""
    feats = []
    for f in data.get("features", []):
        rings = (f.get("geometry") or {}).get("rings")
        geom = {"type": "Polygon", "coordinates": rings} if rings else None
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": f.get("attributes", {})})
    return {"type": "FeatureCollection", "features": feats}


def fetch_parcels_geojson(bbox, limit: int = 500) -> dict:
    # FeatureServer отдаёт HTML-ошибку на f=geojson с этим набором полей —
    # тянем f=json (надёжно) и конвертим в GeoJSON сами.
    west, south, east, north = bbox
    params = {
        "where": "1=1", "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true",
        "geometryPrecision": "6", "f": "json",
        # name/класс/этаж/квартиры/площадь — для ТЭП; owner/target/stadia/
        # cadastral_number/address — «кому принадлежит» и стадия освоения (панель).
        "outFields": "name,house_klass,floor,apart,house_area,"
                     "owner,target,stadia,cadastral_number,address,"
                     # фактические ТЭП проекта на отводе (этажность/площади/парковка)
                     "living_area,namber_parcing,real_otvod_pol_area",
        "resultRecordCount": str(limit),
    }
    url = _OTVODY_URL + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=60, context=_ssl_ctx()) as resp:
            data = json.load(resp)
    except Exception as e:  # noqa: BLE001
        raise SiteContextError(f"GIS отводы запрос упал: {e}") from e
    if "error" in data:
        raise SiteContextError(f"GIS отводы: {data['error']}")
    return _esri_to_geojson(data)


def _fetch_polygons_json(query_url: str, bbox, limit: int, timeout: float = 90.0) -> dict:
    """f=json + ручная конвертация в GeoJSON (как для отводов).

    На MapServer «Открытый_контур» формат f=geojson нестабилен — на средних
    выборках (≈>1k фич) отдаёт «Failed to execute query», тогда как f=json тот же
    bbox возвращает корректно. maxRecordCount слоя = 2000.
    """
    west, south, east, north = bbox
    params = {
        "where": "1=1", "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true",
        "geometryPrecision": "6", "f": "json", "outFields": "",
        "resultRecordCount": str(limit),
    }
    url = query_url + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=_ssl_ctx()) as resp:
            data = json.load(resp)
    except Exception as e:  # noqa: BLE001
        raise SiteContextError(f"GIS json запрос упал: {e}") from e
    if "error" in data:
        raise SiteContextError(f"GIS json: {data['error']}")
    return _esri_to_geojson(data)


def fetch_neighbors_geojson(bbox, limit: int = 2000) -> dict:
    # Слой «Существующие здания» нужен и для отметки «отвод застроен/свободен» —
    # нужна полнота зданий в кадре. f=json (а не geojson) ради надёжности.
    return _fetch_polygons_json(f"{_BASE}/{_LAYERS['neighbor_buildings']}/query", bbox, limit)


def fetch_redlines_geojson(bbox, limit: int = 500) -> dict:
    return _fetch_geojson(f"{_BASE}/{_LAYERS['red_lines']}/query", bbox, "", limit)


__all__ = [
    "SiteContext", "SiteContextError", "fetch_site_context",
    "fetch_parcels_geojson", "fetch_neighbors_geojson", "fetch_redlines_geojson",
]
