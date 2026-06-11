"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken } from "@/lib/auth";
import { createProject, listProjects, getProject, type Project } from "@/lib/projects";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ringFromFeature, projectRingToLocal, localToWgs84, classifyParcel,
  type BBox, type EnginePurpose, type ProjOrigin,
} from "@/lib/gis";
import {
  fetchGisParcels, fetchGisNeighbors, fetchGisRedLines,
  importSiteContext, validateProject,
  type ProjectValidationResponse, type SiteContext,
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

// Кэш выбранного участка (геометрия + контекст GIS) — чтобы правки параметров
// пересчитывали ТЭП БЕЗ повторных запросов в GIS.
type SelCtx = {
  name: string;
  designation: string;
  isSocial: boolean;
  ringWgs84: [number, number][];
  local: [number, number][];
  width: number;
  height: number;
  proj: ProjOrigin;
  ctx: SiteContext;
};

// Редактируемые пользователем параметры посадки (мгновенный пересчёт).
type EditParams = {
  housing_class: string;
  purpose: EnginePurpose;
  max_coverage_pct: number;
  floors: number;
};

const CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "standard", label: "стандарт" },
  { value: "comfort", label: "комфорт" },
  { value: "comfort_plus", label: "комфорт+" },
  { value: "business", label: "бизнес" },
  { value: "premium", label: "премиум" },
];

