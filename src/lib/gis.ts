// Гео-хелперы карты: проекция кольца участка в локальные метры (тот же фрейм,
// что у движка, importers/site_context.py: origin = bbox-min, равнопромежуточная)
// + извлечение кольца из GeoJSON. Сетевые запросы к GIS идут через прокси
// движка (см. engine.ts fetchGis*), а не из браузера напрямую (CORS/SSL).

export type BBox = { west: number; south: number; east: number; north: number };

const LAT_M = 110574;
const LON_M = 111320;

// Параметры локальной проекции участка — нужны и для прямой, и для обратной.
export type ProjOrigin = { lon0: number; lat0: number; kx: number; ky: number };

export type LocalProjection = ProjOrigin & {
  local: [number, number][];   // кольцо в локальных метрах
  width: number;
  height: number;
};

/** Спроецировать кольцо WGS84 [[lon,lat],...] в локальные метры (как на бэке). */
export function projectRingToLocal(ring: [number, number][]): LocalProjection {
  const lon0 = Math.min(...ring.map((p) => p[0]));
  const lat0 = Math.min(...ring.map((p) => p[1]));
  const kx = LON_M * Math.cos((lat0 * Math.PI) / 180);
  const ky = LAT_M;
  const local = ring.map(
    (p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky] as [number, number],
  );
  return {
    lon0, lat0, kx, ky,
    local,
    width: Math.max(...local.map((p) => p[0])),
    height: Math.max(...local.map((p) => p[1])),
  };
}

/** Обратная проекция: локальные метры → WGS84 [[lon,lat],...]. */
export function localToWgs84(coords: number[][], o: ProjOrigin): [number, number][] {
  return coords.map((p) => [p[0] / o.kx + o.lon0, p[1] / o.ky + o.lat0] as [number, number]);
}

export type EnginePurpose = "residential" | "commercial" | "mixed_use" | "hotel";

export type ParcelClass = {
  purpose: EnginePurpose;   // назначение для движка
  label: string;            // человекочитаемая категория
  isHousing: boolean;       // допускает жильё
  isSocial: boolean;        // соцобъект (школа/детсад/больница…) — жильё неприменимо
};

/** Классифицировать отвод по его имени (Zem_otvody_GU.name). */
export function classifyParcel(name: string): ParcelClass {
  const n = (name || "").toLowerCase();
  if (/гостиниц|отел/.test(n))
    return { purpose: "hotel", label: "Гостиница", isHousing: false, isSocial: false };
  if (/школ|детс|сад|ясли|больниц|поликлин|клиник|медиц|спорт|университ|институт|учеб|образоват|фок|бассейн/.test(n))
    return { purpose: "residential", label: "Соцобъект (образование/медицина/спорт)", isHousing: false, isSocial: true };
  if (/торгов|офис|бизнес-?центр|магазин|\bтц\b|тр[ць]|админист|паркинг|стоянк/.test(n))
    return { purpose: "commercial", label: "Коммерция", isHousing: false, isSocial: false };
  if (/встроен|смешан|многофункц|мфк/.test(n))
    return { purpose: "mixed_use", label: "Смешанное (ЖК + встроенные)", isHousing: true, isSocial: false };
  if (/жил|жк|многокварт|квартир|общежит/.test(n))
    return { purpose: "residential", label: "Жилое (ЖК)", isHousing: true, isSocial: false };
  return { purpose: "residential", label: "Назначение не распознано", isHousing: true, isSocial: false };
}

/** Достать внешнее кольцо [[lon,lat],...] из GeoJSON Polygon/MultiPolygon. */
export function ringFromFeature(geom: GeoJSON.Geometry | null): [number, number][] | null {
  if (!geom) return null;
  if (geom.type === "Polygon") return geom.coordinates[0] as [number, number][];
  if (geom.type === "MultiPolygon") return geom.coordinates[0][0] as [number, number][];
  return null;
}
