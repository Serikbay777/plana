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

// ─── Категории отводов по ПДП (для окраски и фильтра карты) ──────────────────
// В данных Астаны (gis.esaulet.kz) НЕТ заполненного поля «функциональное
// назначение» (function почти пустое, target = название ЖК, id_style = мусор),
// поэтому категория выводится парсингом «Наименование отвода» (name) — как и
// classifyParcel. 7 категорий + fallback ложатся на 4 зоны генплана
// (Жилая/Коммерческая/Социальная/Иная). Цвета — для слоя parcels на карте.

export type CategoryKey =
  | "housing_mkd" | "housing_izh" | "mixed" | "commercial"
  | "social" | "industrial" | "infra" | "other";

export type CategoryDef = {
  key: CategoryKey;
  label: string;        // полная подпись для легенды
  color: string;        // цвет заливки участка
  developable: boolean; // пятно под застройку (а не сеть/реклама/улица)
};

// Порядок = порядок в легенде.
export const CATEGORIES: CategoryDef[] = [
  { key: "housing_mkd", label: "Жильё многоквартирное (ЖК/МКД)", color: "#f59e0b", developable: true },
  { key: "housing_izh", label: "Жильё ИЖС / малоэтажное", color: "#facc15", developable: true },
  { key: "mixed", label: "Многофункциональное (МФК)", color: "#a855f7", developable: true },
  { key: "commercial", label: "Коммерция / бизнес", color: "#ef4444", developable: true },
  { key: "social", label: "Соцобъекты (образование/мед/спорт)", color: "#06b6d4", developable: true },
  { key: "industrial", label: "Производство / коммунальное", color: "#4f46e5", developable: true },
  { key: "infra", label: "Инфраструктура / нестационарные", color: "#94a3b8", developable: false },
  { key: "other", label: "Прочее / не распознано", color: "#d1d5db", developable: true },
];

export const CATEGORY_BY_KEY: Record<CategoryKey, CategoryDef> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<CategoryKey, CategoryDef>;

// ВАЖНО: в JS `\b` опирается на ASCII-\w и НЕ работает с кириллицей
// («\bофис», «\bТОО\b» молча не матчатся). Поэтому границы слова задаём
// Unicode-aware lookaround по буквам. w() — целое слово, wl() — граница слева.
const _L = "а-яёa-z"; // буквы (regexp с флагом i)
const _NB = `(?<![${_L}])`;
const _NA = `(?![${_L}])`;
const w = (t: string) => `${_NB}${t}${_NA}`;
const wl = (t: string) => `${_NB}${t}`;
const rx = (parts: string[]) => new RegExp(parts.join("|"), "i");

// Нестационарные/инфраструктура/сети/улицы/реклама — НЕ пятно под застройку.
// Проверяется ПЕРВОЙ: «нестационарный торговый объект» — это киоск, не коммерция.
const RX_INFRA = rx([
  "нестационарн", "мобильн", "реклам", "информацион", "навигацион", "газетн", "цветочн",
  "киоск", "павильон", "остановочн", "благоустро", "озеленени", wl("сквер"), "бульвар",
  "набережн", wl("мост"), "пешеходн", "велосипедн", "велодорож", w("лрт"), "\\blrt\\b",
  wl("улиц"), wl("ул\\."), "проспект", wl("дорог"), "проезд", "магистрал", "развязк",
  "путепровод", w("сет[ьие]"), "инженерн", "водоснаб", "водопровод", "канализ", "теплоснаб",
  "теплосет", "электроснаб", "электросет", "газоснаб", "газопровод", w("кнс"), "насосн",
  "расширение территор", "ограждени", wl("навес"), "памятник", "монумент", wl("стел"),
  "кладбищ", "временн",
]);
const RX_SOCIAL = rx([
  "школ", "детс", "ясли", "больниц", "поликлин", "клиник", "амбулатор", "медиц", "госпит",
  "спорт", "фитнес", w("фок"), "бассейн", "стадион", "футбол", "манеж", "универ", "институт",
  "колледж", wl("учеб"), "образоват", "культур", "музе", "театр", "библиотек", "молод[её]жн",
]);
const RX_IZH = rx(["индивидуальн", "коттедж", "малоэтажн", "усадебн", "садоводств", wl("дач"), "таунхаус", "приусадебн"]);
const RX_MIXED = rx(["многофункц", w("мфк"), w("мфжк"), "смешанн"]);
// жил[а-яё]* ловит жилой/жилые/жилых/жилая/жилому + комплекс/дом/застройка/массив.
const RX_MKD = rx(["многокварт", "жил[а-яё]*\\s*(комплекс|дом|здани|застройк|массив)", w("жк"), "общежит", "апарт"]);
const RX_COMMERCIAL = rx([
  "гостиниц", wl("отел"), "гостев", "торгов", wl("офис"), "бизнес[\\s-]?центр", "магазин",
  w("тц"), w("трц"), "админист", w("азс"), "автозаправ", "автогаз", "придорожн", wl("склад"),
  "логист", w("сто"), "автосервис", "автомойк", "автокомплекс", "рынок", "базар", wl("кафе"),
  "ресторан", "развлекат", "выставочн", "делов", "обслуживан", "паркинг", "банн", wl("баня"),
  "салон", "фудкорт", "фаст-?фуд", "дом\\s*быта",
]);
const RX_INDUSTRIAL = rx([
  "производ", wl("завод"), "фабрик", wl("цех"), "промышлен", "хозяйственно-бытов", "очистн",
  "котельн", "подстанц", "трансформатор",
]);