export default function MapPage() {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState("Приблизьте карту и кликните участок");
  const [sel, setSel] = useState<SelCtx | null>(null);
  const [params, setParams] = useState<EditParams | null>(null);
  const [zone, setZone] = useState("");
  const [result, setResult] = useState<ProjectValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [gisLoading, setGisLoading] = useState(false);
  const [saved, setSaved] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);

  const setData = useCallback((id: string, fc: GeoJSON.FeatureCollection) => {
    const src = mapRef.current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
  }, []);

  const refresh = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    if (!getToken()) { setAuthNeeded(true); setHint("Нужен вход в систему"); return; }
    if (map.getZoom() < MIN_FETCH_ZOOM) {
      setHint("Приблизьте карту, чтобы загрузить участки");
      setData("parcels", { type: "FeatureCollection", features: [] });
      setData("neighbors", { type: "FeatureCollection", features: [] });
      setData("redlines", { type: "FeatureCollection", features: [] });
      return;
    }
    const b = map.getBounds();
    const bbox: BBox = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    setGisLoading(true);
    try {
      const [parcels, neighbors, redlines] = await Promise.all([
        fetchGisParcels(bbox), fetchGisNeighbors(bbox), fetchGisRedLines(bbox),
      ]);
      setData("parcels", parcels);
      setData("neighbors", neighbors);
      setData("redlines", redlines);
      setHint(`Участков в кадре: ${parcels.features.length}. Кликните участок.`);
    } catch (e) {
      if (isAuthError(e)) { setAuthNeeded(true); setHint("Нужен вход в систему"); }
      else setHint("GIS недоступен: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGisLoading(false);
    }
  }, [setData]);

  const onParcelClick = useCallback(async (feat: GeoJSON.Feature) => {
    const ring = ringFromFeature(feat.geometry);
    if (!ring) return;
    setData("selected", { type: "FeatureCollection", features: [feat] });
    setData("footprint", { type: "FeatureCollection", features: [] });
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const floors = parseInt(String(props.floor ?? "").split(",")[0]) || 9;
    const klass = String(props.house_klass ?? "");
    const name = String(props.name ?? "Участок");
    const cls = classifyParcel(name);
    setResult(null); setErr(null); setZone(""); setLoading(true);
    try {
      const ctx = await importSiteContext(ring);
      const pr = projectRingToLocal(ring);
      // дефолты параметров из отвода; ТЭП посчитает эффект ниже
      setSel({
        name, designation: cls.label, isSocial: cls.isSocial, ringWgs84: ring,
        local: pr.local, width: pr.width, height: pr.height,
        proj: { lon0: pr.lon0, lat0: pr.lat0, kx: pr.kx, ky: pr.ky }, ctx,
      });
      setParams({
        housing_class: normalizeClass(klass),
        purpose: cls.purpose,
        max_coverage_pct: 50,
        floors,
      });
      setZone(ctx.functional_zone);
    } catch (e) {
      if (isAuthError(e)) setAuthNeeded(true);
      else setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [setData]);

  // Пересчёт ТЭП при выборе участка или правке параметров — БЕЗ запросов в GIS.
  useEffect(() => {
    if (!sel || !params) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    validateProject({
      site_width_m: sel.width, site_depth_m: sel.height, site_polygon: sel.local,
      floors: params.floors, housing_class: params.housing_class, purpose: params.purpose,
      max_coverage_pct: params.max_coverage_pct,
      studio_pct: 0.2, k1_pct: 0.4, k2_pct: 0.3, k3_pct: 0.1,
      red_lines: sel.ctx.red_lines, neighbors: sel.ctx.neighbor_buildings,
      functional_zone: sel.ctx.functional_zone,
    })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        // обратная проекция пятен застройки → WGS84 → на карту
        const fps = r.summary.footprints_local ?? [];
        setData("footprint", {
          type: "FeatureCollection",
          features: fps.map((ring) => ({
            type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [localToWgs84(ring, sel.proj)] },
          })),
        });
      })
      .catch((e) => {
        if (cancelled) return;
        if (isAuthError(e)) setAuthNeeded(true);
        else setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sel, params, setData]);

  const loadSavedList = useCallback(async () => {
    try {
      const all = await listProjects();
      setSaved(all.filter((p) => (p.params as Record<string, unknown>)?.kind === "posadka"));
    } catch { /* список не критичен */ }
  }, []);

  const saveProject = useCallback(async () => {
    if (!sel || !params || !result) return;
    setSaving(true); setErr(null);
    try {
      await createProject(sel.name.slice(0, 80) || "Участок", {
        kind: "posadka",
        parcel: {
          name: sel.name, designation: sel.designation, isSocial: sel.isSocial,
          ringWgs84: sel.ringWgs84, functionalZone: zone,
        },
        params,
        ctx: sel.ctx,
        tep: result.summary,
        savedAt: new Date().toISOString(),
      });
      await loadSavedList();
    } catch (e) {
      if (isAuthError(e)) setAuthNeeded(true);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [sel, params, result, zone, loadSavedList]);

  const loadProject = useCallback(async (id: string) => {
    setErr(null); setLoading(true);
    try {
      const p = await getProject(id);
      const d = p.params as Record<string, unknown> & {
        kind?: string; parcel?: { name: string; designation: string; isSocial: boolean; ringWgs84: [number, number][]; functionalZone: string };
        params?: EditParams; ctx?: SiteContext;
      };
      if (d?.kind !== "posadka" || !d.parcel?.ringWgs84) { setErr("Это не посадочный проект"); setLoading(false); return; }
      const ring = d.parcel.ringWgs84;
      const pr = projectRingToLocal(ring);
      setZone(d.parcel.functionalZone ?? "");
      setSel({
        name: d.parcel.name, designation: d.parcel.designation, isSocial: !!d.parcel.isSocial,
        ringWgs84: ring, local: pr.local, width: pr.width, height: pr.height,
        proj: { lon0: pr.lon0, lat0: pr.lat0, kx: pr.kx, ky: pr.ky }, ctx: d.ctx as SiteContext,
      });
      setParams(d.params as EditParams);
      const map = mapRef.current;
      if (map) {
        setData("selected", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] });
        const lons = ring.map((r) => r[0]); const lats = ring.map((r) => r[1]);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 80, duration: 600 });
      }
      // ТЭП + пятно пересчитает эффект валидации (сработает на смену sel/params)
    } catch (e) {
      if (isAuthError(e)) setAuthNeeded(true);
      else setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [setData]);

  // Список сохранённых + deep-link ?project=<id>
  useEffect(() => {
    if (!getToken()) return;
    loadSavedList();
    const id = new URLSearchParams(window.location.search).get("project");
    if (id) loadProject(id);
  }, [loadSavedList, loadProject]);

  // Нет токена → сразу просим войти (прокси движка за авторизацией).
  useEffect(() => {
    if (!getToken()) setAuthNeeded(true);
  }, []);

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
      map.addSource("footprint", { type: "geojson", data: empty });

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
      map.addLayer({ id: "footprint-fill", type: "fill", source: "footprint",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.5 } });
      map.addLayer({ id: "footprint-line", type: "line", source: "footprint",
        paint: { "line-color": "#ea580c", "line-width": 1.5 } });

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
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Посадка на участок</h1>
          <Link href="/app" className="text-xs text-blue-600 hover:underline">в приложение →</Link>
        </div>
        <p className="mb-1 text-xs text-gray-500">{ready ? hint : "Загрузка карты…"}</p>
        {gisLoading && <p className="mb-2 text-xs text-blue-600">Загрузка участков из ГИС…</p>}

        {authNeeded && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Данные ГИС доступны после входа в систему.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">Войти →</Link>
          </div>
        )}

        {saved.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-gray-500">Сохранённые участки ({saved.length})</div>
            <div className="flex flex-wrap gap-1">
              {saved.slice(0, 12).map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadProject(p.id)}
                  title={p.name}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-gray-50"
                >
                  {p.name.length > 18 ? p.name.slice(0, 18) + "…" : p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {sel && params && (
          <div className="mb-3 rounded-lg border border-gray-200 p-3">
            <div className="font-medium">{sel.name}</div>
            <div className="mt-1 text-xs">
              <span className="text-gray-400">назначение отвода: </span>{sel.designation}
            </div>
            <div className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${zoneState.cls}`}>
              {zoneState.label}
            </div>
            {sel.isSocial && (
              <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                ⚠ Отвод выделен под соцобъект — жилая застройка тут неприменима.
                ТЭП ниже показаны как гипотеза «если бы здесь строили ЖК».
              </div>
            )}

            <div className="mt-3 space-y-2 border-t border-gray-100 pt-2">
              <div className="text-xs font-medium text-gray-500">Параметры (меняй → пересчёт)</div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs">Класс жилья</span>
                <select
                  className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                  value={params.housing_class}
                  onChange={(e) => setParams({ ...params, housing_class: e.target.value })}
                >
                  {CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs">Этажность</span>
                <input
                  type="number" min={1} max={60}
                  className="w-20 rounded border border-gray-300 px-1 py-0.5 text-right text-xs"
                  value={params.floors}
                  onChange={(e) => setParams({ ...params, floors: Math.max(1, +e.target.value || 1) })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs">% застройки (лимит)</span>
                <input
                  type="number" min={1} max={100}
                  className="w-20 rounded border border-gray-300 px-1 py-0.5 text-right text-xs"
                  value={params.max_coverage_pct}
                  onChange={(e) => setParams({ ...params, max_coverage_pct: Math.min(100, Math.max(1, +e.target.value || 1)) })}
                />
              </label>
            </div>
          </div>
        )}

        {loading && <p className="text-blue-600">Считаю ТЭП и нормы…</p>}
        {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}

        {s && (
          <>
            <h2 className="mb-1 mt-2 font-medium">8 ТЭП</h2>
            <table className="w-full">
              <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:font-medium">
                <tr><td>Площадь территории <Src k="gis" /></td><td>{fmt(s.site_area_m2)} м²</td></tr>
                <tr><td>Площадь застройки <Src k="calc" /></td><td>{fmt(s.total_footprint_m2)} м²</td></tr>
                <tr><td>Процент застройки <Src k="calc" /></td><td>{s.coverage_pct}%</td></tr>
                <tr><td>Строит. объём <Src k="calc" /></td><td>{fmt(s.total_volume_m3)} м³</td></tr>
                <tr><td>Поэтажная площадь (GFA) <Src k="calc" /></td><td>{fmt(s.total_floor_area_m2)} м²</td></tr>
                <tr><td>КИТ <Src k="calc" /></td><td>{s.far}</td></tr>
                <tr><td>Озеленение <Src k="norm" /></td><td>{fmt(s.green_area_m2)} м² ({s.green_pct}%)</td></tr>
              </tbody>
            </table>
            <p className="mt-1 text-[10px] leading-tight text-gray-400">
              <Src k="gis" /> из карты ГИС · <Src k="calc" /> расчёт по геометрии + вашим параметрам ·{" "}
              <Src k="norm" /> норматив по классу (черновой, уточняется ГПЗУ)
            </p>

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

            <button
              onClick={saveProject}
              disabled={saving}
              className="mt-3 w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить проект"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function isAuthError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number } | null)?.status;
  return status === 401 || /not authenticated|401|unauthor/i.test(m);
}

// Бейдж происхождения цифры: gis (из карты) / calc (расчёт) / norm (норматив).
function Src({ k }: { k: "gis" | "calc" | "norm" }) {
  const map = {
    gis: { t: "ГИС", c: "bg-blue-50 text-blue-600" },
    calc: { t: "расчёт", c: "bg-gray-100 text-gray-500" },
    norm: { t: "норма", c: "bg-amber-50 text-amber-700" },
  }[k];
  return <span className={`ml-1 rounded px-1 text-[10px] align-middle ${map.c}`}>{map.t}</span>;
}

// Грязный класс отвода ("4"/"IV"/…) → значение из CLASS_OPTIONS (как на бэке).
function normalizeClass(raw: string): string {
  const k = (raw || "").trim().toLowerCase().replace(/\s/g, "").replace(/\.$/, "");
  const map: Record<string, string> = {
    "1": "premium", i: "premium", элит: "premium", премиум: "premium",
    "2": "business", ii: "business", бизнес: "business",
    "3": "comfort", iii: "comfort", комфорт: "comfort",
    "4": "standard", iv: "standard", эконом: "standard", стандарт: "standard",
    "комфорт+": "comfort_plus",
  };
  return map[k] ?? "comfort";
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
