"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ringFromFeature, projectRingToLocal, classifyParcel, type BBox } from "@/lib/gis";
import {
  fetchGisParcels, fetchGisNeighbors, fetchGisRedLines,
  importSiteContext, validateProject,
  type ProjectValidationResponse,
} from "@/lib/engine";

const ASTANA: [number, number] = [71.43, 51.13];
const MIN_FETCH_ZOOM = 13; // ниже — слишком много отводов

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

type Selected = {
  name: string;
  klass: string;
  floors: number;
  designation: string;   // распознанное назначение отвода
  isSocial: boolean;     // соцобъект — жилая посадка неприменима
};

export default function MapPage() {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState("Приблизьте карту и кликните участок");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [zone, setZone] = useState("");
  const [result, setResult] = useState<ProjectValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setData = useCallback((id: string, fc: GeoJSON.FeatureCollection) => {
    const src = mapRef.current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
  }, []);

  const refresh = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < MIN_FETCH_ZOOM) {
      setHint("Приблизьте карту, чтобы загрузить участки");
      setData("parcels", { type: "FeatureCollection", features: [] });
      setData("neighbors", { type: "FeatureCollection", features: [] });
      setData("redlines", { type: "FeatureCollection", features: [] });
      return;
    }
    const b = map.getBounds();
    const bbox: BBox = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    try {
      const [parcels, neighbors, redlines] = await Promise.all([
        fetchGisParcels(bbox), fetchGisNeighbors(bbox), fetchGisRedLines(bbox),
      ]);
      setData("parcels", parcels);
      setData("neighbors", neighbors);
      setData("redlines", redlines);
      setHint(`Участков в кадре: ${parcels.features.length}. Кликните участок.`);
    } catch (e) {
      setHint("GIS недоступен: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [setData]);

  const onParcelClick = useCallback(async (feat: GeoJSON.Feature) => {
    const ring = ringFromFeature(feat.geometry);
    if (!ring) return;
    setData("selected", { type: "FeatureCollection", features: [feat] });
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const floors = parseInt(String(props.floor ?? "").split(",")[0]) || 9;
    const klass = String(props.house_klass ?? "");
    const name = String(props.name ?? "Участок");
    const cls = classifyParcel(name);
    setSelected({ name, klass, floors, designation: cls.label, isSocial: cls.isSocial });
    setResult(null); setErr(null); setZone(""); setLoading(true);
    try {
      const ctx = await importSiteContext(ring);
      const { local, width, height } = projectRingToLocal(ring);
      const res = await validateProject({
        site_width_m: width, site_depth_m: height, site_polygon: local,
        floors, housing_class: klass, purpose: cls.purpose, max_coverage_pct: 50,
        studio_pct: 0.2, k1_pct: 0.4, k2_pct: 0.3, k3_pct: 0.1,
        red_lines: ctx.red_lines, neighbors: ctx.neighbor_buildings,
        functional_zone: ctx.functional_zone,
      });
      setZone(ctx.functional_zone);
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setData]);

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: OSM_STYLE,
      center: ASTANA,
      zoom: 14,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      map.addSource("neighbors", { type: "geojson", data: empty });
      map.addSource("redlines", { type: "geojson", data: empty });
      map.addSource("parcels", { type: "geojson", data: empty });
      map.addSource("selected", { type: "geojson", data: empty });

      map.addLayer({ id: "neighbors-fill", type: "fill", source: "neighbors",
        paint: { "fill-color": "#94a3b8", "fill-opacity": 0.35 } });
      map.addLayer({ id: "redlines-line", type: "line", source: "redlines",
        paint: { "line-color": "#dc2626", "line-width": 1.5, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.12 } });
      map.addLayer({ id: "parcels-line", type: "line", source: "parcels",
        paint: { "line-color": "#2563eb", "line-width": 1 } });
      map.addLayer({ id: "selected-line", type: "line", source: "selected",
        paint: { "line-color": "#16a34a", "line-width": 3 } });

      map.on("click", "parcels-fill", (e) => {
        if (e.features?.[0]) onParcelClick(e.features[0] as GeoJSON.Feature);
      });
      map.on("mouseenter", "parcels-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "parcels-fill", () => { map.getCanvas().style.cursor = ""; });
      map.on("moveend", refresh);
      setReady(true);
      refresh();
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [refresh, onParcelClick]);

  const s = result?.summary;
  const zoneState = zoneBuildability(zone, result);

  return (
    <div className="flex h-screen w-screen">
      <div ref={mapDiv} className="flex-1" />
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 text-sm">
        <h1 className="mb-1 text-lg font-semibold">Посадка на участок</h1>
        <p className="mb-3 text-xs text-gray-500">{ready ? hint : "Загрузка карты…"}</p>

        {selected && (
          <div className="mb-3 rounded-lg border border-gray-200 p-3">
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs text-gray-500">
              класс «{selected.klass || "—"}» · {selected.floors} эт.
            </div>
            <div className="mt-1 text-xs">
              <span className="text-gray-400">назначение отвода: </span>{selected.designation}
            </div>
            <div className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${zoneState.cls}`}>
              {zoneState.label}
            </div>
            {selected.isSocial && (
              <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                ⚠ Отвод выделен под соцобъект — жилая застройка тут неприменима.
                ТЭП ниже показаны как гипотеза «если бы здесь строили ЖК».
              </div>
            )}
          </div>
        )}

        {loading && <p className="text-blue-600">Считаю ТЭП и нормы…</p>}
        {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}

        {s && (
          <>
            <h2 className="mb-1 mt-2 font-medium">8 ТЭП</h2>
            <table className="w-full">
              <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:font-medium">
                <tr><td>Площадь территории</td><td>{fmt(s.site_area_m2)} м²</td></tr>
                <tr><td>Площадь застройки</td><td>{fmt(s.total_footprint_m2)} м²</td></tr>
                <tr><td>Процент застройки</td><td>{s.coverage_pct}%</td></tr>
                <tr><td>Строит. объём</td><td>{fmt(s.total_volume_m3)} м³</td></tr>
                <tr><td>Поэтажная площадь (GFA)</td><td>{fmt(s.total_floor_area_m2)} м²</td></tr>
                <tr><td>КИТ</td><td>{s.far}</td></tr>
                <tr><td>Озеленение</td><td>{fmt(s.green_area_m2)} м² ({s.green_pct}%)</td></tr>
              </tbody>
            </table>

            <h2 className="mb-1 mt-3 font-medium">
              Нормоконтроль
              <span className="ml-2 text-xs font-normal text-gray-500">
                ⛔{result.errors_count} ⚠️{result.warnings_count} ℹ️{result.infos_count}
              </span>
            </h2>
            {result.violations.length === 0 && <p className="text-green-700">Нарушений нет ✓</p>}
            <ul className="space-y-1">
              {result.violations.map((v, i) => (
                <li key={i} className={`rounded px-2 py-1 text-xs ${sevCls(v.severity)}`}>
                  {v.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function sevCls(sev: string): string {
  if (sev === "error") return "bg-red-50 text-red-700";
  if (sev === "warning") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}

function zoneBuildability(zone: string, res: ProjectValidationResponse | null): { label: string; cls: string } {
  if (!res) return { label: "—", cls: "bg-gray-100 text-gray-500" };
  const v = res.violations.find((x) => x.rule.startsWith("zoning"));
  if (v) return { label: `Зона «${zone}»: уточните ПДП`, cls: "bg-amber-100 text-amber-700" };
  if (zone) return { label: `Зона «${zone}»: жильё ОК`, cls: "bg-green-100 text-green-700" };
  return { label: "Зона не определена", cls: "bg-gray-100 text-gray-500" };
}
