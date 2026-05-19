// Клиент API движка Plana Engine.
// Движок чисто prompt-driven: параметры → промпт → gpt-image / gpt-image-edit.
//
// По умолчанию в dev — http://localhost:8001, в проде — переопределяется
// через NEXT_PUBLIC_ENGINE_URL.

import { getToken } from "./auth";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ??
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:8001");

// ---------------------------------------------------------------------------
// Типы — повторяют схему движка (engine/plana_engine/api/main.py).
// ---------------------------------------------------------------------------

export type AptType =
  | "studio" | "k1" | "euro1" | "k2" | "euro2" | "k3" | "euro3" | "k4";

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
      ...authHeaders(),
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

export async function getHealth(): Promise<{
  status: string;
  version: string;
}> {
  return request("/health");
}

// ---------------------------------------------------------------------------
// ГПЗУ-импорт (PDF → форма через OpenAI Vision)
// ---------------------------------------------------------------------------

export type GpzuExtraction = {
  site_area_m2: number | null;
  site_width_m: number | null;
  site_depth_m: number | null;
  setback_front_m: number | null;
  setback_side_m: number | null;
  setback_rear_m: number | null;
  max_height_m: number | null;
  max_floors: number | null;
  max_coverage_pct: number | null;
  max_far: number | null;
  purpose_allowed: string[];
  notes: string;
  confidence: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// Vision-анализ контура (этап 2 ТЗ)
// ---------------------------------------------------------------------------

export type ContourRecommendation = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  tag: "geometry" | "insolation" | "access" | "fire" | "landscape" | "context";
};

export type ContourAnalysis = {
  shape_summary: string;
  estimated_width_m: number | null;
  estimated_depth_m: number | null;
  estimated_orientation_deg: number | null;
  context_features: string[];
  suggested_purpose: "residential" | "commercial" | "mixed_use" | "hotel" | null;
  recommendations: ContourRecommendation[];
  notes: string;
  confidence: "high" | "medium" | "low";
};

/**
 * Прогнать изображение участка / контура / эскиза через gpt-4.1-vision.
 * Принимает JPG/PNG/PDF, возвращает структурированный анализ.
 */
export async function analyzeContour(file: File): Promise<ContourAnalysis> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${ENGINE_URL}/analyze/contour`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<ContourAnalysis>;
}

export async function importGpzu(file: File): Promise<GpzuExtraction> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${ENGINE_URL}/import/gpzu`, {
    method: "POST",
    headers: authHeaders(),
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
  return res.json() as Promise<GpzuExtraction>;
}

// ---------------------------------------------------------------------------
// CAD-импорт DXF (P2 MVP)
// ---------------------------------------------------------------------------

export type DxfBounds = {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  width: number;
  height: number;
};

export type DxfLayerSummary = {
  name: string;
  entity_count: number;
  color: number | null;
  linetype: string | null;
  is_off: boolean;
  is_frozen: boolean;
};

export type DxfPreviewEntity =
  | { type: "line"; layer: string; points: [number, number][] }
  | { type: "polyline"; layer: string; points: [number, number][]; closed: boolean }
  | { type: "circle"; layer: string; center: [number, number]; radius: number; arc?: boolean };

export type DxfImportResult = {
  filename: string;
  source_format: "dxf" | "dwg";
  converted_from: string | null;
  converter: string | null;
  dxf_version: string;
  units: number | null;
  units_name: string;
  entity_count: number;
  layer_count: number;
  layers: DxfLayerSummary[];
  entity_types: Record<string, number>;
  bounds: DxfBounds | null;
  preview_entities: DxfPreviewEntity[];
  warnings: string[];
};

export async function importFloorplanCad(file: File): Promise<DxfImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  const lower = file.name.toLowerCase();
  const path = lower.endsWith(".dwg")
    ? "/import/floorplan-dwg"
    : "/import/floorplan-dxf";
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<DxfImportResult>;
}

// ---------------------------------------------------------------------------
// Visualize* (одиночные изображения из параметров формы)
// ---------------------------------------------------------------------------

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
  // подъездность
  sections?: number;
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
  // свободный контур участка [[x_m, y_m], ...]
  site_polygon?: [number, number][] | null;
};

export type VisualizeResult = {
  blob: Blob;
  modelUsed: string | null;
  enhancerUsed: string | null;
};

async function _postForImage(
  path: string,
  body: VisualizeFromInputsRequest,
): Promise<VisualizeResult> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: authHeaders(),
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