/** Категория отвода по имени (+ целевое назначение) для окраски/фильтра карты.
 * Порядок приоритетов: инфра-маркеры → МФК → ИЖС → МКД → соц → коммерция → пром.
 * Жильё проверяется ДО соц/коммерции, чтобы «ЖК со встроенным детсадом» был МКД,
 * а не соцобъектом (назначение отвода — жилой комплекс). */
export function categorize(name: string, target = ""): CategoryKey {
  const s = `${name} ${target}`.toLowerCase();
  if (RX_INFRA.test(s)) return "infra";
  if (RX_MIXED.test(s)) return "mixed";
  if (RX_IZH.test(s)) return "housing_izh";
  if (RX_MKD.test(s)) return "housing_mkd";
  if (RX_SOCIAL.test(s)) return "social";
  if (RX_COMMERCIAL.test(s)) return "commercial";
  if (RX_INDUSTRIAL.test(s)) return "industrial";
  return "other";
}

// ─── Тип владельца («кому принадлежит», поле owner = «Застройщик») ────────────
// В данных owner — это 2000+ преимущественно физлиц (Ф.И.О.) + компании/госорганы.
// Группируем в 4 типа для фильтра. Поиск по подстроке — отдельно (см. карту).
export type OwnerTypeKey = "individual" | "company" | "gov" | "unknown";

export const OWNER_TYPES: { key: OwnerTypeKey; label: string }[] = [
  { key: "individual", label: "Физлицо" },
  { key: "company", label: "Компания" },
  { key: "gov", label: "Госорган" },
  { key: "unknown", label: "Не указан / прочее" },
];

const RX_GOV = rx([
  w("гу"), w("кгу"), w("кгкп"), w("гкп"), w("ргп"), w("кгп"), "акимат", "маслихат",
  "министерств", "департамент", "управлен", w("отдел"), "госуд", w("сэс"), "учрежден",
]);
const RX_COMPANY = rx([
  w("тоо"), w("ао"), w("оо"), w("ип"), w("пк"), w("оф"), w("кск"), "компани", "корпораци",
  "холдинг", "групп", "\\bgroup\\b", "\\bltd\\b", "\\bllp\\b", "\\bllc\\b", "девелоп", "инвест",
  "строй", "курылыс", "құрылыс", "[\"«»]",
]);
const RX_FIO = /[а-яёұқөғүһәі]+\s+[а-яёұқөғүһәі]\.\s?[а-яёұқөғүһәі]?\.?/i; // «Фамилия И.О.»

/** Тип владельца отвода: физлицо / компания / госорган / не определён. */
export function ownerType(owner: string): OwnerTypeKey {
  const s = (owner || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (RX_GOV.test(s)) return "gov";
  if (RX_COMPANY.test(s)) return "company";
  if (RX_FIO.test(s)) return "individual";
  return "unknown";
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

export type ParcelCounts = {
  total: number;
  free: number; built: number; nondev: number;
  byCategory: Record<string, { total: number; free: number; built: number }>;
  byOwner: Record<string, number>;
};

/**
 * Пометить отводы свойствами `built` (есть ли внутри существующее здание — слой
 * ГИС «Существующие здания»), `developable` (пятно под застройку), `category`
 * (категория ПДП по имени) и `ownerType` (тип владельца). Готового слоя
 * «свободные участки» в API нет — выводим геометрией + назначением.
 * «Свободно» = developable && !built. Мутирует properties; возвращает счётчики.
 */
export function annotateBuiltParcels(
  parcels: GeoJSON.FeatureCollection,
  buildings: GeoJSON.FeatureCollection,
): ParcelCounts {
  const pts: [number, number][] = [];
  for (const b of buildings.features) {
    const r = ringFromFeature(b.geometry);
    if (r && r.length) pts.push(ringCentroid(r));
  }
  let free = 0, built = 0, nondev = 0;
  const byCategory: ParcelCounts["byCategory"] = {};
  const byOwner: ParcelCounts["byOwner"] = {};
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
    const category = categorize(String(props.name ?? ""), String(props.target ?? ""));
    const developable = CATEGORY_BY_KEY[category].developable;
    const oType = ownerType(String(props.owner ?? ""));
    p.properties = { ...props, built: isBuilt, developable, category, ownerType: oType };

    const cc = (byCategory[category] ??= { total: 0, free: 0, built: 0 });
    cc.total++;
    if (isBuilt) { built++; cc.built++; }
    else if (developable) { free++; cc.free++; }
    else nondev++;
    byOwner[oType] = (byOwner[oType] ?? 0) + 1;
  }
  return { total: parcels.features.length, free, built, nondev, byCategory, byOwner };
}
