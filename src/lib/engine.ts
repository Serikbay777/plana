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

function parseDetail(raw: unknown, fallback: string): string {
  if (typeof raw === "string") return raw;
  // FastAPI 422 returns detail as array of {loc, msg, type}
  if (Array.isArray(raw)) {
    return raw
      .map((e) => (typeof e === "object" && e !== null ? (e as Record<string, unknown>).msg ?? JSON.stringify(e) : String(e)))
      .join("; ");
  }
  if (raw !== null && raw !== undefined) return String(raw);
  return fallback;
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
      detail = parseDetail(body.detail, detail);
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
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
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
      detail = parseDetail(body.detail, detail);
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
  site_polygon: [number, number][] | null;
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
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
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
  k4_pct?: number;
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
  // ГПЗУ / ПДП
  max_coverage_pct?: number;   // ЛИМИТ застройки из ГПЗУ (нормоконтроль); не задан → проверка молчит
  max_height_m?: number;
  max_far?: number;            // КИТ из ПДП/ГПЗУ (0 = не задан)
  max_floors?: number;         // предельная этажность из ПДП/ГПЗУ
  coverage_target_pct?: number; // цель массинга по % застройки (допущение, не лимит)
  // класс жилья (стандарт/комфорт/комфорт+/бизнес/премиум | I-IV | эконом-элит)
  housing_class?: string | null;
  quality?: "low" | "medium" | "high";
  // свободный контур участка [[x_m, y_m], ...]
  site_polygon?: [number, number][] | null;
  // контекст участка в локальных метрах (из importSiteContext)
  red_lines?: number[][][] | null;     // полилинии
  neighbors?: number[][][] | null;     // полигоны соседей
  functional_zone?: string;            // функциональная зона участка
  // тип здания: multi_family (default) / single_family / commercial / mixed_use
  building_type?: string;
  // типология этажа для multi_family:
  //   symmetric (default) / t_shape / asymmetric_depth / double_core / tower / core_shifted
  // Подробности — engine/plana_engine/visualizer/marketing_prompt.py:68+
  floor_typology?: string;
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
      detail = parseDetail(j.detail, detail);
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
 * image-edit: обставляет мебелью РЕАЛЬНЫЙ план (PNG из детерминированного
 * SVG-чертежа). Геометрия берётся из картинки → согласовано с чертежом.
 */
export async function visualizeFloorplanFurnitureEdit(
  planImage: Blob,
  req: VisualizeFromInputsRequest,
  sourcePrompt?: string,
): Promise<VisualizeResult> {
  const fd = new FormData();
  fd.append("plan_image", planImage, "plan.png");
  fd.append("req_json", JSON.stringify(req));
  if (sourcePrompt) fd.append("source_prompt", sourcePrompt);

  const res = await fetch(`${ENGINE_URL}/visualize/floorplan-furniture-edit`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    enhancerUsed: res.headers.get("X-Enhancer-Used"),
  };
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
      detail = parseDetail(j.detail, detail);
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
  prompt_used: string;
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
    try { const b = await res.json(); detail = parseDetail(b.detail, detail); } catch { /* ignore */ }
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
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
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
  /** Ракурс по комнате (living/kitchen/bedroom/…). Пусто = общий композит. */
  room_focus: string;
  /** Русская подпись ракурса для UI. */
  view_label: string;
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

/**
 * Интерьеры через image-edit: сид — мебельный план (top-down), выход —
 * перспектива. Стиль/состав привязан к плану → «примерное» представление.
 */
export async function visualizeInteriorGalleryEdit(
  planImage: Blob,
  req: InteriorGalleryRequest,
  sourcePrompt?: string,
): Promise<InteriorGalleryResponse> {
  const fd = new FormData();
  fd.append("plan_image", planImage, "plan.png");
  fd.append("req_json", JSON.stringify(req));
  if (sourcePrompt) fd.append("source_prompt", sourcePrompt);

  const res = await fetch(`${ENGINE_URL}/visualize/interior-gallery-edit`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Экстерьер-галерея: несколько ракурсов здания (hero/entrance/aerial/courtyard)
// ---------------------------------------------------------------------------

export type ExteriorGalleryRequest = VisualizeFromInputsRequest & {
  /** Список ракурсов; пусто/undefined → дефолтные 4. */
  views?: string[];
};

export type ExteriorGalleryItem = {
  view: string;
  label: string;
  image_b64: string;
  model_used: string;
  enhancer_used: string;
};

export type ExteriorGalleryResponse = {
  items: ExteriorGalleryItem[];
  elapsed_ms: number;
};

export async function visualizeExteriorGallery(
  req: ExteriorGalleryRequest,
): Promise<ExteriorGalleryResponse> {
  return request("/visualize/exterior-gallery", {
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
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
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
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
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

// ---------------------------------------------------------------------------
// Floor layout (structured GPT-4o output — basis for rich IFC/DXF)
// ---------------------------------------------------------------------------

export type LayoutSide = "S" | "N" | "W" | "E";

export type LayoutDoor = {
  side: LayoutSide;
  offset: number;
  width: number;
  swing: "in" | "out";
  hinge: "left" | "right";
};

export type LayoutWindow = {
  side: LayoutSide;
  offset: number;
  width: number;
};

export type FurnitureKind =
  | "bed" | "wardrobe" | "nightstand"
  | "sofa" | "coffee_table" | "tv"
  | "stove" | "sink" | "fridge" | "dining_table" | "kitchen_counter"
  | "bathtub" | "toilet" | "washbasin"
  | "armchair";

export type LayoutFurniture = {
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;     // 0/90/180/270
};

export type LayoutRoom = {
  kind: string;
  name_ru: string;
  x: number; y: number; w: number; d: number;
  doors?: LayoutDoor[];
  windows?: LayoutWindow[];
  furniture?: LayoutFurniture[];
};

export type LayoutApartment = {
  type_code: "studio" | "1k" | "2k" | "3k" | "4k";
  number: number;
  x: number; y: number; w: number; d: number;
  rooms: LayoutRoom[];
};

export type LayoutCore = {
  kind: "lift_passenger" | "lift_freight" | "stair";
  x: number; y: number; w: number; d: number;
};

export type LayoutSection = {
  index: number;
  x_start: number;
  width: number;
  corridor_y: number;
  corridor_d: number;
  cores: LayoutCore[];
  apartments: LayoutApartment[];
};

export type LayoutFloor = {
  width_m: number;
  depth_m: number;
  sections: LayoutSection[];
  // Полигональный контур этажа (по часовой стрелке от левого нижнего угла).
  // Если null/undefined — наружный контур = прямоугольник width_m × depth_m.
  // Используется для T-/L-/U-форм с выступами.
  outline?: [number, number][] | null;
};

// ---------------------------------------------------------------------------
// LayoutProject — обёртка над несколькими этажами (Sprint 1 v1.0 plan).
// На данном этапе под капотом проект всегда содержит ровно 1 этаж и
// activeFloorIdx=0. Multi-floor добавляется в Sprint 4.
// ---------------------------------------------------------------------------

export type FloorEntry = {
  level: number;          // -1 (подвал), 0 (цоколь), 1, 2, 3...
  label?: string;         // "1 этаж", "Мансарда" и т.д.
  layout: LayoutFloor;
};

export type LayoutProject = {
  id: string;
  name?: string;
  units: "meters";        // "feet" зарезервировано на будущее
  floors: FloorEntry[];   // .length >= 1
  activeFloorIdx: number; // 0..floors.length-1
  meta: {
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
  };
};

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Обернуть одиночный LayoutFloor в LayoutProject (для backwards-compat). */
export function wrapAsProject(layout: LayoutFloor, name?: string): LayoutProject {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    units: "meters",
    floors: [{ level: 1, label: "1 этаж", layout }],
    activeFloorIdx: 0,
    meta: { createdAt: now, updatedAt: now, schemaVersion: 1 },
  };
}

/** Текущий активный LayoutFloor проекта. */
export function getActiveFloor(project: LayoutProject): LayoutFloor {
  return project.floors[project.activeFloorIdx]!.layout;
}

/** Вернуть копию проекта с заменённым активным этажом. */
export function updateActiveFloor(
  project: LayoutProject,
  newLayout: LayoutFloor,
): LayoutProject {
  const floors = project.floors.map((f, i) =>
    i === project.activeFloorIdx ? { ...f, layout: newLayout } : f,
  );
  return {
    ...project,
    floors,
    meta: { ...project.meta, updatedAt: new Date().toISOString() },
  };
}

/**
 * Генерировать структурированную планировку этажа (параметрически + AI).
 * Используется перед скачиванием IFC чтобы передать реальную геометрию.
 */
export async function generateFloorLayout(
  req: VisualizeFromInputsRequest,
): Promise<LayoutFloor> {
  return request("/generate/floor-layout", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

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
  layout?: LayoutFloor,
): Promise<{ blob: Blob; filename: string; projectHeaders: Record<string, string> }> {
  const body = layout ? { ...req, layout } : req;
  const res = await fetch(`${ENGINE_URL}/export/floorplan-ifc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
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

// Баланс площади участка (шаг 2a): нормы (озеленение + наземный паркинг) → остаток
// под дом. Коэффициенты — DRAFT (norms.py), уточняются ГПЗУ/ресерчем норм.
export type PosadkaBalance = {
  apartments: number;
  residents: number;
  parking_spaces: number;
  parking_area_m2: number;      // наземный паркинг
  green_required_m2: number;    // озеленение по % класса (на участке)
  green_per_capita_m2: number;  // подушевая норма (жители × 19 м²) — справочно
  reserves_m2: number;          // озеленение + паркинг
  footprint_m2: number;         // фактическое пятно
  leftover_m2: number;          // участок − резервы − пятно (минус = перебор)
  fits: boolean;                // озеленение + паркинг + пятно ≤ участка
};

export type ProjectValidationSummary = {
  site_area_m2: number;
  total_footprint_m2: number;
  coverage_pct: number;
  buildings_count: number;
  total_volume_m3: number;
  total_floor_area_m2: number;
  far: number;
  green_area_m2: number;
  green_pct: number;
  footprints_local?: number[][][];   // пятна застройки в локальных метрах
  balance?: PosadkaBalance;          // баланс площади участка (2a)
  green_zones_local?: number[][][];     // зоны озеленения (2b), локальные метры
  parking_zones_local?: number[][][];   // зоны наземного паркинга (2b)
};

// Контекст участка из GIS (соседи/дороги/красные линии) в локальных метрах.
export type SiteContext = {
  neighbor_buildings: number[][][];
  roads: number[][][];
  red_lines: number[][][];
  functional_zone: string;
  pdp_floors?: string[];          // этажность по ПДП (как в ГИС)
  pdp_floors_max?: number | null; // максимальная этажность по ПДП
  counts: Record<string, number>;
};

/** Подтянуть контекст участка из GIS по кольцу WGS84 [[lon,lat],...]. */
export async function importSiteContext(
  parcelRing: [number, number][],
  radiusM = 150,
): Promise<SiteContext> {
  return request("/import/site-context", {
    method: "POST",
    body: JSON.stringify({ parcel_ring: parcelRing, radius_m: radiusM }),
  });
}

// GIS geojson через прокси движка (browser → engine → GIS; обходит CORS/SSL).
type Bounds = { west: number; south: number; east: number; north: number };

function gisQuery(path: string, b: Bounds): Promise<GeoJSON.FeatureCollection> {
  return request(`${path}?west=${b.west}&south=${b.south}&east=${b.east}&north=${b.north}`);
}

export const fetchGisParcels = (b: Bounds) => gisQuery("/gis/parcels", b);
export const fetchGisNeighbors = (b: Bounds) => gisQuery("/gis/neighbors", b);
export const fetchGisRedLines = (b: Bounds) => gisQuery("/gis/redlines", b);

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

export type GisMasterplanObjectType =
  | "residential_block"
  | "school"
  | "kindergarten"
  | "parking"
  | "commerce"
  | "yard";

export type GisMasterplanGeneratedObject = {
  id: string;
  parcel_id: string;
  type: GisMasterplanObjectType;
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotationDeg: number;
  floors: number;
  rationale: string;
};

export type GisMasterplanScenario = {
  key: string;
  title: string;
  strategy: string;
  objects: GisMasterplanGeneratedObject[];
  rule_notes: string[];
  warnings: string[];
};

export type GisMasterplanResponse = {
  scenarios: GisMasterplanScenario[];
  model_used: string;
  source: "openai";
};

export async function generateGisMasterplan(payload: {
  parcels: Array<Record<string, unknown>>;
  strategy_hint?: string;
}): Promise<GisMasterplanResponse> {
  return request("/generate/gis-masterplan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function visualizeGisMasterplan(payload: {
  handoff: unknown;
  scenario: GisMasterplanScenario;
  strategy_hint?: string;
}): Promise<VisualizeResult> {
  const res = await fetch(`${ENGINE_URL}/visualize/gis-masterplan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = parseDetail(j.detail, detail);
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

// ---------------------------------------------------------------------------
// Стоимость (Высота-1: укрупнённая расчётная стоимость стадии посадки)
// ---------------------------------------------------------------------------

export type CostLine = { label: string; amount: number; note: string };

export type AggregateCostEstimate = {
  region: string;
  building_type: string;
  gfa_m2: number;
  rate_per_m2: number;
  rate_official: boolean;
  price_level: string;
  base_construction: number;
  buildup: CostLine[];
  subtotal_ex_vat: number;
  vat: number;
  total: number;
  total_low: number;
  total_high: number;
  currency: string;
  estimate_class: string;
  is_certified_smeta: boolean;
  disclaimer: string;
  warnings: string[];
};

export type AggregateCostRequest = {
  gfa_m2?: number;
  region?: string;
  building_type?: string;
  n_floors?: number;
};

export async function costAggregate(
  req: AggregateCostRequest,
): Promise<AggregateCostEstimate> {
  return request("/cost/aggregate", {
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

// ---------------------------------------------------------------------------
// PDF Визуализация (фича «загрузил альбом → получил красивый рендер»)
// ---------------------------------------------------------------------------

export type SheetType = {
  key: string;
  label: string;
  aspect: string;
};

export async function getSheetTypes(): Promise<SheetType[]> {
  const res = await request<{ types: SheetType[] }>("/sheet-types");
  return res.types;
}

export type PdfPagePreview = {
  index: number;       // 0-based
  jpeg_b64: string;    // base64 без data:-префикса
  width: number;
  height: number;
};

export type PdfRenderPagesResponse = {
  pages: PdfPagePreview[];
  truncated: boolean;
};

export async function renderPdfPages(
  file: File,
  dpi: number = 110,
): Promise<PdfRenderPagesResponse> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("dpi", String(dpi));
  const res = await fetch(`${ENGINE_URL}/pdf/render-pages`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return res.json() as Promise<PdfRenderPagesResponse>;
}

export type SheetVizMode = "A" | "B" | "C";

export type VisualizeSheetRequest = {
  sheet_type: string;
  quality?: "low" | "medium" | "high";
  hint?: string;
  mode?: SheetVizMode;
  page_jpeg_b64?: string;
};

export type VisualizeSheetResult = {
  blob: Blob;
  modelUsed: string | null;
  sheetType: string | null;
  sheetLabel: string | null;
  sheetMode: string | null;
  sheetContext: string | null;
};

export async function visualizeSheet(
  req: VisualizeSheetRequest,
): Promise<VisualizeSheetResult> {
  const res = await fetch(`${ENGINE_URL}/visualize/sheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = parseDetail(j.detail, detail); } catch { /* ignore */ }
    throw new EngineError(res.status, detail);
  }
  return {
    blob: await res.blob(),
    modelUsed: res.headers.get("X-Model-Used"),
    sheetType: res.headers.get("X-Sheet-Type"),
    sheetLabel: res.headers.get("X-Sheet-Label"),
    sheetMode: res.headers.get("X-Sheet-Mode"),
    sheetContext: res.headers.get("X-Sheet-Context"),
  };
}

export type ClassifySheetResult = {
  sheet_type: string;
  confidence: "high" | "medium" | "low";
};

export async function classifyPdfPage(
  pageJpegB64: string,
): Promise<ClassifySheetResult> {
  return request("/pdf/classify-page", {
    method: "POST",
    body: JSON.stringify({ page_jpeg_b64: pageJpegB64 }),
  });
}

// ---------------------------------------------------------------------------
// Архитектурные чертежи: свободное ТЗ → структурированный layout этажа
// (типы LayoutFloor/Section/Apartment/Room уже объявлены выше)
// ---------------------------------------------------------------------------

export type BriefLayoutResponse = {
  layout: LayoutFloor;
  inputs: VisualizeFromInputsRequest;
  used_defaults: string[];
  notes: string;
};

export async function generateLayoutFromBrief(
  brief: string,
): Promise<BriefLayoutResponse> {
  return request("/generate/layout-from-brief", {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
}

export async function enhanceBrief(brief: string): Promise<string> {
  const res = await request<{ enhanced_brief: string }>("/enhance/brief", {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
  return res.enhanced_brief;
}

export type CostInputExtraction = {
  region: "Almaty" | "Astana" | "Shymkent" | "Aktobe" | "default" | null;
  object_type: string | null;
  building_class: "economy" | "comfort" | "business" | null;
  site_width_m: number | null;
  site_depth_m: number | null;
  setback_front_m: number | null;
  setback_side_m: number | null;
  setback_rear_m: number | null;
  gfa_above_ground_m2: number | null;
  gfa_underground_m2: number | null;
  efficiency_ratio: number | null;
  market_price_per_sellable_m2: number | null;
  floors_above: number | null;
  floors_below: number | null;
  footprint_width_m: number | null;
  footprint_depth_m: number | null;
  parking_mode: "open" | "underground" | "mixed" | null;
  parking_spots: number | null;
  complex_soil: boolean | null;
  complex_slope: boolean | null;
  missing_data_warnings: string[];
  assumptions_notes: string[];
  confidence_level: "low" | "medium" | "high";
};

export type CostInputExtractionResponse = {
  extraction: CostInputExtraction;
  model_used: string;
  source: "openai";
};

export async function extractCostInputsFromBrief(brief: string): Promise<CostInputExtractionResponse> {
  return request("/cost/extract-inputs", {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
}

export type SiteImageRiskFlag = {
  key: "apparent_slope" | "limited_road_access" | "dense_context" | "visible_site_constraints" | "uncertain_image";
  label: string;
  severity: "low" | "medium" | "high";
  suggested_value: boolean;
  reason: string;
};

export type SiteImageRiskAnalysis = {
  apparent_slope: boolean | null;
  road_access: "clear" | "limited" | "unclear";
  dense_context: boolean | null;
  visible_constraints: string[];
  risk_flags: SiteImageRiskFlag[];
  missing_data_warnings: string[];
  notes: string[];
  confidence_level: "low" | "medium" | "high";
};

export type SiteImageRiskAnalysisResponse = {
  analysis: SiteImageRiskAnalysis;
  model_used: string;
  source: "openai_vision";
};

export async function analyzeSiteImageRisks(siteImage: File): Promise<SiteImageRiskAnalysisResponse> {
  const fd = new FormData();
  fd.append("site_image", siteImage);
  return request("/cost/analyze-site-image", {
    method: "POST",
    body: fd,
  });
}

export type CostAnalystExplanation = {
  summary: string;
  key_drivers: string[];
  risk_notes: string[];
  missing_data: string[];
  next_documents: string[];
  confidence_level: "low" | "medium" | "high";
};

export type CostAnalystExplanationResponse = {
  explanation: CostAnalystExplanation;
  model_used: string;
  source: "openai";
};

export async function explainCostSnapshot(payload: {
  selected_variant: string;
  cost_snapshot: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  source_registry: Array<Record<string, unknown>>;
  missing_data_warnings: string[];
}): Promise<CostAnalystExplanationResponse> {
  return request("/cost/explain-snapshot", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function editLayoutWithChat(
  layout: LayoutFloor,
  message: string,
): Promise<LayoutFloor> {
  const res = await request<{ layout: LayoutFloor }>("/edit/layout-with-chat", {
    method: "POST",
    body: JSON.stringify({ layout, message }),
  });
  return res.layout;
}

// ─── Album-генератор (Sprint 1) ─────────────────────────────────────────

export type AlbumSheetKind =
  | "title"
  | "general_data"
  | "floor_plan"
  | "basement_plan"
  | "roof_plan"
  | "section"
  | "facade"
  | "room_explication"
  | "doors_spec"
  | "windows_spec"
  | "hero_render"
  | "masterplan";

export type AlbumSheet = {
  kind: AlbumSheetKind;
  title: string;
  floor_number?: number;
  section_label?: string;
  facade_side?: "S" | "N" | "E" | "W";
};

export type LayoutAlbum = {
  project_name: string;
  layout: LayoutFloor;
  floors_total: number;
  sheets: AlbumSheet[];
};

export type AlbumResponse = {
  album: LayoutAlbum;
  inputs: VisualizeFromInputsRequest;
  used_defaults: string[];
  notes: string;
};

export async function generateAlbumFromBrief(brief: string): Promise<AlbumResponse> {
  return request("/generate/album-from-brief", {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
}

export async function generateAlbumFromInputs(
  req: VisualizeFromInputsRequest,
): Promise<AlbumResponse> {
  return request("/generate/album-from-inputs", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Полный gpt-image альбом (Sprint 2) ──────────────────────────────────

export type AlbumImage = {
  kind: string;
  title: string;
  label: string;
  image_b64: string;
  model_used: string;
  extra: Record<string, unknown>;
};

export type AlbumImagesResponse = {
  images: AlbumImage[];
  project_name: string;
  elapsed_ms: number;
  failed_count: number;
};

export async function generateAlbumImages(
  req: VisualizeFromInputsRequest,
): Promise<AlbumImagesResponse> {
  return request("/generate/album-images", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ---------------------------------------------------------------------------
// Wizard (Sprint 4 v1.0 plan) — структурированный ввод для нового проекта.
// На v1 wizard собирает textual brief и вызывает существующий
// /generate/layout-from-brief. В v1.5 — отдельный structured endpoint
// /generate/layout-from-wizard, который не теряет точность параметров
// в текстовой сериализации.
// ---------------------------------------------------------------------------

export type FootprintShape = "rect" | "l" | "t" | "u" | "custom";

export type ProjectType =
  | "residential_sfh"   // single-family house
  | "residential_multi" // small multi-family (townhouse, low-rise)
  | "commercial"        // офис / коммерция
  | "mixed";            // mixed-use

export type RoomReqKind =
  | "bedroom" | "bathroom" | "kitchen" | "living"
  | "dining" | "office" | "garage" | "utility" | "storage";

export type RoomReq = {
  kind: RoomReqKind;
  count: number;
};

export type WizardInputs = {
  projectType: ProjectType;
  floors: number;             // 1..6
  totalAreaM2: number;        // общая площадь
  footprint: FootprintShape;
  buildingWidth: number;
  buildingDepth: number;
  rooms: RoomReq[];
  city?: string;              // для будущей привязки норм (S5/v1.5)
  notes?: string;             // дополнительные пожелания пользователя
};

const PROJECT_TYPE_RU: Record<ProjectType, string> = {
  residential_sfh: "Жилой одноквартирный дом",
  residential_multi: "Малоэтажное жильё (таунхаус/секционка)",
  commercial: "Коммерческое здание",
  mixed: "Mixed-use",
};

const ROOM_RU: Record<RoomReqKind, [string, string]> = {
  bedroom:  ["спальня", "спален"],
  bathroom: ["ванная", "ванных"],
  kitchen:  ["кухня", "кухонь"],
  living:   ["гостиная", "гостиных"],
  dining:   ["столовая", "столовых"],
  office:   ["кабинет", "кабинетов"],
  garage:   ["гараж", "гаражей"],
  utility:  ["подсобка", "подсобок"],
  storage:  ["кладовка", "кладовок"],
};

/** Маппинг ProjectType wizard'а → building_type для backend-парсера. */
const PROJECT_TYPE_TO_BUILDING_TYPE: Record<ProjectType, string> = {
  residential_sfh:   "single_family",
  residential_multi: "multi_family",
  commercial:        "commercial",
  mixed:             "mixed",
};

/** Собрать textual brief из wizard-параметров для existing brief-endpoint. */
export function briefFromWizard(w: WizardInputs): string {
  const parts: string[] = [];

  // ⚡ Явный hint для парсера — иначе GPT угадает тип и backend может
  // вставить ядра подъезда в одноквартирном доме.
  const bt = PROJECT_TYPE_TO_BUILDING_TYPE[w.projectType];
  parts.push(`Тип здания: ${bt}.`);
  if (bt === "single_family") {
    parts.push(
      "Это ЧАСТНЫЙ ДОМ / коттедж — БЕЗ лифтов, БЕЗ межквартирной лестницы," +
      " БЕЗ общего коридора подъезда. Одна семья на весь этаж.",
    );
  }

  parts.push(`${PROJECT_TYPE_RU[w.projectType]}. ${w.floors}-этажный.`);
  parts.push(`Габариты ${w.buildingWidth.toFixed(1)}×${w.buildingDepth.toFixed(1)} м.`);
  parts.push(`Общая площадь ${w.totalAreaM2.toFixed(0)} м².`);
  if (w.footprint !== "rect") {
    parts.push(`Форма контура: ${w.footprint.toUpperCase()}-образная.`);
  }

  const roomsText = w.rooms
    .filter((r) => r.count > 0)
    .map((r) => {
      const [single, multi] = ROOM_RU[r.kind];
      const word = r.count === 1 ? single : multi;
      return `${r.count} ${word}`;
    })
    .join(", ");
  if (roomsText) parts.push(`Состав: ${roomsText}.`);

  if (w.city) parts.push(`Локация: ${w.city}.`);
  if (w.notes && w.notes.trim()) parts.push(`Дополнительно: ${w.notes.trim()}`);

  return parts.join(" ");
}

/**
 * Генерация плана через wizard. На Sprint 4 — оборачивает brief-endpoint;
 * в v1.5 заменится на /generate/layout-from-wizard с потерей нулевой
 * точности параметров.
 */
export async function generateLayoutFromWizard(
  inputs: WizardInputs,
): Promise<BriefLayoutResponse> {
  const brief = briefFromWizard(inputs);
  return generateLayoutFromBrief(brief);
}

export { EngineError };
export const ENGINE_BASE_URL = ENGINE_URL;
