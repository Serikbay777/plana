"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Layers, LogOut, Sparkles, Download, RefreshCw, AlertCircle,
  Map as MapIcon, Image as ImageIcon, Upload, Building2, Sofa, Eye, X,
  CheckCircle2, Package, AlertTriangle, BarChart3, ArrowRight, Box,
  Sun, Moon, Camera, RotateCw, Pause, Building, Mountain, Compass,
  DoorOpen, ArrowLeft,
} from "lucide-react";
import { PromptForm, DEFAULT_PROMPT_FORM, type PromptFormState } from "@/components/PromptForm";
import { PlanCanvas } from "@/components/PlanCanvas";
import { PlanCanvas3D, type PlanCanvas3DHandle, type SceneMode, type CameraPreset, type ViewMode } from "@/components/PlanCanvas3D";
import { AppMetrics } from "@/components/AppMetrics";
import { ComparisonTable } from "@/components/ComparisonTable";
import { exportPlanPdf, exportAiPlansPdf } from "@/lib/pdf-export";
import {
  generateFromRect,
  visualizeExterior,
  visualizeFloorplanFurniture,
  visualizeInterior,
  visualizeSitePlacement,
  visualizeFloorVariants,
  visualizeSitePlacementVariants,
  visualizeInteriorGallery,
  extractAptTypes,
  packageDownloadUrl,
  APT_COLORS,
  APT_LABELS,
  type GenerateResponse,
  type PresetKey,
  type Plan,
  type AptType,
  type VisualizeFromInputsRequest,
  type VisualizeResult,
  type PlacementVariant,
  type InteriorGalleryItem,
} from "@/lib/engine";
import { getSession, signOut, type Session } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

type GenState = "idle" | "loading" | "ready" | "error";
type TopTab = "floor" | "site" | "viz" | "ai_plans" | "placement" | "3d";
type VizMode = "exterior" | "floorplan_furniture" | "interior";

// Tab 1 — реальный план
type FloorBag = {
  state: GenState;
  response: GenerateResponse | null;
  selectedVariant: number;
  showCompare: boolean;
  errorMessage: string | null;
};
const EMPTY_FLOOR_BAG: FloorBag = {
  state: "idle", response: null, selectedVariant: 0, showCompare: false, errorMessage: null,
};

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

// Preset labels
const PRESET_LABELS: Record<PresetKey, string> = {
  max_useful_area:  "Макс. жилая S",
  max_apt_count:    "Макс. квартир",
  max_avg_area:     "Крупные квартиры",
  balanced_mix:     "Баланс",
  max_insolation:   "Инсоляция",
};

