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

/** Bounding box кольца → [minX, minY, maxX, maxY]. */
function ringBBox(ring: [number, number][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Грубый центроид кольца (среднее вершин) — представит здание точкой. */
function ringCentroid(ring: [number, number][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const n = ring.length || 1;
  return [sx / n, sy / n];
}

/** Точка внутри кольца (ray casting). */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Слой «Земельные отводы» — это ВСЕ выделения земли, а не пятна под застройку:
// рекламные щиты, благоустройство, велодорожки, мосты, сети, улицы, скверы…
// У них по природе нет здания внутри → они флудят «свободно». Отсекаем их по
// назначению (name + target), чтобы «свободно» = «пятно под девелопмент».
// «комплекс» намеренно НЕ в DEV — слишком жадно (ловит «остановочный комплекс»).
// Жилые/админ/много­функц. комплексы и так попадают по жил/админист/многофункц.
const DEV_KEYWORDS =
  /жил|\bжк\b|\bдом\b|многокварт|общежит|школ|детс|\bсад\b|ясли|больниц|поликлин|клиник|медиц|гостиниц|\bотел|апарт|админист|\bофис|бизнес-?центр|торгов|магазин|\bтц\b|мфк|многофункц|обществен|производ|\bсклад|\bзавод|фабрик|\bцех|институт|университ|пристройк/;
const NONDEV_KEYWORDS =
  /информацион|реклам|благоустро|озеленени|\bмост|пешеходн|велосипедн|велодорож|транспортн.{0,4}систем|\bлрт\b|\blrt\b|реконструкц|\bсет[ьие]\b|инженерн|наружн.*сет|водоснаб|канализац|теплоснаб|электроснаб|газоснаб|газопровод|водопровод|\bулиц|\bул\.|проспект|\bдорог|проезд|магистрал|развязк|путепровод|\bплощадь|\bсквер|бульвар|набережн|павильон|нестационарн|киоск|остановочн|\bнавес|парковк|паркинг|ограждени|теплиц|террас|летне|\bкафе|расширение территор|временн|\bлэп\b|подстанц|\bкнс\b|насосн|котельн|трансформатор|памятник|монумент|\bстел|кладбищ/;

/** Является ли отвод пятном под застройку (а не щитом/благоустройством/сетью). */
export function isDevelopableParcel(name: string, target = ""): boolean {
  const s = `${name} ${target}`.toLowerCase();
  if (DEV_KEYWORDS.test(s)) return true;       // явный тип здания — оставляем
  if (NONDEV_KEYWORDS.test(s)) return false;   // инфраструктура/реклама — отсекаем
  return true;                                  // не распознано — не прячем
}

/**
 * Пометить отводы свойствами `built` (есть ли внутри существующее здание — слой
 * ГИС «Существующие здания») и `developable` (пятно под застройку по назначению).
 * Готового слоя «свободные участки» в API нет — выводим геометрией + назначением.
 * «Свободно» = developable && !built. Мутирует properties; возвращает счётчики.
 */
export function annotateBuiltParcels(
  parcels: GeoJSON.FeatureCollection,
  buildings: GeoJSON.FeatureCollection,
): { free: number; built: number; nondev: number } {
  const pts: [number, number][] = [];
  for (const b of buildings.features) {
    const r = ringFromFeature(b.geometry);
    if (r && r.length) pts.push(ringCentroid(r));
  }
  let free = 0, built = 0, nondev = 0;
  for (const p of parcels.features) {
    const ring = ringFromFeature(p.geometry);
    let isBuilt = false;
    if (ring && ring.length >= 3) {
      const [minX, minY, maxX, maxY] = ringBBox(ring);
      for (const pt of pts) {
        if (pt[0] < minX || pt[0] > maxX || pt[1] < minY || pt[1] > maxY) continue;
        if (pointInRing(pt, ring)) { isBuilt = true; break; }
      }
    }
    const props = (p.properties ?? {}) as Record<string, unknown>;
    const developable = isDevelopableParcel(String(props.name ?? ""), String(props.target ?? ""));
    p.properties = { ...props, built: isBuilt, developable };
    if (isBuilt) built++;
    else if (developable) free++;
    else nondev++;
  }
  return { free, built, nondev };
}