// Архитектурная критика из агентного enhancer'а (kz-norms)
export type CritiqueNumericalConstraint = {
  parameter: string;
  value: string;
  source: string;
};

export type CritiqueRecommendation = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

export type CritiqueRisk = {
  description: string;
  severity: "blocker" | "warning" | "info";
};

export type CritiquePayload = {
  summary: string;
  numerical_constraints: CritiqueNumericalConstraint[];
  design_recommendations: CritiqueRecommendation[];
  risks: CritiqueRisk[];
  norms_used: string[];
};

export type FloorVariantsResponse = {
  variants: FloorVariantItem[];
  elapsed_ms: number;
  critique?: CritiquePayload | null;
};

export async function visualizeFloorVariants(
  req: VisualizeFromInputsRequest,
): Promise<FloorVariantsResponse> {
  return request("/visualize/floor-variants", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function visualizeFloorByLevel(
  req: VisualizeFromInputsRequest & { floor_number: number },
): Promise<FloorVariantsResponse> {
  return request("/visualize/floor-by-level", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function visualizeParking(
  req: VisualizeFromInputsRequest & { parking_level?: number },
): Promise<VisualizeResult> {
  const res = await fetch(`${ENGINE_URL}/visualize/parking`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const b = await res.json(); detail = b.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  const blob = await res.blob();
  return {
    blob,
    modelUsed: res.headers.get("X-Model-Used") ?? "",
    enhancerUsed: res.headers.get("X-Enhancer-Used") ?? null,
  };
}

// ---------------------------------------------------------------------------
// Размещение ЖК на участке — 3 варианта посадки (image-edit × 3)
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
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<PlacementVariantsResponse>;
}

// ---------------------------------------------------------------------------
// Interior gallery — 1 рендер на уникальный тип квартиры
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

export async function visualizeInteriorGallery(
  req: InteriorGalleryRequest,
): Promise<InteriorGalleryResponse> {
  return request("/visualize/interior-gallery", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ---------------------------------------------------------------------------
// Интерактивная корректировка: исходный чертёж + русская инструкция → новый PNG
// ---------------------------------------------------------------------------

/**
 * Применить текстовую правку к существующему AI-чертежу.
 *
 * @param imageDataUrl  — `data:image/png;base64,...` или обычный URL/blob
 * @param instruction   — «сделай гостиную больше», «перенеси кухню на юг», …
 * @param quality       — low|medium|high (стоимость edit'а ~$0.04–0.17)
 *
 * Возвращает PNG-блоб + имя модели, которая выполнила правку.
 */
export async function editAiPlan(
  imageDataUrl: string,
  instruction: string,
  quality: "low" | "medium" | "high" = "medium",
): Promise<VisualizeResult> {
  const blob = await fetch(imageDataUrl).then((r) => r.blob());
  const fd = new FormData();
  fd.append("image", blob, "source.png");
  fd.append("instruction", instruction);
  fd.append("quality", quality);

  const res = await fetch(`${ENGINE_URL}/visualize/edit-instruction`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: null,
  };
}

export async function inpaintAiPlan(
  imageDataUrl: string,
  maskDataUrl: string,
  instruction: string,
  quality: "low" | "medium" | "high" = "medium",
): Promise<VisualizeResult> {
  const imageBlob = await fetch(imageDataUrl).then((r) => r.blob());
  const maskBlob = await fetch(maskDataUrl).then((r) => r.blob());
  const fd = new FormData();
  fd.append("image", imageBlob, "source.png");
  fd.append("mask", maskBlob, "mask.png");
  fd.append("instruction", instruction);
  fd.append("quality", quality);

  const res = await fetch(`${ENGINE_URL}/visualize/inpaint`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail ?? detail; } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: null,
  };
}

// ---------------------------------------------------------------------------
// CAD-экспорт (DXF/IFC) — параллельный пайплайн
// ---------------------------------------------------------------------------

export type FloorPlanMetrics = {
  total_floor_area_m2: number;
  apartments_count: number;
  avg_apartment_area_m2: number;
  sections_count: number;
  units_per_section: number;
  living_area_estimate_m2: number;
  efficiency_pct: number;
};

/**
 * Скачать DXF плана типового этажа (для AutoCAD/ArchiCAD/Revit).
 *
 * Возвращает blob + метрики из заголовков (apt count, площади, К_eff).
 * В отличие от AI-чертежей это РЕАЛЬНАЯ геометрия со слоями и размерами.
 */
export async function exportFloorplanDxf(
  req: VisualizeFromInputsRequest,
): Promise<{ blob: Blob; filename: string; metricsHeaders: Record<string, string> }> {
  const res = await fetch(`${ENGINE_URL}/export/floorplan-dxf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new EngineError(res.status, await res.text());

  const blob = await res.blob();
  return {
    blob,
    filename: "plana-floorplan.dxf",
    metricsHeaders: {
      apartments: res.headers.get("X-Apartments-Count") ?? "",
      floorArea: res.headers.get("X-Floor-Area") ?? "",
      livingArea: res.headers.get("X-Living-Area") ?? "",
      efficiency: res.headers.get("X-Efficiency-Pct") ?? "",
      sections: res.headers.get("X-Sections") ?? "",
    },
  };
}

/**
 * Скачать IFC4 плана этажа (BIM-заготовка для Revit/ArchiCAD/BIMcollab).
 *
 * Возвращает blob + базовые проектные метрики из заголовков.
 */
export async function exportFloorplanIfc(
  req: VisualizeFromInputsRequest,
): Promise<{ blob: Blob; filename: string; projectHeaders: Record<string, string> }> {
  const res = await fetch(`${ENGINE_URL}/export/floorplan-ifc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new EngineError(res.status, await res.text());

  const blob = await res.blob();
  return {
    blob,
    filename: "plana-floorplan.ifc",
    projectHeaders: {
      buildings: res.headers.get("X-Buildings-Count") ?? "",
      siteArea: res.headers.get("X-Site-Area") ?? "",
      footprintArea: res.headers.get("X-Footprint-Area") ?? "",
      coverage: res.headers.get("X-Coverage-Pct") ?? "",
    },
  };
}

/**
 * Только метрики — для preview прямо в форме (быстро, без генерации DXF).
 */
export async function getFloorplanMetrics(
  req: VisualizeFromInputsRequest,
): Promise<FloorPlanMetrics> {
  return request("/export/floorplan-metrics", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ---------------------------------------------------------------------------
// Validation (P3) — проверка KZ-норм и ГПЗУ через доменную модель + Shapely
// ---------------------------------------------------------------------------

export type ViolationSeverity = "error" | "warning" | "info";

export type ProjectViolation = {
  rule: string;
  severity: ViolationSeverity;
  message: string;
  norm: string;
  actual: number | null;
  expected: number | null;
  target: string;
};

export type ProjectValidationSummary = {
  site_area_m2: number;
  total_footprint_m2: number;
  coverage_pct: number;
  buildings_count: number;
};

export type ProjectValidationResponse = {
  summary: ProjectValidationSummary;
  violations: ProjectViolation[];
  errors_count: number;
  warnings_count: number;
  infos_count: number;
};

/**
 * Прогнать форму через KZ-валидаторы. Использует доменную модель + shapely
 * на бэке. Тот же VisualizeFromInputsRequest, что и /export/floorplan-metrics.
 */
export async function validateProject(
  req: VisualizeFromInputsRequest,
): Promise<ProjectValidationResponse> {
  return request("/validate/project", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type AptTypeRow = {
  type_code: string;
  label: string;
  pct_input: number;
  count_per_floor: number;
  total_count: number;
  area_m2: number;
  living_m2: number;
  total_area_m2: number;
  total_living_m2: number;
  share_pct: number;
  norm_min: number;
  norm_max: number;
  norm_ok: boolean;
};

export type TepSummary = {
  total_floors: number;
  total_apartments: number;
  total_floor_area_m2: number;
  total_apt_area_m2: number;
  total_living_area_m2: number;
  efficiency_pct: number;
  avg_apt_area_m2: number;
  apt_per_1000m2: number;
};

export type KvartirografiyaResponse = {
  rows: AptTypeRow[];
  tep: TepSummary;
  recommendations: string[];
};

export async function getKvartirografiya(
  req: VisualizeFromInputsRequest,
): Promise<KvartirografiyaResponse> {
  return request("/analytics/kvartirografiya", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type FacadeInsolation = {
  name: string;
  azimuth_deg: number;
  hours: number;
  required: number;
  compliant: boolean;
};

export type InsolationValidationResponse = {
  latitude: number;
  building_azimuth: number;
  required_hours: number;
  lat_zone: string;
  facades: FacadeInsolation[];
  compliant: boolean;
};

export async function validateInsolation(
  latitude: number,
  buildingAzimuth: number,
): Promise<InsolationValidationResponse> {
  return request(
    `/validate/insolation?latitude=${latitude}&building_azimuth=${buildingAzimuth}`,
    { method: "POST" },
  );
}

export { EngineError };
export const ENGINE_BASE_URL = ENGINE_URL;
