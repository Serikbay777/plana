"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Layers, LogOut, Sparkles, Download, RefreshCw, AlertCircle,
  Map as MapIcon, Image as ImageIcon, Upload, Building2, Sofa, Eye, X,
  CheckCircle2, ArrowRight, Wand2, Loader2, ScanSearch, Compass, Ruler,
  Trees, Flame, DoorOpen, Network, Save, FolderOpen, Check,
  LayoutGrid, List, History, ChevronDown, Plus, FileText,
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
  visualizeExterior,
  visualizeFloorplanFurniture,
  visualizeSitePlacement,
  visualizeFloorVariants,
  visualizeFloorByLevel,
  visualizeSitePlacementVariants,
  visualizeInteriorGallery,
  editAiPlan,
  inpaintAiPlan,
  exportFloorplanDxf,
  exportFloorplanIfc,
  generateFloorLayout,
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
} from "@/lib/engine";
import { getSession, signOut, type Session } from "@/lib/auth";
import { createProject, updateProject, uploadAsset, getProject, createRun, listProjects, type GenerationRun, type Project as ProjectType } from "@/lib/projects";
import HistoryPanel from "@/components/HistoryPanel";
import { PdfVizTab, type PdfVizResult } from "@/components/PdfVizTab";
import { ArchitecturalDrawingsTab } from "@/components/ArchitecturalDrawingsTab";
import { AlbumImagesViewer } from "@/components/AlbumImagesViewer";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

type GenState = "idle" | "loading" | "ready" | "error";
type CadExportKind = "dxf" | "ifc";
type TopTab = "site" | "viz" | "ai_plans" | "placement" | "pdf_viz" | "arch_drawings";
type VizMode = "exterior" | "floorplan_furniture" | "interior";

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

