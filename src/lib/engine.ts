// Клиент API движка Plana Engine.
// По умолчанию в dev — http://localhost:8001, в проде — переопределяется
// через NEXT_PUBLIC_ENGINE_URL.

const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8001";

// ---------------------------------------------------------------------------
// Типы — повторяют схему движка (engine/plana_engine/types.py).
// Если фронт начнёт расходиться — генерируем из OpenAPI; пока вручную.
// ---------------------------------------------------------------------------

export type AptType =
  | "studio" | "k1" | "euro1" | "k2" | "euro2" | "k3" | "euro3" | "k4";

export type ZoneKind =
  | "kitchen" | "bathroom" | "living" | "bedroom" | "hall" | "loggia";

export type PresetKey =
  | "max_useful_area"
  | "max_apt_count"
  | "max_avg_area"
  | "balanced_mix"
  | "max_insolation";

export type Point = { x: number; y: number };
export type Polygon = { exterior: Point[]; holes: Point[][] };

export type Edge = {
  a: Point;
  b: Point;
  type: "facade" | "party" | "unknown";
  length: number;
};

export type PlacedZone = {
  kind: ZoneKind;
  polygon: Polygon;
  label?: string;
};

export type PlacedTile = {
  spec_code: string;
  apt_type: AptType;
  label: string;
  polygon: Polygon;
  area: number;
  width: number;
  depth: number;
  facade_edge: Edge;
  zones: PlacedZone[];
  apt_number: number;
  door_world: Point | null;
  living_area: number;
};

export type CoreSpec = {
  polygon: Polygon;
  lifts: number;
  stairs: number;
  has_shaft: boolean;
};

export type Corridor = {
  polygon: Polygon;
  kind: "linear" | "ring" | "central";
  length: number;
};

export type PlanMetrics = {
  floor_area: number;
  saleable_area: number;
  saleable_ratio: number;
  apt_count: number;
  avg_apt_area: number;
  apt_by_type: Partial<Record<AptType, number>>;
  south_oriented_share: number;
  insolation_score: number;
  core_area: number;
  corridor_area: number;
  corridor_length: number;
};

export type NormViolation = {
  rule_id: string;
  severity: "info" | "warning" | "error";
  message: string;
  location?: Point | null;
};

export type NormsReport = {
  passed: boolean;
  violations: NormViolation[];
};

export type Plan = {
  floor_polygon: Polygon;
  core: CoreSpec;
  corridors: Corridor[];
  tiles: PlacedTile[];
  metrics: PlanMetrics;
  norms: NormsReport;
  preset: PresetKey;
};

export type GenerateResponse = {
  request_id: string;
  variants: Plan[];
  elapsed_ms: number;
};

export type PresetMeta = {
  key: PresetKey;
  label: string;
  description: string;
};

export type TileSpecMeta = {
  code: string;
  apt_type: AptType;
  label: string;
  area: number;
  width: number;
  depth: number;
};

export type GenerateRectRequest = {
  site_width_m: number;
  site_depth_m: number;
  setback_front_m?: number;
  setback_side_m?: number;
  setback_rear_m?: number;
  floors?: number;
  purpose?: "residential" | "commercial" | "mixed_use" | "hotel";
  target_mix?: { studio: number; k1: number; k2: number; k3: number };
};

// ---------------------------------------------------------------------------
// Клиент
// ---------------------------------------------------------------------------

class EngineError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export async function getPresets(): Promise<PresetMeta[]> {
  const r = await request<{ presets: PresetMeta[] }>("/presets");
  return r.presets;
}

export async function getCatalog(): Promise<TileSpecMeta[]> {
  const r = await request<{ version: string; tiles: TileSpecMeta[] }>(
    "/catalog",
  );
  return r.tiles;
}

export async function getHealth(): Promise<{
  status: string;
  version: string;
  norms_version: string;
  catalog_size: number;
}> {
  return request("/health");
}