// Tab 4 — AI чертежи (5 PNG вариантов)
type AiPlanVariant = {
  key: string;
  label: string;
  imageUrl: string;  // data: URL из base64
  modelUsed: string;
  enhancerUsed: string;
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
function buildVisReq(form: PromptFormState): VisualizeFromInputsRequest {
  return {
    site_width_m: form.site_width_m,
    site_depth_m: form.site_depth_m,
    setback_front_m: form.setback_front_m,
    setback_side_m: form.setback_side_m,
    setback_rear_m: form.setback_rear_m,
    floors: form.floors,
    purpose: form.purpose,
    studio_pct: form.studio_pct / 100,
    k1_pct: form.k1_pct / 100,
    k2_pct: form.k2_pct / 100,
    k3_pct: form.k3_pct / 100,
    parking_spaces_per_apt: form.parking_spaces_per_apt,
    parking_underground_levels: form.parking_underground_levels,
    fire_evacuation_max_m: form.fire_evacuation_max_m,
    fire_evacuation_exits_per_section: form.fire_evacuation_exits_per_section,
    fire_dead_end_corridor_max_m: form.fire_dead_end_corridor_max_m,
    lifts_passenger: form.lifts_passenger,
    lifts_freight: form.lifts_freight,
    insolation_priority: form.insolation_priority,
    insolation_min_hours: form.insolation_min_hours,
    max_coverage_pct: form.max_coverage_pct,
    max_height_m: form.max_height_m,
    quality: "medium",
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [form, setForm] = useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  const [tab, setTab] = useState<TopTab>("ai_plans");

  // Tab 1
  const [floorBag, setFloorBag] = useState<FloorBag>(EMPTY_FLOOR_BAG);
  // Tab 2
  const [siteBag, setSiteBag] = useState<ImageBag>(EMPTY_IMAGE_BAG);
  // Tab 3 — три независимых стейта
  const [vizExtBag,     setVizExtBag]     = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [vizFloorBag,   setVizFloorBag]   = useState<ImageBag>(EMPTY_IMAGE_BAG);
  const [vizIntBag,     setVizIntBag]     = useState<ImageBag>(EMPTY_IMAGE_BAG);      // fallback single image
  const [vizIntGallery, setVizIntGallery] = useState<InteriorGalleryBag>(EMPTY_INT_GALLERY);
  const [vizMode, setVizMode] = useState<VizMode>("exterior");
  // Tab 4
  const [aiPlansBag, setAiPlansBag] = useState<AiPlansBag>(EMPTY_AI_PLANS);
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

  // ---- auth gate
  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/login"); return; }
    setSession(s);
    setAuthChecked(true);
  }, [router]);

  // сбрасываем результаты при изменении формы
  useEffect(() => {
    setFloorBag(b => b.state !== "idle" ? EMPTY_FLOOR_BAG : b);
    setSiteBag(b => b.state === "ready" ? { ...b, state: "idle" } : b);
    setVizExtBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
    setVizFloorBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
    setVizIntBag(b => b.state === "ready" ? EMPTY_IMAGE_BAG : b);
    setVizIntGallery(b => b.state === "ready" ? EMPTY_INT_GALLERY : b);
    setAiPlansBag(b => b.state === "ready" ? EMPTY_AI_PLANS : b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // ---- generators
  const generateFloor = async () => {
    setFloorBag({ ...EMPTY_FLOOR_BAG, state: "loading" });
    try {
      const res = await generateFromRect({
        site_width_m: form.site_width_m,
        site_depth_m: form.site_depth_m,
        setback_front_m: form.setback_front_m,
        setback_side_m: form.setback_side_m,
        setback_rear_m: form.setback_rear_m,
        floors: form.floors,
        purpose: form.purpose,
        target_mix: {
          studio: form.studio_pct / 100,
          k1: form.k1_pct / 100,
          k2: form.k2_pct / 100,
          k3: form.k3_pct / 100,
        },
      });
      setFloorBag({ state: "ready", response: res, selectedVariant: 0, showCompare: false, errorMessage: null });
    } catch (e) {
      setFloorBag({ state: "error", response: null, selectedVariant: 0, showCompare: false, errorMessage: (e as Error).message });
    }
  };

  const wrapImageGen = async (
    setter: React.Dispatch<React.SetStateAction<ImageBag>>,
    fn: () => Promise<VisualizeResult>,
  ) => {
    setter({ ...EMPTY_IMAGE_BAG, state: "loading" });
    try {
      const result = await fn();
      setter({
        state: "ready",
        imageUrl: URL.createObjectURL(result.blob),
        modelUsed: result.modelUsed,
        enhancerUsed: result.enhancerUsed,
        errorMessage: null,
      });
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
    return wrapImageGen(setSiteBag, () => visualizeSitePlacement(siteFile, buildVisReq(form), siteBldFile));
  };

  // Генератор интерьер-галереи — по уникальным типам из плана (или fallback)
  const generateInteriorGallery = async () => {
    setVizIntGallery({ ...EMPTY_INT_GALLERY, state: "loading" });
    try {
      const plan = floorBag.response?.variants[floorBag.selectedVariant] ?? null;
      const aptTypes = plan
        ? extractAptTypes(plan)
        : // fallback: синтетические типы из процентов формы
          (["studio", "k1", "k2", "k3"] as const)
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
    } catch (e) {
      setVizIntGallery({ ...EMPTY_INT_GALLERY, state: "error", errorMessage: (e as Error).message });
    }
  };

  // Генерация одного режима (по активному vizMode) — для ручного запуска
  const generateViz = () => {
    const req = buildVisReq(form);
    if (vizMode === "exterior")                 wrapImageGen(setVizExtBag,   () => visualizeExterior(req));
    else if (vizMode === "floorplan_furniture") wrapImageGen(setVizFloorBag, () => visualizeFloorplanFurniture(req));
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
    setAiPlansBag({ ...EMPTY_AI_PLANS, state: "loading" });
    try {
      const res = await visualizeFloorVariants(buildVisReq(form));
      const variants: AiPlanVariant[] = res.variants.map((v) => ({
        key: v.key,
        label: v.label,
        modelUsed: v.model_used,
        enhancerUsed: v.enhancer_used,
        imageUrl: `data:image/png;base64,${v.image_b64}`,
      }));
      setAiPlansBag({ state: "ready", variants, elapsedMs: res.elapsed_ms, errorMessage: null });
    } catch (e) {
      setAiPlansBag({ ...EMPTY_AI_PLANS, state: "error", errorMessage: (e as Error).message });
    }
  };

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
    } catch (e) {
      setPlacementBag({ ...EMPTY_PLACEMENT, state: "error", errorMessage: (e as Error).message });
    }
  };

  const onGenerate = useMemo(() => {
    if (tab === "floor" || tab === "3d") return generateFloor;
    if (tab === "site")                  return generateSite;
    if (tab === "ai_plans")              return generateAiPlans;
    if (tab === "placement")             return generatePlacement;
    return generateViz;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, vizMode, siteFile, placementSiteFile, placementBldFile, form]);

  // active state для индикатора loading в кнопке
  const vizAnyLoading = vizExtBag.state === "loading" || vizFloorBag.state === "loading" || vizIntBag.state === "loading" || vizIntGallery.state === "loading";
  const isLoading =
    tab === "floor" || tab === "3d" ? floorBag.state === "loading"
    : tab === "site"                 ? siteBag.state === "loading"
    : tab === "ai_plans"             ? aiPlansBag.state === "loading"
    : tab === "placement"            ? placementBag.state === "loading"
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
      <Header session={session} onSignOut={() => { signOut(); router.replace("/"); }} />
      <TabStrip tab={tab} onChange={setTab} />

      <main
        className="flex-1 px-6 pb-6 pt-4 grid gap-4"
        style={{ gridTemplateColumns: (tab === "placement" || tab === "site") ? "1fr" : "300px minmax(0, 1fr)" }}
      >
        {/* LEFT — форма (скрыта на фото-табах) */}
        {tab !== "placement" && tab !== "site" && (
          <PromptForm
            value={form}
            onChange={setForm}
            onGenerate={onGenerate}
            generating={isLoading}
          />
        )}

        {/* RIGHT — зависит от таба */}
        <section className="surface-strong rounded-2xl relative overflow-hidden flex flex-col min-h-[660px]">
          {tab === "floor" && (
            <FloorTab
              bag={floorBag}
              floors={form.floors}
              form={form}
              onGenerate={generateFloor}
              onSelectVariant={(i) => setFloorBag(b => ({ ...b, selectedVariant: i }))}
              onToggleCompare={() => setFloorBag(b => ({ ...b, showCompare: !b.showCompare }))}
              onGoToViz={() => setTab("viz")}
            />
          )}
          {tab === "3d" && (
            <View3DTab
              bag={floorBag}
              floors={form.floors}
              onGenerate={generateFloor}
              aiPlansBag={aiPlansBag}
            />
          )}
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
              bag={aiPlansBag}
              onGenerate={generateAiPlans}
              onGoToViz={goToVizAndGenerateAll}
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
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header & TabStrip
// ---------------------------------------------------------------------------

function Header({ session, onSignOut }: { session: Session | null; onSignOut: () => void }) {
  return (
    <header className="px-6 py-3 flex items-center justify-between border-b border-white/[0.05]">
      <div className="flex items-center gap-2.5">
        <div className="size-7 rounded-lg bg-white grid place-items-center">
          <Layers size={13} className="text-black" strokeWidth={2.5} />
        </div>
        <span className="text-[14px] font-semibold tracking-display">Plana</span>
      </div>
      <div className="flex items-center gap-2">
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

function TabStrip({ tab, onChange }: { tab: TopTab; onChange: (t: TopTab) => void }) {
  const items: Array<{ key: TopTab; label: string; icon: React.ReactNode }> = [
    { key: "ai_plans",  label: "AI Чертежи",          icon: <Sparkles size={13} /> },
    { key: "3d",        label: "3D Вид",               icon: <Box size={13} /> },
    { key: "viz",       label: "Визуализации",         icon: <ImageIcon size={13} /> },
    { key: "site",      label: "Посадка на участок",  icon: <MapIcon size={13} /> },
    { key: "placement", label: "Размещение ЖК",        icon: <Building2 size={13} /> },
  ];
  return (
    <div className="px-6 pt-3 pb-1 border-b border-white/[0.04]">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Реальный поэтажный план
// ---------------------------------------------------------------------------

function FloorTab({
  bag, floors, form, onGenerate, onSelectVariant, onToggleCompare, onGoToViz,
}: {
  bag: FloorBag;
  floors: number;
  form: PromptFormState;
  onGenerate: () => void;
  onSelectVariant: (i: number) => void;
  onToggleCompare: () => void;
  onGoToViz: () => void;
}) {
  const planDivRef = useRef<HTMLDivElement>(null);
  const plan = bag.response?.variants[bag.selectedVariant] ?? null;
  const requestId = bag.response?.request_id ?? null;
  const plans = bag.response?.variants ?? [];

  return (
    <>
      {/* Variant tabs + Compare toggle */}
      {bag.state === "ready" && bag.response && (
        <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto flex-shrink-0">
          {plans.map((v, i) => {
            const errCount = v.norms.violations.filter(vl => vl.severity === "error").length;
            const warnCount = v.norms.violations.filter(vl => vl.severity === "warning").length;
            const hasIssues = errCount + warnCount > 0;
            return (
              <button
                key={v.preset}
                onClick={() => { onSelectVariant(i); if (bag.showCompare) onToggleCompare(); }}
                className={[
                  "h-8 px-3 rounded-lg text-[12px] flex items-center gap-1.5 transition whitespace-nowrap border flex-shrink-0",
                  !bag.showCompare && bag.selectedVariant === i
                    ? "bg-white/[0.08] border-white/15 text-white font-medium"
                    : "border-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
                ].join(" ")}
              >
                {PRESET_LABELS[v.preset]}
                {hasIssues && (
                  <span className="flex items-center gap-0.5 text-[10px] text-amber-400/80">
                    <AlertTriangle size={10} />
                    {errCount + warnCount}
                  </span>
                )}
              </button>
            );
          })}

          <div className="h-4 w-px bg-white/[0.07] mx-1 flex-shrink-0" />

          {/* Compare toggle */}
          <button
            onClick={onToggleCompare}
            className={[
              "h-8 px-3 rounded-lg text-[12px] flex items-center gap-1.5 transition border flex-shrink-0",
              bag.showCompare
                ? "bg-white/[0.08] border-white/15 text-white font-medium"
                : "border-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
            ].join(" ")}
          >
            <BarChart3 size={12} />
            Сравнение
          </button>

          <div className="ml-auto pl-3 text-[11px] text-white/35 tabular flex-shrink-0 flex items-center gap-1">
            <CheckCircle2 size={11} className="text-emerald-400/60" />
            {bag.response.elapsed_ms} мс
          </div>
        </div>
      )}

      {/* Main — сравнительная таблица ИЛИ план + метрики */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {bag.state === "ready" && bag.showCompare && plans.length > 0 ? (
          /* ── Сравнительная таблица ── */
          <div className="flex-1 p-5 overflow-y-auto">
            <ComparisonTable
              plans={plans}
              selectedId={bag.selectedVariant}
              presetLabels={PRESET_LABELS}
              onSelect={(idx) => { onSelectVariant(idx); onToggleCompare(); }}
              floors={floors}
            />
          </div>
        ) : (
          /* ── Канвас плана ── */
          <>
            <div ref={planDivRef} className="flex-1 relative p-3 min-h-[520px]">
              {bag.state === "idle" && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center max-w-md px-8">
                    <div className="size-14 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-white/10 grid place-items-center mx-auto mb-5">
                      <Sparkles size={22} className="text-white/85" />
                    </div>
                    <div className="text-[20px] font-semibold tracking-display mb-2.5">Поэтажная планировка</div>
                    <div className="text-[13px] text-white/55 leading-relaxed">
                      Заполни параметры слева, нажми «Сгенерировать» — движок выдаст 5 вариантов за 1–3 сек.
                    </div>
                  </div>
                </div>
              )}
              {bag.state === "loading" && (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner text="Генерируем планировки · 1–3 сек" />
                </div>
              )}
              {bag.state === "error" && <ErrorState message={bag.errorMessage} onRetry={onGenerate} />}
              {bag.state === "ready" && plan && (
                <PlanCanvas plan={plan} showLabels showZones showFixtures showScale />
              )}
            </div>

            {/* Sidebar метрик */}
            {bag.state === "ready" && plan && (
              <aside className="w-52 border-l border-white/[0.05] p-3 overflow-y-auto flex-shrink-0 flex flex-col gap-4">
                <AppMetrics
                  plan={plan}
                  floors={floors}
                  requestId={requestId}
                  onExportPdf={() =>
                    exportPlanPdf({
                      plan,
                      floors,
                      form,
                      presetLabel: PRESET_LABELS[plan.preset],
                      planContainerEl: planDivRef.current,
                    })
                  }
                />
                <AptMixBar plan={plan} />
              </aside>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      {bag.state === "ready" && bag.response && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
          {bag.showCompare ? (
            <div className="text-[11px] text-white/40">
              Нажмите на строку — выберете вариант и вернётесь к плану
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <span>{plans.length} вариантов</span>
              <span className="text-white/20">·</span>
              <span>{plan?.tiles.length ?? 0} квартир на этаже</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {requestId && (
              <a
                href={packageDownloadUrl(requestId)}
                download
                className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition"
              >
                <Package size={12} /> Пакет ZIP
              </a>
            )}
            <button
              onClick={onGenerate}
              className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition"
            >
              <RefreshCw size={12} /> Перегенерировать
            </button>
            <button
              onClick={onGoToViz}
              className="h-9 px-4 rounded-full btn-apple text-[12px] flex items-center gap-1.5"
            >
              Визуализировать <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </>
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
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {preview  && <img src={preview}   alt="" className="h-8 w-12 object-cover rounded-lg opacity-70" />}
            {bldPreview && <img src={bldPreview} alt="" className="h-8 w-12 object-cover rounded-lg opacity-70" />}
            <span className="text-[11px] text-white/35">Хочешь другой вариант?</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
              <RefreshCw size={12} /> Перегенерировать
            </button>
            <a href={bag.imageUrl} download={`plana-site-${Date.now()}.png`} className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5">
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
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
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
          <div className="flex items-center gap-2">
            <button onClick={onGenerate} className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition">
              <RefreshCw size={12} /> Перегенерировать
            </button>
            {mode !== "interior" && activeSingleBag?.state === "ready" && activeSingleBag.imageUrl && (
              <a
                href={activeSingleBag.imageUrl}
                download={`${nonIntModes.find(m => m.key === mode)!.downloadName}-${Date.now()}.png`}
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
                download={`plana-interior-${items[lightboxIdx].apt_type}-${Date.now()}.png`}
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
          download={`plana-interior-${active.apt_type}-${Date.now()}.png`}
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
        <a href={bag.imageUrl} download={`${downloadName}-${Date.now()}.png`} className="btn-apple h-9 px-4 text-[12px] flex items-center gap-1.5">
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
                download={`plana-placement-${lightbox.key}-${Date.now()}.png`}
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
                      download={`plana-placement-${v.key}-${Date.now()}.png`}
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

function AiPlansTab({ bag, onGenerate, onGoToViz }: { bag: AiPlansBag; onGenerate: () => void; onGoToViz: () => void }) {
  const [lightbox, setLightbox] = useState<AiPlanVariant | null>(null);

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-[13px] flex items-center gap-1.5"
              onClick={() => setLightbox(null)}
            >
              <X size={16} /> Закрыть
            </button>
            <img src={lightbox.imageUrl} alt={lightbox.label} className="w-full rounded-2xl shadow-2xl" />
            <div className="flex items-center justify-between mt-4">
              <div>
                <div className="text-[15px] font-semibold text-white">{lightbox.label}</div>
                <div className="flex items-center gap-2 mt-1">
                  {lightbox.enhancerUsed && lightbox.enhancerUsed !== "fallback" && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/30 text-violet-200">
                      ✨ {lightbox.enhancerUsed}
                    </span>
                  )}
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60">
                    {lightbox.modelUsed}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={lightbox.imageUrl}
                  download={`plana-ai-${lightbox.key}-${Date.now()}.png`}
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
          </div>
        </div>
      )}

      {/* Header strip */}
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-300" />
          <span className="text-[13px] font-medium text-white/85">AI Чертежи планировки</span>
        </div>
        <span className="text-[11.5px] text-white/40">
          Параметры → Gemma 4 → gpt-image × 5 вариантов параллельно
        </span>
        {bag.state === "ready" && bag.elapsedMs && (
          <div className="ml-auto flex items-center gap-1 text-[11px] text-white/35">
            <CheckCircle2 size={11} className="text-emerald-400/60" />
            {(bag.elapsedMs / 1000).toFixed(1)} сек
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {bag.state === "idle" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center max-w-lg px-8">
              <div className="size-16 rounded-full bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20 border border-white/10 grid place-items-center mx-auto mb-5">
                <Sparkles size={26} className="text-violet-200" />
              </div>
              <div className="text-[21px] font-semibold tracking-display mb-3">
                5 AI-вариантов планировки
              </div>
              <div className="text-[13px] text-white/50 leading-relaxed mb-6">
                Введи параметры слева и нажми «Сгенерировать». Движок обогатит промпт через Gemma 4, затем
                запустит gpt-image параллельно в&nbsp;5 направлениях — макс. площадь, плотность,
                классическая секция, инсоляция, евроформат.
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11.5px]">
                {["Макс. жилая S", "Макс. квартир", "Классика", "Инсоляция (юг)", "Евроформат"].map((lbl) => (
                  <div key={lbl} className="h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-white/55 px-2">
                    {lbl}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {bag.state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="size-12 rounded-full border-2 border-white/15 border-t-violet-400 animate-spin" />
              <div>
                <div className="text-[14px] text-white/80 font-medium mb-1">Генерируем 5 чертежей…</div>
                <div className="text-[12px] text-white/45">Gemma 4 → gpt-image × 5 параллельно · 30–90 сек</div>
              </div>
              {/* Скелетон карточек */}
              <div className="grid grid-cols-2 gap-3 mt-4 w-[480px] opacity-40">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={[
                      "rounded-xl bg-white/[0.04] border border-white/[0.06] animate-pulse",
                      i === 4 ? "col-span-2 h-28" : "h-36",
                    ].join(" ")}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {bag.state === "error" && <ErrorState message={bag.errorMessage} onRetry={onGenerate} />}

        {bag.state === "ready" && bag.variants.length > 0 && (
          <div className="p-5 grid grid-cols-2 gap-4">
            {bag.variants.map((v, i) => (
              <div
                key={v.key}
                className={[
                  "group rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden",
                  "hover:border-white/15 hover:bg-white/[0.04] transition-all duration-200",
                  // 5-й вариант — полная ширина (в 2-колонной сетке)
                  i === 4 ? "col-span-2" : "",
                ].join(" ")}
              >
                {/* Image */}
                <div
                  className="relative overflow-hidden cursor-zoom-in"
                  onClick={() => setLightbox(v)}
                >
                  <img
                    src={v.imageUrl}
                    alt={v.label}
                    className={[
                      "w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
                      i === 4 ? "max-h-64" : "max-h-52",
                    ].join(" ")}
                    loading="lazy"
                  />
                  {/* Overlay with zoom hint */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 text-[11px] text-white/90 flex items-center gap-1.5">
                      <Eye size={12} /> Открыть
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-white/90">{v.label}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {v.enhancerUsed && v.enhancerUsed !== "fallback" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-violet-300">
                          ✨ {v.enhancerUsed}
                        </span>
                      )}
                      <span className="text-[10px] text-white/35">{v.modelUsed}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <a
                      href={v.imageUrl}
                      download={`plana-ai-${v.key}-${Date.now()}.png`}
                      className="h-8 px-2.5 rounded-full surface text-[11px] flex items-center gap-1 hover:bg-white/[0.08] transition text-white/55 hover:text-white/85"
                      onClick={(e) => e.stopPropagation()}
                      title="Скачать PNG"
                    >
                      <Download size={11} /> PNG
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); exportAiPlansPdf([v], `plana-ai-${v.key}`); }}
                      className="h-8 px-2.5 rounded-full surface text-[11px] flex items-center gap-1 hover:bg-white/[0.08] transition text-white/55 hover:text-white/85"
                      title="Скачать PDF"
                    >
                      <Download size={11} /> PDF
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onGoToViz(); }}
                      className="h-8 px-3 rounded-full btn-apple text-[11px] flex items-center gap-1.5"
                    >
                      <Sparkles size={11} /> Визуализировать
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {bag.state === "ready" && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] text-white/40 flex items-center gap-2">
            <span>{bag.variants.length} вариантов</span>
            <span className="text-white/20">·</span>
            <span>Кликни по изображению для полного размера</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onGenerate}
              className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition"
            >
              <RefreshCw size={12} /> Перегенерировать
            </button>
            <button
              onClick={() => exportAiPlansPdf(bag.variants)}
              className="h-9 px-3.5 rounded-full surface text-[12px] flex items-center gap-1.5 hover:bg-white/[0.08] transition text-white/70 hover:text-white"
            >
              <Download size={12} /> Скачать PDF
            </button>
            <button
              onClick={onGoToViz}
              className="h-9 px-4 rounded-full btn-apple text-[12px] flex items-center gap-1.5"
            >
              Визуализировать <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 3D View Tab
// ---------------------------------------------------------------------------

function View3DTab({
  bag, floors, onGenerate, aiPlansBag,
}: {
  bag: FloorBag;
  floors: number;
  onGenerate: () => void;
  aiPlansBag: AiPlansBag;
}) {
  const plan = bag.response?.variants[bag.selectedVariant] ?? null;
  const plans = bag.response?.variants ?? [];
  const [selectedAiIdx, setSelectedAiIdx] = useState<number>(0);

  const aiVariants = aiPlansBag.variants;
  const aiImageUrl = aiVariants[selectedAiIdx]?.imageUrl ?? undefined;

  // ── 3D scene controls ─────────────────────────────────────────────────────
  const canvasRef = useRef<PlanCanvas3DHandle>(null);
  const [mode, setMode] = useState<SceneMode>("night");
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [visibleFloors, setVisibleFloors] = useState<number>(floors);
  const [activePreset, setActivePreset] = useState<CameraPreset | null>("iso");
  const [view, setView] = useState<ViewMode>("exterior");

  // Когда меняется количество этажей в форме — сбрасываем срез под новое значение.
  useEffect(() => {
    setVisibleFloors(floors);
  }, [floors]);

  // Sync slider → canvas. Это покрывает случай, когда сцена только что пересобралась
  // (новый plan / aiImage) и нужно довыставить текущий срез.
  useEffect(() => {
    canvasRef.current?.setVisibleFloors(visibleFloors);
  }, [visibleFloors, plan, aiImageUrl]);

  // Аналогичный sync для walkthrough-уровня (после ребилда canvas начинает с exterior).
  useEffect(() => {
    canvasRef.current?.setView(view);
  }, [view, plan, aiImageUrl]);

  const handleSetMode = (m: SceneMode) => {
    setMode(m);
    canvasRef.current?.setMode(m);
  };
  const handleSetAutoRotate = (on: boolean) => {
    setAutoRotate(on);
    canvasRef.current?.setAutoRotate(on);
  };
  const handleSetVisibleFloors = (n: number) => {
    setVisibleFloors(n);
    canvasRef.current?.setVisibleFloors(n);
  };
  const handlePreset = (p: CameraPreset) => {
    setActivePreset(p);
    setAutoRotate(false);
    canvasRef.current?.setCameraPreset(p);
  };
  const handleScreenshot = () => {
    const url = canvasRef.current?.screenshot();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `plana-3d-${Date.now()}.png`;
    a.click();
  };
  const handleSetView = (v: ViewMode) => {
    setView(v);
    canvasRef.current?.setView(v);
    if (v === "lobby") {
      setAutoRotate(false);
      setActivePreset(null);
    }
  };

  return (
    <>
      {/* Top bar: plan variant + AI plan selector */}
      {bag.state === "ready" && (
        <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] flex items-center gap-2 overflow-x-auto flex-shrink-0">
          {/* Floor plan variants */}
          {plans.length > 1 && plans.map((v, i) => (
            <button
              key={v.preset}
              className={[
                "h-7 px-3 rounded-lg text-[11.5px] transition border flex-shrink-0",
                bag.selectedVariant === i
                  ? "bg-white/[0.08] border-white/15 text-white font-medium"
                  : "border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.03]",
              ].join(" ")}
            >
              {PRESET_LABELS[v.preset]}
            </button>
          ))}

          {/* Divider + AI plan texture selector */}
          {aiVariants.length > 0 && (
            <>
              {plans.length > 1 && <div className="w-px h-4 bg-white/10 flex-shrink-0" />}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10.5px] text-white/30 mr-0.5">Чертёж:</span>
                {aiVariants.map((v, i) => (
                  <button
                    key={v.key}
                    onClick={() => setSelectedAiIdx(i)}
                    className={[
                      "h-7 px-2.5 rounded-lg text-[11px] transition border flex-shrink-0",
                      selectedAiIdx === i
                        ? "bg-violet-500/20 border-violet-400/30 text-violet-200 font-medium"
                        : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.03]",
                    ].join(" ")}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {aiVariants.length === 0 && (
            <div className="text-[10.5px] text-white/25 flex items-center gap-1 flex-shrink-0 ml-1">
              <Sparkles size={10} className="text-violet-400/40" />
              Сгенерируй «AI Чертежи» для текстуры крыши
            </div>
          )}

          <div className="ml-auto text-[11px] text-white/30 flex-shrink-0 flex items-center gap-1">
            <Box size={11} className="text-violet-400/60" />
            Интерактивная 3D-модель · крути мышкой
          </div>
        </div>
      )}

      {/* Основная область */}
      <div className="flex-1 relative min-h-0">
        {bag.state === "idle" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center max-w-md px-8">
              <div className="size-16 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-400/20 border border-white/10 grid place-items-center mx-auto mb-5">
                <Box size={26} className="text-violet-200" />
              </div>
              <div className="text-[21px] font-semibold tracking-display mb-3">3D Вид здания</div>
              <div className="text-[13px] text-white/50 leading-relaxed mb-6">
                Заполни параметры слева и нажми «Сгенерировать» — получишь изометрическую 3D-модель
                с этажами, квартирами и ядром лифта.
              </div>
              <button
                onClick={onGenerate}
                className="btn-apple h-11 px-6 text-[14px] flex items-center gap-2 mx-auto"
              >
                <Box size={15} /> Сгенерировать 3D
              </button>
            </div>
          </div>
        )}

        {bag.state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner text="Строим 3D-модель · 1–3 сек" />
          </div>
        )}

        {bag.state === "error" && (
          <ErrorState message={bag.errorMessage} onRetry={onGenerate} />
        )}

        {bag.state === "ready" && plan && (
          <>
            <PlanCanvas3D
              ref={canvasRef}
              plan={plan}
              floors={floors}
              aiPlanImageUrl={aiImageUrl}
              initialMode={mode}
              initialAutoRotate={autoRotate}
              initialVisibleFloors={visibleFloors}
            />

            {/* ── Floating controls overlay ── */}
            <SceneControls
              view={view}
              mode={mode}
              autoRotate={autoRotate}
              floors={floors}
              visibleFloors={visibleFloors}
              activePreset={activePreset}
              onSetMode={handleSetMode}
              onToggleAutoRotate={() => handleSetAutoRotate(!autoRotate)}
              onSetVisibleFloors={handleSetVisibleFloors}
              onPreset={handlePreset}
              onScreenshot={handleScreenshot}
              onSetView={handleSetView}
            />

            {/* «Войти в подъезд» — выделенная CTA в режиме exterior */}
            {view === "exterior" && (
              <button
                onClick={() => handleSetView("lobby")}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 h-11 px-5 rounded-full bg-violet-500/90 hover:bg-violet-500 text-white text-[13px] font-medium flex items-center gap-2 shadow-lg shadow-violet-500/30 backdrop-blur-md border border-violet-300/30 transition"
                title="Перейти в 3D-обзор лобби"
              >
                <DoorOpen size={15} /> Войти в подъезд
              </button>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      {bag.state === "ready" && plan && (
        <div className="border-t border-white/[0.05] px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] text-white/35 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Box size={11} className="text-violet-400/60" />
              {plan.metrics.apt_count} квартир · {floors} эт. · {(plan.metrics.floor_area * floors).toFixed(0)} м²
            </span>
            <span className="text-white/20">·</span>
            <span>ЛКМ — вращать · колесо — зум · ПКМ — пан</span>
            {aiImageUrl && (
              <>
                <span className="text-white/20">·</span>
                <span className="flex items-center gap-1 text-violet-300/50">
                  <Sparkles size={10} /> AI чертёж на крыше
                </span>
              </>
            )}
          </div>
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
// SceneControls — плавающая панель с переключателями для 3D
// ---------------------------------------------------------------------------

function SceneControls({
  view, mode, autoRotate, floors, visibleFloors, activePreset,
  onSetMode, onToggleAutoRotate, onSetVisibleFloors, onPreset, onScreenshot, onSetView,
}: {
  view: ViewMode;
  mode: SceneMode;
  autoRotate: boolean;
  floors: number;
  visibleFloors: number;
  activePreset: CameraPreset | null;
  onSetMode: (m: SceneMode) => void;
  onToggleAutoRotate: () => void;
  onSetVisibleFloors: (n: number) => void;
  onPreset: (p: CameraPreset) => void;
  onScreenshot: () => void;
  onSetView: (v: ViewMode) => void;
}) {
  const presets: Array<{ key: CameraPreset; icon: React.ReactNode; label: string }> = [
    { key: "iso",   icon: <Box size={13} />,      label: "Изометрия" },
    { key: "top",   icon: <Mountain size={13} />, label: "Сверху" },
    { key: "front", icon: <Building size={13} />, label: "Фасад" },
    { key: "side",  icon: <Compass size={13} />,  label: "Сбоку" },
  ];

  const segBtn = (active: boolean) => [
    "h-7 px-2.5 rounded-md text-[11px] flex items-center gap-1 transition",
    active
      ? "bg-white/[0.12] text-white"
      : "text-white/55 hover:text-white hover:bg-white/[0.05]",
  ].join(" ");

  const inLobby = view === "lobby";

  return (
    <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
      {/* Левый кластер */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* В лобби — кнопка «Назад» вместо обычных контролей */}
        {inLobby && (
          <button
            onClick={() => onSetView("exterior")}
            className="h-8 px-3 rounded-lg text-[12px] flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/15 text-white/85 hover:text-white hover:bg-black/70 transition"
            title="Вернуться к виду снаружи"
          >
            <ArrowLeft size={13} /> Снаружи
          </button>
        )}

        {/* Day / Night — доступен везде */}
        <div className="flex items-center bg-black/40 backdrop-blur-md border border-white/10 rounded-lg p-0.5">
          <button onClick={() => onSetMode("day")} className={segBtn(mode === "day")} title="Дневной режим">
            <Sun size={13} /> День
          </button>
          <button onClick={() => onSetMode("night")} className={segBtn(mode === "night")} title="Ночной режим">
            <Moon size={13} /> Ночь
          </button>
        </div>

        {/* Контроли только в exterior */}
        {!inLobby && (
          <>
            <button
              onClick={onToggleAutoRotate}
              className={[
                "h-8 px-2.5 rounded-lg text-[11px] flex items-center gap-1 border backdrop-blur-md transition",
                autoRotate
                  ? "bg-violet-500/20 border-violet-400/30 text-violet-100"
                  : "bg-black/40 border-white/10 text-white/65 hover:text-white",
              ].join(" ")}
              title={autoRotate ? "Остановить вращение" : "Включить автоповорот"}
            >
              {autoRotate ? <Pause size={12} /> : <RotateCw size={12} />}
              {autoRotate ? "Стоп" : "Авто"}
            </button>

            <div className="flex items-center bg-black/40 backdrop-blur-md border border-white/10 rounded-lg p-0.5">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onPreset(p.key)}
                  className={segBtn(activePreset === p.key)}
                  title={p.label}
                >
                  {p.icon}
                  <span className="hidden lg:inline">{p.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Правый кластер: слайдер этажей (только exterior) + screenshot */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {!inLobby && (
          <div className="flex items-center gap-2.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg px-3 h-8">
            <Layers size={12} className="text-white/55 flex-shrink-0" />
            <span className="text-[11px] text-white/55 whitespace-nowrap">Этажи</span>
            <input
              type="range"
              min={1}
              max={floors}
              value={visibleFloors}
              onChange={(e) => onSetVisibleFloors(Number(e.target.value))}
              className="w-28 accent-violet-400 cursor-pointer"
            />
            <span className="text-[11px] tabular text-white/85 min-w-[28px] text-right">
              {visibleFloors}/{floors}
            </span>
          </div>
        )}

        <button
          onClick={onScreenshot}
          className="h-8 px-2.5 rounded-lg text-[11px] flex items-center gap-1 bg-black/40 backdrop-blur-md border border-white/10 text-white/65 hover:text-white hover:bg-black/55 transition"
          title="Сохранить кадр в PNG"
        >
          <Camera size={12} /> PNG
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AptMixBar — разбивка квартир по типу в боковой панели
// ---------------------------------------------------------------------------

function AptMixBar({ plan }: { plan: Plan }) {
  const byType = plan.metrics.apt_by_type;
  const entries = (Object.entries(byType) as [AptType, number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;

  if (entries.length === 0) return null;

  return (
    <div className="border-t border-white/[0.05] pt-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-medium mb-2.5">
        Структура квартир
      </div>
      {/* Цветная полоска */}
      <div className="h-1.5 rounded-full overflow-hidden flex mb-3 bg-white/[0.05]">
        {entries.map(([type, count]) => (
          <div
            key={type}
            style={{
              width: `${(count / total) * 100}%`,
              background: APT_COLORS[type],
            }}
          />
        ))}
      </div>
      {/* Строки */}
      <div className="flex flex-col gap-1.5">
        {entries.map(([type, count]) => (
          <div key={type} className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full flex-shrink-0"
                style={{ background: APT_COLORS[type] }}
              />
              <span className="text-white/60">{APT_LABELS[type]}</span>
            </div>
            <div className="flex items-center gap-1.5 tabular">
              <span className="text-white/85">{count}</span>
              <span className="text-white/35">({((count / total) * 100).toFixed(0)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
