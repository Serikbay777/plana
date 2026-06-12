"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Layers, LogOut, Sparkles, Download, RefreshCw, AlertCircle,
  Map as MapIcon, Image as ImageIcon, Upload, Building2, Sofa, Eye, X,
  CheckCircle2, ArrowRight, Wand2, Loader2, ScanSearch, Compass, Ruler,
  Trees, Flame, DoorOpen, Network, Save, FolderOpen, Check,
  LayoutGrid, List, History, ChevronDown, Plus, FileText, Calculator,
} from "lucide-react";
import { PromptForm, DEFAULT_PROMPT_FORM, type PromptFormState } from "@/components/PromptForm";
import { ValidationPanel } from "@/components/ValidationPanel";
import { InsolationPanel } from "@/components/InsolationPanel";
import { KvartirografiyaPanel } from "@/components/KvartirografiyaPanel";
import MaskCanvas, { type MaskCanvasHandle } from "@/components/MaskCanvas";
import { exportAiPlansPdf, exportFullReportPdf } from "@/lib/pdf-export";
import {
  importGpzu,
  importFloorplanCad,
  analyzeContour,
  visualizeSitePlacement,
  visualizeFloorVariants,
  visualizeFloorByLevel,
  visualizeSitePlacementVariants,
  visualizeInteriorGallery,
  visualizeInteriorGalleryEdit,
  visualizeExteriorGallery,
  visualizeFloorplanFurnitureEdit,
  editAiPlan,
  inpaintAiPlan,
  exportFloorplanDxf,
  exportFloorplanIfc,
  generateFloorLayout,
  generateGisMasterplan,
  visualizeGisMasterplan,
  getFloorplanMetrics,
  visualizeParking,
  type DxfImportResult,
  type GpzuExtraction,
  type ContourAnalysis,
  type ContourRecommendation,
  type VisualizeFromInputsRequest,
  type VisualizeResult,
  type PlacementVariant,
  type InteriorGalleryItem,
  type FloorPlanMetrics,
  type GisMasterplanResponse,
  type LayoutFloor,
} from "@/lib/engine";
import { getSession, signOut, type Session } from "@/lib/auth";
import { createProject, updateProject, uploadAsset, getProject, createRun, listProjects, type GenerationRun, type ProjectAsset, type Project as ProjectType } from "@/lib/projects";
import HistoryPanel from "@/components/HistoryPanel";
import { PdfVizTab, type PdfVizResult } from "@/components/PdfVizTab";
import { ArchitecturalDrawingsTab, FloorPlanSvg } from "@/components/ArchitecturalDrawingsTab";
import { AlbumImagesViewer } from "@/components/AlbumImagesViewer";
import { CostPlacementTab, DEFAULT_COST_PLACEMENT_DRAFT, type CostPlacementDraft } from "@/components/CostPlacementTab";
import {
  GIS_MASTERPLAN_HANDOFF_KEY,
  type GisMasterplanHandoff,
} from "@/lib/gis-masterplan-handoff";
import { svgToPngBlob } from "@/lib/export/toPng";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

type GenState = "idle" | "loading" | "ready" | "error";
type CadExportKind = "dxf" | "ifc";
type TopTab = "site" | "viz" | "ai_plans" | "placement" | "cost_placement" | "pdf_viz" | "arch_drawings";
type VizMode = "exterior" | "floorplan_furniture" | "interior";

function topTabForRun(tab: string): TopTab {
  if (tab.startsWith("viz_")) return "viz";
  if (tab === "site" || tab === "ai_plans" || tab === "placement" || tab === "cost_placement" || tab === "pdf_viz" || tab === "arch_drawings") return tab;
  return "ai_plans";
}

// Tab 2/3 — AI картинки
type ImageBag = {
  state: GenState;
  imageUrl: string | null;
  modelUsed: string | null;
  enhancerUsed: string | null;
  errorMessage: string | null;
};
const EMPTY_IMAGE_BAG: ImageBag = {
  state: "idle", imageUrl: null, modelUsed: null, enhancerUsed: null, errorMessage: null,
};

// Tab 3 — интерьер-галерея (несколько ракурсов по комнатам на тип квартиры)
type InteriorGalleryBag = {
  state: GenState;
  items: InteriorGalleryItem[];
  elapsedMs: number | null;
  errorMessage: string | null;
};
const EMPTY_INT_GALLERY: InteriorGalleryBag = {
  state: "idle", items: [], elapsedMs: null, errorMessage: null,
};

// Tab 3 — экстерьер-галерея (несколько ракурсов здания)
// UI-форма элемента: imageUrl может быть data:-URL (свежая генерация) или
// asset-URL (восстановление из проекта/истории).
type ExtGalleryItemUI = {
  view: string;
  label: string;
  imageUrl: string;
  modelUsed: string | null;
};
type ExteriorGalleryBag = {
  state: GenState;
  items: ExtGalleryItemUI[];
  elapsedMs: number | null;
  errorMessage: string | null;
};
const EMPTY_EXT_GALLERY: ExteriorGalleryBag = {
  state: "idle", items: [], elapsedMs: null, errorMessage: null,
};
// Подписи ракурсов экстерьера — для restore, где API-label недоступен.
const EXTERIOR_VIEW_LABEL: Record<string, string> = {
  hero: "Общий вид", aerial: "С высоты", landscape: "Благоустройство", yard: "Двор",
  // legacy-ключи старых сохранений
  entrance: "Вход", courtyard: "Двор",
};
// variant_key ассета («exterior» из старого формата или «exterior_hero») → view.
function extViewFromVariantKey(key: string): string {
  return key.replace(/^exterior_?/, "") || "hero";
}

// Ассеты экстерьера → элементы галереи с дедупом по ракурсу (оставляем
// последний = самый свежий). Проект копит ассеты от разных генераций — без
// дедупа в табах появляются дубли (8 = 2×4).
function extItemsFromAssets(
  assets: { variant_key: string; url: string; model_used: string | null }[],
): ExtGalleryItemUI[] {
  const byView = new Map<string, ExtGalleryItemUI>();
  for (const a of assets) {
    const view = extViewFromVariantKey(a.variant_key);
    if (view === "hero") continue;   // «Общий вид» убран из галереи
    byView.set(view, {
      view,
      label: EXTERIOR_VIEW_LABEL[view] ?? "Экстерьер",
      imageUrl: a.url,
      modelUsed: a.model_used,
    });
  }
  return Array.from(byView.values());
}

// Единый контекст визуализации: захватывается при клике «Визуализация» в AI
// Чертежах и связывает чертёж + параметры + промпт одним id, чтобы «С мебелью»
// строилась ровно из того плана, что юзер видит, а не из заново сгенерированного.
type VizSource = {
  id: string;
  req: VisualizeFromInputsRequest;
  planImageUrl: string;   // картинка чертежа из AI Чертежей (data:/blob:/http)
  planPrompt?: string;    // исходный промпт чертежа — как доп. контекст для edit
};

// Tab 4 — AI чертежи (5 PNG вариантов)
type AiPlanVariant = {
  key: string;
  label: string;
  imageUrl: string;  // data: URL из base64
  modelUsed: string;
  enhancerUsed: string;
  promptUsed: string;
};

const VARIANT_LABEL: Record<string, string> = {
  max_useful_area: "Макс. жилая площадь",
  max_apt_count:   "Макс. кол-во квартир",
  balanced_mix:    "Классическая секция",
  max_insolation:  "Инсоляция (юг)",
  open_plan:       "Евроформат",
};

type AiPlansBag = {
  state: GenState;
  variants: AiPlanVariant[];
  elapsedMs: number | null;
  errorMessage: string | null;
};

const EMPTY_AI_PLANS: AiPlansBag = {
  state: "idle", variants: [], elapsedMs: null, errorMessage: null,
};

// Tab 5 — Размещение ЖК на участке
type PlacementBag = {
  state: GenState;
  variants: PlacementVariant[];
  elapsedMs: number | null;
  errorMessage: string | null;
};
const EMPTY_PLACEMENT: PlacementBag = {
  state: "idle", variants: [], elapsedMs: null, errorMessage: null,
};

type GisMasterplanBag = {
  state: GenState;
  response: GisMasterplanResponse | null;
  errorMessage: string | null;
};

const EMPTY_GIS_MASTERPLAN: GisMasterplanBag = {
  state: "idle",
  response: null,
  errorMessage: null,
};

function friendlyAiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("authentication") || lower.includes("invalid_api_key") || lower.includes("incorrect api key")) {
    return "OpenAI ключ недействителен или отозван. Создай новый ключ в OpenAI Platform, обнови OPENAI_API_KEY в .env и перезапусти engine.";
  }
  if (lower.includes("rate limit") || lower.includes("token limit") || lower.includes("429")) {
    return "OpenAI ограничил запрос по rate/token limit. Для локальной проверки подожди немного или проверь лимиты проекта в OpenAI Platform.";
  }
  if (lower.includes("model") && (lower.includes("not available") || lower.includes("not found"))) {
    return "Модель OpenAI недоступна для этого ключа. Проверь OPENAI_MODEL в .env или доступы проекта.";
  }
  if (lower.includes("openai_api_key") || lower.includes("api key")) {
    return "OPENAI_API_KEY не настроен корректно. Проверь .env и перезапусти backend.";
  }
  return raw || "AI запрос не выполнился. Проверь backend logs и настройки OpenAI.";
}

// Конструируем тело для visualize-эндпоинтов
const D = DEFAULT_PROMPT_FORM;
const nn = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && isFinite(v) ? v : fallback;