// Tab 3 — интерьер-галерея (1 рендер на тип квартиры)
type InteriorGalleryBag = {
  state: GenState;
  items: InteriorGalleryItem[];
  elapsedMs: number | null;
  errorMessage: string | null;
};
const EMPTY_INT_GALLERY: InteriorGalleryBag = {
  state: "idle", items: [], elapsedMs: null, errorMessage: null,
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
  const [recentProjects, setRecentProjects] = useState<ProjectType[]>([]);
  const [projectName, setProjectName] = useState("Без названия");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  const [form, setForm] = useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  const [tab, setTab] = useState<TopTab>("ai_plans");

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
  const [vizExtBag,     setVizExtBag]     = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [vizFloorBag,   setVizFloorBag]   = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [vizIntBag,     setVizIntBag]     = useState<ImageBag>(EMPTY_IMAGE_BAG);      // fallback single image
  const [vizIntGallery, setVizIntGallery] = useState<InteriorGalleryBag>(EMPTY_INT_GALLERY);
  const [vizMode, setVizMode] = useState<VizMode>("exterior");
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
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

  // ---- auth gate
  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/login"); return; }
    setSession(s);
    setAuthChecked(true);
  }, [router]);

  // ---- загрузка последних проектов для переключателя
  useEffect(() => {
    if (!authChecked) return;
    listProjects().then(setRecentProjects).catch(() => {});
  }, [authChecked]);

  // ---- загрузка проекта по ?project=ID
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("project");
    if (!pid || !authChecked) return;
    getProject(pid).then((p) => {
      restoringRef.current = true;
      setProjectId(p.id);
      setProjectName(p.name);
      setForm({ ...DEFAULT_PROMPT_FORM, ...(p.params as PromptFormState) });
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
        const ext = p.assets.find((a) => a.tab === "viz_exterior");
        if (ext) setVizExtBag({ state: "ready", imageUrl: ext.url, modelUsed: ext.model_used, enhancerUsed: null, errorMessage: null });
        const floorViz = p.assets.find((a) => a.tab === "viz_floor");
        if (floorViz) setVizFloorBag({ state: "ready", imageUrl: floorViz.url, modelUsed: floorViz.model_used, enhancerUsed: null, errorMessage: null });
        const site = p.assets.find((a) => a.tab === "site");
        if (site) setSiteBag({ state: "ready", imageUrl: site.url, modelUsed: site.model_used, enhancerUsed: null, errorMessage: null });
      }
      setTimeout(() => { restoringRef.current = false; }, 50);
    }).catch(() => { /* проект не найден — просто игнорируем */ });
  }, [authChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- сохранение проекта
  const saveProject = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveOk(false);
    try {
      let pid = projectId;
      if (!pid) {
        const p = await createProject(projectName, form);
        pid = p.id;
        setProjectId(pid);
        window.history.replaceState(null, "", `?project=${pid}`);
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
      } else {
        const p = await updateProject(pid, { name: projectName, params: form });
        setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
      }
      // сохраняем сгенерированные изображения
      const uploads: Promise<unknown>[] = [];
      Object.entries(floorBags).forEach(([floorStr, bag]) => {
        const fl = Number(floorStr);
        if (bag.state === "ready") {
          bag.variants.forEach((v) => {
            uploads.push(uploadAsset(pid!, "ai_plans", v.key, v.imageUrl, v.modelUsed, fl).catch(() => {}));
          });
        }
      });
      if (vizExtBag.imageUrl)   uploads.push(uploadAsset(pid!, "viz_exterior", "exterior",  vizExtBag.imageUrl,   vizExtBag.modelUsed ?? undefined).catch(() => {}));
      if (vizFloorBag.imageUrl) uploads.push(uploadAsset(pid!, "viz_floor",    "floor",     vizFloorBag.imageUrl, vizFloorBag.modelUsed ?? undefined).catch(() => {}));
      if (siteBag.imageUrl)     uploads.push(uploadAsset(pid!, "site",         "placement", siteBag.imageUrl,     siteBag.modelUsed ?? undefined).catch(() => {}));
      await Promise.all(uploads);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [saving, projectId, projectName, form, floorBags, vizExtBag, vizFloorBag, siteBag]);

  // ---- авто-сохранение после генерации
  const autoSaveGeneration = useCallback((
    tab: string,
    floor: number,
    assets: { variantKey: string; imageUrl: string; modelUsed?: string }[],
    currentForm: PromptFormState,
  ) => {
    const task = async () => {
      setAutoSaving(true);
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
          const p = await createProject(auto, currentForm);
          pid = p.id;
          projectIdRef.current = pid;
          setProjectId(pid);
          window.history.replaceState(null, "", `?project=${pid}`);
          setRecentProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 10));
        } else {
          await updateProject(pid, { params: currentForm }).catch(() => {});
        }
        const run = await createRun(pid, tab, floor, currentForm);
        await Promise.all(
          assets.map((a) =>
            uploadAsset(pid!, tab, a.variantKey, a.imageUrl, a.modelUsed, floor, run.id).catch(() => {}),
          ),
        );
        setAutoSaveLabel(pname || "проект");
        setTimeout(() => setAutoSaveLabel(null), 3000);
      } catch { /* silent */ } finally {
        setAutoSaving(false);
      }
    };
    // Очередь: сохранения сериализуются, ничего не дропается.
    saveChainRef.current = saveChainRef.current.then(task, task);
    return saveChainRef.current;
  }, [projectName]);

  // сбрасываем результаты при изменении формы
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (restoringRef.current) return;
      setSiteBag(b => b.state === "ready" ? { ...b, state: "idle" } : b);
      setVizExtBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
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

      const res = await visualizeInteriorGallery({
        floors: form.floors,
        purpose: form.purpose,
        quality: "medium",
        apt_types: aptTypes,
      });
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

  // Генерация одного режима (по активному vizMode) — для ручного запуска
  const generateViz = () => {
    const req = buildVisReq(form);
    if (vizMode === "exterior")                 wrapImageGen(setVizExtBag,   () => visualizeExterior(req),           { tab: "viz_exterior", variantKey: "exterior" });
    else if (vizMode === "floorplan_furniture") wrapImageGen(setVizFloorBag, () => visualizeFloorplanFurniture(req), { tab: "viz_floor",    variantKey: "floor" });
    else                                        generateInteriorGallery();
  };

  // Запуск всех параллельно — при переходе с AI Чертежей
  const generateAllViz = () => {
    const req = buildVisReq(form);
    wrapImageGen(setVizExtBag,   () => visualizeExterior(req));
    wrapImageGen(setVizFloorBag, () => visualizeFloorplanFurniture(req));
    generateInteriorGallery();
  };

  // Переход в Визуализации + автозапуск всех
  const goToVizAndGenerateAll = () => {
    setTab("viz");
    const req = buildVisReq(form);
    wrapImageGen(setVizExtBag,   () => visualizeExterior(req));
    wrapImageGen(setVizFloorBag, () => visualizeFloorplanFurniture(req));
    generateInteriorGallery();
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
      exteriorUrl: vizExtBag.state === "ready" ? vizExtBag.imageUrl : null,
      floorplanFurnitureUrl: vizFloorBag.state === "ready" ? vizFloorBag.imageUrl : null,
      interiors: vizIntGallery.state === "ready" ? vizIntGallery.items : [],
      pdfViz: pdfVizResults,
    });
  };

  // ---- восстановление из истории
  const handleRestoreRun = useCallback((run: GenerationRun) => {
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
    } else if (run.tab === "viz_exterior" && run.assets[0]) {
      setVizExtBag({ state: "ready", imageUrl: run.assets[0].url, modelUsed: run.assets[0].model_used, enhancerUsed: null, errorMessage: null });
      setTab("viz");
    } else if (run.tab === "viz_floor" && run.assets[0]) {
      setVizFloorBag({ state: "ready", imageUrl: run.assets[0].url, modelUsed: run.assets[0].model_used, enhancerUsed: null, errorMessage: null });
      setTab("viz");
    } else if (run.tab === "site" && run.assets[0]) {
      setSiteBag({ state: "ready", imageUrl: run.assets[0].url, modelUsed: run.assets[0].model_used, enhancerUsed: null, errorMessage: null });
      setTab("site");
    } else if (run.tab === "pdf_viz") {
      // Полноценный restore PDF-альбома требовал бы хранить исходный PDF —
      // в MVP просто переключаем таб; превью сохранённых ассетов остаётся в Истории.
      setTab("pdf_viz");
    } else if (run.tab === "arch_drawings") {
      // Этап 1: restore = просто переключение таба + превью в Истории.
      setTab("arch_drawings");
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
    setVizExtBag(EMPTY_IMAGE_BAG);
    setVizFloorBag(EMPTY_IMAGE_BAG);
    setSiteBag(EMPTY_IMAGE_BAG);
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
    : generateViz;

  // active state для индикатора loading в кнопке
  const vizAnyLoading = vizExtBag.state === "loading" || vizFloorBag.state === "loading" || vizIntBag.state === "loading" || vizIntGallery.state === "loading";
  const currentFloorBag = floorBags[currentFloor] ?? EMPTY_AI_PLANS;
  const isLoading =
    tab === "site"        ? siteBag.state === "loading"
    : tab === "ai_plans"  ? currentFloorBag.state === "loading"
    : tab === "placement" ? placementBag.state === "loading"
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
        onChange={setTab}
        onExportDxf={handleExportDxf}
        onExportIfc={handleExportIfc}
        cadExportLoading={cadExportLoading}
      />

      <main
        className="flex-1 px-6 pb-6 pt-4 grid gap-4"
        style={{ gridTemplateColumns: (tab === "placement" || tab === "site" || tab === "pdf_viz" || tab === "arch_drawings") ? "1fr" : "300px minmax(0, 1fr)" }}
      >
        {/* LEFT — форма + панель валидации (скрыто на фото-табах) */}
        {tab !== "placement" && tab !== "site" && tab !== "pdf_viz" && tab !== "arch_drawings" && (
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
          {tab === "site" && (
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
          )}
          {tab === "viz" && (
            <VizTab
              extBag={vizExtBag}
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
              onGoToViz={goToVizAndGenerateAll}
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
                vizExtBag.state === "ready" ||
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
          {tab === "pdf_viz" && (
            <PdfVizTab
              onAutoSave={(pageIndex, asset) => {
                autoSaveGeneration("pdf_viz", pageIndex, [asset], form);
              }}
              onResultsChange={setPdfVizResults}
            />
          )}
          {tab === "arch_drawings" && (
            <ArchitecturalDrawingsTab
              onAutoSave={(asset) => {
                autoSaveGeneration("arch_drawings", 1, [asset], form);
              }}
            />
          )}
        </section>
        {historyOpen && (
          <HistoryPanel
            projectId={projectId}
            currentTab={tab}
            onRestoreImages={handleRestoreRun}
            onRestoreParams={handleRestoreParams}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header & TabStrip
// ---------------------------------------------------------------------------

function Header({
  session, onSignOut, onSave, saving, saveOk, autoSaving, autoSaveLabel,
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
    { key: "site",           label: "Посадка на участок",   icon: <MapIcon size={13} /> },
    { key: "placement",      label: "Размещение ЖК",         icon: <Building2 size={13} /> },
    { key: "pdf_viz",        label: "PDF Визуализация",      icon: <FileText size={13} /> },
    { key: "arch_drawings",  label: "Архитектурные чертежи", icon: <Ruler size={13} /> },
  ];
  const items = allItems.filter((it) => it.key === "ai_plans" || it.key === "arch_drawings");
  return (
    <div className="px-6 pt-3 pb-1 border-b border-white/[0.04] flex items-center justify-between gap-3 flex-wrap">
      <div className="inline-flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        {items.map((it) => (
          <button
            key={it.key}
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
  const inputRef    = useRef<HTMLInputElement | null>(null);
  const bldInputRef = useRef<HTMLInputElement | null>(null);

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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
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

function VizTab({
  extBag, floorBag, intBag, intGallery, mode, setMode, onGenerate, onGenerateAll,
}: {
  extBag: ImageBag;
  floorBag: ImageBag;
  intBag: ImageBag;
  intGallery: InteriorGalleryBag;
  mode: VizMode;
  setMode: (m: VizMode) => void;
  onGenerate: () => void;
  onGenerateAll: () => void;
}) {
  // Для галереи — какой тип квартиры показываем
  const [selectedIntIdx, setSelectedIntIdx] = useState(0);

  const intIsLoading = intGallery.state === "loading" || intBag.state === "loading";
  const intIsReady   = intGallery.state === "ready" || intBag.state === "ready";

  const nonIntModes: Array<{ key: VizMode; label: string; icon: React.ReactNode; bag: ImageBag; downloadName: string }> = [
    { key: "exterior",            label: "Экстерьер", icon: <Building2 size={13} />, bag: extBag,   downloadName: "plana-exterior" },
    { key: "floorplan_furniture", label: "С мебелью", icon: <Sofa size={13} />,      bag: floorBag, downloadName: "plana-floorplan" },
  ];

  const anyReady = extBag.state === "ready" || floorBag.state === "ready" || intIsReady;
  const allIdle  = extBag.state === "idle"  && floorBag.state === "idle"  && intGallery.state === "idle" && intBag.state === "idle";

  const activeSingleBag = nonIntModes.find(m => m.key === mode)?.bag ?? null;

  return (
    <>
      {/* ── Sub-tab strip ── */}
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.04] flex items-center gap-2 flex-shrink-0">
        {nonIntModes.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={[
              "h-9 px-3.5 rounded-lg text-[12.5px] flex items-center gap-2 transition border",
              mode === m.key
                ? "bg-white/[0.07] border-white/15 text-white"
                : "border-transparent text-white/60 hover:text-white/85 hover:bg-white/[0.03]",
            ].join(" ")}
          >
            {m.bag.state === "loading" ? (
              <div className="size-3 rounded-full border border-white/30 border-t-white/80 animate-spin" />
            ) : m.bag.state === "ready" ? (
              <CheckCircle2 size={13} className="text-emerald-400" />
            ) : m.icon}
            {m.label}
          </button>
        ))}

        {/* Кнопка Интерьер */}
        <button
          onClick={() => setMode("interior")}
          className={[
            "h-9 px-3.5 rounded-lg text-[12.5px] flex items-center gap-2 transition border",
            mode === "interior"
              ? "bg-white/[0.07] border-white/15 text-white"
              : "border-transparent text-white/60 hover:text-white/85 hover:bg-white/[0.03]",
          ].join(" ")}
        >
          {intIsLoading ? (
            <div className="size-3 rounded-full border border-white/30 border-t-white/80 animate-spin" />
          ) : intIsReady ? (
            <CheckCircle2 size={13} className="text-emerald-400" />
          ) : (
            <Eye size={13} />
          )}
          Интерьер
          {intGallery.state === "ready" && intGallery.items.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium">
              {intGallery.items.length} типа
            </span>
          )}
        </button>

        <div className="h-4 w-px bg-white/[0.07] mx-1" />

        {allIdle && (
          <button
            onClick={onGenerateAll}
            className="h-9 px-3.5 rounded-lg text-[12.5px] flex items-center gap-2 border border-dashed border-white/20 text-white/55 hover:text-white/85 hover:border-white/35 hover:bg-white/[0.03] transition"
          >
            <Sparkles size={13} className="text-violet-300" />
            Генерировать все 3
          </button>
        )}
      </div>

      {/* ── Контент ── */}
      <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
        {mode === "interior" ? (
          /* ─── ГАЛЕРЕЯ ИНТЕРЬЕРОВ ─── */
          <InteriorGalleryPanel
            gallery={intGallery}
            fallbackBag={intBag}
            selectedIdx={selectedIntIdx}
            onSelect={setSelectedIntIdx}
            onGenerate={onGenerate}
          />
        ) : (
          /* ─── Одиночное изображение (экстерьер / с мебелью) ─── */
          <ImageCanvas
            bag={activeSingleBag!}
            onGenerate={onGenerate}
            emptyTitle={mode === "exterior" ? "Внешний вид здания" : "План с мебелью"}
            emptyText=""
            loadingText={mode === "exterior" ? "AI рендерит экстерьер · 60–90 сек" : "AI расставляет мебель · 60–90 сек"}
          />
        )}
      </div>

      {/* ── Bottom bar ── */}
      {anyReady && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            {nonIntModes.map(m => m.bag.state === "ready" ? (
              <span key={m.key} className="flex items-center gap-1 text-emerald-400/70">
                <CheckCircle2 size={10} /> {m.label}
              </span>
            ) : m.bag.state === "loading" ? (
              <span key={m.key} className="flex items-center gap-1 text-white/30">
                <div className="size-2 rounded-full border border-white/20 border-t-white/50 animate-spin" />
                {m.label}
              </span>
            ) : null)}
            {intIsReady && (
              <span className="flex items-center gap-1 text-emerald-400/70">
                <CheckCircle2 size={10} /> Интерьер
              </span>
            )}
            {intIsLoading && (
              <span className="flex items-center gap-1 text-white/30">
                <div className="size-2 rounded-full border border-white/20 border-t-white/50 animate-spin" />
                Интерьер
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
              <RefreshCw size={12} /> Перегенерировать
            </button>
            {mode !== "interior" && activeSingleBag?.state === "ready" && activeSingleBag.imageUrl && (
              <a
                href={activeSingleBag.imageUrl}
                download={`${nonIntModes.find(m => m.key === mode)!.downloadName}.png`}
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
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // ── loading
  if (gallery.state === "loading") {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="size-12 rounded-full border-2 border-white/15 border-t-violet-400 animate-spin" />
          <div>
            <div className="text-[14px] text-white/80 font-medium mb-1">Генерируем интерьеры по типам…</div>
            <div className="text-[12px] text-white/45">Каждый тип квартиры получит свой рендер · 60–120 сек</div>
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
          <div className="text-[13px] text-white/50 leading-relaxed">
            Сгенерирует отдельный фотореалистичный рендер для каждого типа квартиры в плане —
            студия, 1К, 2К, 3К — с реальными размерами и составом комнат.
          </div>
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

  // ── ready: галерея
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
              src={`data:image/png;base64,${items[lightboxIdx].image_b64}`}
              alt={items[lightboxIdx].label}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="flex items-center justify-between mt-4">
              <div>
                <div className="text-[15px] font-semibold text-white">
                  {items[lightboxIdx].label} · {items[lightboxIdx].area.toFixed(0)} м² · {items[lightboxIdx].count} кв.
                </div>
                <div className="text-[11px] text-white/45 mt-0.5">{items[lightboxIdx].model_used}</div>
              </div>
              <a
                href={`data:image/png;base64,${items[lightboxIdx].image_b64}`}
                download={`plana-interior-${items[lightboxIdx].apt_type}.png`}
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
        {items.map((item, i) => (
          <button
            key={item.apt_type}
            onClick={() => onSelect(i)}
            className={[
              "h-9 px-3.5 rounded-lg text-[12px] flex items-center gap-2 transition border",
              i === safeIdx
                ? "bg-white/[0.08] border-white/15 text-white font-medium"
                : "border-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
            ].join(" ")}
          >
            <span>{item.label}</span>
            <span className="text-[10px] text-white/35">{item.area.toFixed(0)} м²</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">×{item.count}</span>
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
        <img
          src={`data:image/png;base64,${active.image_b64}`}
          alt={active.label}
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
          <span className="text-[12px] font-medium text-white/80">{active.label} · {active.area.toFixed(0)} м²</span>
          {active.enhancer_used && active.enhancer_used !== "fallback" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-violet-300">
              ✨ {active.enhancer_used}
            </span>
          )}
          <span className="text-[10px] text-white/30">{active.model_used}</span>
        </div>
        <a
          href={`data:image/png;base64,${active.image_b64}`}
          download={`plana-interior-${active.apt_type}.png`}
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
  bag, onGenerate, emptyTitle, emptyText, loadingText,
}: {
  bag: ImageBag;
  onGenerate: () => void;
  emptyTitle: string;
  emptyText: string;
  loadingText: string;
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
            <span className="text-white/20">→</span>
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
              {result.converter} → DXF
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
  onGoToViz: () => void;
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
                  if (el) setLightboxImgSize({ w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
              {maskMode && !editing && lightboxImgSize && lightboxImgRef.current && (
                <div className="absolute inset-0 rounded-2xl overflow-hidden">
                  <MaskCanvas
                    ref={maskCanvasRef}
                    imageWidth={lightboxImgSize.w}
                    imageHeight={lightboxImgSize.h}
                    displayWidth={lightboxImgRef.current.clientWidth}
                    displayHeight={lightboxImgRef.current.clientHeight}
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