export async function generateFromRect(
  req: GenerateRectRequest,
): Promise<GenerateResponse> {
  return request("/generate/rect", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function generateFromDxf(
  file: File,
  opts: { floors?: number } = {},
): Promise<GenerateResponse> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("floors", String(opts.floors ?? 1));
  const res = await fetch(`${ENGINE_URL}/generate/dxf`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<GenerateResponse>;
}

/**
 * Скачать один DXF по `request_id` + preset key.
 * Возвращает blob, который можно положить в URL.createObjectURL.
 */
export function dxfDownloadUrl(requestId: string, preset: PresetKey): string {
  return `${ENGINE_URL}/export/${requestId}/${preset}.dxf`;
}

/**
 * Скачать ZIP-пакет сдачи: 5 DXF + норм-отчёт + метрики + параметры.
 */
export function packageDownloadUrl(requestId: string): string {
  return `${ENGINE_URL}/export/${requestId}/package.zip`;
}

/**
 * URL для marketing-визуализации по уже сгенерированному варианту движка.
 * Картинка генерируется при первом запросе (15–30 сек) и кэшируется.
 */
export function visualizeUrl(
  requestId: string,
  preset: PresetKey,
  quality: "low" | "medium" | "high" = "medium",
): string {
  return `${ENGINE_URL}/visualize/${requestId}/${preset}.png?quality=${quality}`;
}

export type VisualizeFromInputsRequest = {
  site_width_m: number;
  site_depth_m: number;
  setback_front_m?: number;
  setback_side_m?: number;
  setback_rear_m?: number;
  floors: number;
  purpose?: "residential" | "commercial" | "mixed_use" | "hotel";
  studio_pct: number;
  k1_pct: number;
  k2_pct: number;
  k3_pct: number;
  // паркинг
  parking_spaces_per_apt?: number;
  parking_underground_levels?: number;
  // пожарка
  fire_evacuation_max_m?: number;
  fire_evacuation_exits_per_section?: number;
  fire_dead_end_corridor_max_m?: number;
  // лифты
  lifts_passenger?: number;
  lifts_freight?: number;
  // инсоляция
  insolation_priority?: boolean;
  insolation_min_hours?: number;
  // ГПЗУ
  max_coverage_pct?: number;
  max_height_m?: number;
  quality?: "low" | "medium" | "high";
};

export type VisualizeResult = {
  blob: Blob;
  modelUsed: string | null;
  enhancerUsed: string | null;
};

/**
 * Сгенерировать визуализацию ИЗ ФОРМЕННЫХ ПАРАМЕТРОВ.
 *
 * Возвращает Blob с PNG + имя модели, которая сработала
 * (gpt-image-2 / gpt-image-1.5 / gpt-image-1 / cache).
 */
export async function visualizeFromInputs(
  req: VisualizeFromInputsRequest,
): Promise<VisualizeResult> {
  const res = await fetch(`${ENGINE_URL}/visualize/from-inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: res.headers.get("X-Enhancer-Used"),
  };
}

export type VisualizePromptResponse = {
  prompt: string;
  has_api_key: boolean;
};

export async function getVisualizePrompt(
  requestId: string,
  preset: PresetKey,
): Promise<VisualizePromptResponse> {
  return request(`/visualize/${requestId}/${preset}/prompt`);
}

// ---------------------------------------------------------------------------
// Дополнительные визуализации
// ---------------------------------------------------------------------------

async function _postForImage(
  path: string,
  body: VisualizeFromInputsRequest,
): Promise<VisualizeResult> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: res.headers.get("X-Enhancer-Used"),
  };
}

export async function visualizeExterior(req: VisualizeFromInputsRequest) {
  return _postForImage("/visualize/exterior", req);
}

export async function visualizeFloorplanFurniture(req: VisualizeFromInputsRequest) {
  return _postForImage("/visualize/floorplan-furniture", req);
}

export async function visualizeInterior(req: VisualizeFromInputsRequest) {
  return _postForImage("/visualize/interior", req);
}

/**
 * Image-to-image: впишет здание в загруженное аэрофото участка.
 */
export async function visualizeSitePlacement(
  siteImage: File,
  params: Omit<VisualizeFromInputsRequest, "site_width_m" | "site_depth_m" | "floors"> & {
    site_width_m: number;
    site_depth_m: number;
    floors: number;
  },
  buildingImage?: File,
): Promise<VisualizeResult> {
  const fd = new FormData();
  fd.append("site_image", siteImage);
  if (buildingImage) fd.append("building_image", buildingImage);
  fd.append("site_width_m", String(params.site_width_m));
  fd.append("site_depth_m", String(params.site_depth_m));
  fd.append("setback_front_m", String(params.setback_front_m ?? 0));
  fd.append("setback_side_m", String(params.setback_side_m ?? 0));
  fd.append("setback_rear_m", String(params.setback_rear_m ?? 0));
  fd.append("floors", String(params.floors));
  fd.append("purpose", params.purpose ?? "residential");
  fd.append("studio_pct", String(params.studio_pct ?? 0));
  fd.append("k1_pct", String(params.k1_pct ?? 0));
  fd.append("k2_pct", String(params.k2_pct ?? 0));
  fd.append("k3_pct", String(params.k3_pct ?? 0));
  fd.append("parking_spaces_per_apt", String(params.parking_spaces_per_apt ?? 1));
  fd.append("parking_underground_levels", String(params.parking_underground_levels ?? 1));
  fd.append("max_coverage_pct", String(params.max_coverage_pct ?? 50));
  fd.append("max_height_m", String(params.max_height_m ?? 30));
  fd.append("quality", params.quality ?? "medium");

  const res = await fetch(`${ENGINE_URL}/visualize/site-placement`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: res.headers.get("X-Enhancer-Used"),
  };
}

// ---------------------------------------------------------------------------
// AI Floor Variants — 5 PNG чертежей параллельно
// ---------------------------------------------------------------------------

export type FloorVariantItem = {
  key: string;
  label: string;
  model_used: string;
  enhancer_used: string;
  image_b64: string;
};

export type FloorVariantsResponse = {
  variants: FloorVariantItem[];
  elapsed_ms: number;
};

// ---------------------------------------------------------------------------
// Размещение ЖК на участке — 3 варианта посадки
// ---------------------------------------------------------------------------

export type PlacementVariant = {
  key: string;
  label: string;
  model_used: string;
  image_b64: string;
};

export type PlacementVariantsResponse = {
  variants: PlacementVariant[];
  elapsed_ms: number;
};

/**
 * Аэрофото участка + фото ЖК → 3 варианта размещения ЖК на участке.
 * gpt-image-edit × 3 параллельно.
 */
export async function visualizeSitePlacementVariants(
  siteImage: File,
  buildingImage: File,
  params: {
    site_width_m: number;
    site_depth_m: number;
    setback_front_m?: number;
    setback_side_m?: number;
    setback_rear_m?: number;
    floors?: number;
    purpose?: string;
    quality?: "low" | "medium" | "high";
  },
): Promise<PlacementVariantsResponse> {
  const fd = new FormData();
  fd.append("site_image", siteImage);
  fd.append("building_image", buildingImage);
  fd.append("site_width_m",    String(params.site_width_m));
  fd.append("site_depth_m",    String(params.site_depth_m));
  fd.append("setback_front_m", String(params.setback_front_m ?? 0));
  fd.append("setback_side_m",  String(params.setback_side_m  ?? 0));
  fd.append("setback_rear_m",  String(params.setback_rear_m  ?? 0));
  fd.append("floors",          String(params.floors   ?? 1));
  fd.append("purpose",         params.purpose  ?? "residential");
  fd.append("quality",         params.quality  ?? "medium");

  const res = await fetch(`${ENGINE_URL}/visualize/site-placement-variants`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<PlacementVariantsResponse>;
}

/**
 * Сгенерировать 5 PNG-вариантов архитектурной планировки через gpt-image.
 * Параметры → Gemma 4 (один раз) → 5 × gpt-image параллельно → JSON с base64.
 * Занимает 30–90 секунд. Кэшируется на сервере.
 */
export async function visualizeFloorVariants(
  req: VisualizeFromInputsRequest,
): Promise<FloorVariantsResponse> {
  return request("/visualize/floor-variants", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ---------------------------------------------------------------------------
// Interior gallery: 1 render per unique apartment type
// ---------------------------------------------------------------------------

export type AptTypeInput = {
  apt_type: AptType;
  area: number;
  width: number;
  depth: number;
  zone_kinds: string[];
  count: number;
};

export type InteriorGalleryRequest = {
  floors: number;
  purpose: string;
  quality?: "low" | "medium" | "high";
  apt_types: AptTypeInput[];
};

export type InteriorGalleryItem = {
  apt_type: AptType;
  label: string;
  area: number;
  count: number;
  image_b64: string;
  model_used: string;
  enhancer_used: string;
};

export type InteriorGalleryResponse = {
  items: InteriorGalleryItem[];
  elapsed_ms: number;
};

/**
 * Извлечь уникальные типы квартир из плана (по одному представителю на тип —
 * самый большой по площади).
 */
export function extractAptTypes(plan: Plan): AptTypeInput[] {
  const typeMap = new Map<
    AptType,
    { tile: (typeof plan.tiles)[number]; count: number; maxArea: number }
  >();

  for (const tile of plan.tiles) {
    const existing = typeMap.get(tile.apt_type);
    if (!existing) {
      typeMap.set(tile.apt_type, { tile, count: 1, maxArea: tile.area });
    } else {
      existing.count++;
      if (tile.area > existing.maxArea) {
        existing.tile = tile;
        existing.maxArea = tile.area;
      }
    }
  }

  return Array.from(typeMap.values()).map(({ tile, count }) => ({
    apt_type: tile.apt_type,
    area: tile.area,
    width: tile.width,
    depth: tile.depth,
    zone_kinds: tile.zones.map((z) => z.kind),
    count,
  }));
}

/**
 * Сгенерировать галерею интерьеров — по одному изображению на тип квартиры.
 * Параллельно, каждый с собственным Gemma-enhanced промптом.
 */
export async function visualizeInteriorGallery(
  req: InteriorGalleryRequest,
): Promise<InteriorGalleryResponse> {
  return request("/visualize/interior-gallery", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export { EngineError };
export const ENGINE_BASE_URL = ENGINE_URL;

// ---------------------------------------------------------------------------
// UI-хелперы: цвета и подписи типов квартир
// ---------------------------------------------------------------------------

export const APT_COLORS: Record<AptType, string> = {
  studio: "#22d3ee",
  k1:     "#a78bfa",
  euro1:  "#8b5cf6",
  k2:     "#f59e0b",
  euro2:  "#fb923c",
  k3:     "#f472b6",
  euro3:  "#ec4899",
  k4:     "#fda4af",
};

export const APT_LABELS: Record<AptType, string> = {
  studio: "Студия",
  k1:     "1-комн",
  euro1:  "Евро-1",
  k2:     "2-комн",
  euro2:  "Евро-2",
  k3:     "3-комн",
  euro3:  "Евро-3",
  k4:     "4-комн",
};

export const ZONE_COLORS: Record<ZoneKind, string> = {
  living:   "rgba(255,255,255,0.025)",
  bedroom:  "rgba(255,255,255,0.04)",
  kitchen:  "rgba(245,158,11,0.14)",
  bathroom: "rgba(34,211,238,0.18)",
  hall:     "rgba(255,255,255,0.06)",
  loggia:   "rgba(167,139,250,0.08)",
};

export const ZONE_LABELS: Record<ZoneKind, string> = {
  living:   "",
  bedroom:  "",
  kitchen:  "К",
  bathroom: "С",
  hall:     "",
  loggia:   "Л",
};