function buildVisReq(form: PromptFormState): VisualizeFromInputsRequest {
  return {
    site_width_m:  nn(form.site_width_m,  D.site_width_m),
    site_depth_m:  nn(form.site_depth_m,  D.site_depth_m),
    setback_front_m: nn(form.setback_front_m, D.setback_front_m),
    setback_side_m:  nn(form.setback_side_m,  D.setback_side_m),
    setback_rear_m:  nn(form.setback_rear_m,  D.setback_rear_m),
    floors:  nn(form.floors,  D.floors),
    purpose: form.purpose ?? D.purpose,
    studio_pct: nn(form.studio_pct, D.studio_pct) / 100,
    k1_pct:     nn(form.k1_pct,     D.k1_pct)     / 100,
    k2_pct:     nn(form.k2_pct,     D.k2_pct)     / 100,
    k3_pct:     nn(form.k3_pct,     D.k3_pct)     / 100,
    k4_pct:     nn(form.k4_pct,     D.k4_pct)     / 100,
    sections:   nn(form.sections,   D.sections),
    parking_spaces_per_apt:       nn(form.parking_spaces_per_apt,       D.parking_spaces_per_apt),
    parking_underground_levels:   nn(form.parking_underground_levels,   D.parking_underground_levels),
    fire_evacuation_max_m:        nn(form.fire_evacuation_max_m,        D.fire_evacuation_max_m),
    fire_evacuation_exits_per_section: nn(form.fire_evacuation_exits_per_section, D.fire_evacuation_exits_per_section),
    fire_dead_end_corridor_max_m: nn(form.fire_dead_end_corridor_max_m, D.fire_dead_end_corridor_max_m),
    lifts_passenger: nn(form.lifts_passenger, D.lifts_passenger),
    lifts_freight:   nn(form.lifts_freight,   D.lifts_freight),
    insolation_priority:  form.insolation_priority  ?? D.insolation_priority,
    insolation_min_hours: nn(form.insolation_min_hours, D.insolation_min_hours),
    max_coverage_pct: nn(form.max_coverage_pct, D.max_coverage_pct),
    max_height_m:     nn(form.max_height_m,     D.max_height_m),
    quality: "medium",
    site_polygon: form.site_polygon ?? null,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dxfUnitToMetersScale(unit: number | null): number {
  switch (unit) {
    case 1: return 0.0254;   // inches
    case 2: return 0.3048;   // feet
    case 4: return 0.001;    // millimeters
    case 5: return 0.01;     // centimeters
    case 6: return 1;        // meters
    case 7: return 1000;     // kilometers
    case 10: return 0.9144;  // yards
    case 14: return 0.1;     // decimeters
    default: return 1;       // unitless/unknown: treat as meters for MVP
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

const COST_PLACEMENT_PARAM_KEY = "__plana_cost_placement";
const GIS_MASTERPLAN_PARAM_KEY = "__plana_gis_masterplan";
const DEFAULT_GIS_STRATEGY_HINT =
  "Собери 3 варианта посадки: максимум GFA, сбалансированный двор, социальный mix. Учитывай жилые корпуса, паркинг, двор, детсад/школу если участок социальный.";

type GisMasterplanProjectSnapshot = {
  handoff: GisMasterplanHandoff;
  response: GisMasterplanResponse | null;
  selectedScenarioKey: string | null;
  strategyHint: string;
  updatedAt: string;
};

type GisMasterplanScenarioObject = GisMasterplanResponse["scenarios"][number]["objects"][number];
type GisMasterplanScenarioObjectPatch = Partial<Pick<GisMasterplanScenarioObject, "type" | "width" | "depth" | "floors">>;
type GisRuleSeverity = "error" | "warning" | "info";
type GisRuleIssue = {
  id: string;
  severity: GisRuleSeverity;
  title: string;
  detail: string;
  objectIds?: string[];
};

const GIS_OBJECT_TYPE_OPTIONS: Array<{ value: GisMasterplanScenarioObject["type"]; label: string }> = [
  { value: "residential_block", label: "Жилой корпус" },
  { value: "kindergarten", label: "Детский сад" },
  { value: "school", label: "Школа" },
  { value: "commerce", label: "Коммерция" },
  { value: "parking", label: "Паркинг" },
  { value: "yard", label: "Двор / озеленение" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectParamsWithCostPlacement(
  form: PromptFormState,
  costPlacementDraft: CostPlacementDraft,
  gisSnapshot?: GisMasterplanProjectSnapshot | null,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...form,
    [COST_PLACEMENT_PARAM_KEY]: costPlacementDraft,
  };
  if (gisSnapshot) params[GIS_MASTERPLAN_PARAM_KEY] = gisSnapshot;
  return params;
}

function promptFormFromProjectParams(params: Record<string, unknown>): PromptFormState {
  const formParams = { ...params };
  delete formParams[COST_PLACEMENT_PARAM_KEY];
  delete formParams[GIS_MASTERPLAN_PARAM_KEY];
  return { ...DEFAULT_PROMPT_FORM, ...(formParams as Partial<PromptFormState>) };
}

function gisMasterplanFromProjectParams(params: Record<string, unknown>): GisMasterplanProjectSnapshot | null {
  const raw = params[GIS_MASTERPLAN_PARAM_KEY];
  if (!isRecord(raw)) return null;
  const handoff = raw.handoff;
  if (!isRecord(handoff) || !Array.isArray(handoff.parcels)) return null;
  const response = isRecord(raw.response) && Array.isArray(raw.response.scenarios)
    ? raw.response as unknown as GisMasterplanResponse
    : null;
  return {
    handoff: handoff as unknown as GisMasterplanHandoff,
    response,
    selectedScenarioKey: typeof raw.selectedScenarioKey === "string" ? raw.selectedScenarioKey : null,
    strategyHint: typeof raw.strategyHint === "string" ? raw.strategyHint : DEFAULT_GIS_STRATEGY_HINT,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function isGisRenderFreshForSnapshot(asset: ProjectAsset, snapshot: GisMasterplanProjectSnapshot | null): boolean {
  if (!snapshot?.updatedAt) return true;
  const assetTime = Date.parse(asset.created_at);
  const snapshotTime = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(assetTime) || !Number.isFinite(snapshotTime)) return true;
  return assetTime >= snapshotTime - 1000;
}

function normalizeGisScenarioObjectEdit(
  object: GisMasterplanScenarioObject,
  patch: GisMasterplanScenarioObjectPatch,
): GisMasterplanScenarioObject {
  const next: GisMasterplanScenarioObject = { ...object, ...patch };
  const finiteWidth = Number.isFinite(next.width) ? next.width : object.width;
  const finiteDepth = Number.isFinite(next.depth) ? next.depth : object.depth;
  next.width = Math.max(1, Math.round(finiteWidth * 10) / 10);
  next.depth = Math.max(1, Math.round(finiteDepth * 10) / 10);
  if (next.type === "yard") {
    next.floors = 0;
  } else {
    const finiteFloors = Number.isFinite(next.floors) ? next.floors : object.floors;
    next.floors = Math.max(1, Math.round(finiteFloors || 1));
  }
  return next;
}

function costPlacementFromProjectParams(params: Record<string, unknown>): CostPlacementDraft {
  const raw = params[COST_PLACEMENT_PARAM_KEY];
  if (!isRecord(raw)) return DEFAULT_COST_PLACEMENT_DRAFT;

  const rawCostAssumptions = raw.costAssumptions;
  const rawCostParams = raw.costParams;
  const costParams = isRecord(rawCostParams) ? rawCostParams : {};
  const regionCoefficients = isRecord(costParams.region_coefficients) ? costParams.region_coefficients : {};
  const qualityCoefficients = isRecord(costParams.quality_coefficients) ? costParams.quality_coefficients : {};
  return {
    ...DEFAULT_COST_PLACEMENT_DRAFT,
    ...(raw as Partial<CostPlacementDraft>),
    costParams: {
      ...DEFAULT_COST_PLACEMENT_DRAFT.costParams,
      ...costParams,
      region_coefficients: {
        ...DEFAULT_COST_PLACEMENT_DRAFT.costParams.region_coefficients,
        ...regionCoefficients,
      },
      quality_coefficients: {
        ...DEFAULT_COST_PLACEMENT_DRAFT.costParams.quality_coefficients,
        ...qualityCoefficients,
      },
    },
    costAssumptions: {
      ...DEFAULT_COST_PLACEMENT_DRAFT.costAssumptions,
      ...(isRecord(rawCostAssumptions) ? rawCostAssumptions : {}),
    },
  };
}

function isUnsavedGeneratedImageUrl(url: string | null): url is string {
  return Boolean(url && (url.startsWith("blob:") || url.startsWith("data:")));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Хранение проектов
  const [projectId, setProjectId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveLabel, setAutoSaveLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoredRun, setRestoredRun] = useState<GenerationRun | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectType[]>([]);
  const [projectName, setProjectName] = useState("Без названия");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  const [form, setForm] = useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  const [tab, setTab] = useState<TopTab>("ai_plans");
  const [gisHandoff, setGisHandoff] = useState<GisMasterplanHandoff | null>(null);
  const [gisMasterplanBag, setGisMasterplanBag] = useState<GisMasterplanBag>(EMPTY_GIS_MASTERPLAN);
  const [selectedGisScenarioKey, setSelectedGisScenarioKey] = useState<string | null>(null);
  const [gisStrategyHint, setGisStrategyHint] = useState(DEFAULT_GIS_STRATEGY_HINT);
  const [gisRenderBag, setGisRenderBag] = useState<ImageBag>(EMPTY_IMAGE_BAG);

  // ГПЗУ-импорт PDF → автозаполнение формы (Vision)
  const [gpzuLoading, setGpzuLoading] = useState(false);
  const [gpzuLastResult, setGpzuLastResult] = useState<GpzuExtraction | null>(null);
  const [gpzuError, setGpzuError] = useState<string | null>(null);
  // CAD-импорт DXF → summary/preview (P2)
  const [dxfImportLoading, setDxfImportLoading] = useState(false);
  const [dxfImportResult, setDxfImportResult] = useState<DxfImportResult | null>(null);
  const [dxfImportError, setDxfImportError] = useState<string | null>(null);
  // Vision-анализ контура / участка (Этап 2 ТЗ)
  const [contourLoading, setContourLoading] = useState(false);
  const [contourResult, setContourResult] = useState<ContourAnalysis | null>(null);
  const [contourError, setContourError] = useState<string | null>(null);
  // Tab 2
  const [siteBag, setSiteBag] = useState<ImageBag>(EMPTY_IMAGE_BAG);
  // Tab 3 — три независимых стейта
  const [vizExtGallery, setVizExtGallery] = useState<ExteriorGalleryBag>(EMPTY_EXT_GALLERY);
  const [vizFloorBag,   setVizFloorBag]   = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [vizIntBag,     setVizIntBag]     = useState<ImageBag>(EMPTY_IMAGE_BAG);      // fallback single image
  const [vizIntGallery, setVizIntGallery] = useState<InteriorGalleryBag>(EMPTY_INT_GALLERY);
  const [vizMode, setVizMode] = useState<VizMode>("exterior");
  // Скрытый рендер плана для растеризации SVG → PNG (референс для «С мебелью»).
  const [rasterLayout, setRasterLayout] = useState<LayoutFloor | null>(null);
  const rasterContainerRef = useRef<HTMLDivElement | null>(null);
  const rasterResolveRef = useRef<((blob: Blob) => void) | null>(null);
  const rasterRejectRef = useRef<((e: Error) => void) | null>(null);
  // Источник для «С мебелью»: чертёж + параметры, захваченные из AI Чертежей.
  const [vizSource, setVizSource] = useState<VizSource | null>(null);
  // Tab 4 — per-floor bags
  const [floorBags, setFloorBags] = useState<Record<number, AiPlansBag>>({});
  const [currentFloor, setCurrentFloor] = useState(1);
  // Паркинг
  const [parkingBag, setParkingBag] = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [parkingLevel, setParkingLevel] = useState(1);
  // PDF Визуализация (lift state up для exportFullReportPdf)
  const [pdfVizResults, setPdfVizResults] = useState<PdfVizResult[]>([]);
  // Tab 5
  const [placementBag, setPlacementBag] = useState<PlacementBag>(EMPTY_PLACEMENT);
  const [placementSiteFile,     setPlacementSiteFile]     = useState<File | null>(null);
  const [placementSitePreview,  setPlacementSitePreview]  = useState<string | null>(null);
  const [placementBldFile,      setPlacementBldFile]      = useState<File | null>(null);
  const [placementBldPreview,   setPlacementBldPreview]   = useState<string | null>(null);
  const [costPlacementDraft, setCostPlacementDraft] = useState<CostPlacementDraft>(DEFAULT_COST_PLACEMENT_DRAFT);

  // Site upload (Tab 2)
  const [siteFile, setSiteFile] = useState<File | null>(null);
  const [sitePreview, setSitePreview] = useState<string | null>(null);
  const [siteBldFile, setSiteBldFile] = useState<File | null>(null);
  const [siteBldPreview, setSiteBldPreview] = useState<string | null>(null);

  // Prevents form-change effect from clearing bags during project/history restore
  const restoringRef = useRef(false);

  // Сериализация авто-сохранений: очередь вместо «дропнуть если занято».
  // projectIdRef держит актуальный id даже до того, как setProjectId долетит.
  const projectIdRef = useRef<string | null>(null);
  const projectNameRef = useRef(projectName);
  const formRef = useRef(form);
  const gisHandoffRef = useRef(gisHandoff);
  const gisMasterplanBagRef = useRef(gisMasterplanBag);
  const selectedGisScenarioKeyRef = useRef(selectedGisScenarioKey);
  const gisStrategyHintRef = useRef(gisStrategyHint);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  useEffect(() => { projectNameRef.current = projectName; }, [projectName]);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => { gisHandoffRef.current = gisHandoff; }, [gisHandoff]);
  useEffect(() => { gisMasterplanBagRef.current = gisMasterplanBag; }, [gisMasterplanBag]);
  useEffect(() => { selectedGisScenarioKeyRef.current = selectedGisScenarioKey; }, [selectedGisScenarioKey]);
  useEffect(() => { gisStrategyHintRef.current = gisStrategyHint; }, [gisStrategyHint]);

  const buildGisSnapshot = useCallback((
    handoff: GisMasterplanHandoff | null = gisHandoffRef.current,
    response: GisMasterplanResponse | null = gisMasterplanBagRef.current.response,
    selectedScenarioKey: string | null = selectedGisScenarioKeyRef.current,
    strategyHint: string = gisStrategyHintRef.current,
  ): GisMasterplanProjectSnapshot | null => {
    if (!handoff) return null;
    return {
      handoff,
      response,
      selectedScenarioKey,
      strategyHint,
      updatedAt: new Date().toISOString(),
    };
  }, []);

  // ---- auth gate
  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/login"); return; }
    setSession(s);
    setAuthChecked(true);
  }, [router]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab) setTab(topTabForRun(requestedTab));
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(GIS_MASTERPLAN_HANDOFF_KEY);
    if (!raw) return;
    try {
      const handoff = JSON.parse(raw) as GisMasterplanHandoff;
      if (handoff.source !== "gis_multi_parcel_map" || handoff.parcels.length === 0) return;
      const equivalentSide = Math.sqrt(Math.max(1, handoff.summary.totalAreaM2));
      const width = Math.max(1, Math.round(Math.max(handoff.summary.maxWidthM, equivalentSide)));
      const depth = Math.max(1, Math.round(Math.max(handoff.summary.maxDepthM, equivalentSide)));
      setGisHandoff(handoff);
      setProjectName(`GIS masterplan: ${handoff.summary.parcelsCount} parcel${handoff.summary.parcelsCount > 1 ? "s" : ""}`);
      setForm((current) => ({
        ...current,
        site_width_m: width,
        site_depth_m: depth,
        building_width_m: Math.max(12, Math.round(width * 0.45)),
        building_depth_m: Math.max(12, Math.round(depth * 0.32)),
        floors: handoff.summary.avgFloors,
        max_height_m: handoff.summary.avgFloors * 3.15,
        max_coverage_pct: 50,
        site_polygon: handoff.parcels.length === 1 ? handoff.parcels[0].local : null,
      }));
    } catch {
      /* ignore malformed GIS handoff */
    } finally {
      window.localStorage.removeItem(GIS_MASTERPLAN_HANDOFF_KEY);
    }
  }, []);

  // ---- загрузка последних проектов для переключателя
  const handleGenerateGisMasterplan = useCallback(async () => {
    if (!gisHandoff || gisMasterplanBag.state === "loading") return;
    setGisMasterplanBag({ ...EMPTY_GIS_MASTERPLAN, state: "loading" });
    setGisRenderBag(EMPTY_IMAGE_BAG);
    try {
      const response = await generateGisMasterplan({
        parcels: gisHandoff.parcels.map((parcel) => ({
          id: parcel.id,
          name: parcel.name,
          designation: parcel.designation,
          functionalZone: parcel.functionalZone,
          isSocial: parcel.isSocial,
          local: parcel.local,
          width: parcel.width,
          height: parcel.height,
          areaM2: parcel.areaM2,
          params: parcel.params,
        })),
        strategy_hint: gisStrategyHint.trim() || DEFAULT_GIS_STRATEGY_HINT,
      });
      const selectedKey = response.scenarios[0]?.key ?? null;
      setSelectedGisScenarioKey(selectedKey);
      setGisMasterplanBag({ state: "ready", response, errorMessage: null });
      const snapshot: GisMasterplanProjectSnapshot | null = gisHandoff
        ? {
            handoff: gisHandoff,
            response,
            selectedScenarioKey: selectedKey,
            strategyHint: gisStrategyHint.trim() || DEFAULT_GIS_STRATEGY_HINT,
            updatedAt: new Date().toISOString(),
          }
        : null;
      if (snapshot) {
        const task = async () => {
          setAutoSaving(true);
          setSaveError(null);
          try {
            let pid = projectIdRef.current;
            const params = projectParamsWithCostPlacement(formRef.current, costPlacementDraft, snapshot);
            if (!pid) {
              const autoName = `GIS мастерплан · ${gisHandoff.summary.parcelsCount} уч.`;
              setProjectName(autoName);
              const p = await createProject(autoName, params);
              pid = p.id;
              projectIdRef.current = pid;
              setProjectId(pid);
              window.history.replaceState(null, "", `?project=${pid}&tab=site`);
              setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
              setAutoSaveLabel(autoName);
            } else {
              const p = await updateProject(pid, { params });
              setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
              setAutoSaveLabel(projectNameRef.current || "GIS мастерплан");
            }
            setTimeout(() => setAutoSaveLabel(null), 2500);
          } catch (saveExc) {
            setSaveError((saveExc as Error).message || "Не удалось сохранить GIS-мастерплан");
          } finally {
            setAutoSaving(false);
          }
        };
        saveChainRef.current = saveChainRef.current.then(task, task);
      }
    } catch (e) {
      setGisMasterplanBag({ ...EMPTY_GIS_MASTERPLAN, state: "error", errorMessage: friendlyAiError(e) });
    }
  }, [costPlacementDraft, gisHandoff, gisMasterplanBag.state, gisStrategyHint]);

  const handleSelectGisScenario = useCallback((scenarioKey: string) => {
    setSelectedGisScenarioKey(scenarioKey);
    setGisRenderBag(EMPTY_IMAGE_BAG);
    const snapshot = buildGisSnapshot(gisHandoffRef.current, gisMasterplanBagRef.current.response, scenarioKey);
    if (!snapshot || !projectIdRef.current) return;
    const task = async () => {
      setAutoSaving(true);
      setSaveError(null);
      try {
        const p = await updateProject(projectIdRef.current!, {
          params: projectParamsWithCostPlacement(formRef.current, costPlacementDraft, snapshot),
        });
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
        setAutoSaveLabel("GIS мастерплан");
        setTimeout(() => setAutoSaveLabel(null), 2500);
      } catch (e) {
        setSaveError((e as Error).message || "Не удалось сохранить выбранный сценарий");
      } finally {
        setAutoSaving(false);
      }
    };
    saveChainRef.current = saveChainRef.current.then(task, task);
  }, [buildGisSnapshot, costPlacementDraft]);

  const handleUpdateGisScenarioObject = useCallback((objectId: string, patch: GisMasterplanScenarioObjectPatch) => {
    const handoff = gisHandoffRef.current;
    const response = gisMasterplanBagRef.current.response;
    if (!handoff || !response?.scenarios.length) return;
    const selectedKey = selectedGisScenarioKeyRef.current ?? response.scenarios[0].key;
    const nextResponse: GisMasterplanResponse = {
      ...response,
      scenarios: response.scenarios.map((scenario) => {
        if (scenario.key !== selectedKey) return scenario;
        return {
          ...scenario,
          objects: scenario.objects.map((object) => (
            object.id === objectId ? normalizeGisScenarioObjectEdit(object, patch) : object
          )),
        };
      }),
    };
    setGisMasterplanBag({ state: "ready", response: nextResponse, errorMessage: null });
    setSelectedGisScenarioKey(selectedKey);
    setGisRenderBag(EMPTY_IMAGE_BAG);
    const snapshot = buildGisSnapshot(handoff, nextResponse, selectedKey);
    if (!snapshot || !projectIdRef.current) return;
    const task = async () => {
      setAutoSaving(true);
      setSaveError(null);
      try {
        const p = await updateProject(projectIdRef.current!, {
          params: projectParamsWithCostPlacement(formRef.current, costPlacementDraft, snapshot),
        });
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
        setAutoSaveLabel("GIS-сценарий обновлен");
        setTimeout(() => setAutoSaveLabel(null), 2500);
      } catch (e) {
        setSaveError((e as Error).message || "Не удалось сохранить правку GIS-сценария");
      } finally {
        setAutoSaving(false);
      }
    };
    saveChainRef.current = saveChainRef.current.then(task, task);
  }, [buildGisSnapshot, costPlacementDraft]);

  const applySelectedGisScenarioToCost = useCallback(() => {
    const handoff = gisHandoffRef.current;
    const response = gisMasterplanBagRef.current.response;
    if (!handoff || !response?.scenarios.length) return false;
    const selectedKey = selectedGisScenarioKeyRef.current ?? response.scenarios[0].key;
    const scenario = response.scenarios.find((item) => item.key === selectedKey) ?? response.scenarios[0];
    setCostPlacementDraft((current) => costDraftFromGisScenario(current, handoff, scenario));
    return true;
  }, []);

  const handleOpenCostFromGis = useCallback(() => {
    applySelectedGisScenarioToCost();
    setTab("cost_placement");
  }, [applySelectedGisScenarioToCost]);

  const handleGenerateGisRender = useCallback(async () => {
    const handoff = gisHandoffRef.current;
    const response = gisMasterplanBagRef.current.response;
    if (!handoff || !response?.scenarios.length || gisRenderBag.state === "loading") return;
    const selectedKey = selectedGisScenarioKeyRef.current ?? response.scenarios[0].key;
    const scenario = response.scenarios.find((item) => item.key === selectedKey) ?? response.scenarios[0];
    setGisRenderBag({ ...EMPTY_IMAGE_BAG, state: "loading" });
    try {
      const result = await visualizeGisMasterplan({
        handoff,
        scenario,
        strategy_hint: gisStrategyHintRef.current.trim() || DEFAULT_GIS_STRATEGY_HINT,
      });
      const imageUrl = URL.createObjectURL(result.blob);
      setGisRenderBag({
        state: "ready",
        imageUrl,
        modelUsed: result.modelUsed,
        enhancerUsed: result.enhancerUsed,
        errorMessage: null,
      });
      const snapshot = buildGisSnapshot(handoff, response, scenario.key);
      const task = async () => {
        setAutoSaving(true);
        setSaveError(null);
        try {
          let pid = projectIdRef.current;
          if (!pid) {
            const autoName = `GIS мастерплан · ${handoff.summary.parcelsCount} уч.`;
            setProjectName(autoName);
            const p = await createProject(autoName, projectParamsWithCostPlacement(formRef.current, costPlacementDraft, snapshot));
            pid = p.id;
            projectIdRef.current = pid;
            setProjectId(pid);
            window.history.replaceState(null, "", `?project=${pid}&tab=site`);
            setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
          } else {
            const p = await updateProject(pid, {
              params: projectParamsWithCostPlacement(formRef.current, costPlacementDraft, snapshot),
            });
            setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
          }
          const asset = await uploadAsset(
            pid,
            "gis_masterplan_render",
            scenario.key,
            imageUrl,
            result.modelUsed ?? undefined,
          );
          setGisRenderBag({
            state: "ready",
            imageUrl: asset.url,
            modelUsed: asset.model_used,
            enhancerUsed: null,
            errorMessage: null,
          });
          setAutoSaveLabel("AI-визуализация GIS сохранена");
          setTimeout(() => setAutoSaveLabel(null), 2500);
        } catch (saveExc) {
          setSaveError((saveExc as Error).message || "Не удалось сохранить AI-визуализацию GIS");
        } finally {
          setAutoSaving(false);
        }
      };
      saveChainRef.current = saveChainRef.current.then(task, task);
    } catch (e) {
      setGisRenderBag({
        ...EMPTY_IMAGE_BAG,
        state: "error",
        errorMessage: friendlyAiError(e),
      });
    }
  }, [buildGisSnapshot, costPlacementDraft, gisRenderBag.state]);

  useEffect(() => {
    if (tab !== "cost_placement") return;
    applySelectedGisScenarioToCost();
  }, [tab, selectedGisScenarioKey, applySelectedGisScenarioToCost]);

  useEffect(() => {
    if (!authChecked) return;
    listProjects()
      .then(setRecentProjects)
      .catch((e: unknown) => setSaveError((e as Error).message || "Не удалось загрузить список проектов"));
  }, [authChecked]);

  // ---- загрузка проекта по ?project=ID
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("project");
    if (!pid || !authChecked) return;
    getProject(pid).then((p) => {
      setSaveError(null);
      restoringRef.current = true;
      setProjectId(p.id);
      setProjectName(p.name);
      setForm(promptFormFromProjectParams(p.params));
      setCostPlacementDraft(costPlacementFromProjectParams(p.params));
      const gisSnapshot = gisMasterplanFromProjectParams(p.params);
      if (gisSnapshot) {
        setGisHandoff(gisSnapshot.handoff);
        setSelectedGisScenarioKey(gisSnapshot.selectedScenarioKey);
        setGisStrategyHint(gisSnapshot.strategyHint || DEFAULT_GIS_STRATEGY_HINT);
        setGisMasterplanBag(gisSnapshot.response
          ? { state: "ready", response: gisSnapshot.response, errorMessage: null }
          : EMPTY_GIS_MASTERPLAN);
        setTab("site");
      } else {
        setGisHandoff(null);
        setSelectedGisScenarioKey(null);
        setGisStrategyHint(DEFAULT_GIS_STRATEGY_HINT);
        setGisMasterplanBag(EMPTY_GIS_MASTERPLAN);
      }
      // восстанавливаем изображения из ассетов
      if (p.assets) {
        // AI-чертежи группируем по этажу
        const byFloor: Record<number, AiPlanVariant[]> = {};
        p.assets.filter((a) => a.tab === "ai_plans").forEach((a) => {
          const fl = a.floor ?? 1;
          if (!byFloor[fl]) byFloor[fl] = [];
          byFloor[fl].push({ key: a.variant_key, label: VARIANT_LABEL[a.variant_key] ?? a.variant_key, imageUrl: a.url, modelUsed: a.model_used ?? "", enhancerUsed: "", promptUsed: "" });
        });
        if (Object.keys(byFloor).length > 0) {
          const bags: Record<number, AiPlansBag> = {};
          Object.entries(byFloor).forEach(([f, variants]) => {
            bags[Number(f)] = { state: "ready", variants, elapsedMs: null, errorMessage: null };
          });
          setFloorBags(bags);
        }
        const extAssets = p.assets.filter((a) => a.tab === "viz_exterior");
        if (extAssets.length > 0) {
          setVizExtGallery({
            state: "ready",
            items: extItemsFromAssets(extAssets),
            elapsedMs: null,
            errorMessage: null,
          });
        }
        const floorViz = p.assets.find((a) => a.tab === "viz_floor");
        if (floorViz) setVizFloorBag({ state: "ready", imageUrl: floorViz.url, modelUsed: floorViz.model_used, enhancerUsed: null, errorMessage: null });
        const site = p.assets.find((a) => a.tab === "site");
        if (site) setSiteBag({ state: "ready", imageUrl: site.url, modelUsed: site.model_used, enhancerUsed: null, errorMessage: null });
        const gisRender = [...p.assets]
          .reverse()
          .filter((a) => a.tab === "gis_masterplan_render")
          .filter((a) => isGisRenderFreshForSnapshot(a, gisSnapshot))
          .find((a) => !gisSnapshot?.selectedScenarioKey || a.variant_key === gisSnapshot.selectedScenarioKey)
          ?? [...p.assets]
            .reverse()
            .filter((a) => a.tab === "gis_masterplan_render")
            .find((a) => isGisRenderFreshForSnapshot(a, gisSnapshot));
        if (gisRender) {
          setGisRenderBag({
            state: "ready",
            imageUrl: gisRender.url,
            modelUsed: gisRender.model_used,
            enhancerUsed: null,
            errorMessage: null,
          });
        } else {
          setGisRenderBag(EMPTY_IMAGE_BAG);
        }
      }
      setTimeout(() => { restoringRef.current = false; }, 50);
    }).catch((e: unknown) => {
      setSaveError((e as Error).message || "Не удалось открыть проект");
    });
  }, [authChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- сохранение проекта
  const saveProject = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveOk(false);
    setSaveError(null);
    try {
      let pid = projectId;
      if (!pid) {
        const p = await createProject(projectName, projectParamsWithCostPlacement(form, costPlacementDraft, buildGisSnapshot()));
        pid = p.id;
        projectIdRef.current = pid;
        setProjectId(pid);
        window.history.replaceState(null, "", `?project=${pid}`);
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
      } else {
        const p = await updateProject(pid, { name: projectName, params: projectParamsWithCostPlacement(form, costPlacementDraft, buildGisSnapshot()) });
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
      }
      // сохраняем сгенерированные изображения
      const uploads: Promise<unknown>[] = [];
      Object.entries(floorBags).forEach(([floorStr, bag]) => {
        const fl = Number(floorStr);
        if (bag.state === "ready") {
          bag.variants.forEach((v) => {
            uploads.push(uploadAsset(pid!, "ai_plans", v.key, v.imageUrl, v.modelUsed, fl));
          });
        }
      });
      if (vizExtGallery.state === "ready") {
        vizExtGallery.items.forEach((it) => {
          uploads.push(uploadAsset(pid!, "viz_exterior", `exterior_${it.view}`, it.imageUrl, it.modelUsed ?? undefined));
        });
      }
      if (vizFloorBag.imageUrl) uploads.push(uploadAsset(pid!, "viz_floor",    "floor",     vizFloorBag.imageUrl, vizFloorBag.modelUsed ?? undefined));
      if (siteBag.imageUrl)     uploads.push(uploadAsset(pid!, "site",         "placement", siteBag.imageUrl,     siteBag.modelUsed ?? undefined));
      if (isUnsavedGeneratedImageUrl(gisRenderBag.imageUrl) && selectedGisScenarioKey) {
        uploads.push(uploadAsset(pid!, "gis_masterplan_render", selectedGisScenarioKey, gisRenderBag.imageUrl, gisRenderBag.modelUsed ?? undefined));
      }
      await Promise.all(uploads);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setSaveError((e as Error).message || "Не удалось сохранить проект");
    } finally {
      setSaving(false);
    }
  }, [saving, projectId, projectName, form, costPlacementDraft, floorBags, vizExtGallery, vizFloorBag, siteBag, gisRenderBag, selectedGisScenarioKey, buildGisSnapshot]);

  // ---- авто-сохранение после генерации
  const autoSaveGeneration = useCallback((
    tab: string,
    floor: number,
    assets: { variantKey: string; imageUrl: string; modelUsed?: string }[],
    currentForm: PromptFormState,
  ) => {
    const task = async () => {
      setAutoSaving(true);
      setSaveError(null);
      try {
        // Создаём проект автоматически если его ещё нет.
        // projectIdRef, а не state — чтобы поставленные в очередь сохранения
        // видели уже созданный проект и не плодили дубли.
        let pid = projectIdRef.current;
        let pname = projectName;
        if (!pid) {
          const auto = `${currentForm.purpose === "residential" ? "ЖК" : "Проект"} ${currentForm.floors}эт ${currentForm.building_width_m}×${currentForm.building_depth_m}`;
          pname = auto;
          setProjectName(auto);
          const p = await createProject(auto, projectParamsWithCostPlacement(currentForm, costPlacementDraft, buildGisSnapshot()));
          pid = p.id;
          projectIdRef.current = pid;
          setProjectId(pid);
          window.history.replaceState(null, "", `?project=${pid}`);
          setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
        } else {
          await updateProject(pid, { params: projectParamsWithCostPlacement(currentForm, costPlacementDraft, buildGisSnapshot()) });
        }
        const run = await createRun(pid, tab, floor, currentForm);
        await Promise.all(
          assets.map((a) =>
            uploadAsset(pid!, tab, a.variantKey, a.imageUrl, a.modelUsed, floor, run.id),
          ),
        );
        setAutoSaveLabel(pname || "проект");
        setTimeout(() => setAutoSaveLabel(null), 3000);
      } catch (e) {
        setSaveError((e as Error).message || "Не удалось автосохранить результат");
      } finally {
        setAutoSaving(false);
      }
    };
    // Очередь: сохранения сериализуются, ничего не дропается.
    saveChainRef.current = saveChainRef.current.then(task, task);
    return saveChainRef.current;
  }, [projectName, costPlacementDraft, buildGisSnapshot]);

  useEffect(() => {
    if (!projectId || restoringRef.current) return;
    const timer = window.setTimeout(() => {
      const pid = projectIdRef.current;
      if (!pid || restoringRef.current) return;
      const task = async () => {
        setAutoSaving(true);
        setSaveError(null);
        try {
          const p = await updateProject(pid, {
            name: projectNameRef.current,
            params: projectParamsWithCostPlacement(formRef.current, costPlacementDraft, buildGisSnapshot()),
          });
          setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
          setAutoSaveLabel(projectNameRef.current || "project");
          setTimeout(() => setAutoSaveLabel(null), 2500);
        } catch (e) {
          setSaveError((e as Error).message || "Could not auto-save cost placement");
        } finally {
          setAutoSaving(false);
        }
      };
      saveChainRef.current = saveChainRef.current.then(task, task);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [projectId, costPlacementDraft, buildGisSnapshot]);

  // сбрасываем результаты при изменении формы
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (restoringRef.current) return;
      setSiteBag(b => b.state === "ready" ? { ...b, state: "idle" } : b);
      setVizExtGallery(b => b.state === "ready" ? EMPTY_EXT_GALLERY : b);
      setVizFloorBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
      setVizIntBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
      setVizIntGallery(b => b.state === "ready" ? EMPTY_INT_GALLERY : b);
      setFloorBags(prev => {
        const next: Record<number, AiPlansBag> = {};
        Object.entries(prev).forEach(([k, b]) => { next[Number(k)] = b.state === "ready" ? EMPTY_AI_PLANS : b; });
        return next;
      });
      setParkingBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [form]);

  // ---- ГПЗУ-импорт ---------------------------------------------------------
  const handleGpzuImport = async (file: File) => {
    setGpzuLoading(true);
    setGpzuError(null);
    setGpzuLastResult(null);
    try {
      const ext = await importGpzu(file);
      // Применяем только непустые поля — пользовательский ввод не затираем
      setForm((f) => ({
        ...f,
        site_width_m:    ext.site_width_m    ?? f.site_width_m,
        site_depth_m:    ext.site_depth_m    ?? f.site_depth_m,
        setback_front_m: ext.setback_front_m ?? f.setback_front_m,
        setback_side_m:  ext.setback_side_m  ?? f.setback_side_m,
        setback_rear_m:  ext.setback_rear_m  ?? f.setback_rear_m,
        floors:          ext.max_floors      ?? f.floors,
        max_height_m:    ext.max_height_m    ?? f.max_height_m,
        max_coverage_pct: ext.max_coverage_pct ?? f.max_coverage_pct,
      }));
      setGpzuLastResult(ext);
    } catch (e) {
      setGpzuError((e as Error).message);
    } finally {
      setGpzuLoading(false);
    }
  };

  // ---- CAD DXF-import (P2 MVP) --------------------------------------------
  const handleDxfImport = async (file: File) => {
    setDxfImportLoading(true);
    setDxfImportError(null);
    setDxfImportResult(null);
    try {
      const result = await importFloorplanCad(file);
      setDxfImportResult(result);
    } catch (e) {
      setDxfImportError((e as Error).message);
    } finally {
      setDxfImportLoading(false);
    }
  };

  const applyDxfBoundsToForm = (result: DxfImportResult) => {
    if (!result.bounds) return;
    const scale = dxfUnitToMetersScale(result.units);
    const widthM = roundMetric(result.bounds.width * scale);
    const depthM = roundMetric(result.bounds.height * scale);
    if (widthM <= 0 || depthM <= 0) return;
    setForm((f) => ({
      ...f,
      building_width_m: widthM,
      building_depth_m: depthM,
      site_width_m: widthM,
      site_depth_m: depthM,
      site_polygon: result.site_polygon ?? null,
    }));
  };

  // ---- Vision-анализ контура (Этап 2 ТЗ) -----------------------------------
  const handleContourAnalyze = async (file: File) => {
    setContourLoading(true);
    setContourError(null);
    setContourResult(null);
    try {
      const a = await analyzeContour(file);
      setContourResult(a);
      // Автозаполняем габариты и назначение, если модель уверена и поле пустое
      setForm((f) => ({
        ...f,
        site_width_m: a.estimated_width_m ?? f.site_width_m,
        site_depth_m: a.estimated_depth_m ?? f.site_depth_m,
        purpose:      a.suggested_purpose ?? f.purpose,
      }));
    } catch (e) {
      setContourError((e as Error).message);
    } finally {
      setContourLoading(false);
    }
  };

  // ---- generators
  const wrapImageGen = async (
    setter: React.Dispatch<React.SetStateAction<ImageBag>>,
    fn: () => Promise<VisualizeResult>,
    saveSpec?: { tab: string; variantKey: string },
  ) => {
    setter({ ...EMPTY_IMAGE_BAG, state: "loading" });
    try {
      const result = await fn();
      const imageUrl = URL.createObjectURL(result.blob);
      setter({
        state: "ready",
        imageUrl,
        modelUsed: result.modelUsed,
        enhancerUsed: result.enhancerUsed,
        errorMessage: null,
      });
      if (saveSpec) {
        autoSaveGeneration(
          saveSpec.tab, 1,
          [{ variantKey: saveSpec.variantKey, imageUrl, modelUsed: result.modelUsed ?? undefined }],
          form,
        );
      }
    } catch (e) {
      setter({ ...EMPTY_IMAGE_BAG, state: "error", errorMessage: (e as Error).message });
    }
  };

  const generateSite = () => {
    if (!siteFile) {
      setSiteBag({ ...EMPTY_IMAGE_BAG, state: "error", errorMessage: "Загрузите аэрофото участка" });
      return;
    }
    if (!siteBldFile) {
      setSiteBag({ ...EMPTY_IMAGE_BAG, state: "error", errorMessage: "Загрузите фото или рендер здания" });
      return;
    }
    return wrapImageGen(
      setSiteBag,
      () => visualizeSitePlacement(siteFile, buildVisReq(form), siteBldFile),
      { tab: "site", variantKey: "placement" },
    );
  };

  // Генератор интерьер-галереи — по типам из процентов формы
  const generateInteriorGallery = async () => {
    setVizIntGallery({ ...EMPTY_INT_GALLERY, state: "loading" });
    try {
      const aptTypes = (["studio", "k1", "k2", "k3"] as const)
        .filter((t) => {
          if (t === "studio") return form.studio_pct > 0;
          if (t === "k1")    return form.k1_pct > 0;
          if (t === "k2")    return form.k2_pct > 0;
          if (t === "k3")    return form.k3_pct > 0;
          return false;
        })
        .map((t) => ({
          apt_type: t,
          area: t === "studio" ? 30 : t === "k1" ? 45 : t === "k2" ? 65 : 88,
          width: t === "studio" ? 5.5 : t === "k1" ? 6.5 : t === "k2" ? 7.8 : 9.2,
          depth: t === "studio" ? 5.5 : t === "k1" ? 7.0 : t === "k2" ? 8.2 : 9.6,
          zone_kinds:
            t === "studio" ? ["living", "kitchen", "bathroom", "hall"]
            : t === "k1"   ? ["living", "bedroom", "kitchen", "bathroom", "hall"]
            : t === "k2"   ? ["living", "bedroom", "bedroom", "kitchen", "bathroom", "hall"]
                            : ["living", "bedroom", "bedroom", "bedroom", "kitchen", "bathroom", "bathroom", "hall"],
          count: 1,
        }));

      if (aptTypes.length === 0) aptTypes.push({
        apt_type: "k2", area: 65, width: 7.8, depth: 8.2,
        zone_kinds: ["living", "bedroom", "bedroom", "kitchen", "bathroom", "hall"], count: 1,
      });

      const intReq = {
        floors: form.floors,
        purpose: form.purpose,
        quality: "medium" as const,
        apt_types: aptTypes,
      };
      // Если есть мебельный план («С мебелью») — сидим им интерьеры через
      // image-edit (стиль/состав по плану). Иначе — обычный text→image.
      const seedUrl = vizFloorBag.state === "ready" ? vizFloorBag.imageUrl : null;
      const res = seedUrl
        ? await visualizeInteriorGalleryEdit(
            await fetch(seedUrl).then((r) => r.blob()),
            intReq,
            vizSource?.planPrompt,
          )
        : await visualizeInteriorGallery(intReq);
      setVizIntGallery({ state: "ready", items: res.items, elapsedMs: res.elapsed_ms, errorMessage: null });
      autoSaveGeneration(
        "viz_interior", 1,
        res.items.map((it) => ({
          variantKey: it.apt_type,
          imageUrl: `data:image/png;base64,${it.image_b64}`,
          modelUsed: it.model_used,
        })),
        form,
      );
    } catch (e) {
      setVizIntGallery({ ...EMPTY_INT_GALLERY, state: "error", errorMessage: (e as Error).message });
    }
  };

  // Растеризация скрытого FloorPlanSvg в PNG. setRasterLayout монтирует план в
  // offscreen-контейнер, ждём два кадра до paint, снимаем <svg> → PNG-блоб.
  useEffect(() => {
    if (!rasterLayout) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (cancelled) return;
        try {
          const svg = rasterContainerRef.current?.querySelector("svg") as SVGSVGElement | null;
          if (!svg) throw new Error("Не удалось отрендерить план для растеризации");
          const blob = await svgToPngBlob(svg, { background: "#FFFFFF", scaleFactor: 70 });
          rasterResolveRef.current?.(blob);
        } catch (e) {
          rasterRejectRef.current?.(e as Error);
        } finally {
          rasterResolveRef.current = null;
          rasterRejectRef.current = null;
          setRasterLayout(null);
        }
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [rasterLayout]);

  const rasterizePlanToPng = (layout: LayoutFloor): Promise<Blob> =>
    new Promise<Blob>((resolve, reject) => {
      rasterResolveRef.current = resolve;
      rasterRejectRef.current = reject;
      setRasterLayout(layout);
    });

  // «С мебелью» через image-edit. Если из AI Чертежей захвачен контекст
  // (vizSource) — берём ТОТ ЖЕ чертёж и его параметры. Иначе fallback:
  // генерим детерминированный план и растеризуем его.
  const generateFloorplanFurniture = async () => {
    setVizFloorBag({ ...EMPTY_IMAGE_BAG, state: "loading" });
    try {
      const req = vizSource?.req ?? buildVisReq(form);
      let planBlob: Blob;
      if (vizSource?.planImageUrl) {
        planBlob = await fetch(vizSource.planImageUrl).then((r) => r.blob());
      } else {
        const layout = await generateFloorLayout(req);
        planBlob = await rasterizePlanToPng(layout);
      }
      const result = await visualizeFloorplanFurnitureEdit(planBlob, req, vizSource?.planPrompt);
      const imageUrl = URL.createObjectURL(result.blob);
      setVizFloorBag({
        state: "ready", imageUrl,
        modelUsed: result.modelUsed, enhancerUsed: result.enhancerUsed,
        errorMessage: null,
      });
      autoSaveGeneration(
        "viz_floor", 1,
        [{ variantKey: "floor", imageUrl, modelUsed: result.modelUsed ?? undefined }],
        form,
      );
    } catch (e) {
      setVizFloorBag({ ...EMPTY_IMAGE_BAG, state: "error", errorMessage: (e as Error).message });
    }
  };

  // Экстерьер-галерея: несколько ракурсов здания (hero/entrance/aerial/courtyard).
  const generateExteriorGallery = async () => {
    setVizExtGallery({ ...EMPTY_EXT_GALLERY, state: "loading" });
    try {
      const res = await visualizeExteriorGallery(buildVisReq(form));
      const items: ExtGalleryItemUI[] = res.items.map((it) => ({
        view: it.view,
        label: it.label,
        imageUrl: `data:image/png;base64,${it.image_b64}`,
        modelUsed: it.model_used,
      }));
      setVizExtGallery({ state: "ready", items, elapsedMs: res.elapsed_ms, errorMessage: null });
      autoSaveGeneration(
        "viz_exterior", 1,
        items.map((it) => ({ variantKey: `exterior_${it.view}`, imageUrl: it.imageUrl, modelUsed: it.modelUsed ?? undefined })),
        form,
      );
    } catch (e) {
      setVizExtGallery({ ...EMPTY_EXT_GALLERY, state: "error", errorMessage: (e as Error).message });
    }
  };

  // Генерация одного режима (по активному vizMode) — для ручного запуска
  const generateViz = () => {
    if (vizMode === "exterior")                 generateExteriorGallery();
    else if (vizMode === "floorplan_furniture") generateFloorplanFurniture();
    else                                        generateInteriorGallery();
  };

  // Запуск всех параллельно — ручная кнопка «Генерировать всё».
  const generateAllViz = () => {
    generateExteriorGallery();
    generateFloorplanFurniture();
    generateInteriorGallery();
  };

  // Клик «Визуализация» в AI Чертежах: захватываем ИМЕННО этот чертёж +
  // текущие параметры в единый контекст и переходим в Визуализации. Генерацию
  // юзер запускает сам кнопкой в нужном блоке.
  const goToViz = (planImageUrl?: string, planPrompt?: string) => {
    if (planImageUrl) {
      setVizSource({
        id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
        req: buildVisReq(form),
        planImageUrl,
        planPrompt,
      });
    }
    setTab("viz");
  };

  const generateAiPlans = async () => {
    const fl = currentFloor;
    const snapForm = form;
    setFloorBags(prev => ({ ...prev, [fl]: { ...EMPTY_AI_PLANS, state: "loading" } }));
    try {
      const res = await visualizeFloorByLevel({ ...buildVisReq(snapForm), floor_number: fl });
      const variants: AiPlanVariant[] = res.variants.map((v) => ({
        key: v.key,
        label: v.label,
        modelUsed: v.model_used,
        enhancerUsed: v.enhancer_used,
        imageUrl: `data:image/png;base64,${v.image_b64}`,
        promptUsed: v.prompt_used ?? "",
      }));
      setFloorBags(prev => ({ ...prev, [fl]: { state: "ready", variants, elapsedMs: res.elapsed_ms, errorMessage: null } }));
      // авто-сохранение в фоне
      autoSaveGeneration(
        "ai_plans", fl,
        variants.map((v) => ({ variantKey: v.key, imageUrl: v.imageUrl, modelUsed: v.modelUsed })),
        snapForm,
      );
    } catch (e) {
      setFloorBags(prev => ({ ...prev, [fl]: { ...EMPTY_AI_PLANS, state: "error", errorMessage: (e as Error).message } }));
    }
  };

  const generateParking = () =>
    wrapImageGen(setParkingBag, () => visualizeParking({ ...buildVisReq(form), parking_level: parkingLevel }));

  const generatePlacement = async () => {
    if (!placementSiteFile || !placementBldFile) {
      setPlacementBag({ ...EMPTY_PLACEMENT, state: "error", errorMessage: "Загрузите оба изображения: аэрофото участка и фото ЖК" });
      return;
    }
    setPlacementBag({ ...EMPTY_PLACEMENT, state: "loading" });
    try {
      const res = await visualizeSitePlacementVariants(placementSiteFile, placementBldFile, {
        site_width_m:    form.site_width_m,
        site_depth_m:    form.site_depth_m,
        setback_front_m: form.setback_front_m,
        setback_side_m:  form.setback_side_m,
        setback_rear_m:  form.setback_rear_m,
        floors:          form.floors,
        purpose:         form.purpose,
        quality:         "medium",
      });
      setPlacementBag({ state: "ready", variants: res.variants, elapsedMs: res.elapsed_ms, errorMessage: null });
      autoSaveGeneration(
        "placement", 1,
        res.variants.map((v) => ({
          variantKey: v.key,
          imageUrl: `data:image/png;base64,${v.image_b64}`,
          modelUsed: v.model_used,
        })),
        form,
      );
    } catch (e) {
      setPlacementBag({ ...EMPTY_PLACEMENT, state: "error", errorMessage: (e as Error).message });
    }
  };

  // Экспорт полного отчёта (Этап 5 ТЗ): обложка + ГПЗУ + анализ контура +
  // 5 чертежей + 3 посадки + экстерьер + интерьеры → один PDF.
  const handleExportFullReport = async () => {
    await exportFullReportPdf({
      form,
      gpzu: gpzuLastResult,
      contour: contourResult,
      aiPlans: currentFloorBag.state === "ready" ? currentFloorBag.variants : [],
      placement: placementBag.state === "ready" ? placementBag.variants : [],
      exteriorUrl: vizExtGallery.state === "ready" && vizExtGallery.items[0] ? vizExtGallery.items[0].imageUrl : null,
      floorplanFurnitureUrl: vizFloorBag.state === "ready" ? vizFloorBag.imageUrl : null,
      interiors: vizIntGallery.state === "ready" ? vizIntGallery.items : [],
      pdfViz: pdfVizResults,
    });
  };

  // ---- восстановление из истории
  const handleRestoreRun = useCallback((run: GenerationRun) => {
    setRestoredRun(null);
    if (run.tab === "ai_plans") {
      const variants: AiPlanVariant[] = run.assets.map((a) => ({
        key: a.variant_key,
        label: VARIANT_LABEL[a.variant_key] ?? a.variant_key,
        imageUrl: a.url,
        modelUsed: a.model_used ?? "",
        enhancerUsed: "",
        promptUsed: "",
      }));
      setFloorBags((prev) => ({
        ...prev,
        [run.floor]: { state: "ready", variants, elapsedMs: null, errorMessage: null },
      }));
      setCurrentFloor(run.floor);
      setTab("ai_plans");
    } else if (run.tab === "viz_exterior" && run.assets.length > 0) {
      setVizExtGallery({
        state: "ready",
        items: extItemsFromAssets(run.assets),
        elapsedMs: null,
        errorMessage: null,
      });
      setVizMode("exterior");
      setTab("viz");
    } else if (run.tab === "viz_floor" && run.assets[0]) {
      setVizFloorBag({ state: "ready", imageUrl: run.assets[0].url, modelUsed: run.assets[0].model_used, enhancerUsed: null, errorMessage: null });
      setVizMode("floorplan_furniture");
      setTab("viz");
    } else if (run.tab === "site" && run.assets[0]) {
      setSiteBag({ state: "ready", imageUrl: run.assets[0].url, modelUsed: run.assets[0].model_used, enhancerUsed: null, errorMessage: null });
      setTab("site");
    } else if (run.tab === "gis_masterplan_render" && run.assets[0]) {
      setGisRenderBag({
        state: "ready",
        imageUrl: run.assets[0].url,
        modelUsed: run.assets[0].model_used,
        enhancerUsed: null,
        errorMessage: null,
      });
      setTab("site");
    } else if (run.assets.length > 0) {
      setRestoredRun(run);
      setTab(topTabForRun(run.tab));
    }
  }, []);

  const handleRestoreParams = useCallback((params: PromptFormState) => {
    setForm(params);
  }, []);

  const handleNewProject = () => {
    setProjectId(null);
    setProjectName("Без названия");
    setForm(DEFAULT_PROMPT_FORM);
    setFloorBags({});
    setVizSource(null);
    setVizExtGallery(EMPTY_EXT_GALLERY);
    setVizFloorBag(EMPTY_IMAGE_BAG);
    setSiteBag(EMPTY_IMAGE_BAG);
    setCostPlacementDraft(DEFAULT_COST_PLACEMENT_DRAFT);
    setGisHandoff(null);
    setGisMasterplanBag(EMPTY_GIS_MASTERPLAN);
    setSelectedGisScenarioKey(null);
    setGisStrategyHint(DEFAULT_GIS_STRATEGY_HINT);
    setGisRenderBag(EMPTY_IMAGE_BAG);
    setCurrentFloor(1);
    window.history.replaceState(null, "", "/app");
  };

  const handleOpenProject = (p: ProjectType) => {
    window.location.href = `/app?project=${p.id}`;
  };

  const [cadExportLoading, setCadExportLoading] = useState<CadExportKind | null>(null);
  const handleExportDxf = async () => {
    if (cadExportLoading !== null) return;
    setCadExportLoading("dxf");
    try {
      const { blob, filename, metricsHeaders } = await exportFloorplanDxf(buildVisReq(form));
      downloadBlob(blob, filename);
      console.log("DXF metrics:", metricsHeaders);
    } catch (e) {
      alert(`Не удалось сгенерировать DXF: ${(e as Error).message}`);
    } finally {
      setCadExportLoading(null);
    }
  };

  const handleExportIfc = async () => {
    if (cadExportLoading !== null) return;
    setCadExportLoading("ifc");
    try {
      const visReq = buildVisReq(form);
      let result;
      try {
        // Богатый IFC: GPT-планировка → IfcSpace на каждую комнату
        const layout = await generateFloorLayout(visReq);
        result = await exportFloorplanIfc(visReq, layout);
      } catch {
        // Фолбэк: параметрический IFC (перекрытия/ядра/коридоры) без layout
        result = await exportFloorplanIfc(visReq);
      }
      downloadBlob(result.blob, result.filename);
      console.log("IFC project:", result.projectHeaders);
    } catch (e) {
      alert(`Не удалось сгенерировать IFC: ${(e as Error).message}`);
    } finally {
      setCadExportLoading(null);
    }
  };

  const onGenerate =
    tab === "site"      ? generateSite
    : tab === "ai_plans"  ? generateAiPlans
    : tab === "placement" ? generatePlacement
    : tab === "cost_placement" ? (() => {})
    : generateViz;

  // active state для индикатора loading в кнопке
  const vizAnyLoading = vizExtGallery.state === "loading" || vizFloorBag.state === "loading" || vizIntBag.state === "loading" || vizIntGallery.state === "loading";
  const currentFloorBag = floorBags[currentFloor] ?? EMPTY_AI_PLANS;
  const isLoading =
    tab === "site"        ? siteBag.state === "loading"
    : tab === "ai_plans"  ? currentFloorBag.state === "loading"
    : tab === "placement" ? placementBag.state === "loading"
    : tab === "cost_placement" ? false
    : vizAnyLoading;

  if (!authChecked) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-white/40 text-sm">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        session={session}
        onSignOut={() => { signOut(); router.replace("/"); }}
        onSave={saveProject}
        saving={saving}
        saveOk={saveOk}
        autoSaving={autoSaving}
        autoSaveLabel={autoSaveLabel}
        saveError={saveError}
        projectName={projectName}
        onRenameProject={setProjectName}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        recentProjects={recentProjects}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProject}
      />
      <TabStrip
        tab={tab}
        onChange={(nextTab) => {
          setRestoredRun(null);
          setTab(nextTab);
        }}
        onExportDxf={handleExportDxf}
        onExportIfc={handleExportIfc}
        cadExportLoading={cadExportLoading}
      />

      <main
        className="flex-1 px-6 pb-6 pt-4 grid gap-4"
        style={{ gridTemplateColumns: (tab === "placement" || tab === "cost_placement" || tab === "site" || tab === "pdf_viz" || tab === "arch_drawings") ? "1fr" : "300px minmax(0, 1fr)" }}
      >
        {/* LEFT — форма + панель валидации (скрыто на фото-табах) */}
        {tab !== "placement" && tab !== "cost_placement" && tab !== "site" && tab !== "pdf_viz" && tab !== "arch_drawings" && (
          <div className="flex flex-col gap-3 min-h-0">
            <PromptForm
              value={form}
              onChange={setForm}
              onGenerate={onGenerate}
              generating={isLoading}
            />
            <ValidationPanel request={buildVisReq(form)} />
            <KvartirografiyaPanel request={buildVisReq(form)} />
            <InsolationPanel />
          </div>
        )}

        {/* RIGHT — зависит от таба + панель истории */}
        <div className="flex min-h-[660px] gap-0 rounded-2xl overflow-hidden">
        <section className="surface-strong relative overflow-hidden flex flex-col flex-1 min-w-0 rounded-2xl" style={historyOpen ? { borderRadius: "1rem 0 0 1rem" } : {}}>
          {gisHandoff && tab !== "site" && (
            <GisMasterplanIntakePanel
              handoff={gisHandoff}
              onOpenSite={() => setTab("site")}
              onOpenAi={() => setTab("ai_plans")}
              onOpenCost={handleOpenCostFromGis}
              strategyHint={gisStrategyHint}
              onStrategyHintChange={setGisStrategyHint}
              onGenerateMasterplan={handleGenerateGisMasterplan}
              masterplanState={gisMasterplanBag.state}
              onDismiss={() => {
                setGisHandoff(null);
                setSelectedGisScenarioKey(null);
                setGisStrategyHint(DEFAULT_GIS_STRATEGY_HINT);
                setGisMasterplanBag(EMPTY_GIS_MASTERPLAN);
              }}
            />
          )}
          {gisHandoff && tab !== "site" && gisMasterplanBag.response && (
            <GisAiMasterplanPanel
              handoff={gisHandoff}
              response={gisMasterplanBag.response}
              selectedScenarioKey={selectedGisScenarioKey}
              errorMessage={gisMasterplanBag.errorMessage}
              onSelectScenario={handleSelectGisScenario}
              onOpenCost={handleOpenCostFromGis}
              onRegenerate={handleGenerateGisMasterplan}
              renderBag={gisRenderBag}
              onGenerateRender={handleGenerateGisRender}
            />
          )}
          {gisHandoff && tab !== "site" && gisMasterplanBag.state === "error" && !gisMasterplanBag.response && (
            <div className="border-b border-rose-300/15 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-100">
              AI-мастерплан не сгенерировался: {gisMasterplanBag.errorMessage}
            </div>
          )}
          {restoredRun && topTabForRun(restoredRun.tab) === tab && (
            <SavedRunGallery run={restoredRun} onClose={() => setRestoredRun(null)} />
          )}
          {tab === "site" && (
            <>
              {gisHandoff && (
                <GisMasterplanWorkspace
                  handoff={gisHandoff}
                  response={gisMasterplanBag.response}
                  selectedScenarioKey={selectedGisScenarioKey}
                  errorMessage={gisMasterplanBag.errorMessage}
                  strategyHint={gisStrategyHint}
                  onStrategyHintChange={setGisStrategyHint}
                  masterplanState={gisMasterplanBag.state}
                  onGenerateMasterplan={handleGenerateGisMasterplan}
                  onSelectScenario={handleSelectGisScenario}
                  onUpdateObject={handleUpdateGisScenarioObject}
                  onOpenCost={handleOpenCostFromGis}
                  renderBag={gisRenderBag}
                  onGenerateRender={handleGenerateGisRender}
                  onDismiss={() => {
                    setGisHandoff(null);
                    setSelectedGisScenarioKey(null);
                    setGisStrategyHint(DEFAULT_GIS_STRATEGY_HINT);
                    setGisMasterplanBag(EMPTY_GIS_MASTERPLAN);
                    setGisRenderBag(EMPTY_IMAGE_BAG);
                  }}
                />
              )}
              <SiteTab
                bag={siteBag}
                onGenerate={generateSite}
                file={siteFile}
                setFile={setSiteFile}
                preview={sitePreview}
                setPreview={setSitePreview}
                bldFile={siteBldFile}
                setBldFile={setSiteBldFile}
                bldPreview={siteBldPreview}
                setBldPreview={setSiteBldPreview}
                siteW={form.site_width_m}
                siteD={form.site_depth_m}
                floors={form.floors}
                onSiteW={v => setForm(f => ({ ...f, site_width_m: v }))}
                onSiteD={v => setForm(f => ({ ...f, site_depth_m: v }))}
                onFloors={v => setForm(f => ({ ...f, floors: v }))}
              />
            </>
          )}
          {tab === "viz" && (
            <VizTab
              extGallery={vizExtGallery}
              floorBag={vizFloorBag}
              intBag={vizIntBag}
              intGallery={vizIntGallery}
              mode={vizMode}
              setMode={setVizMode}
              onGenerate={generateViz}
              onGenerateAll={generateAllViz}
            />
          )}
          {tab === "ai_plans" && (
            <AiPlansTab
              bag={currentFloorBag}
              currentFloor={currentFloor}
              totalFloors={form.floors}
              onChangeFloor={setCurrentFloor}
              floorBags={floorBags}
              onGenerate={generateAiPlans}
              onGoToViz={goToViz}
              dxfImportLoading={dxfImportLoading}
              dxfImportResult={dxfImportResult}
              dxfImportError={dxfImportError}
              onDxfImport={handleDxfImport}
              onClearDxfImport={() => { setDxfImportResult(null); setDxfImportError(null); }}
              onApplyDxfBounds={applyDxfBoundsToForm}
              onExportDxf={() => handleExportDxf()}
              onExportIfc={() => handleExportIfc()}
              cadExportLoading={cadExportLoading}
              gpzuLoading={gpzuLoading}
              gpzuLastResult={gpzuLastResult}
              gpzuError={gpzuError}
              onGpzuImport={handleGpzuImport}
              onClearGpzu={() => { setGpzuLastResult(null); setGpzuError(null); }}
              contourLoading={contourLoading}
              contourResult={contourResult}
              contourError={contourError}
              onContourAnalyze={handleContourAnalyze}
              onClearContour={() => { setContourResult(null); setContourError(null); }}
              onApplyContourDims={(w, d) => setForm(f => ({ ...f, site_width_m: w, site_depth_m: d, building_width_m: w, building_depth_m: d }))}

              inputs={buildVisReq(form)}
              onGetMetrics={() => getFloorplanMetrics(buildVisReq(form))}
              parkingBag={parkingBag}
              parkingLevel={parkingLevel}
              parkingLevelsTotal={form.parking_underground_levels}
              onParkingLevel={setParkingLevel}
              onGenerateParking={generateParking}
              onExportFullReport={handleExportFullReport}
              hasExtraSections={
                placementBag.state === "ready" ||
                vizExtGallery.state === "ready" ||
                vizFloorBag.state === "ready" ||
                vizIntGallery.state === "ready" ||
                Object.values(floorBags).some(b => b.state === "ready")
              }
            />
          )}
          {tab === "placement" && (
            <PlacementTab
              bag={placementBag}
              siteFile={placementSiteFile}
              sitePreview={placementSitePreview}
              bldFile={placementBldFile}
              bldPreview={placementBldPreview}
              onSiteFile={(f) => { if (placementSitePreview) URL.revokeObjectURL(placementSitePreview); setPlacementSiteFile(f); setPlacementSitePreview(f ? URL.createObjectURL(f) : null); }}
              onBldFile={(f)  => { if (placementBldPreview)  URL.revokeObjectURL(placementBldPreview);  setPlacementBldFile(f);  setPlacementBldPreview(f  ? URL.createObjectURL(f)  : null); }}
              onGenerate={generatePlacement}
            />
          )}
          {tab === "cost_placement" && (
            <CostPlacementTab
              value={costPlacementDraft}
              onChange={setCostPlacementDraft}
            />
          )}
          <div className={tab === "pdf_viz" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
            <PdfVizTab
              onAutoSave={(pageIndex, asset) => {
                autoSaveGeneration("pdf_viz", pageIndex, [asset], form);
              }}
              onResultsChange={setPdfVizResults}
            />
          </div>
          <div className={tab === "arch_drawings" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
            <ArchitecturalDrawingsTab
              active={tab === "arch_drawings"}
              onAutoSave={(asset) => {
                autoSaveGeneration("arch_drawings", 1, [asset], form);
              }}
            />
          </div>
        </section>
        {historyOpen && (
          <HistoryPanel
            projectId={projectId}
            currentTab={tab === "cost_placement" ? undefined : tab}
            onRestoreImages={handleRestoreRun}
            onRestoreParams={handleRestoreParams}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        </div>
      </main>

      {/* Offscreen-рендер плана для растеризации SVG → PNG (референс «С мебелью»).
          viewBox в FloorPlanSvg задан, поэтому реальный размер контейнера на
          результат не влияет — нужен лишь смонтированный <svg> в DOM. */}
      <div
        ref={rasterContainerRef}
        aria-hidden
        style={{ position: "fixed", left: -100000, top: 0, width: 1100, height: 760, pointerEvents: "none", opacity: 0, zIndex: -1 }}
      >
        {rasterLayout && <FloorPlanSvg layout={rasterLayout} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header & TabStrip
// ---------------------------------------------------------------------------

function SavedRunGallery({ run, onClose }: { run: GenerationRun; onClose: () => void }) {
  return (
    <div data-testid="saved-run-gallery" className="absolute inset-0 z-20 bg-[#111] flex flex-col">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
        <History size={14} className="text-violet-300" />
        <div>
          <div className="text-[13px] font-medium text-white/85">Сохраненный результат</div>
          <div className="text-[11px] text-white/35">{run.tab} · {run.assets.length} изображений</div>
        </div>
        <button
          onClick={onClose}
          className="ml-auto h-8 px-3 rounded-full border border-white/[0.08] bg-white/[0.04] text-[11.5px] text-white/60 hover:text-white transition flex items-center gap-1.5"
        >
          <X size={11} /> Вернуться в рабочую область
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {run.assets.map((asset) => <SavedAssetCard key={asset.id} asset={asset} />)}
        </div>
      </div>
    </div>
  );
}

function GisMasterplanWorkspace({
  handoff,
  response,
  selectedScenarioKey,
  errorMessage,
  strategyHint,
  onStrategyHintChange,
  masterplanState,
  onGenerateMasterplan,
  onSelectScenario,
  onUpdateObject,
  onOpenCost,
  renderBag,
  onGenerateRender,
  onDismiss,
}: {
  handoff: GisMasterplanHandoff;
  response: GisMasterplanResponse | null;
  selectedScenarioKey: string | null;
  errorMessage: string | null;
  strategyHint: string;
  onStrategyHintChange: (value: string) => void;
  masterplanState: GenState;
  onGenerateMasterplan: () => void;
  onSelectScenario: (scenarioKey: string) => void;
  onUpdateObject: (objectId: string, patch: GisMasterplanScenarioObjectPatch) => void;
  onOpenCost: () => void;
  renderBag: ImageBag;
  onGenerateRender: () => void;
  onDismiss: () => void;
}) {
  const parcelById = new Map(handoff.parcels.map((parcel) => [parcel.id, parcel]));
  const selectedScenario = response?.scenarios.find((scenario) => scenario.key === selectedScenarioKey)
    ?? response?.scenarios[0]
    ?? null;
  const metrics = selectedScenario ? scenarioMetrics(selectedScenario, handoff) : null;
  const ruleIssues = selectedScenario ? evaluateGisScenarioRules(selectedScenario, handoff) : [];
  const notes = selectedScenario ? [...selectedScenario.warnings, ...selectedScenario.rule_notes] : [];

  return (
    <div
      data-testid="gis-masterplan-workspace"
      className="border-b border-emerald-300/15 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.13),rgba(9,9,12,0.96)_38%,rgba(9,9,12,0.98))] px-4 py-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/75">Рабочее место участка</div>
          <div className="mt-1 text-[18px] font-semibold tracking-tight text-white/92">
            GIS-мастерплан: {handoff.summary.parcelsCount} участк.
          </div>
          <div className="mt-1 max-w-3xl text-[12px] leading-relaxed text-white/48">
            Выбранные участки из карты превращаются в управляемый сценарий: ТЗ, AI-посадка, контроль метрик, визуализация и переход к стоимости.
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onGenerateMasterplan}
            disabled={masterplanState === "loading"}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-300/12 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-300/18 disabled:cursor-wait disabled:opacity-60"
          >
            {masterplanState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {response ? "Перегенерировать сценарии" : "Сгенерировать сценарии"}
          </button>
          <button
            type="button"
            onClick={onGenerateRender}
            disabled={!selectedScenario || renderBag.state === "loading"}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {renderBag.state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            AI-визуализация
          </button>
          <button type="button" onClick={onOpenCost} className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/15">
            Стоимость
          </button>
          <button type="button" onClick={onDismiss} className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/45 hover:bg-white/[0.07]">
            Скрыть GIS
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <WorkspaceStat label="Площадь" value={fmtM2(handoff.summary.totalAreaM2)} />
        <WorkspaceStat label="Участки" value={String(handoff.summary.parcelsCount)} />
        <WorkspaceStat label="Средняя этажность" value={`${handoff.summary.avgFloors} эт.`} />
        <WorkspaceStat label="Зоны" value={handoff.summary.functionalZones.join(", ") || "не указано"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.4fr)_minmax(320px,0.75fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/[0.08] bg-black/22 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">ТЗ для AI-посадки</div>
              <div className="text-[10.5px] text-white/28">дома, садики, дороги, двор, паркинг</div>
            </div>
            <textarea
              data-testid="gis-masterplan-prompt"
              value={strategyHint}
              onChange={(event) => onStrategyHintChange(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[12px] leading-relaxed text-white/78 outline-none placeholder:text-white/25 focus:border-emerald-300/35"
              placeholder="Например: 4 жилых корпуса по краям, садик рядом с дорогой, двор без машин, гостевой паркинг у въезда..."
            />
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-black/18">
            <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">
              Участки из карты
            </div>
            <div className="max-h-44 overflow-auto p-2">
              {handoff.parcels.map((parcel) => (
                <div key={parcel.id} className="mb-1 rounded-xl border border-white/[0.055] bg-white/[0.025] px-3 py-2 last:mb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-white/76">{parcel.name || parcel.designation || "Участок"}</div>
                      <div className="truncate text-[10.5px] text-white/35">{parcel.functionalZone || "зона не указана"}</div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-white/45">{fmtM2(parcel.areaM2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/[0.08] bg-black/22 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">Просмотр сценария</div>
                <div className="mt-0.5 text-[13px] font-semibold text-white/82">
                  {selectedScenario ? gisScenarioTitle(selectedScenario) : "Сценарий еще не создан"}
                </div>
              </div>
              {selectedScenario && (
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10.5px] text-emerald-100/80">
                  {selectedScenario.objects.length} объектов
                </span>
              )}
            </div>

            {renderBag.state === "ready" && renderBag.imageUrl ? (
              <div className="overflow-hidden rounded-xl border border-cyan-300/15 bg-black/25">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={renderBag.imageUrl} alt="AI-визуализация GIS-мастерплана" className="max-h-[420px] w-full object-cover" />
                <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/42">
                  <span>Сохраненный концепт-рендер</span>
                  <a href={renderBag.imageUrl} download={`gis-masterplan-${selectedScenario?.key ?? "render"}.png`} className="text-cyan-100/80 hover:text-cyan-50">Скачать PNG</a>
                </div>
              </div>
            ) : selectedScenario ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <GisScenarioPreview scenario={selectedScenario} parcelById={parcelById} issues={ruleIssues} className="h-72 w-full rounded-xl border border-white/[0.06] bg-[#0b1020]" />
                <GisScenarioAxonometricPreview scenario={selectedScenario} parcelById={parcelById} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.10] bg-white/[0.025] px-4 py-12 text-center">
                <div className="text-sm font-medium text-white/75">Сначала сгенерируйте AI-сценарии</div>
                <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-white/40">
                  Plana возьмет реальные участки, ваше ТЗ и соберет 3 варианта посадки для ранней проверки.
                </div>
              </div>
            )}

            {renderBag.state === "loading" && (
              <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-[12px] text-cyan-50/75">
                Генерирую клиентский рендер территории...
              </div>
            )}
            {renderBag.state === "error" && (
              <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
                AI-визуализация не удалась: {renderBag.errorMessage}
              </div>
            )}
            {errorMessage && (
              <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
                AI-мастерплан не сгенерировался: {errorMessage}
              </div>
            )}
          </div>

          {response && (
            <div className="grid gap-2 md:grid-cols-3">
              {response.scenarios.map((scenario) => {
                const isSelected = selectedScenario?.key === scenario.key;
                return (
                  <button
                    type="button"
                    key={scenario.key}
                    onClick={() => onSelectScenario(scenario.key)}
                    className={[
                      "rounded-2xl border p-3 text-left transition",
                      isSelected ? "border-emerald-300/40 bg-emerald-300/[0.08]" : "border-white/[0.08] bg-black/18 hover:bg-white/[0.045]",
                    ].join(" ")}
                  >
                    <div className="text-[12px] font-semibold text-white/82">{gisScenarioTitle(scenario)}</div>
                    <div className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-white/40">{scenario.strategy}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/[0.08] bg-black/22 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">Ключевые метрики</div>
            {metrics ? (
              <div className="grid grid-cols-2 gap-2">
                <DetailMetric label="GFA" value={fmtM2(metrics.gfa)} />
                <DetailMetric label="Пятно" value={fmtM2(metrics.footprint)} />
                <DetailMetric label="Застройка" value={`${metrics.coveragePct.toFixed(1)}%`} />
                <DetailMetric label="КИТ/FAR" value={metrics.far.toFixed(2)} />
                <DetailMetric label="Корпуса" value={String(metrics.residentialCount)} />
                <DetailMetric label="Соц." value={String(metrics.socialCount)} />
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-6 text-center text-[12px] text-white/38">
                Метрики появятся после генерации сценария.
              </div>
            )}
          </div>

          {selectedScenario && (
            <div className="rounded-2xl border border-white/[0.08] bg-black/18">
              <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">
                Объекты
              </div>
              <div className="max-h-56 overflow-auto p-2">
                {selectedScenario.objects.map((object) => (
                  <div key={object.id} className="mb-1 rounded-xl bg-white/[0.035] px-3 py-2 last:mb-0">
                    <div className="flex justify-between gap-2 text-[11.5px]">
                      <span className="truncate text-white/72">{gisObjectLabel(object)}</span>
                      <span className="shrink-0 text-white/38">{Math.round(object.width)}×{Math.round(object.depth)} м</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.05] p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-100/70">Что проверить дальше</div>
            <div className="space-y-1 text-[11px] leading-relaxed text-amber-50/62">
              {(notes.length ? notes.slice(0, 7) : [
                "Нужны красные линии и официальный ПДП/ГПЗУ.",
                "Нужны парковочные нормы и инсоляция для финального решения.",
                "Стоимость пока Class 5, не официальная смета РК.",
              ]).map((note) => (
                <div key={note}>- {note}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedScenario && metrics && (
        <GisScenarioControlDeck
          handoff={handoff}
          scenario={selectedScenario}
          metrics={metrics}
          notes={notes}
          ruleIssues={ruleIssues}
          renderBag={renderBag}
          onUpdateObject={onUpdateObject}
          onGenerateRender={onGenerateRender}
          onOpenCost={onOpenCost}
        />
      )}
    </div>
  );
}

function GisScenarioControlDeck({
  handoff,
  scenario,
  metrics,
  notes,
  ruleIssues,
  renderBag,
  onUpdateObject,
  onGenerateRender,
  onOpenCost,
}: {
  handoff: GisMasterplanHandoff;
  scenario: GisMasterplanResponse["scenarios"][number];
  metrics: ReturnType<typeof scenarioMetrics>;
  notes: string[];
  ruleIssues: GisRuleIssue[];
  renderBag: ImageBag;
  onUpdateObject: (objectId: string, patch: GisMasterplanScenarioObjectPatch) => void;
  onGenerateRender: () => void;
  onOpenCost: () => void;
}) {
  const program = summarizeScenarioProgram(scenario);
  const sortedObjects = [...scenario.objects].sort((a, b) => objectSortRank(a.type) - objectSortRank(b.type));
  const blockingCount = ruleIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = ruleIssues.filter((issue) => issue.severity === "warning").length;
  return (
    <div data-testid="gis-scenario-control-deck" className="mt-4 rounded-3xl border border-white/[0.08] bg-black/24 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65">Детальный пакет сценария</div>
          <div className="mt-1 text-[17px] font-semibold text-white/90">{gisScenarioTitle(scenario)}</div>
          <div className="mt-1 max-w-4xl text-[12px] leading-relaxed text-white/45">{scenario.strategy}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="gis-detail-render"
            onClick={onGenerateRender}
            disabled={renderBag.state === "loading"}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            {renderBag.state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {renderBag.imageUrl ? "Обновить рендер" : "Создать рендер"}
          </button>
          <button type="button" data-testid="gis-detail-cost" onClick={onOpenCost} className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/15">
            Рассчитать стоимость
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <WorkspaceStat label="GFA сценария" value={fmtM2(metrics.gfa)} />
            <WorkspaceStat label="КИТ / FAR" value={metrics.far.toFixed(2)} />
            <WorkspaceStat label="Пятно" value={fmtM2(metrics.footprint)} />
            <WorkspaceStat label="Застройка" value={`${metrics.coveragePct.toFixed(1)}%`} />
          </div>

          <div
            data-testid="gis-rule-checks"
            className={[
              "rounded-2xl border p-3",
              blockingCount > 0
                ? "border-rose-300/18 bg-rose-500/[0.07]"
                : warningCount > 0
                  ? "border-amber-300/16 bg-amber-300/[0.055]"
                  : "border-emerald-300/14 bg-emerald-300/[0.045]",
            ].join(" ")}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">Контроль норм и геометрии</div>
                <div className="mt-0.5 text-[12px] text-white/60">
                  {blockingCount > 0
                    ? `${blockingCount} крит. нарушение, ${warningCount} предупрежд.`
                    : warningCount > 0
                      ? `${warningCount} предупрежд. для проверки`
                      : "Грубых нарушений не найдено"}
                </div>
              </div>
              <span className={[
                "rounded-full border px-2 py-1 text-[10.5px] font-medium",
                blockingCount > 0
                  ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
                  : warningCount > 0
                    ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                    : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
              ].join(" ")}>
                {blockingCount > 0 ? "Нельзя утверждать" : warningCount > 0 ? "Нужна проверка" : "Ранний контроль OK"}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {ruleIssues.slice(0, 6).map((issue) => (
                <GisRuleIssueRow key={issue.id} issue={issue} />
              ))}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <ProgramPill label="Жилые корпуса" value={String(program.residential)} />
            <ProgramPill label="Соц. объекты" value={String(program.social)} />
            <ProgramPill label="Коммерция" value={String(program.commerce)} />
            <ProgramPill label="Двор / паркинг" value={`${program.yard}/${program.parking}`} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            <div className="grid grid-cols-[minmax(170px,1.2fr)_76px_76px_70px_92px_minmax(150px,1fr)] gap-2 border-b border-white/[0.06] px-3 py-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/35">
              <div>Объект</div>
              <div>Шир.</div>
              <div>Глуб.</div>
              <div>Этажи</div>
              <div>Площадь</div>
              <div>Роль</div>
            </div>
            <div className="max-h-72 overflow-auto">
              {sortedObjects.map((object) => (
                <div key={object.id} className="grid grid-cols-[minmax(170px,1.2fr)_76px_76px_70px_92px_minmax(150px,1fr)] gap-2 border-b border-white/[0.045] px-3 py-2 text-[11.5px] last:border-b-0">
                  <div className="min-w-0">
                    <select
                      data-testid={`gis-object-type-${object.id}`}
                      value={object.type}
                      onChange={(event) => onUpdateObject(object.id, { type: event.target.value as GisMasterplanScenarioObject["type"] })}
                      className="w-full rounded-lg border border-white/10 bg-[#15151b] px-2 py-1.5 text-[11px] font-medium text-white/78 outline-none focus:border-emerald-300/35"
                      aria-label={`Тип объекта ${object.name}`}
                    >
                      {GIS_OBJECT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div className="truncate text-[10.5px] text-white/35">{object.name}</div>
                  </div>
                  <input
                    data-testid={`gis-object-width-${object.id}`}
                    type="number"
                    min={1}
                    step={1}
                    value={Math.round(object.width)}
                    onChange={(event) => onUpdateObject(object.id, { width: Number(event.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1.5 text-[11px] text-white/72 outline-none focus:border-emerald-300/35"
                    aria-label={`Ширина объекта ${object.name}`}
                  />
                  <input
                    data-testid={`gis-object-depth-${object.id}`}
                    type="number"
                    min={1}
                    step={1}
                    value={Math.round(object.depth)}
                    onChange={(event) => onUpdateObject(object.id, { depth: Number(event.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1.5 text-[11px] text-white/72 outline-none focus:border-emerald-300/35"
                    aria-label={`Глубина объекта ${object.name}`}
                  />
                  <input
                    data-testid={`gis-object-floors-${object.id}`}
                    type="number"
                    min={object.type === "yard" ? 0 : 1}
                    step={1}
                    value={object.floors}
                    onChange={(event) => onUpdateObject(object.id, { floors: Number(event.target.value) })}
                    disabled={object.type === "yard"}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1.5 text-[11px] text-white/72 outline-none focus:border-emerald-300/35 disabled:opacity-40"
                    aria-label={`Этажность объекта ${object.name}`}
                  />
                  <div className="pt-1.5 text-white/50">{fmtM2(object.width * object.depth * Math.max(1, object.floors))}</div>
                  <div className="min-w-0 truncate text-white/38">{object.rationale || "роль не указана"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/38">Готовность к следующему шагу</div>
            <div className="space-y-2">
              <ReadinessRow ok={scenario.objects.length > 0} label="Есть структурированная посадка" />
              <ReadinessRow ok={metrics.gfa > 0} label="Есть GFA для стоимости" />
              <ReadinessRow ok={blockingCount === 0} label={blockingCount === 0 ? "Нет критических геометрических нарушений" : `${blockingCount} крит. нарушение требует правки`} />
              <ReadinessRow ok={renderBag.state === "ready" && Boolean(renderBag.imageUrl)} label="Есть клиентский AI-рендер" />
              <ReadinessRow ok={notes.length === 0} label={notes.length === 0 ? "Нет предупреждений AI" : `${notes.length} пункт(ов) требуют проверки`} />
            </div>
          </div>

          <div className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.05] p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-100/70">Контроль перед решением</div>
            <div className="space-y-1 text-[11px] leading-relaxed text-amber-50/62">
              {(notes.length ? notes.slice(0, 8) : [
                "Сценарий можно передавать в стоимость Class 5.",
                "Для production нужны красные линии, инсоляция, парковка и ПДП/ГПЗУ.",
              ]).map((note) => (
                <div key={note}>- {note}</div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 text-[11px] leading-relaxed text-white/42">
            <div className="mb-1 font-medium uppercase tracking-[0.14em] text-white/38">Источник данных</div>
            <div>Участков: {handoff.summary.parcelsCount}; площадь: {fmtM2(handoff.summary.totalAreaM2)}; сценарий сохранится в проекте вместе с AI-рендером, если он создан.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GisRuleIssueRow({ issue }: { issue: GisRuleIssue }) {
  const color = gisIssueColor(issue.severity);
  const icon = issue.severity === "info"
    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-300" />
    : <AlertCircle className={["mt-0.5 h-3.5 w-3.5", color === "rose" ? "text-rose-300" : "text-amber-300"].join(" ")} />;
  return (
    <div
      data-testid="gis-rule-issue"
      className={[
        "flex gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
        color === "rose"
          ? "border-rose-300/15 bg-rose-500/[0.08] text-rose-50/78"
          : color === "amber"
            ? "border-amber-300/14 bg-amber-300/[0.07] text-amber-50/74"
            : "border-emerald-300/14 bg-emerald-300/[0.06] text-emerald-50/72",
      ].join(" ")}
    >
      {icon}
      <div className="min-w-0">
        <div className="font-medium text-white/82">{issue.title}</div>
        <div className="mt-0.5 text-white/48">{issue.detail}</div>
      </div>
    </div>
  );
}

function ProgramPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-2">
      <div className="text-[10.5px] text-white/35">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-white/86">{value}</div>
    </div>
  );
}

function ReadinessRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.055] bg-black/18 px-3 py-2 text-[12px]">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}
      <span className={ok ? "text-white/72" : "text-amber-50/72"}>{label}</span>
    </div>
  );
}

function WorkspaceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-2">
      <div className="text-[10.5px] text-white/35">{label}</div>
      <div className="mt-0.5 truncate text-[14px] font-semibold text-white/86">{value}</div>
    </div>
  );
}

function GisMasterplanIntakePanel({
  handoff,
  onOpenSite,
  onOpenAi,
  onOpenCost,
  strategyHint,
  onStrategyHintChange,
  onGenerateMasterplan,
  masterplanState,
  onDismiss,
}: {
  handoff: GisMasterplanHandoff;
  onOpenSite: () => void;
  onOpenAi: () => void;
  onOpenCost: () => void;
  strategyHint: string;
  onStrategyHintChange: (value: string) => void;
  onGenerateMasterplan: () => void;
  masterplanState: GenState;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-emerald-300/15 bg-emerald-300/[0.055] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-emerald-200/80">GIS-мастерплан</div>
          <div className="mt-1 text-sm text-white/84">
            Из /map импортировано участков: {handoff.summary.parcelsCount}. Можно собрать AI-посадку и проверить базовые параметры.
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/55">
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-1">{Math.round(handoff.summary.totalAreaM2).toLocaleString("ru-RU")} м² всего</span>
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-1">{handoff.summary.avgFloors} эт. средняя этажность</span>
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-1">{handoff.summary.functionalZones.join(", ") || "зона не указана"}</span>
            {handoff.summary.hasSocialParcel && <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-100">есть соц. участок</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerateMasterplan}
            disabled={masterplanState === "loading"}
            className="rounded-lg border border-violet-300/25 bg-violet-400/12 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            {masterplanState === "loading" ? "Генерация..." : "Сгенерировать AI-мастерплан"}
          </button>
          <button type="button" onClick={onOpenSite} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10">
            Посадка здания
          </button>
          <button type="button" onClick={onOpenAi} className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-300/15">
            AI-чертежи
          </button>
          <button type="button" onClick={onOpenCost} className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/15">
            Стоимость
          </button>
          <button type="button" onClick={onDismiss} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white/45 hover:bg-white/5">
            Скрыть
          </button>
        </div>
      </div>
      <div className="mt-2 max-h-20 overflow-auto rounded-lg border border-white/10 bg-black/10 p-2 text-[11px] text-white/45">
        {handoff.parcels.map((parcel) => (
          <div key={parcel.id} className="flex justify-between gap-3 border-b border-white/[0.05] py-1 last:border-b-0">
            <span className="truncate">{parcel.name}</span>
            <span className="shrink-0">{Math.round(parcel.areaM2).toLocaleString("ru-RU")} м²</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">ТЗ для AI-посадки</span>
          <span className="text-[10.5px] text-white/28">например: 4 корпуса, садик у дороги, двор внутри</span>
        </div>
        <textarea
          value={strategyHint}
          onChange={(event) => onStrategyHintChange(event.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[12px] leading-relaxed text-white/78 outline-none placeholder:text-white/25 focus:border-emerald-300/35"
          placeholder="Опиши посадку: сколько домов, где школа/садик, как расположить паркинг, двор, коммерцию..."
        />
      </div>
    </div>
  );
}

function gisScenarioTitle(scenario: GisMasterplanResponse["scenarios"][number]): string {
  const key = scenario.key.toLowerCase();
  if (key.includes("max")) return "Максимум GFA";
  if (key.includes("balanced") || key.includes("courtyard")) return "Сбалансированный двор";
  if (key.includes("social")) return "Социальный mix";
  return scenario.title || "Сценарий посадки";
}

function gisObjectTypeLabel(type: GisMasterplanResponse["scenarios"][number]["objects"][number]["type"]): string {
  switch (type) {
    case "residential_block": return "Жилой корпус";
    case "school": return "Школа";
    case "kindergarten": return "Детский сад";
    case "parking": return "Паркинг";
    case "commerce": return "Коммерция";
    case "yard": return "Двор / озеленение";
    default: return "Объект";
  }
}

function gisObjectLabel(object: GisMasterplanResponse["scenarios"][number]["objects"][number]): string {
  return `${gisObjectTypeLabel(object.type)}${object.floors > 0 ? ` · ${object.floors} эт.` : ""}`;
}

function objectSortRank(type: GisMasterplanResponse["scenarios"][number]["objects"][number]["type"]): number {
  switch (type) {
    case "residential_block": return 1;
    case "kindergarten": return 2;
    case "school": return 3;
    case "commerce": return 4;
    case "parking": return 5;
    case "yard": return 6;
    default: return 9;
  }
}

function summarizeScenarioProgram(scenario: GisMasterplanResponse["scenarios"][number]) {
  return {
    residential: scenario.objects.filter((object) => object.type === "residential_block").length,
    social: scenario.objects.filter((object) => object.type === "school" || object.type === "kindergarten").length,
    commerce: scenario.objects.filter((object) => object.type === "commerce").length,
    parking: scenario.objects.filter((object) => object.type === "parking").length,
    yard: scenario.objects.filter((object) => object.type === "yard").length,
  };
}

function fmtM2(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} м²`;
}

function scenarioMetrics(
  scenario: GisMasterplanResponse["scenarios"][number],
  handoff: GisMasterplanHandoff,
) {
  const siteArea = Math.max(1, handoff.summary.totalAreaM2);
  const buildableObjects = scenario.objects.filter((object) => object.type !== "yard");
  const footprint = buildableObjects.reduce((sum, object) => sum + object.width * object.depth, 0);
  const gfa = buildableObjects.reduce((sum, object) => sum + object.width * object.depth * Math.max(1, object.floors), 0);
  return {
    siteArea,
    footprint,
    gfa,
    coveragePct: footprint / siteArea * 100,
    far: gfa / siteArea,
    residentialCount: scenario.objects.filter((object) => object.type === "residential_block").length,
    socialCount: scenario.objects.filter((object) => object.type === "school" || object.type === "kindergarten").length,
    parkingCount: scenario.objects.filter((object) => object.type === "parking").length,
    maxFloors: Math.max(0, ...scenario.objects.map((object) => object.floors)),
  };
}

function gisObjectBounds(object: GisMasterplanScenarioObject) {
  return {
    minX: object.x - object.width / 2,
    maxX: object.x + object.width / 2,
    minY: object.y - object.depth / 2,
    maxY: object.y + object.depth / 2,
  };
}

function gisParcelBounds(parcel: GisMasterplanHandoff["parcels"][number]) {
  const xs = parcel.local.map(([x]) => x);
  const ys = parcel.local.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function boundsOverlap(a: ReturnType<typeof gisObjectBounds>, b: ReturnType<typeof gisObjectBounds>): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function evaluateGisScenarioRules(
  scenario: GisMasterplanResponse["scenarios"][number],
  handoff: GisMasterplanHandoff,
): GisRuleIssue[] {
  const issues: GisRuleIssue[] = [];
  const metrics = scenarioMetrics(scenario, handoff);
  const maxCoveragePct = Math.min(
    80,
    Math.max(1, ...handoff.parcels.map((parcel) => parcel.params?.max_coverage_pct ?? 50)),
  );
  const maxFloors = Math.max(1, ...handoff.parcels.map((parcel) => parcel.params?.floors ?? handoff.summary.avgFloors));
  const maxFar = Math.max(2.5, maxFloors * maxCoveragePct / 100 * 0.95);
  const parcelById = new Map(handoff.parcels.map((parcel) => [parcel.id, parcel]));

  scenario.objects.forEach((object) => {
    const parcel = parcelById.get(object.parcel_id);
    if (!parcel) {
      issues.push({
        id: `missing-parcel-${object.id}`,
        severity: "error",
        title: "Объект без участка",
        detail: `${object.name} не привязан к выбранному участку.`,
        objectIds: [object.id],
      });
      return;
    }
    const objectBounds = gisObjectBounds(object);
    const parcelBounds = gisParcelBounds(parcel);
    if (
      objectBounds.minX < parcelBounds.minX ||
      objectBounds.maxX > parcelBounds.maxX ||
      objectBounds.minY < parcelBounds.minY ||
      objectBounds.maxY > parcelBounds.maxY
    ) {
      issues.push({
        id: `outside-${object.id}`,
        severity: "error",
        title: "Выход за границу участка",
        detail: `${gisObjectTypeLabel(object.type)} "${object.name}" выходит за расчетный контур участка.`,
        objectIds: [object.id],
      });
    }
    if (object.type !== "yard" && object.floors > maxFloors + 2) {
      issues.push({
        id: `floors-${object.id}`,
        severity: "warning",
        title: "Этажность выше параметров участка",
        detail: `${object.name}: ${object.floors} эт. при ориентире участка ${maxFloors} эт. Нужна проверка ПДП/ГПЗУ.`,
        objectIds: [object.id],
      });
    }
  });

  const solidObjects = scenario.objects.filter((object) => object.type !== "yard");
  for (let i = 0; i < solidObjects.length; i += 1) {
    for (let j = i + 1; j < solidObjects.length; j += 1) {
      const a = solidObjects[i];
      const b = solidObjects[j];
      if (a.parcel_id === b.parcel_id && boundsOverlap(gisObjectBounds(a), gisObjectBounds(b))) {
        issues.push({
          id: `overlap-${a.id}-${b.id}`,
          severity: "error",
          title: "Пересечение объектов",
          detail: `${a.name} пересекается с ${b.name}. Разведите пятна или уменьшите габариты.`,
          objectIds: [a.id, b.id],
        });
      }
    }
  }

  if (metrics.coveragePct > maxCoveragePct) {
    issues.push({
      id: "coverage-limit",
      severity: "error",
      title: "Превышен процент застройки",
      detail: `Сценарий дает ${metrics.coveragePct.toFixed(1)}% при лимите ${maxCoveragePct.toFixed(0)}%.`,
    });
  }
  if (metrics.far > maxFar) {
    issues.push({
      id: "far-limit",
      severity: "warning",
      title: "Высокий КИТ/FAR",
      detail: `FAR ${metrics.far.toFixed(2)} выше раннего ориентира ${maxFar.toFixed(2)}. Нужна проверка градрегламентов.`,
    });
  }

  const yardArea = scenario.objects
    .filter((object) => object.type === "yard")
    .reduce((sum, object) => sum + object.width * object.depth, 0);
  const yardPct = yardArea / metrics.siteArea * 100;
  if (yardPct < 12) {
    issues.push({
      id: "yard-area",
      severity: "warning",
      title: "Мало двора/озеленения",
      detail: `Открытая территория около ${yardPct.toFixed(1)}% участка. Для жилого сценария это риск.`,
    });
  }

  const hasResidential = scenario.objects.some((object) => object.type === "residential_block");
  const hasParking = scenario.objects.some((object) => object.type === "parking");
  if (hasResidential && !hasParking) {
    issues.push({
      id: "parking-missing",
      severity: "warning",
      title: "Не показан паркинг",
      detail: "В сценарии есть жилье, но нет отдельного объекта паркинга. Парковочный норматив пока не закрыт.",
    });
  }
  if (handoff.summary.hasSocialParcel && !scenario.objects.some((object) => object.type === "school" || object.type === "kindergarten")) {
    issues.push({
      id: "social-missing",
      severity: "warning",
      title: "Социальный участок без соцобъекта",
      detail: "В выбранных участках есть социальная функция, но сценарий не содержит школу или детский сад.",
    });
  }
  if (issues.length === 0) {
    issues.push({
      id: "screening-ok",
      severity: "info",
      title: "Грубых нарушений не найдено",
      detail: "Сценарий проходит ранний геометрический контроль. Для решения нужны официальные красные линии, инсоляция, парковка и ГПЗУ.",
    });
  }
  return issues;
}

function gisIssueColor(severity: GisRuleSeverity): string {
  switch (severity) {
    case "error": return "rose";
    case "warning": return "amber";
    case "info": return "emerald";
    default: return "white";
  }
}

function objectHasBlockingIssue(objectId: string, issues: GisRuleIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error" && issue.objectIds?.includes(objectId));
}

function costDraftFromGisScenario(
  current: CostPlacementDraft,
  handoff: GisMasterplanHandoff,
  scenario: GisMasterplanResponse["scenarios"][number],
): CostPlacementDraft {
  const metrics = scenarioMetrics(scenario, handoff);
  const footprintSide = Math.sqrt(Math.max(1, metrics.footprint));
  const siteWidth = Math.max(1, Math.round(handoff.summary.maxWidthM || Math.sqrt(metrics.siteArea)));
  const siteDepth = Math.max(1, Math.round(metrics.siteArea / siteWidth));
  const parkingCount = scenario.objects.filter((object) => object.type === "parking").length;
  const socialCount = scenario.objects.filter((object) => object.type === "school" || object.type === "kindergarten").length;
  const riskFlags = Array.from(new Set([
    ...current.costAssumptions.missingDataWarnings,
    ...scenario.warnings,
    ...scenario.rule_notes,
    "Стоимость импортирована из выбранного GIS AI-мастерплана; геометрия участка пока упрощена до расчетных габаритов.",
  ]));

  return {
    ...current,
    site_width_m: siteWidth,
    site_depth_m: siteDepth,
    gfa_above_ground_m2: Math.max(1, Math.round(metrics.gfa)),
    floors_above: Math.max(1, metrics.maxFloors || current.floors_above),
    footprint_width_m: Math.max(1, Math.round(footprintSide)),
    footprint_depth_m: Math.max(1, Math.round(footprintSide)),
    parking_mode: parkingCount > 0 ? "open" : current.parking_mode,
    selected_variant_key: "central",
    costAssumptions: {
      ...current.costAssumptions,
      region: current.region,
      objectType: socialCount > 0 ? "GIS masterplan / mixed residential with social infrastructure" : "GIS masterplan / multifamily screening",
      geoRegionConfidence: "medium",
      geoWarnings: Array.from(new Set([
        ...(current.costAssumptions.geoWarnings ?? []),
        "GIS-мастерплан выбран как источник площади/GFA для Class 5 оценки.",
      ])),
      missingDataWarnings: riskFlags,
      fieldSources: {
        ...(current.costAssumptions.fieldSources ?? {}),
        site_width_m: "manual",
        site_depth_m: "manual",
        gfa_above_ground_m2: "manual",
        floors_above: "manual",
        footprint_width_m: "manual",
        footprint_depth_m: "manual",
        parking_mode: "manual",
      },
    },
  };
}

function GisAiMasterplanPanel({
  handoff,
  response,
  selectedScenarioKey,
  errorMessage,
  onSelectScenario,
  onOpenCost,
  onRegenerate,
  renderBag,
  onGenerateRender,
}: {
  handoff: GisMasterplanHandoff;
  response: GisMasterplanResponse;
  selectedScenarioKey: string | null;
  errorMessage: string | null;
  onSelectScenario: (scenarioKey: string) => void;
  onOpenCost: () => void;
  onRegenerate: () => void;
  renderBag: ImageBag;
  onGenerateRender: () => void;
}) {
  const parcelById = new Map(handoff.parcels.map((parcel) => [parcel.id, parcel]));
  const selectedScenario = response.scenarios.find((scenario) => scenario.key === selectedScenarioKey) ?? response.scenarios[0] ?? null;
  return (
    <div className="border-b border-violet-300/15 bg-violet-300/[0.045] px-4 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-violet-200/80">AI-сценарии мастерплана</div>
          <div className="mt-1 text-sm text-white/82">
            OpenAI собрал {response.scenarios.length} структурированных сценария посадки по выбранным участкам.
          </div>
          <div className="mt-1 text-[11px] text-white/42">
            Модель: {response.model_used} · координаты в локальных метрах участка · концепт для ранней проверки, не официальное согласование.
          </div>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
        >
          Перегенерировать
        </button>
      </div>
      {errorMessage && (
        <div className="mb-3 rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          Последняя перегенерация не удалась: {errorMessage}
        </div>
      )}
      {selectedScenario && (
        <GisScenarioDetailPanel
          handoff={handoff}
          scenario={selectedScenario}
          parcelById={parcelById}
          ruleIssues={evaluateGisScenarioRules(selectedScenario, handoff)}
          onOpenCost={onOpenCost}
          renderBag={renderBag}
          onGenerateRender={onGenerateRender}
        />
      )}
      <div className="grid gap-3 lg:grid-cols-3">
        {response.scenarios.map((scenario) => (
          <div
            key={scenario.key}
            className={[
              "overflow-hidden rounded-2xl border bg-black/15 transition",
              selectedScenarioKey === scenario.key ? "border-emerald-300/40 shadow-[0_0_0_1px_rgba(110,231,183,0.12)]" : "border-white/[0.08]",
            ].join(" ")}
          >
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-white/88">{gisScenarioTitle(scenario)}</div>
                {selectedScenarioKey === scenario.key && (
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                    Основной
                  </span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/45">{scenario.strategy}</div>
            </div>
            <div className="bg-black/20 p-3">
              <GisScenarioPreview scenario={scenario} parcelById={parcelById} />
            </div>
            <div className="space-y-2 px-3 py-3">
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg bg-white/[0.04] px-2 py-1">
                  <div className="font-semibold text-white/85">{scenario.objects.length}</div>
                  <div className="text-white/35">объекты</div>
                </div>
                <div className="rounded-lg bg-white/[0.04] px-2 py-1">
                  <div className="font-semibold text-white/85">{scenario.objects.filter((o) => o.type === "residential_block").length}</div>
                  <div className="text-white/35">корпуса</div>
                </div>
                <div className="rounded-lg bg-white/[0.04] px-2 py-1">
                  <div className="font-semibold text-white/85">{scenario.objects.filter((o) => o.type === "school" || o.type === "kindergarten").length}</div>
                  <div className="text-white/35">соц.</div>
                </div>
              </div>
              <div className="max-h-28 space-y-1 overflow-auto pr-1 text-[11px]">
                {scenario.objects.map((object) => (
                  <div key={object.id} className="flex justify-between gap-2 rounded-lg bg-white/[0.035] px-2 py-1 text-white/55">
                    <span className="truncate">{gisObjectLabel(object)}</span>
                    <span className="shrink-0 text-white/35">{Math.round(object.width)}×{Math.round(object.depth)} м · {object.floors} эт.</span>
                  </div>
                ))}
              </div>
              {(scenario.warnings.length > 0 || scenario.rule_notes.length > 0) && (
                <details className="rounded-lg border border-amber-300/12 bg-amber-300/[0.05] px-2 py-1.5">
                  <summary className="cursor-pointer select-none text-[11px] text-amber-100/80">Предупреждения и допущения</summary>
                  <div className="mt-1 space-y-1 text-[10.5px] leading-relaxed text-amber-50/60">
                    {[...scenario.warnings, ...scenario.rule_notes].slice(0, 6).map((note) => (
                      <div key={note}>- {note}</div>
                    ))}
                  </div>
                </details>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSelectScenario(scenario.key)}
                  className="rounded-lg border border-white/10 bg-white/[0.045] px-2 py-2 text-[11px] text-white/70 hover:bg-white/[0.08]"
                >
                  {selectedScenarioKey === scenario.key ? "Выбран" : "Сделать основным"}
                </button>
                <button
                  type="button"
                  onClick={onOpenCost}
                  className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-2 text-[11px] font-medium text-amber-100 hover:bg-amber-300/15"
                >
                  Стоимость
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GisScenarioDetailPanel({
  handoff,
  scenario,
  parcelById,
  ruleIssues,
  onOpenCost,
  renderBag,
  onGenerateRender,
}: {
  handoff: GisMasterplanHandoff;
  scenario: GisMasterplanResponse["scenarios"][number];
  parcelById: Map<string, GisMasterplanHandoff["parcels"][number]>;
  ruleIssues: GisRuleIssue[];
  onOpenCost: () => void;
  renderBag: ImageBag;
  onGenerateRender: () => void;
}) {
  const metrics = scenarioMetrics(scenario, handoff);
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-300/15 bg-black/20">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200/70">Детальный просмотр сценария</div>
            <div className="mt-1 text-[16px] font-semibold text-white/90">{gisScenarioTitle(scenario)}</div>
            <div className="mt-1 max-w-3xl text-[12px] leading-relaxed text-white/45">{scenario.strategy}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerateRender}
              disabled={renderBag.state === "loading"}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-300/15 disabled:cursor-wait disabled:opacity-60"
            >
              {renderBag.state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              AI-визуализация
            </button>
            <button
              type="button"
              onClick={onOpenCost}
              className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/15"
            >
              Перейти к стоимости
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">План участка</div>
            <GisScenarioPreview scenario={scenario} parcelById={parcelById} issues={ruleIssues} className="h-80 w-full rounded-xl border border-white/[0.06] bg-[#0b1020]" />
          </div>
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">2.5D массинг</div>
            <GisScenarioAxonometricPreview scenario={scenario} parcelById={parcelById} />
          </div>
          <div className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">AI-рендер территории</div>
              {renderBag.imageUrl && (
                <a
                  href={renderBag.imageUrl}
                  download={`gis-masterplan-${scenario.key}.png`}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/55 hover:bg-white/[0.08]"
                >
                  <Download className="h-3 w-3" />
                  Скачать
                </a>
              )}
            </div>
            {renderBag.state === "ready" && renderBag.imageUrl ? (
              <div className="overflow-hidden rounded-xl border border-violet-300/15 bg-black/25">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={renderBag.imageUrl} alt="AI-визуализация выбранного GIS-мастерплана" className="h-auto w-full" />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/42">
                  <span>Концепт-рендер для обсуждения, не официальный чертеж.</span>
                  <span>Модель: {renderBag.modelUsed ?? "gpt-image"}</span>
                </div>
              </div>
            ) : renderBag.state === "loading" ? (
              <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-violet-300/20 bg-violet-300/[0.035] text-sm text-violet-50/70">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Генерирую визуализацию выбранного сценария...
              </div>
            ) : renderBag.state === "error" ? (
              <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                Не удалось создать AI-визуализацию: {renderBag.errorMessage}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.10] bg-white/[0.025] px-4 py-8 text-center">
                <div className="text-sm font-medium text-white/75">Сначала проверьте схему, потом создайте клиентский вид</div>
                <div className="mx-auto mt-1 max-w-xl text-[12px] leading-relaxed text-white/40">
                  AI-визуализация использует выбранные участки, объекты, этажность и пользовательское ТЗ. Геометрия сценария остается источником правды.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <DetailMetric label="GFA" value={fmtM2(metrics.gfa)} />
            <DetailMetric label="Пятно" value={fmtM2(metrics.footprint)} />
            <DetailMetric label="Застройка" value={`${metrics.coveragePct.toFixed(1)}%`} />
            <DetailMetric label="FAR / КИТ" value={metrics.far.toFixed(2)} />
            <DetailMetric label="Корпуса" value={String(metrics.residentialCount)} />
            <DetailMetric label="Макс. этажность" value={`${metrics.maxFloors} эт.`} />
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025]">
            <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
              Объекты сценария
            </div>
            <div className="max-h-72 overflow-auto p-2">
              {scenario.objects.map((object) => (
                <div key={object.id} className="mb-1 rounded-lg border border-white/[0.055] bg-black/18 px-3 py-2 last:mb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-white/82">{gisObjectLabel(object)}</div>
                      <div className="mt-0.5 truncate text-[10.5px] text-white/35">{object.rationale || "AI rationale не указан"}</div>
                    </div>
                    <div className="shrink-0 text-right text-[10.5px] text-white/42">
                      <div>{Math.round(object.width)}×{Math.round(object.depth)} м</div>
                      <div>{fmtM2(object.width * object.depth * Math.max(1, object.floors))}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(scenario.warnings.length > 0 || scenario.rule_notes.length > 0) && (
            <div className="rounded-xl border border-amber-300/12 bg-amber-300/[0.05] p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-100/70">Что проверить дальше</div>
              <div className="space-y-1 text-[11px] leading-relaxed text-amber-50/62">
                {[...scenario.warnings, ...scenario.rule_notes].slice(0, 8).map((note) => (
                  <div key={note}>- {note}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2">
      <div className="text-[10.5px] text-white/35">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-white/88">{value}</div>
    </div>
  );
}

function GisScenarioPreview({
  scenario,
  parcelById,
  issues = [],
  className = "h-44 w-full rounded-xl border border-white/[0.06] bg-[#0b1020]",
}: {
  scenario: GisMasterplanResponse["scenarios"][number];
  parcelById: Map<string, GisMasterplanHandoff["parcels"][number]>;
  issues?: GisRuleIssue[];
  className?: string;
}) {
  const parcels = Array.from(parcelById.values());
  const width = Math.max(1, ...parcels.map((parcel) => parcel.width));
  const height = Math.max(1, ...parcels.map((parcel) => parcel.height));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className}>
      {parcels.map((parcel, index) => {
        const points = parcel.local.map(([x, y]) => `${x},${y}`).join(" ");
        return (
          <polygon
            key={parcel.id}
            points={points}
            fill={index % 2 === 0 ? "rgba(16,185,129,0.10)" : "rgba(59,130,246,0.10)"}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth={0.8}
          />
        );
      })}
      {scenario.objects.map((object) => {
        const parcel = parcelById.get(object.parcel_id);
        if (!parcel) return null;
        const hasBlockingIssue = objectHasBlockingIssue(object.id, issues);
        const x = object.x - object.width / 2;
        const y = object.y - object.depth / 2;
        return (
          <g key={object.id} transform={`rotate(${object.rotationDeg} ${object.x} ${object.y})`}>
            <rect
              x={x}
              y={y}
              width={object.width}
              height={object.depth}
              rx={1.5}
              fill={gisObjectColor(object.type)}
              stroke={hasBlockingIssue ? "rgba(251,113,133,0.98)" : "rgba(255,255,255,0.55)"}
              strokeWidth={hasBlockingIssue ? 1.6 : 0.7}
            />
            {hasBlockingIssue && (
              <circle
                cx={object.x + object.width / 2}
                cy={object.y - object.depth / 2}
                r={2.8}
                fill="rgba(251,113,133,0.95)"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth={0.4}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function GisScenarioAxonometricPreview({
  scenario,
  parcelById,
}: {
  scenario: GisMasterplanResponse["scenarios"][number];
  parcelById: Map<string, GisMasterplanHandoff["parcels"][number]>;
}) {
  const parcels = Array.from(parcelById.values());
  const width = Math.max(1, ...parcels.map((parcel) => parcel.width));
  const height = Math.max(1, ...parcels.map((parcel) => parcel.height));
  const iso = (x: number, y: number, z = 0): [number, number] => [
    180 + (x - y) * 1.05,
    42 + (x + y) * 0.42 - z,
  ];
  const footprintPoints = (object: GisMasterplanResponse["scenarios"][number]["objects"][number], z = 0) => {
    const x1 = object.x - object.width / 2;
    const x2 = object.x + object.width / 2;
    const y1 = object.y - object.depth / 2;
    const y2 = object.y + object.depth / 2;
    return [iso(x1, y1, z), iso(x2, y1, z), iso(x2, y2, z), iso(x1, y2, z)];
  };
  const pointString = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  const sorted = [...scenario.objects]
    .filter((object) => object.type !== "yard")
    .sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const site = [iso(0, 0), iso(width, 0), iso(width, height), iso(0, height)];

  return (
    <svg viewBox="0 0 360 300" className="h-80 w-full rounded-xl border border-white/[0.06] bg-[#090d18]">
      <defs>
        <linearGradient id="gisIsoGround" x1="0" x2="1">
          <stop offset="0%" stopColor="rgba(16,185,129,0.16)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0.12)" />
        </linearGradient>
      </defs>
      <polygon points={pointString(site)} fill="url(#gisIsoGround)" stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
      {scenario.objects.filter((object) => object.type === "yard").map((object) => (
        <polygon
          key={object.id}
          points={pointString(footprintPoints(object, 1))}
          fill="rgba(16,185,129,0.28)"
          stroke="rgba(110,231,183,0.55)"
          strokeWidth="1"
        />
      ))}
      {sorted.map((object) => {
        const z = Math.max(4, object.floors * 5);
        const bottom = footprintPoints(object, 0);
        const top = footprintPoints(object, z);
        return (
          <g key={object.id}>
            <polygon points={pointString([bottom[0], bottom[1], top[1], top[0]])} fill="rgba(255,255,255,0.12)" />
            <polygon points={pointString([bottom[1], bottom[2], top[2], top[1]])} fill="rgba(0,0,0,0.24)" />
            <polygon points={pointString(top)} fill={gisObjectColor(object.type)} stroke="rgba(255,255,255,0.58)" strokeWidth="0.9" />
          </g>
        );
      })}
      <text x="16" y="282" fill="rgba(255,255,255,0.35)" fontSize="10">
        Высота блоков пропорциональна этажности. Это схема контроля, не финальный 3D-рендер.
      </text>
    </svg>
  );
}

function gisObjectColor(type: GisMasterplanResponse["scenarios"][number]["objects"][number]["type"]) {
  switch (type) {
    case "residential_block": return "rgba(139,92,246,0.72)";
    case "school": return "rgba(59,130,246,0.74)";
    case "kindergarten": return "rgba(34,197,94,0.72)";
    case "parking": return "rgba(148,163,184,0.68)";
    case "commerce": return "rgba(245,158,11,0.72)";
    case "yard": return "rgba(16,185,129,0.45)";
    default: return "rgba(255,255,255,0.55)";
  }
}

function SavedAssetCard({ asset }: { asset: ProjectAsset }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
      <a href={asset.url} target="_blank" rel="noreferrer" className="block bg-black/20">
        <img src={asset.url} alt={asset.variant_key} className="w-full h-56 object-contain" />
      </a>
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-white/80 truncate">{asset.variant_key}</div>
          <div className="text-[10.5px] text-white/35 truncate">{asset.model_used || "модель не указана"}</div>
        </div>
        <a
          href={asset.url}
          download={`plana-${asset.tab}-${asset.variant_key}.png`}
          className="ml-auto h-7 px-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] text-[10.5px] text-white/60 hover:text-white transition flex items-center gap-1"
        >
          <Download size={10} /> PNG
        </a>
      </div>
    </div>
  );
}

function Header({
  session, onSignOut, onSave, saving, saveOk, autoSaving, autoSaveLabel, saveError,
  projectName, onRenameProject,
  historyOpen, onToggleHistory, recentProjects, onNewProject, onOpenProject,
}: {
  session: Session | null;
  onSignOut: () => void;
  onSave: () => void;
  saving: boolean;
  saveOk: boolean;
  autoSaving: boolean;
  autoSaveLabel: string | null;
  saveError: string | null;
  projectName: string;
  onRenameProject: (name: string) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  recentProjects: ProjectType[];
  onNewProject: () => void;
  onOpenProject: (p: ProjectType) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const commitRename = () => {
    const trimmed = draft.trim() || "Без названия";
    onRenameProject(trimmed);
    setDraft(trimmed);
    setEditing(false);
  };

  return (
    <header className="px-6 py-3 flex items-center justify-between border-b border-white/[0.05] flex-shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="size-7 rounded-lg bg-white grid place-items-center flex-shrink-0">
          <Layers size={13} className="text-black" strokeWidth={2.5} />
        </div>
        <span className="text-[14px] font-semibold tracking-display">Plana</span>
        <span className="text-white/20 text-[13px]">/</span>
        {/* Project name + switcher */}
        <div className="relative">
          <div className="flex items-center gap-0.5">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
                className="bg-transparent border-b border-white/30 text-[13px] text-white/85 outline-none w-44"
              />
            ) : (
              <button onClick={() => { setDraft(projectName); setEditing(true); }} className="text-[13px] text-white/60 hover:text-white/90 transition max-w-[180px] truncate">
                {projectName}
              </button>
            )}
            <button
              onClick={() => setSwitcherOpen((v) => !v)}
              className="h-5 w-5 grid place-items-center text-white/30 hover:text-white/70 transition"
            >
              <ChevronDown size={11} className={switcherOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          </div>
          {switcherOpen && (
            <div className="absolute left-0 top-8 z-50 w-56 rounded-xl border border-white/[0.1] bg-[#151515] shadow-2xl overflow-hidden">
              <button
                onClick={() => { onNewProject(); setSwitcherOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-white/70 hover:bg-white/[0.06] transition border-b border-white/[0.06]"
              >
                <Plus size={11} className="text-violet-400" /> Новый проект
              </button>
              {recentProjects.slice(0, 7).map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onOpenProject(p); setSwitcherOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-white/65 hover:bg-white/[0.06] transition"
                >
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" className="size-7 rounded object-cover flex-shrink-0 opacity-70" />
                  ) : (
                    <div className="size-7 rounded bg-white/[0.05] flex-shrink-0 grid place-items-center">
                      <Layers size={10} className="text-white/30" />
                    </div>
                  )}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              <a
                href="/projects"
                onClick={() => setSwitcherOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[11.5px] text-white/40 hover:bg-white/[0.04] transition border-t border-white/[0.06]"
              >
                <FolderOpen size={10} /> Все проекты
              </a>
            </div>
          )}
        </div>
        {/* Auto-save indicator */}
        {autoSaving && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/35">
            <Loader2 size={10} className="animate-spin" /> Сохраняем…
          </div>
        )}
        {autoSaveLabel && !autoSaving && (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/70">
            <Check size={10} /> Автосохранено
          </div>
        )}
        {saveError && !autoSaving && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-300/75 max-w-72 truncate" title={saveError}>
            <AlertCircle size={10} className="flex-shrink-0" /> Не сохранено: {saveError}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleHistory}
          className={[
            "h-8 px-3 rounded-full border flex items-center gap-1.5 text-[12px] transition",
            historyOpen
              ? "bg-violet-500/20 border-violet-400/30 text-violet-200"
              : "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white/90",
          ].join(" ")}
        >
          <History size={12} />
          История
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="h-8 px-3 rounded-full border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90 disabled:opacity-40 transition"
        >
          {saveOk ? <Check size={12} className="text-green-400" /> : saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saveOk ? "Сохранено" : saving ? "Сохраняем…" : "Сохранить"}
        </button>
        {session && (
          <div className="h-8 px-3 rounded-full bg-white/[0.04] border border-white/[0.07] flex items-center gap-2 text-[12px]">
            <div className="size-5 rounded-full bg-white/15 grid place-items-center text-[10px] font-semibold text-white/85">
              {session.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-white/85">{session.name}</span>
          </div>
        )}
        <button
          onClick={onSignOut}
          className="size-8 rounded-full border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] grid place-items-center text-white/60 hover:text-white/90 transition"
          aria-label="Выйти"
        >
          <LogOut size={12} />
        </button>
      </div>
    </header>
  );
}

function TabStrip({
  tab, onChange, onExportDxf, onExportIfc, cadExportLoading,
}: {
  tab: TopTab;
  onChange: (t: TopTab) => void;
  onExportDxf: () => void;
  onExportIfc: () => void;
  cadExportLoading: CadExportKind | null;
}) {
  // Временно показываем только «AI Чертежи» и «Архитектурные чертежи».
  // Чтобы вернуть остальные табы — убрать .filter ниже.
  const allItems: Array<{ key: TopTab; label: string; icon: React.ReactNode }> = [
    { key: "ai_plans",       label: "AI Чертежи",           icon: <Sparkles size={13} /> },
    { key: "viz",            label: "Визуализации",          icon: <ImageIcon size={13} /> },
    { key: "site",           label: "Посадка здания",       icon: <MapIcon size={13} /> },
    { key: "placement",      label: "Размещение ЖК",         icon: <Building2 size={13} /> },
    { key: "pdf_viz",        label: "PDF Визуализация",      icon: <FileText size={13} /> },
    { key: "arch_drawings",  label: "Архитектурные чертежи", icon: <Ruler size={13} /> },
  ];
  const items = allItems.filter((it) => it.key !== "placement");
  return (
    <div className="px-6 pt-3 pb-1 border-b border-white/[0.04] flex items-center justify-between gap-3 flex-wrap">
      <div className="inline-flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        {items.map((it) => (
          <button
            key={it.key}
            data-testid={`top-tab-${it.key}`}
            onClick={() => onChange(it.key)}
            className={[
              "h-8 px-3.5 rounded-lg text-[12.5px] flex items-center gap-1.5 transition",
              tab === it.key
                ? "bg-white text-black font-medium"
                : "text-white/65 hover:text-white/90 hover:bg-white/[0.04]",
            ].join(" ")}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
        <button
          data-testid="top-tab-cost_placement"
          onClick={() => onChange("cost_placement")}
          className={[
            "h-8 px-3.5 rounded-lg text-[12.5px] flex items-center gap-1.5 transition",
            tab === "cost_placement"
              ? "bg-white text-black font-medium"
              : "text-white/65 hover:text-white/90 hover:bg-white/[0.04]",
          ].join(" ")}
        >
          <Calculator size={13} />
          Стоимость участка
        </button>
      </div>
      {/* Экспорт CAD/BIM скрыт по просьбе пользователя.
          handleExportDxf / handleExportIfc + cadExportLoading state остаются —
          вернуть UI = раскоментить блок ниже. */}
      {false && (
        <div className="flex items-center gap-2">
          <button
            onClick={onExportDxf}
            disabled={cadExportLoading !== null}
            className={[
              "h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 transition border border-violet-400/30 text-violet-200/90",
              cadExportLoading === null ? "hover:bg-violet-500/15 hover:text-white" : "opacity-60 cursor-wait",
            ].join(" ")}
            title="DXF — реальный CAD-чертёж для AutoCAD/ArchiCAD/Revit"
          >
            {cadExportLoading === "dxf" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} DXF
            <span className="text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded bg-violet-500/20">CAD</span>
          </button>
          <button
            onClick={onExportIfc}
            disabled={cadExportLoading !== null}
            className={[
              "h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 transition border border-cyan-400/30 text-cyan-200/90",
              cadExportLoading === null ? "hover:bg-cyan-500/15 hover:text-white" : "opacity-60 cursor-wait",
            ].join(" ")}
            title="IFC4 BIM-модель — открывается в Revit/ArchiCAD/BIMcollab"
          >
            {cadExportLoading === "ifc" ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />} IFC
            <span className="text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded bg-cyan-500/20">BIM</span>
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Tab 2 — Посадка на участок (image-to-image)
// ---------------------------------------------------------------------------

function SiteTab({
  bag, onGenerate, file, setFile, preview, setPreview,
  bldFile, setBldFile, bldPreview, setBldPreview,
  siteW, siteD, floors, onSiteW, onSiteD, onFloors,
}: {
  bag: ImageBag;
  onGenerate: () => void;
  file: File | null;      setFile: (f: File | null) => void;
  preview: string | null; setPreview: (p: string | null) => void;
  bldFile: File | null;      setBldFile: (f: File | null) => void;
  bldPreview: string | null; setBldPreview: (p: string | null) => void;
  siteW: number; siteD: number; floors: number;
  onSiteW: (v: number) => void;
  onSiteD: (v: number) => void;
  onFloors: (v: number) => void;
}) {
  const handleFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };
  const handleBldFile = (f: File | null) => {
    if (bldPreview) URL.revokeObjectURL(bldPreview);
    setBldFile(f);
    setBldPreview(f ? URL.createObjectURL(f) : null);
  };

  return (
    <>
      {/* Шапка — только заголовок + мини-параметры */}
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0">
        <MapIcon size={13} className="text-emerald-300" />
        <span className="text-[13px] font-medium text-white/85">Посадка здания на участок</span>
        <div className="h-4 w-px bg-white/[0.07]" />
        <div className="flex items-center gap-2 text-[11.5px] text-white/50">
          <span>Участок</span>
          <input type="number" value={siteW} onChange={e => onSiteW(+e.target.value)}
            className="w-12 h-6 bg-white/[0.06] border border-white/10 rounded px-1.5 text-white/80 text-center" />
          <span>×</span>
          <input type="number" value={siteD} onChange={e => onSiteD(+e.target.value)}
            className="w-12 h-6 bg-white/[0.06] border border-white/10 rounded px-1.5 text-white/80 text-center" />
          <span>м,</span>
          <input type="number" value={floors} onChange={e => onFloors(+e.target.value)}
            className="w-10 h-6 bg-white/[0.06] border border-white/10 rounded px-1.5 text-white/80 text-center" />
          <span>эт.</span>
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">

        {/* Результат */}
        {bag.state === "ready" && bag.imageUrl && (
          <div className="absolute inset-0 grid place-items-center p-4">
            <img src={bag.imageUrl} alt="AI-посадка здания" className="max-w-full max-h-full rounded-xl" style={{ objectFit: "contain" }} />
          </div>
        )}

        {/* Загрузка */}
        {bag.state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner text="AI вписывает здание в участок · 60–90 сек" />
          </div>
        )}

        {/* Ошибка */}
        {bag.state === "error" && <ErrorState message={bag.errorMessage} onRetry={onGenerate} />}

        {/* Idle — два дропзона */}
        {bag.state === "idle" && (
          <div className="p-5 flex flex-col gap-5">
            <div className="text-center max-w-lg mx-auto pt-4">
              <div className="text-[18px] font-semibold tracking-display mb-2">Загрузи два фото</div>
              <div className="text-[12.5px] text-white/50 leading-relaxed">
                Аэрофото участка + фото или рендер здания. AI впишет здание на участок с учётом отступов.
              </div>
            </div>

            <div className="mx-auto grid w-full max-w-2xl grid-cols-3 gap-2 text-center text-[11px] text-white/55">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2">
                <div className="font-medium text-white/80">1. Участок</div>
                <div className="mt-0.5 text-white/35">вид сверху / аэрофото</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2">
                <div className="font-medium text-white/80">2. Здание</div>
                <div className="mt-0.5 text-white/35">рендер / фасад / референс</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2">
                <div className="font-medium text-white/80">3. Масштаб</div>
                <div className="mt-0.5 text-white/35">{siteW}×{siteD} м · {floors} эт.</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto w-full">
              <UploadZone
                label="Аэрофото участка"
                sub="Скрин Google / Яндекс Maps, сверху"
                preview={preview}
                file={file}
                onFile={handleFile}
                accent="#6ee7b7"
              />
              <UploadZone
                label="Фото / рендер здания"
                sub="Любое изображение вашего ЖК"
                preview={bldPreview}
                file={bldFile}
                onFile={handleBldFile}
                accent="#93c5fd"
              />
            </div>

            {file && bldFile && (
              <div className="flex justify-center">
                <button onClick={onGenerate} className="btn-apple h-10 px-6 text-[13px] flex items-center gap-2">
                  <Sparkles size={14} /> Вписать здание на участок
                </button>
              </div>
            )}
            {(!file || !bldFile) && (
              <p className="text-center text-[11.5px] text-white/30">
                {!file && !bldFile ? "Загрузи оба фото выше" : !file ? "Нужно аэрофото участка" : "Нужно фото здания"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {bag.state === "ready" && bag.imageUrl && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {preview  && <img src={preview}   alt="" className="h-8 w-12 object-cover rounded-lg opacity-70" />}
            {bldPreview && <img src={bldPreview} alt="" className="h-8 w-12 object-cover rounded-lg opacity-70" />}
            <span className="text-[11px] text-white/35">Хочешь другой вариант?</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
              <RefreshCw size={12} /> Перегенерировать
            </button>
            <a href={bag.imageUrl} download="plana-site.png" className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5">
              <Download size={12} /> Скачать PNG
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Визуализации (3 саб-таба AI)
// ---------------------------------------------------------------------------

function VizSubTab({
  active, loading, ready, icon, label, badge, onClick,
}: {
  active: boolean;
  loading: boolean;
  ready: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "h-9 px-3.5 rounded-lg text-[12.5px] flex items-center gap-2 transition border",
        active
          ? "bg-white/[0.07] border-white/15 text-white"
          : "border-transparent text-white/60 hover:text-white/85 hover:bg-white/[0.03]",
      ].join(" ")}
    >
      {loading ? (
        <div className="size-3 rounded-full border border-white/30 border-t-white/80 animate-spin" />
      ) : ready ? (
        <CheckCircle2 size={13} className="text-emerald-400" />
      ) : icon}
      {label}
      {badge}
    </button>
  );
}

function VizTab({
  extGallery, floorBag, intBag, intGallery, mode, setMode, onGenerate, onGenerateAll,
}: {
  extGallery: ExteriorGalleryBag;
  floorBag: ImageBag;
  intBag: ImageBag;
  intGallery: InteriorGalleryBag;
  mode: VizMode;
  setMode: (m: VizMode) => void;
  onGenerate: () => void;
  onGenerateAll: () => void;
}) {
  // Галереи — какой тип квартиры / какой ракурс показываем
  const [selectedIntIdx, setSelectedIntIdx] = useState(0);
  const [selectedExtIdx, setSelectedExtIdx] = useState(0);

  const extLoading = extGallery.state === "loading";
  const extReady   = extGallery.state === "ready";
  const intIsLoading = intGallery.state === "loading" || intBag.state === "loading";
  const intIsReady   = intGallery.state === "ready" || intBag.state === "ready";
  const floorReady = floorBag.state === "ready";
  const floorLoading = floorBag.state === "loading";

  const anyReady = extReady || floorReady || intIsReady;
  const allIdle  = extGallery.state === "idle" && floorBag.state === "idle"
    && intGallery.state === "idle" && intBag.state === "idle";

  return (
    <>
      {/* ── Sub-tab strip ── */}
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.04] flex items-center gap-2 flex-shrink-0">
        <VizSubTab
          active={mode === "exterior"} loading={extLoading} ready={extReady}
          icon={<Building2 size={13} />} label="Экстерьер"
          badge={extReady && extGallery.items.length > 0 ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium">
              {extGallery.items.length} вида
            </span>
          ) : null}
          onClick={() => setMode("exterior")}
        />
        <VizSubTab
          active={mode === "floorplan_furniture"} loading={floorLoading} ready={floorReady}
          icon={<Sofa size={13} />} label="С мебелью"
          onClick={() => setMode("floorplan_furniture")}
        />
        <VizSubTab
          active={mode === "interior"} loading={intIsLoading} ready={intIsReady}
          icon={<Eye size={13} />} label="Интерьер"
          badge={intGallery.state === "ready" && intGallery.items.length > 0 ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium">
              {intGallery.items.length} фото
            </span>
          ) : null}
          onClick={() => setMode("interior")}
        />

        <div className="h-4 w-px bg-white/[0.07] mx-1" />

        {allIdle && (
          <button
            onClick={onGenerateAll}
            className="h-9 px-3.5 rounded-lg text-[12.5px] flex items-center gap-2 border border-dashed border-white/20 text-white/55 hover:text-white/85 hover:border-white/35 hover:bg-white/[0.03] transition"
          >
            <Sparkles size={13} className="text-violet-300" />
            Генерировать всё
          </button>
        )}
      </div>

      {/* ── Контент ── */}
      <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
        {mode === "interior" ? (
          <InteriorGalleryPanel
            gallery={intGallery}
            fallbackBag={intBag}
            selectedIdx={selectedIntIdx}
            onSelect={setSelectedIntIdx}
            onGenerate={onGenerate}
          />
        ) : mode === "exterior" ? (
          <ExteriorGalleryPanel
            gallery={extGallery}
            selectedIdx={selectedExtIdx}
            onSelect={setSelectedExtIdx}
            onGenerate={onGenerate}
          />
        ) : (
          <ImageCanvas
            bag={floorBag}
            onGenerate={onGenerate}
            emptyTitle="План с мебелью"
            emptyText="Pinterest-стиль: top-down план типового этажа с расставленной мебелью."
            loadingText="AI расставляет мебель · 60–90 сек"
            showGenerate
          />
        )}
      </div>

      {/* ── Bottom bar ── */}
      {anyReady && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <VizStatusChip ready={extReady} loading={extLoading} label="Экстерьер" />
            <VizStatusChip ready={floorReady} loading={floorLoading} label="С мебелью" />
            <VizStatusChip ready={intIsReady} loading={intIsLoading} label="Интерьер" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
              <RefreshCw size={12} /> Перегенерировать
            </button>
            {mode === "floorplan_furniture" && floorBag.state === "ready" && floorBag.imageUrl && (
              <a
                href={floorBag.imageUrl}
                download="plana-floorplan.png"
                className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5"
              >
                <Download size={12} /> Скачать PNG
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function VizStatusChip({ ready, loading, label }: { ready: boolean; loading: boolean; label: string }) {
  if (ready) {
    return (
      <span className="flex items-center gap-1 text-emerald-400/70">
        <CheckCircle2 size={10} /> {label}
      </span>
    );
  }
  if (loading) {
    return (
      <span className="flex items-center gap-1 text-white/30">
        <div className="size-2 rounded-full border border-white/20 border-t-white/50 animate-spin" />
        {label}
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// ExteriorGalleryPanel — несколько ракурсов экстерьера
// ---------------------------------------------------------------------------

function ExteriorGalleryPanel({
  gallery, selectedIdx, onSelect, onGenerate,
}: {
  gallery: ExteriorGalleryBag;
  selectedIdx: number;
  onSelect: (i: number) => void;
  onGenerate: () => void;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  if (gallery.state === "loading") {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="size-12 rounded-full border-2 border-white/15 border-t-violet-400 animate-spin" />
          <div>
            <div className="text-[14px] text-white/80 font-medium mb-1">Рендерим ракурсы экстерьера…</div>
            <div className="text-[12px] text-white/45">Hero · вход · аэро · двор — параллельно · 60–120 сек</div>
          </div>
          <div className="flex gap-2 mt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 w-20 rounded-lg bg-white/[0.05] animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (gallery.state === "error") {
    return <ErrorState message={gallery.errorMessage} onRetry={onGenerate} />;
  }

  if (gallery.state === "idle") {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="text-center max-w-md px-8">
          <div className="size-14 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-white/10 grid place-items-center mx-auto mb-5">
            <Building2 size={22} className="text-white/85" />
          </div>
          <div className="text-[20px] font-semibold tracking-display mb-2.5">Внешний вид здания</div>
          <div className="text-[13px] text-white/50 leading-relaxed mb-5">
            Сгенерирует несколько ракурсов одного здания: общий вид 3/4, вход с уровня
            улицы, аэросъёмка и дворовый фасад.
          </div>
          <button onClick={onGenerate} className="btn-apple h-10 px-5 text-[13px] inline-flex items-center gap-2">
            <Sparkles size={14} /> Сгенерировать ракурсы
          </button>
        </div>
      </div>
    );
  }

  // ── ready
  const items = gallery.items;
  const safeIdx = Math.min(selectedIdx, items.length - 1);
  const active = items[safeIdx];

  return (
    <>
      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-[13px] flex items-center gap-1.5"
              onClick={() => setLightboxIdx(null)}
            >
              <X size={16} /> Закрыть
            </button>
            <img
              src={items[lightboxIdx].imageUrl}
              alt={items[lightboxIdx].label}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="flex items-center justify-between mt-4">
              <div>
                <div className="text-[15px] font-semibold text-white">{items[lightboxIdx].label}</div>
                <div className="text-[11px] text-white/45 mt-0.5">{items[lightboxIdx].modelUsed}</div>
              </div>
              <a
                href={items[lightboxIdx].imageUrl}
                download={`plana-exterior-${items[lightboxIdx].view}.png`}
                className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5"
              >
                <Download size={12} /> PNG
              </a>
            </div>
          </div>
        </div>
      )}

      {/* View selector tabs */}
      <div className="px-5 pt-3 pb-2 flex items-center gap-2 flex-shrink-0 border-b border-white/[0.04]">
        {items.map((item, i) => (
          <button
            key={item.view}
            onClick={() => onSelect(i)}
            className={[
              "h-9 px-3.5 rounded-lg text-[12px] flex items-center gap-2 transition border",
              i === safeIdx
                ? "bg-white/[0.08] border-white/15 text-white font-medium"
                : "border-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
        {gallery.elapsedMs && (
          <div className="ml-auto flex items-center gap-1 text-[11px] text-white/30">
            <CheckCircle2 size={11} className="text-emerald-400/50" />
            {(gallery.elapsedMs / 1000).toFixed(1)} сек
          </div>
        )}
      </div>

      {/* Main image */}
      <div
        className="flex-1 relative cursor-zoom-in min-h-0 overflow-hidden"
        onClick={() => setLightboxIdx(safeIdx)}
      >
        <img src={active.imageUrl} alt={active.label} className="w-full h-full object-contain" />
        <div className="absolute inset-0 flex items-end justify-end p-4 pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-[11px] text-white/70 flex items-center gap-1.5">
            <Eye size={11} /> Открыть полностью
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-white/[0.04] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white/80">{active.label}</span>
          <span className="text-[10px] text-white/30">{active.modelUsed}</span>
        </div>
        <a
          href={active.imageUrl}
          download={`plana-exterior-${active.view}.png`}
          className="h-8 px-3 rounded-full surface text-[11px] flex items-center gap-1.5 hover:bg-white/[0.08] transition text-white/60 hover:text-white"
        >
          <Download size={11} /> PNG
        </a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// InteriorGalleryPanel — галерея интерьеров по типам квартир
// ---------------------------------------------------------------------------

function InteriorGalleryPanel({
  gallery, fallbackBag, selectedIdx, onSelect, onGenerate,
}: {
  gallery: InteriorGalleryBag;
  fallbackBag: ImageBag;
  selectedIdx: number;
  onSelect: (i: number) => void;
  onGenerate: () => void;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Выбранный ракурс внутри активного типа квартиры.
  const [selectedAngleIdx, setSelectedAngleIdx] = useState(0);
  // Смена типа квартиры сбрасывает ракурс на первый (см. onClick таба типа).
  const selectGroup = (i: number) => { onSelect(i); setSelectedAngleIdx(0); };

  // ── loading
  if (gallery.state === "loading") {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="size-12 rounded-full border-2 border-white/15 border-t-violet-400 animate-spin" />
          <div>
            <div className="text-[14px] text-white/80 font-medium mb-1">Генерируем ракурсы по комнатам…</div>
            <div className="text-[12px] text-white/45">Каждый тип квартиры — несколько кадров · 60–180 сек</div>
          </div>
          {/* skeleton tabs */}
          <div className="flex gap-2 mt-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-8 w-20 rounded-lg bg-white/[0.05] animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── error
  if (gallery.state === "error") {
    return <ErrorState message={gallery.errorMessage} onRetry={onGenerate} />;
  }

  // ── idle
  if (gallery.state === "idle" && fallbackBag.state === "idle") {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="text-center max-w-md px-8">
          <div className="size-14 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-white/10 grid place-items-center mx-auto mb-5">
            <Eye size={22} className="text-white/85" />
          </div>
          <div className="text-[20px] font-semibold tracking-display mb-2.5">Интерьеры по типам</div>
          <div className="text-[13px] text-white/50 leading-relaxed mb-5">
            Для каждого типа квартиры (студия, 1К, 2К, 3К) сгенерирует несколько кадров
            по комнатам — гостиная, кухня, спальня, санузел.
          </div>
          <button onClick={onGenerate} className="btn-apple h-10 px-5 text-[13px] inline-flex items-center gap-2">
            <Sparkles size={14} /> Сгенерировать интерьеры
          </button>
        </div>
      </div>
    );
  }

  // ── fallback single image (старый режим)
  if (gallery.state === "idle" && fallbackBag.state === "ready") {
    return (
      <div className="flex-1 relative">
        <img src={fallbackBag.imageUrl!} alt="Интерьер" className="w-full h-full object-contain" />
      </div>
    );
  }

  // ── ready: галерея, сгруппированная по типу квартиры (тип → ракурсы комнат)
  const groups: {
    apt_type: string; label: string; area: number; count: number; items: InteriorGalleryItem[];
  }[] = [];
  const groupIndex: Record<string, number> = {};
  for (const it of gallery.items) {
    if (groupIndex[it.apt_type] === undefined) {
      groupIndex[it.apt_type] = groups.length;
      groups.push({ apt_type: it.apt_type, label: it.label, area: it.area, count: it.count, items: [] });
    }
    groups[groupIndex[it.apt_type]].items.push(it);
  }
  const safeGroupIdx = Math.min(selectedIdx, groups.length - 1);
  const group = groups[safeGroupIdx];
  const angles = group.items;
  const safeAngleIdx = Math.min(selectedAngleIdx, angles.length - 1);
  const active = angles[safeAngleIdx];
  const angleLabel = (it: InteriorGalleryItem) => it.view_label || it.label;

  return (
    <>
      {/* Lightbox — показывает активный ракурс */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-w-5xl w-full" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-[13px] flex items-center gap-1.5"
              onClick={() => setLightboxOpen(false)}
            >
              <X size={16} /> Закрыть
            </button>
            <img
              src={`data:image/png;base64,${active.image_b64}`}
              alt={angleLabel(active)}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="flex items-center justify-between mt-4">
              <div>
                <div className="text-[15px] font-semibold text-white">
                  {group.label} · {angleLabel(active)} · {group.area.toFixed(0)} м² · {group.count} кв.
                </div>
                <div className="text-[11px] text-white/45 mt-0.5">{active.model_used}</div>
              </div>
              <a
                href={`data:image/png;base64,${active.image_b64}`}
                download={`plana-interior-${active.apt_type}-${active.room_focus || "view"}.png`}
                className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5"
              >
                <Download size={12} /> PNG
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Type selector tabs */}
      <div className="px-5 pt-3 pb-2 flex items-center gap-2 flex-shrink-0 border-b border-white/[0.04]">
        {groups.map((g, i) => (
          <button
            key={g.apt_type}
            onClick={() => selectGroup(i)}
            className={[
              "h-9 px-3.5 rounded-lg text-[12px] flex items-center gap-2 transition border",
              i === safeGroupIdx
                ? "bg-white/[0.08] border-white/15 text-white font-medium"
                : "border-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
            ].join(" ")}
          >
            <span>{g.label}</span>
            <span className="text-[10px] text-white/35">{g.area.toFixed(0)} м²</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">{g.items.length} фото</span>
          </button>
        ))}
        {gallery.elapsedMs && (
          <div className="ml-auto flex items-center gap-1 text-[11px] text-white/30">
            <CheckCircle2 size={11} className="text-emerald-400/50" />
            {(gallery.elapsedMs / 1000).toFixed(1)} сек
          </div>
        )}
      </div>

      {/* Room-angle thumbnail strip для активного типа */}
      {angles.length > 1 && (
        <div className="px-5 pt-2.5 pb-2 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
          {angles.map((it, i) => (
            <button
              key={it.room_focus || i}
              onClick={() => setSelectedAngleIdx(i)}
              className={[
                "group relative h-14 w-20 rounded-lg overflow-hidden border flex-shrink-0 transition",
                i === safeAngleIdx
                  ? "border-violet-400/70 ring-1 ring-violet-400/40"
                  : "border-white/10 hover:border-white/30",
              ].join(" ")}
              title={angleLabel(it)}
            >
              <img
                src={`data:image/png;base64,${it.image_b64}`}
                alt={angleLabel(it)}
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 bg-black/55 text-[9px] text-white/85 text-center py-0.5 truncate px-1">
                {angleLabel(it)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main image */}
      <div
        className="flex-1 relative cursor-zoom-in min-h-0 overflow-hidden"
        onClick={() => setLightboxOpen(true)}
      >
        <img
          src={`data:image/png;base64,${active.image_b64}`}
          alt={angleLabel(active)}
          className="w-full h-full object-contain"
        />
        {/* Zoom hint */}
        <div className="absolute inset-0 flex items-end justify-end p-4 pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-[11px] text-white/70 flex items-center gap-1.5">
            <Eye size={11} /> Открыть полностью
          </div>
        </div>
      </div>

      {/* Image footer */}
      <div className="px-5 py-2.5 border-t border-white/[0.04] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white/80">{group.label} · {angleLabel(active)} · {group.area.toFixed(0)} м²</span>
          {active.enhancer_used && active.enhancer_used !== "fallback" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-violet-300">
              ✨ {active.enhancer_used}
            </span>
          )}
          <span className="text-[10px] text-white/30">{active.model_used}</span>
        </div>
        <a
          href={`data:image/png;base64,${active.image_b64}`}
          download={`plana-interior-${active.apt_type}-${active.room_focus || "view"}.png`}
          className="h-8 px-3 rounded-full surface text-[11px] flex items-center gap-1.5 hover:bg-white/[0.08] transition text-white/60 hover:text-white"
        >
          <Download size={11} /> PNG
        </a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared — image canvas, action bars, etc.
// ---------------------------------------------------------------------------

function ImageCanvas({
  bag, onGenerate, emptyTitle, emptyText, loadingText, showGenerate = false,
}: {
  bag: ImageBag;
  onGenerate: () => void;
  emptyTitle: string;
  emptyText: string;
  loadingText: string;
  showGenerate?: boolean;
}) {
  if (bag.state === "ready" && bag.imageUrl) {
    return (
      <div className="absolute inset-0 grid place-items-center p-4">
        <img src={bag.imageUrl} alt="AI-визуализация" className="max-w-full max-h-full rounded-xl" style={{ objectFit: "contain" }} />
      </div>
    );
  }
  if (bag.state === "loading") {
    return (
      <div className="absolute inset-0 grid place-items-center">
        <Spinner text={loadingText} />
      </div>
    );
  }
  if (bag.state === "error") return <ErrorState message={bag.errorMessage} onRetry={onGenerate} />;
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center max-w-md px-8">
        <div className="size-14 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-white/10 grid place-items-center mx-auto mb-5">
          <Sparkles size={22} className="text-white/85" />
        </div>
        <div className="text-[20px] font-semibold tracking-display mb-2.5">{emptyTitle}</div>
        <div className="text-[13px] text-white/55 leading-relaxed">{emptyText}</div>
        {showGenerate && (
          <button onClick={onGenerate} className="btn-apple h-10 px-5 text-[13px] inline-flex items-center gap-2 mt-5">
            <Sparkles size={14} /> Сгенерировать
          </button>
        )}
      </div>
    </div>
  );
}

function ImageActionBar({ bag, onGenerate, downloadName }: { bag: ImageBag; onGenerate: () => void; downloadName: string }) {
  if (bag.state !== "ready" || !bag.imageUrl) return null;
  return (
    <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2 text-[12px] text-white/45 tabular">
        <span>Plana</span>
        <span className="text-white/20">·</span>
        {bag.enhancerUsed && bag.enhancerUsed !== "fallback" && (
          <>
            <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-violet-200" title="Промпт обогащён через Gemma 4">
              ✨ {bag.enhancerUsed}
            </span>
            <span className="text-white/20">в†’</span>
          </>
        )}
        {bag.modelUsed && (
          <span className="px-2 py-0.5 rounded-full bg-white/[0.05] text-white/70">{bag.modelUsed}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
          <RefreshCw size={12} /> Перегенерировать
        </button>
        <a href={bag.imageUrl} download={`${downloadName}.png`} className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5">
          <Download size={12} /> Скачать PNG
        </a>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="max-w-md text-center px-8">
        <div className="size-12 rounded-full bg-rose-500/10 border border-rose-400/30 grid place-items-center mx-auto mb-4">
          <AlertCircle size={20} className="text-rose-300" />
        </div>
        <div className="text-[15px] font-medium text-white/90 mb-2 tracking-display">Не удалось сгенерировать</div>
        <div className="text-[12.5px] text-white/55 leading-relaxed mb-4">{message}</div>
        <button onClick={onRetry} className="btn-apple h-10 px-5 text-[13px] inline-flex items-center gap-2">
          <RefreshCw size={13} /> Попробовать снова
        </button>
      </div>
    </div>
  );
}


function GpzuSummary({ ext }: { ext: GpzuExtraction }) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Габариты", value: ext.site_width_m && ext.site_depth_m
        ? `${ext.site_width_m} × ${ext.site_depth_m} м`
        : null },
    { label: "Площадь",  value: ext.site_area_m2 ? `${ext.site_area_m2.toFixed(0)} м²` : null },
    { label: "Отступы",  value: (ext.setback_front_m != null || ext.setback_side_m != null || ext.setback_rear_m != null)
        ? `пер. ${ext.setback_front_m ?? "—"} · бок ${ext.setback_side_m ?? "—"} · зад ${ext.setback_rear_m ?? "—"} м`
        : null },
    { label: "Этажность",        value: ext.max_floors != null ? `до ${ext.max_floors}` : null },
    { label: "Высота",           value: ext.max_height_m != null ? `до ${ext.max_height_m} м` : null },
    { label: "% застройки",      value: ext.max_coverage_pct != null ? `${ext.max_coverage_pct}%` : null },
    { label: "КИТ",              value: ext.max_far != null ? ext.max_far.toFixed(2) : null },
    { label: "Назначение",       value: ext.purpose_allowed.length ? ext.purpose_allowed.join(", ") : null },
  ];
  const present = rows.filter(r => r.value);
  if (!present.length) {
    return <div className="text-[11.5px] text-white/55">Параметры не извлечены — проверь PDF.</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
      {present.map((r) => (
        <div key={r.label} className="flex items-baseline gap-1.5">
          <span className="text-white/45">{r.label}:</span>
          <span className="text-white/85 tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DxfImportSummary({
  result,
  onApplyBounds,
}: {
  result: DxfImportResult;
  onApplyBounds: (result: DxfImportResult) => void;
}) {
  const bounds = result.bounds;
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    () => new Set(result.layers.filter((layer) => !layer.is_off && !layer.is_frozen).map((layer) => layer.name)),
  );
  const topLayers = [...result.layers]
    .sort((a, b) => b.entity_count - a.entity_count)
    .slice(0, 6);
  const topTypes = Object.entries(result.entity_types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const scale = dxfUnitToMetersScale(result.units);
  const metricBounds = bounds
    ? `${roundMetric(bounds.width * scale)} x ${roundMetric(bounds.height * scale)} м`
    : null;
  const toggleLayer = (name: string) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(220px,0.75fr)_minmax(300px,1fr)] gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Layers size={12} className="text-cyan-300" />
          <span className="text-[11.5px] text-white/75 truncate">
            {result.source_format === "dwg" ? "DWG импортирован" : "DXF импортирован"} · {result.converted_from ?? result.filename}
          </span>
          {result.converter && (
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-emerald-200/80">
              {result.converter} в†’ DXF
            </span>
          )}
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-400/20 text-cyan-200/80">
            {result.dxf_version}
          </span>
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-white/60">
            {result.units_name}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <DxfStat label="Entities" value={String(result.entity_count)} />
          <DxfStat label="Layers" value={String(result.layer_count)} />
          <DxfStat
            label="BBox"
            value={metricBounds ?? "-"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-white/35 mb-1.5">
              Слои
            </div>
            <div className="space-y-1">
              {topLayers.map((layer) => (
                <button
                  key={layer.name}
                  onClick={() => toggleLayer(layer.name)}
                  className="w-full flex items-center justify-between gap-2 text-[11px] rounded-md px-1.5 py-1 hover:bg-white/[0.05] transition"
                  title={visibleLayers.has(layer.name) ? "Скрыть слой" : "Показать слой"}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={[
                        "size-2 rounded-full flex-shrink-0",
                        visibleLayers.has(layer.name) ? "bg-cyan-300" : "bg-white/20",
                      ].join(" ")}
                    />
                    <span className={visibleLayers.has(layer.name) ? "text-white/70 truncate" : "text-white/30 truncate"}>
                      {layer.name}
                    </span>
                  </span>
                  <span className="text-white/35 tabular">{layer.entity_count}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-white/35 mb-1.5">
              Entity types
            </div>
            <div className="space-y-1">
              {topTypes.map(([type, count]) => (
                <div key={type} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-white/65 truncate">{type}</span>
                  <span className="text-white/35 tabular">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {result.warnings.length > 0 && (
          <div className="mt-3 text-[11px] text-amber-200/75 leading-snug">
            {result.warnings[0]}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onApplyBounds(result)}
            disabled={!bounds}
            className="h-8 px-3 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-100/90 text-[11.5px] hover:bg-cyan-500/15 transition disabled:opacity-40"
            title={result.site_polygon ? "Применить контур участка + габариты в форму" : "Записать bbox DXF в ширину и глубину формы"}
          >
            {result.site_polygon ? "Применить контур" : "Применить габариты"}
          </button>
          <button
            onClick={() => setVisibleLayers(new Set(result.layers.map((layer) => layer.name)))}
            className="h-8 px-3 rounded-full surface text-[11.5px] hover:bg-white/[0.08] transition"
            title="Показать все слои"
          >
            Все слои
          </button>
          <button
            onClick={() => setVisibleLayers(new Set())}
            className="h-8 px-3 rounded-full surface text-[11.5px] hover:bg-white/[0.08] transition"
            title="Скрыть все слои"
          >
            Скрыть
          </button>
        </div>
      </div>

      <DxfPreview result={result} visibleLayers={visibleLayers} />
    </div>
  );
}

function DxfStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.035] border border-white/[0.06] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1">{label}</div>
      <div className="text-[12px] text-white/85 tabular truncate">{value}</div>
    </div>
  );
}

function DxfPreview({
  result,
  visibleLayers,
}: {
  result: DxfImportResult;
  visibleLayers: Set<string>;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const b = result.bounds;
  if (!b || result.preview_entities.length === 0) {
    return (
      <div className="h-44 rounded-lg border border-white/[0.06] bg-black/20 grid place-items-center text-[12px] text-white/35">
        Preview недоступен для этого DXF
      </div>
    );
  }

  const width = Math.max(b.width, 1);
  const height = Math.max(b.height, 1);
  const visibleEntities = result.preview_entities.filter((entity) => visibleLayers.has(entity.layer));
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const stepX = viewWidth * 0.12;
  const stepY = viewHeight * 0.12;
  const viewBox = `${b.min_x + pan.x + (width - viewWidth) / 2} ${-b.max_y + pan.y + (height - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#080b10] overflow-hidden">
      <div className="h-9 border-b border-white/[0.06] px-2.5 flex items-center justify-between gap-2">
        <div className="text-[10.5px] text-white/40 tabular">
          {visibleEntities.length}/{result.preview_entities.length} preview entities
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPan((p) => ({ ...p, x: p.x - stepX }))}
            className="size-6 rounded-md surface text-[10px] text-white/55 hover:text-white"
            title="Pan left"
          >
            L
          </button>
          <button
            onClick={() => setPan((p) => ({ ...p, y: p.y - stepY }))}
            className="size-6 rounded-md surface text-[10px] text-white/55 hover:text-white"
            title="Pan up"
          >
            U
          </button>
          <button
            onClick={() => setPan((p) => ({ ...p, y: p.y + stepY }))}
            className="size-6 rounded-md surface text-[10px] text-white/55 hover:text-white"
            title="Pan down"
          >
            D
          </button>
          <button
            onClick={() => setPan((p) => ({ ...p, x: p.x + stepX }))}
            className="size-6 rounded-md surface text-[10px] text-white/55 hover:text-white"
            title="Pan right"
          >
            R
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
            className="size-6 rounded-md surface text-[12px] text-white/55 hover:text-white"
            title="Zoom out"
          >
            -
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(12, z * 1.25))}
            className="size-6 rounded-md surface text-[12px] text-white/55 hover:text-white"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={resetView}
            className="h-6 px-2 rounded-md surface text-[10px] text-white/55 hover:text-white"
            title="Reset view"
          >
            Fit
          </button>
        </div>
      </div>
      <div className="h-44 relative">
        {visibleEntities.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-white/35">
            Все preview-слои скрыты
          </div>
        )}
        <svg viewBox={viewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <g transform="scale(1 -1)">
            {visibleEntities.slice(0, 450).map((entity, i) => {
              const stroke = DXF_LAYER_COLORS[Math.abs(hashString(entity.layer)) % DXF_LAYER_COLORS.length];
              if (entity.type === "line") {
                const [a, c] = entity.points;
                return (
                  <line
                    key={i}
                    x1={a[0]}
                    y1={a[1]}
                    x2={c[0]}
                    y2={c[1]}
                    stroke={stroke}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    opacity={0.82}
                  />
                );
              }
              if (entity.type === "polyline") {
                const points = entity.points.map((p) => `${p[0]},${p[1]}`).join(" ");
                return (
                  <polyline
                    key={i}
                    points={points}
                    fill="none"
                    stroke={stroke}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    opacity={0.82}
                  />
                );
              }
              return (
                <circle
                  key={i}
                  cx={entity.center[0]}
                  cy={entity.center[1]}
                  r={entity.radius}
                  fill="none"
                  stroke={stroke}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={1}
                  strokeDasharray={entity.arc ? "4 3" : undefined}
                  opacity={0.78}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

const DXF_LAYER_COLORS = [
  "#67e8f9",
  "#a7f3d0",
  "#fca5a5",
  "#c4b5fd",
  "#fde68a",
  "#93c5fd",
  "#f0abfc",
  "#d1d5db",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// ContourSummary — карточка с результатами Vision-анализа контура (Этап 2 ТЗ)
// ---------------------------------------------------------------------------

const REC_TAG_ICON: Record<ContourRecommendation["tag"], React.ReactNode> = {
  geometry:    <Ruler size={11} />,
  insolation:  <Sparkles size={11} />,
  access:      <DoorOpen size={11} />,
  fire:        <Flame size={11} />,
  landscape:   <Trees size={11} />,
  context:     <Network size={11} />,
};

const REC_TAG_LABEL: Record<ContourRecommendation["tag"], string> = {
  geometry:   "форма",
  insolation: "инсоляция",
  access:     "входы",
  fire:       "пожарка",
  landscape:  "благоустр.",
  context:    "контекст",
};

const REC_PRIORITY_STYLES: Record<ContourRecommendation["priority"], string> = {
  high:   "bg-rose-500/15 border-rose-400/30 text-rose-200",
  medium: "bg-amber-500/15 border-amber-400/30 text-amber-200",
  low:    "bg-white/[0.05] border-white/10 text-white/60",
};

function ContourSummary({ analysis, onApplyDims }: { analysis: ContourAnalysis; onApplyDims?: () => void }) {
  const a = analysis;
  const orientation = a.estimated_orientation_deg != null
    ? `${a.estimated_orientation_deg.toFixed(0)}° от севера`
    : null;
  const dims = a.estimated_width_m && a.estimated_depth_m
    ? `${a.estimated_width_m.toFixed(0)} × ${a.estimated_depth_m.toFixed(0)} м`
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <ScanSearch size={12} className="text-violet-300" />
        <span className="text-[11.5px] text-white/70">
          Анализ контура · уверенность {a.confidence === "high" ? "высокая" : a.confidence === "medium" ? "средняя" : "низкая"}
        </span>
        {dims && (
          <span className="text-[10.5px] tabular px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-white/65">
            {dims}
          </span>
        )}
        {orientation && (
          <span className="text-[10.5px] tabular px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-white/65 flex items-center gap-1">
            <Compass size={10} /> {orientation}
          </span>
        )}
        {onApplyDims && (
          <button
            onClick={onApplyDims}
            className="h-6 px-2.5 rounded-full border border-violet-400/30 bg-violet-500/10 text-violet-100/90 text-[10.5px] hover:bg-violet-500/20 transition"
            title="Применить габариты из анализа в форму"
          >
            Применить размеры
          </button>
        )}
      </div>
      <div className="text-[12.5px] text-white/85 mb-2.5">{a.shape_summary}</div>

      {a.context_features.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {a.context_features.map((f, i) => (
            <span
              key={i}
              className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-white/55"
            >
              {f}
            </span>
          ))}
        </div>
      )}

      {a.recommendations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10.5px] uppercase tracking-[0.12em] text-white/40 font-medium mb-0.5">
            Рекомендации
          </div>
          {a.recommendations.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 ${REC_PRIORITY_STYLES[r.priority]}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="opacity-80">{REC_TAG_ICON[r.tag]}</span>
                <span className="text-[10px] uppercase tracking-[0.1em] opacity-70">
                  {REC_TAG_LABEL[r.tag]}
                </span>
                <span className="text-[12.5px] font-medium ml-1 text-white">
                  {r.title}
                </span>
              </div>
              <div className="text-[11.5px] text-white/75 leading-snug">
                {r.detail}
              </div>
            </div>
          ))}
        </div>
      )}

      {a.notes && (
        <div className="mt-3 text-[11px] text-white/45 italic border-l border-white/15 pl-2.5">
          {a.notes}
        </div>
      )}
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="size-10 rounded-full border-2 border-white/15 border-t-white animate-spin" />
      <div className="text-[13px] text-white/65 tabular">{text}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Размещение ЖК на участке (2 фото → 3 варианта посадки)
// ---------------------------------------------------------------------------

function UploadZone({
  label, sub, preview, file, onFile, accent,
}: {
  label: string; sub: string; preview: string | null; file: File | null;
  onFile: (f: File | null) => void; accent: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) onFile(f);
  };
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => ref.current?.click()}
      className="relative rounded-xl border border-dashed border-white/15 hover:border-white/25 hover:bg-white/[0.02] transition cursor-pointer overflow-hidden flex flex-col"
      style={{ minHeight: 180 }}
    >
      {preview ? (
        <>
          <img src={preview} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="relative z-10 mt-auto p-3 flex items-end justify-between">
            <div>
              <div className={`text-[11px] font-semibold mb-0.5`} style={{ color: accent }}>{label}</div>
              <div className="text-[10.5px] text-white/60 truncate max-w-[160px]">{file?.name}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              className="h-7 px-2.5 rounded-full bg-black/50 text-[11px] text-white/70 hover:text-white flex items-center gap-1"
            >
              <X size={11} />
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 p-5 text-center gap-2">
          <Upload size={22} className="text-white/30" />
          <div className="text-[12.5px] font-medium text-white/70">{label}</div>
          <div className="text-[11px] text-white/40">{sub}</div>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

function PlacementTab({
  bag, siteFile, sitePreview, bldFile, bldPreview, onSiteFile, onBldFile, onGenerate,
}: {
  bag: PlacementBag;
  siteFile: File | null; sitePreview: string | null;
  bldFile: File | null;  bldPreview: string | null;
  onSiteFile: (f: File | null) => void;
  onBldFile:  (f: File | null) => void;
  onGenerate: () => void;
}) {
  const [lightbox, setLightbox] = useState<PlacementVariant | null>(null);
  const bothUploaded = !!siteFile && !!bldFile;

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <button className="absolute -top-10 right-0 text-white/60 hover:text-white text-[13px] flex items-center gap-1.5" onClick={() => setLightbox(null)}>
              <X size={16} /> Закрыть
            </button>
            <img src={`data:image/png;base64,${lightbox.image_b64}`} alt={lightbox.label} className="w-full rounded-2xl shadow-2xl" />
            <div className="flex items-center justify-between mt-4">
              <div className="text-[15px] font-semibold text-white">{lightbox.label}</div>
              <a
                href={`data:image/png;base64,${lightbox.image_b64}`}
                download={`plana-placement-${lightbox.key}.png`}
                className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5"
              >
                <Download size={12} /> Скачать PNG
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0">
        <Building2 size={14} className="text-emerald-300" />
        <span className="text-[13px] font-medium text-white/85">Размещение ЖК на участке</span>
        <span className="text-[11.5px] text-white/40">Фото ЖК + аэрофото → 3 варианта посадки</span>
        {bag.state === "ready" && bag.elapsedMs && (
          <div className="ml-auto flex items-center gap-1 text-[11px] text-white/35">
            <CheckCircle2 size={11} className="text-emerald-400/60" />
            {(bag.elapsedMs / 1000).toFixed(1)} сек
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {/* Idle — загрузка двух фото */}
        {bag.state === "idle" && (
          <div className="p-5 flex flex-col gap-5">
            <div className="text-center max-w-lg mx-auto pt-4">
              <div className="text-[18px] font-semibold tracking-display mb-2">Загрузи два фото</div>
              <div className="text-[12.5px] text-white/50 leading-relaxed">
                Аэрофото участка + фото или рендер вашего ЖК. AI предложит 3 варианта как здание можно разместить на участке.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto w-full">
              <UploadZone
                label="Аэрофото участка"
                sub="Скрин с Google Maps или Яндекс"
                preview={sitePreview}
                file={siteFile}
                onFile={onSiteFile}
                accent="#6ee7b7"
              />
              <UploadZone
                label="Фото / рендер ЖК"
                sub="Любое изображение здания"
                preview={bldPreview}
                file={bldFile}
                onFile={onBldFile}
                accent="#93c5fd"
              />
            </div>
            {bothUploaded && (
              <div className="flex justify-center">
                <button onClick={onGenerate} className="btn-apple h-10 px-6 text-[13px] flex items-center gap-2">
                  <Sparkles size={14} /> Сгенерировать 3 варианта размещения
                </button>
              </div>
            )}
            {!bothUploaded && (
              <div className="text-center text-[11.5px] text-white/30">
                {!siteFile && !bldFile ? "Загрузи оба фото" : !siteFile ? "Нужно аэрофото участка" : "Нужно фото ЖК"}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {bag.state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4">
              <div className="size-12 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin" />
              <div className="text-center">
                <div className="text-[14px] text-white/80 font-medium mb-1">Генерируем 3 варианта размещения…</div>
                <div className="text-[12px] text-white/45">gpt-image × 3 параллельно · 60–120 сек</div>
              </div>
              {/* Скелетон */}
              <div className="grid grid-cols-3 gap-3 mt-4 opacity-30">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-52 h-36 rounded-xl bg-white/[0.05] border border-white/[0.07] animate-pulse" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {bag.state === "error" && <ErrorState message={bag.errorMessage} onRetry={onGenerate} />}

        {/* Ready — галерея 3 вариантов */}
        {bag.state === "ready" && bag.variants.length > 0 && (
          <div className="p-5">
            {/* Превью загруженных фото */}
            {(sitePreview || bldPreview) && (
              <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="text-[11px] text-white/40 mr-1">Источники:</div>
                {sitePreview && <img src={sitePreview} alt="Участок" className="h-12 w-20 object-cover rounded-lg opacity-80" />}
                <ArrowRight size={14} className="text-white/20" />
                {bldPreview  && <img src={bldPreview}  alt="ЖК"     className="h-12 w-20 object-cover rounded-lg opacity-80" />}
                <div className="ml-auto text-[11px] text-white/30">{bag.variants.length} варианта готово</div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              {bag.variants.map((v) => (
                <div
                  key={v.key}
                  className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-white/15 hover:bg-white/[0.04] transition-all duration-200"
                >
                  <div className="relative cursor-zoom-in overflow-hidden" onClick={() => setLightbox(v)}>
                    <img
                      src={`data:image/png;base64,${v.image_b64}`}
                      alt={v.label}
                      className="w-full h-44 object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 text-[11px] text-white/90 flex items-center gap-1.5">
                        <Eye size={12} /> Открыть
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-[12.5px] font-medium text-white/90">{v.label}</div>
                      <div className="text-[10px] text-white/35 mt-0.5">{v.model_used}</div>
                    </div>
                    <a
                      href={`data:image/png;base64,${v.image_b64}`}
                      download={`plana-placement-${v.key}.png`}
                      className="h-8 px-3 rounded-full surface text-[11px] flex items-center gap-1.5 hover:bg-white/[0.08] transition text-white/55 hover:text-white/85"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={11} /> PNG
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {bag.state === "ready" && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] text-white/40">
            {bag.variants.length} варианта размещения · нажми на изображение для полного размера
          </div>
          <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
            <RefreshCw size={12} /> Перегенерировать
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — AI Чертежи (5 PNG вариантов планировки через gpt-image)
// ---------------------------------------------------------------------------

function AiPlansTab({
  bag, currentFloor, totalFloors, onChangeFloor, floorBags,
  onGenerate, onGoToViz, onExportDxf, onExportIfc, cadExportLoading,
  dxfImportLoading, dxfImportResult, dxfImportError, onDxfImport, onClearDxfImport, onApplyDxfBounds,
  gpzuLoading, gpzuLastResult, gpzuError, onGpzuImport, onClearGpzu,
  contourLoading, contourResult, contourError, onContourAnalyze, onClearContour, onApplyContourDims,
  onGetMetrics, parkingBag, parkingLevel, parkingLevelsTotal, onParkingLevel, onGenerateParking,
  onExportFullReport, hasExtraSections,
  inputs,
}: {
  bag: AiPlansBag;
  currentFloor: number;
  totalFloors: number;
  onChangeFloor: (f: number) => void;
  floorBags: Record<number, AiPlansBag>;
  onGenerate: () => void;
  onGoToViz: (planImageUrl?: string, planPrompt?: string) => void;
  onExportDxf: () => Promise<void>;
  onExportIfc: () => Promise<void>;
  cadExportLoading: CadExportKind | null;
  inputs: VisualizeFromInputsRequest;
  dxfImportLoading: boolean;
  dxfImportResult: DxfImportResult | null;
  dxfImportError: string | null;
  onDxfImport: (f: File) => void;
  onClearDxfImport: () => void;
  onApplyDxfBounds: (result: DxfImportResult) => void;
  gpzuLoading: boolean;
  gpzuLastResult: GpzuExtraction | null;
  gpzuError: string | null;
  onGpzuImport: (f: File) => void;
  onClearGpzu: () => void;
  contourLoading: boolean;
  contourResult: ContourAnalysis | null;
  contourError: string | null;
  onContourAnalyze: (f: File) => void;
  onClearContour: () => void;
  onApplyContourDims: (w: number, d: number) => void;
  onGetMetrics: () => Promise<FloorPlanMetrics>;
  parkingBag: ImageBag;
  parkingLevel: number;
  parkingLevelsTotal: number;
  onParkingLevel: (l: number) => void;
  onGenerateParking: () => void;
  onExportFullReport: () => Promise<void>;
  hasExtraSections: boolean;
}) {
  const [lightbox, setLightbox] = useState<AiPlanVariant | null>(null);
  // Интерактивная корректировка (Этап 4 ТЗ): юзер пишет инструкцию,
  // gpt-image-edit перерисовывает чертёж, результат показываем поверх оригинала.
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editedUrl, setEditedUrl] = useState<string | null>(null);
  const [editedModel, setEditedModel] = useState<string | null>(null);
  const [showEdited, setShowEdited] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const maskCanvasRef = useRef<MaskCanvasHandle>(null);
  const [lightboxImgSize, setLightboxImgSize] = useState<{ w: number; h: number } | null>(null);
  const [lightboxDisplaySize, setLightboxDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const lightboxImgRef = useRef<HTMLImageElement>(null);

  // Сброс edit-состояния при смене картинки в lightbox
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEditInstruction("");
      setEditError(null);
      setEditing(false);
      setEditedUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setEditedModel(null);
      setShowEdited(false);
      setMaskMode(false);
      maskCanvasRef.current?.clear();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lightbox?.key]);

  const handleApplyEdit = async () => {
    if (!lightbox || !editInstruction.trim() || editing) return;
    setEditing(true);
    setEditError(null);
    try {
      const res = await editAiPlan(lightbox.imageUrl, editInstruction.trim(), "medium");
      const url = URL.createObjectURL(res.blob);
      if (editedUrl) URL.revokeObjectURL(editedUrl);
      setEditedUrl(url);
      setEditedModel(res.modelUsed);
      setShowEdited(true);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditing(false);
    }
  };

  const handleApplyInpaint = async () => {
    if (!lightbox || !editInstruction.trim() || editing) return;
    const maskDataUrl = maskCanvasRef.current?.exportMask();
    if (!maskDataUrl) return;
    setEditing(true);
    setEditError(null);
    try {
      const res = await inpaintAiPlan(lightbox.imageUrl, maskDataUrl, editInstruction.trim(), "medium");
      const url = URL.createObjectURL(res.blob);
      if (editedUrl) URL.revokeObjectURL(editedUrl);
      setEditedUrl(url);
      setEditedModel(res.modelUsed);
      setShowEdited(true);
      setMaskMode(false);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditing(false);
    }
  };

  const gpzuInputRef = useRef<HTMLInputElement>(null);
  const onGpzuChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onGpzuImport(f);
    if (gpzuInputRef.current) gpzuInputRef.current.value = "";
  };
  const contourInputRef = useRef<HTMLInputElement>(null);
  const onContourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onContourAnalyze(f);
    if (contourInputRef.current) contourInputRef.current.value = "";
  };
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const onDxfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onDxfImport(f);
    if (dxfInputRef.current) dxfInputRef.current.value = "";
  };

  // Что показываем сейчас в lightbox — оригинал или результат правки
  const currentUrl = showEdited && editedUrl ? editedUrl : lightbox?.imageUrl;

  // Подсказки-примеры инструкций
  const EDIT_EXAMPLES = [
    "Сделай гостиную больше",
    "Перенеси кухню на южный фасад",
    "Добавь балконы у каждой квартиры",
    "Объедини две маленькие квартиры в одну большую",
  ];

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full my-auto" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-[13px] flex items-center gap-1.5"
              onClick={() => setLightbox(null)}
            >
              <X size={16} /> Закрыть
            </button>

            {/* Toggle оригинал / правка (показывается только когда есть результат) */}
            {editedUrl && (
              <div className="absolute -top-10 left-0 inline-flex bg-white/[0.06] border border-white/[0.1] rounded-lg p-0.5">
                <button
                  onClick={() => setShowEdited(false)}
                  className={[
                    "h-7 px-3 rounded-md text-[11.5px] transition",
                    !showEdited ? "bg-white/15 text-white font-medium" : "text-white/55 hover:text-white",
                  ].join(" ")}
                >
                  Оригинал
                </button>
                <button
                  onClick={() => setShowEdited(true)}
                  className={[
                    "h-7 px-3 rounded-md text-[11.5px] transition flex items-center gap-1.5",
                    showEdited ? "bg-violet-500/30 text-violet-100 font-medium" : "text-white/55 hover:text-white",
                  ].join(" ")}
                >
                  <Wand2 size={11} /> После правки
                </button>
              </div>
            )}

            {/* Картинка */}
            <div
              className="relative"
              style={{ cursor: maskMode && !editing ? "none" : undefined }}
            >
              <img
                ref={lightboxImgRef}
                src={currentUrl}
                alt={lightbox.label}
                className="w-full rounded-2xl shadow-2xl"
                onLoad={() => {
                  const el = lightboxImgRef.current;
                  if (el) {
                    setLightboxImgSize({ w: el.naturalWidth, h: el.naturalHeight });
                    setLightboxDisplaySize({ w: el.clientWidth, h: el.clientHeight });
                  }
                }}
              />
              {maskMode && !editing && lightboxImgSize && lightboxDisplaySize && (
                <div className="absolute inset-0 rounded-2xl overflow-hidden">
                  <MaskCanvas
                    ref={maskCanvasRef}
                    imageWidth={lightboxImgSize.w}
                    imageHeight={lightboxImgSize.h}
                    displayWidth={lightboxDisplaySize.w}
                    displayHeight={lightboxDisplaySize.h}
                  />
                </div>
              )}
              {editing && (
                <div className="absolute inset-0 rounded-2xl bg-black/55 backdrop-blur-sm flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={28} className="text-violet-300 animate-spin" />
                    <div className="text-[12.5px] text-white/85">Применяем правку…</div>
                    <div className="text-[10.5px] text-white/45">gpt-image-edit · ~30–60 сек</div>
                  </div>
                </div>
              )}
            </div>

            {/* Метаданные + кнопки скачивания */}
            <div className="flex items-center justify-between mt-4">
              <div>
                <div className="text-[15px] font-semibold text-white">{lightbox.label}</div>
                <div className="flex items-center gap-2 mt-1">
                  {showEdited && editedModel && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/30 border border-violet-400/40 text-violet-100 flex items-center gap-1">
                      <Wand2 size={10} /> Изменено · {editedModel}
                    </span>
                  )}
                  {!showEdited && lightbox.enhancerUsed && lightbox.enhancerUsed !== "fallback" && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/30 text-violet-200">
                      ✨ {lightbox.enhancerUsed}
                    </span>
                  )}
                  {!showEdited && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60">
                      {lightbox.modelUsed}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={currentUrl}
                  download={`plana-ai-${lightbox.key}${showEdited ? "-edit" : ""}.png`}
                  className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition text-white/70 hover:text-white"
                >
                  <Download size={12} /> PNG
                </a>
                <button
                  onClick={() => exportAiPlansPdf([lightbox], `plana-ai-${lightbox.key}`)}
                  className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5"
                >
                  <Download size={12} /> PDF
                </button>
              </div>
            </div>

            {/* Edit-панель */}
            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Wand2 size={13} className="text-violet-300" />
                <span className="text-[12.5px] font-medium text-white/85">Корректировка чертежа</span>
                <span className="text-[10.5px] text-white/35 flex-1">
                  Опиши что изменить — gpt-image отредактирует план
                </span>
                {/* Переключатель: текст / маска */}
                <div className="inline-flex bg-white/[0.06] border border-white/[0.1] rounded-lg p-0.5 shrink-0">
                  <button
                    onClick={() => { setMaskMode(false); maskCanvasRef.current?.clear(); }}
                    disabled={editing}
                    className={[
                      "h-6 px-2.5 rounded-md text-[11px] transition",
                      !maskMode ? "bg-white/15 text-white font-medium" : "text-white/50 hover:text-white",
                    ].join(" ")}
                  >
                    Текст
                  </button>
                  <button
                    onClick={() => setMaskMode(true)}
                    disabled={editing}
                    className={[
                      "h-6 px-2.5 rounded-md text-[11px] transition flex items-center gap-1",
                      maskMode ? "bg-red-500/30 text-red-100 font-medium" : "text-white/50 hover:text-white",
                    ].join(" ")}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Маска
                  </button>
                </div>
              </div>

              {maskMode && (
                <div className="mb-2.5 rounded-lg bg-red-500/10 border border-red-400/20 px-3 py-2 text-[11.5px] text-red-200/80">
                  Закрась кистью область для перерисовки, затем опиши что нужно — AI заменит только закрашенное.
                  <button
                    onClick={() => maskCanvasRef.current?.clear()}
                    disabled={editing}
                    className="ml-2 underline text-red-300 hover:text-red-100 transition disabled:opacity-40"
                  >
                    Очистить
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") maskMode ? handleApplyInpaint() : handleApplyEdit();
                  }}
                  placeholder={maskMode
                    ? "Что нарисовать в закрашенной области?"
                    : "«сделай гостиную больше», «перенеси кухню на южный фасад», …"}
                  disabled={editing}
                  className="flex-1 h-10 px-3.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/40 focus:bg-white/[0.06] transition disabled:opacity-50"
                />
                <button
                  onClick={maskMode ? handleApplyInpaint : handleApplyEdit}
                  disabled={editing || !editInstruction.trim()}
                  className="btn-apple h-10 px-4 text-[12.5px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {editing ? "Применяем…" : "Применить"}
                </button>
              </div>
              {/* Подсказки */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {EDIT_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => !editing && setEditInstruction(ex)}
                    disabled={editing}
                    className="h-6 px-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/55 hover:text-white hover:bg-white/[0.07] transition disabled:opacity-40"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {editError && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-rose-300">
                  <AlertCircle size={12} />
                  {editError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header strip */}
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.04] flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-violet-300" />
            <span className="text-[13px] font-medium text-white/85">AI Чертежи планировки</span>
          </div>
          <span className="text-[11.5px] text-white/40">
            Превью плана типового этажа для питча
          </span>
          <div className="ml-auto flex items-center gap-2">
          {/* Кнопки импорта скрыты по просьбе пользователя.
              State (dxfImportLoading, gpzuLoading, contourLoading), ref'ы
              (dxfInputRef, contourInputRef, gpzuInputRef) и обработчики
              (onDxfChange, onGpzuChange, onContourChange) оставлены —
              вернуть UI = раскоментить блок ниже. */}
          {false && (
            <>
              <input
                ref={dxfInputRef}
                type="file"
                accept=".dxf,.dwg,application/dxf"
                className="hidden"
                onChange={onDxfChange}
              />
              <button
                onClick={() => dxfInputRef.current?.click()}
                disabled={dxfImportLoading}
                className="h-8 px-3 rounded-full surface text-[11.5px] flex items-center gap-1.5 hover:bg-white/[0.08] transition disabled:opacity-50"
                title="Загрузить DXF/DWG — покажем слои, entities, габариты и быстрый preview"
              >
                {dxfImportLoading ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                {dxfImportLoading ? "Читаем CAD…" : "CAD import"}
              </button>
              <input
                ref={contourInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={onContourChange}
              />
              <button
                onClick={() => contourInputRef.current?.click()}
                disabled={contourLoading}
                className="h-8 px-3 rounded-full surface text-[11.5px] flex items-center gap-1.5 hover:bg-white/[0.08] transition disabled:opacity-50"
                title="Загрузить фото / PDF / эскиз участка — Vision проанализирует и предложит рекомендации"
              >
                {contourLoading ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
                {contourLoading ? "Анализируем…" : "Анализ контура"}
              </button>
              <input
                ref={gpzuInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onGpzuChange}
              />
              <button
                onClick={() => gpzuInputRef.current?.click()}
                disabled={gpzuLoading}
                className="h-8 px-3 rounded-full surface text-[11.5px] flex items-center gap-1.5 hover:bg-white/[0.08] transition disabled:opacity-50"
                title="Загрузить ГПЗУ-PDF — поля формы заполнятся автоматически"
              >
                <Upload size={12} />
                {gpzuLoading ? "Распознаём…" : "ГПЗУ → форма"}
              </button>
            </>
          )}
          {bag.state === "ready" && bag.elapsedMs && (
            <div className="flex items-center gap-1 text-[11px] text-white/35">
              <CheckCircle2 size={11} className="text-emerald-400/60" />
              {(bag.elapsedMs / 1000).toFixed(1)} сек
            </div>
          )}
          </div>
        </div>

        {/* Floor navigator */}
        {totalFloors > 1 && (
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            <span className="text-[11px] text-white/35 mr-1">Этаж:</span>
            {Array.from({ length: totalFloors }, (_, i) => i + 1).map((fl) => {
              const state = floorBags[fl]?.state ?? "idle";
              const label = fl === 1 ? "1 (лобби)" : fl === totalFloors ? `${fl} (верх)` : String(fl);
              return (
                <button
                  key={fl}
                  onClick={() => onChangeFloor(fl)}
                  className={[
                    "h-7 px-2.5 rounded-lg text-[11.5px] transition border relative",
                    currentFloor === fl
                      ? "bg-violet-500/25 border-violet-400/40 text-violet-100 font-medium"
                      : "border-white/[0.07] text-white/55 hover:text-white/85 hover:bg-white/[0.04]",
                  ].join(" ")}
                >
                  {label}
                  {state === "ready" && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-emerald-400" />
                  )}
                  {state === "loading" && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full border border-white/40 border-t-white/80 animate-spin" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* DXF import result/error banner */}
      {(dxfImportResult || dxfImportError) && (
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-start gap-3 flex-shrink-0">
          {dxfImportError ? (
            <div className="flex items-center gap-2 text-[12px] text-rose-300">
              <AlertCircle size={13} />
              CAD не импортирован: {dxfImportError}
            </div>
          ) : dxfImportResult ? (
            <div className="flex-1 min-w-0">
              <DxfImportSummary
                key={`${dxfImportResult.filename}:${dxfImportResult.entity_count}`}
                result={dxfImportResult}
                onApplyBounds={onApplyDxfBounds}
              />
            </div>
          ) : null}
          <button
            onClick={onClearDxfImport}
            className="text-white/30 hover:text-white/70 transition flex-shrink-0"
            title="Скрыть"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* GPZU result/error banner */}
      {(gpzuLastResult || gpzuError) && (
        <div className="px-5 py-2.5 border-b border-white/[0.04] flex items-start gap-3 flex-shrink-0">
          {gpzuError ? (
            <div className="flex items-center gap-2 text-[12px] text-rose-300">
              <AlertCircle size={13} />
              ГПЗУ не распознан: {gpzuError}
            </div>
          ) : gpzuLastResult ? (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <CheckCircle2 size={12} className="text-emerald-300" />
                  <span className="text-[11.5px] text-white/70">ГПЗУ распознан · поля формы обновлены</span>
                </div>
                <GpzuSummary ext={gpzuLastResult} />
              </div>
            </>
          ) : null}
          <button
            onClick={onClearGpzu}
            className="text-white/30 hover:text-white/70 transition flex-shrink-0"
            title="Скрыть"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Contour analysis banner */}
      {(contourResult || contourError) && (
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-start gap-3 flex-shrink-0">
          {contourError ? (
            <div className="flex items-center gap-2 text-[12px] text-rose-300">
              <AlertCircle size={13} />
              Анализ не удался: {contourError}
            </div>
          ) : contourResult ? (
            <div className="flex-1 min-w-0">
              <ContourSummary
                analysis={contourResult}
                onApplyDims={
                  contourResult.estimated_width_m && contourResult.estimated_depth_m
                    ? () => onApplyContourDims(contourResult.estimated_width_m!, contourResult.estimated_depth_m!)
                    : undefined
                }
              />
            </div>
          ) : null}
          <button
            onClick={onClearContour}
            className="text-white/30 hover:text-white/70 transition flex-shrink-0"
            title="Скрыть"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {bag.state === "idle" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center max-w-md px-8">
              <div className="size-16 rounded-full bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20 border border-white/10 grid place-items-center mx-auto mb-5">
                <Sparkles size={26} className="text-violet-200" />
              </div>
              <div className="text-[21px] font-semibold tracking-display mb-3">
                AI план типового этажа
              </div>
              <div className="text-[13px] text-white/50 leading-relaxed">
                Введи параметры слева и нажми «Сгенерировать» — получишь готовый план этажа для питча инвесторам.
              </div>
            </div>
          </div>
        )}

        {bag.state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="size-12 rounded-full border-2 border-white/15 border-t-violet-400 animate-spin" />
              <div>
                <div className="text-[14px] text-white/80 font-medium mb-1">Генерируем план…</div>
                <div className="text-[12px] text-white/45">30–90 сек</div>
              </div>
              <div className="w-80 h-52 rounded-xl bg-white/[0.04] border border-white/[0.06] animate-pulse mt-2 opacity-40" />
            </div>
          </div>
        )}

        {bag.state === "error" && <ErrorState message={bag.errorMessage} onRetry={onGenerate} />}

        {bag.state === "ready" && bag.variants.length > 0 && (() => {
          const v = bag.variants.find((x) => x.key === "balanced_mix") ?? bag.variants[0];
          return (
            <div className="p-6 flex justify-center">
              <div className="w-full max-w-2xl group rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-white/15 transition-all duration-200">
                <div
                  className="relative overflow-hidden cursor-zoom-in"
                  onClick={() => setLightbox(v)}
                >
                  <img
                    src={v.imageUrl}
                    alt={v.label}
                    className="w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 text-[11px] text-white/90 flex items-center gap-1.5">
                      <Eye size={12} /> Открыть
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12.5px] font-medium text-white/90">Оптимальный план типового этажа</div>
                    <div className="text-[10px] text-white/35 mt-0.5">{v.modelUsed}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onGoToViz(v.imageUrl, v.promptUsed); }}
                      className="btn-apple h-8 px-3 text-[11px] flex items-center gap-1.5"
                      title="В Визуализации с этим чертежом — «С мебелью» построится из него"
                    >
                      <ImageIcon size={12} /> Визуализация
                    </button>
                    <a
                      href={v.imageUrl}
                      download={`plana-ai-plan.png`}
                      className="h-8 px-2.5 rounded-full surface text-[11px] flex items-center gap-1 hover:bg-white/[0.08] transition text-white/55 hover:text-white/85"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={11} /> PNG
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); exportAiPlansPdf([v], "plana-ai-plan"); }}
                      className="h-8 px-2.5 rounded-full surface text-[11px] flex items-center gap-1 hover:bg-white/[0.08] transition text-white/55 hover:text-white/85"
                    >
                      <Download size={11} /> PDF
                    </button>
                  </div>
                </div>
                {v.promptUsed && (
                  <details className="border-t border-white/[0.05]">
                    <summary className="px-4 py-2 text-[10.5px] text-white/35 cursor-pointer hover:text-white/55 select-none list-none flex items-center gap-1.5">
                      <FileText size={10} /> Промпт для gpt-image-2
                    </summary>
                    <pre className="px-4 pb-3 text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
                      {v.promptUsed}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Паркинг — секция под вариантами */}
      {parkingLevelsTotal > 0 && (bag.state === "ready" || parkingBag.state !== "idle") && (
        <ParkingSection
          bag={parkingBag}
          level={parkingLevel}
          levelsTotal={parkingLevelsTotal}
          onLevel={onParkingLevel}
          onGenerate={onGenerateParking}
        />
      )}

      {/* Bottom bar */}
      {bag.state === "ready" && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onGenerate}
            className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition"
          >
            <RefreshCw size={12} /> Перегенерировать
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// P2.1 — Сравнительная таблица вариантов
// ---------------------------------------------------------------------------

const VARIANT_STRATEGY: Record<string, string> = {
  max_useful_area: "Компактное ядро, квартиры сквозь всю глубину, минимум коридоров",
  max_apt_count:   "Студии и 1К, двусторонний коридор, 8–12 квартир на этаже",
  balanced_mix:    "20% студии · 30% 1К · 35% 2К · 15% 3К — советский/классический mix",
  max_insolation:  "Все жилые на юг, технические (санузел, кухня) на север",
  open_plan:       "3–5 крупных евроквартир, open-plan кухня-гостиная ≥ 22 м²",
};

function ComparisonTable({
  variants, metrics, metricsLoading, onOpenLightbox, onExportDxf, onExportIfc, cadExportLoading,
}: {
  variants: AiPlanVariant[];
  metrics: FloorPlanMetrics | null;
  metricsLoading: boolean;
  onOpenLightbox: (v: AiPlanVariant) => void;
  onExportDxf: () => Promise<void>;
  onExportIfc: () => Promise<void>;
  cadExportLoading: CadExportKind | null;
}) {
  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Метрики здания — единые для всех вариантов */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-3.5 flex flex-wrap gap-x-6 gap-y-2">
        {metricsLoading ? (
          <div className="flex items-center gap-2 text-[11.5px] text-white/40">
            <Loader2 size={12} className="animate-spin" /> Считаем метрики…
          </div>
        ) : metrics ? (
          <>
            <MetricChip label="Площадь этажа" value={`${metrics.total_floor_area_m2} м²`} />
            <MetricChip label="Квартир на этаже" value={String(metrics.apartments_count)} />
            <MetricChip label="Ср. площадь квартиры" value={`${metrics.avg_apartment_area_m2} м²`} />
            <MetricChip label="КПД" value={`${metrics.efficiency_pct}%`} accent />
            <MetricChip label="Секций" value={String(metrics.sections_count)} />
            <MetricChip label="Квартир/секция" value={String(metrics.units_per_section)} />
          </>
        ) : (
          <span className="text-[11.5px] text-white/30">Метрики не загружены</span>
        )}
      </div>

      {/* Таблица вариантов */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/[0.07] bg-white/[0.02]">
              <th className="px-4 py-2.5 text-[11px] font-medium text-white/40 w-20">Превью</th>
              <th className="px-4 py-2.5 text-[11px] font-medium text-white/40">Вариант</th>
              <th className="px-4 py-2.5 text-[11px] font-medium text-white/40">Стратегия</th>
              <th className="px-4 py-2.5 text-[11px] font-medium text-white/40 w-32 text-right">Скачать</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={v.key} className={["border-b border-white/[0.05] hover:bg-white/[0.02] transition", i === variants.length - 1 ? "border-b-0" : ""].join(" ")}>
                <td className="px-4 py-3">
                  <button onClick={() => onOpenLightbox(v)} className="relative group rounded-lg overflow-hidden w-16 h-12 flex-shrink-0">
                    <img src={v.imageUrl} alt={v.label} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                      <Eye size={12} className="text-white opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="text-[12.5px] font-medium text-white/90">{v.label}</div>
                  <div className="text-[10.5px] text-white/35 mt-0.5">{v.modelUsed}</div>
                </td>
                <td className="px-4 py-3 text-[11.5px] text-white/55 leading-relaxed max-w-xs">
                  {VARIANT_STRATEGY[v.key] ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 justify-end">
                    <a
                      href={v.imageUrl}
                      download={`plana-ai-${v.key}.png`}
                      className="h-7 px-2 rounded-lg surface text-[10.5px] flex items-center gap-1 hover:bg-white/[0.08] transition text-white/55 hover:text-white"
                    >
                      <Download size={10} /> PNG
                    </a>
                    <button
                      onClick={onExportDxf}
                      disabled={cadExportLoading !== null}
                      className="h-7 px-2 rounded-lg text-[10.5px] flex items-center gap-1 transition border border-violet-400/30 text-violet-200/80 hover:bg-violet-500/15 disabled:opacity-50"
                    >
                      <Download size={10} /> DXF
                    </button>
                    <button
                      onClick={onExportIfc}
                      disabled={cadExportLoading !== null}
                      className="h-7 px-2 rounded-lg text-[10.5px] flex items-center gap-1 transition border border-cyan-400/30 text-cyan-200/80 hover:bg-cyan-500/15 disabled:opacity-50"
                    >
                      <Network size={10} /> IFC
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10.5px] text-white/40">{label}:</span>
      <span className={["text-[13px] font-semibold", accent ? "text-emerald-300" : "text-white/85"].join(" ")}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P2.2 — Секция паркинга в AI Plans
// ---------------------------------------------------------------------------

function ParkingSection({
  bag, level, levelsTotal, onLevel, onGenerate,
}: {
  bag: ImageBag;
  level: number;
  levelsTotal: number;
  onLevel: (l: number) => void;
  onGenerate: () => void;
}) {
  const [open, setOpen] = useState(bag.state !== "idle");
  return (
    <div className="border-t border-white/[0.05] flex-shrink-0">
      {/* Заголовок-accordion */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center gap-2.5 hover:bg-white/[0.02] transition text-left"
      >
        <DoorOpen size={13} className="text-cyan-300 flex-shrink-0" />
        <span className="text-[12.5px] font-medium text-white/80">Подземный паркинг</span>
        <span className="text-[11px] text-white/35 ml-1">{levelsTotal} ур.</span>
        {bag.state === "ready" && <CheckCircle2 size={12} className="text-emerald-400 ml-1" />}
        {bag.state === "loading" && <Loader2 size={12} className="animate-spin text-white/40 ml-1" />}
        <span className="ml-auto text-[11px] text-white/30">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-5 pb-4 flex flex-col gap-3">
          {/* Выбор уровня + кнопка */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11.5px] text-white/45">Уровень:</span>
            {Array.from({ length: levelsTotal }, (_, i) => i + 1).map((l) => (
              <button
                key={l}
                onClick={() => onLevel(l)}
                className={[
                  "h-7 px-2.5 rounded-lg text-[11.5px] transition border",
                  level === l
                    ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-100 font-medium"
                    : "border-white/[0.07] text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
                ].join(" ")}
              >
                Б{l}
              </button>
            ))}
            <button
              onClick={onGenerate}
              disabled={bag.state === "loading"}
              className="ml-auto h-8 px-3.5 rounded-full btn-apple text-[12px] flex items-center gap-1.5 disabled:opacity-50"
            >
              {bag.state === "loading" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {bag.state === "loading" ? "Генерируем…" : bag.state === "ready" ? "Перегенерировать" : "Сгенерировать план"}
            </button>
          </div>

          {/* Результат */}
          {bag.state === "ready" && bag.imageUrl && (
            <div className="relative rounded-xl overflow-hidden group">
              <img src={bag.imageUrl} alt="План паркинга" className="w-full rounded-xl" />
              <div className="absolute bottom-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                <a
                  href={bag.imageUrl}
                  download="plana-parking.png"
                  className="h-8 px-3 rounded-full bg-black/70 backdrop-blur text-[11.5px] text-white flex items-center gap-1.5 hover:bg-black/90 transition"
                >
                  <Download size={11} /> PNG
                </a>
              </div>
            </div>
          )}

          {bag.state === "error" && (
            <div className="flex items-center gap-2 text-[12px] text-rose-300">
              <AlertCircle size={13} /> {bag.errorMessage}
            </div>
          )}

          {bag.state === "idle" && (
            <div className="text-[11.5px] text-white/30 text-center py-4">
              Нажми «Сгенерировать план» — AI нарисует план паркинга в стиле CAD
            </div>
          )}
        </div>
      )}
    </div>
  );
}
