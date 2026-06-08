"use client";

import { useMemo, useState } from "react";
import { AlertCircle, BarChart3, Calculator, CheckCircle2, Coins, Info, Map as MapIcon } from "lucide-react";
import {
  DEFAULT_COST_PARAMS,
  createPlacementVariants,
  estimateCost,
  polygonArea,
  rectanglePolygon,
  type Building,
  type BuildingPlacement,
  type CostParams,
  type CostSnapshot,
  type ParkingMode,
  type QualityClass,
  type Region,
  type Site,
} from "@/lib/cost-placement";

type RateSourceType = "placeholder" | "official" | "market_calibrated" | "manual";
type ConfidenceLevel = "low" | "medium" | "high";

export type CostAssumptions = {
  priceLevelYear: string;
  region: Region;
  objectType: string;
  buildingClass: QualityClass;
  baseRateAboveGround: number;
  regionCoefficient: number;
  classCoefficient: number;
  undergroundFactor: number;
  siteWorksMethod: string;
  contingencyPct: number;
  vatIncluded: boolean;
  rateSourceType: RateSourceType;
  rateSourceName: string;
  rateSourceYear: string;
  lastUpdated: string;
  confidenceLevel: ConfidenceLevel;
  uploadedRateFileName: string | null;
  uploadedRateKeys: string[];
  includedItems: string[];
  excludedItems: string[];
  missingDataWarnings: string[];
};

export type CostPlacementDraft = {
  region: Region;
  site_width_m: number;
  site_depth_m: number;
  setback_front_m: number;
  setback_side_m: number;
  setback_rear_m: number;
  quality_class: QualityClass;
  gfa_above_ground_m2: number;
  gfa_underground_m2: number;
  efficiency_ratio: number;
  market_price_per_sellable_m2: number;
  floors_above: number;
  floors_below: number;
  footprint_width_m: number;
  footprint_depth_m: number;
  parking_mode: ParkingMode;
  parking_spots: number;
  auto_parking: boolean;
  complex_soil: boolean;
  complex_slope: boolean;
  selected_variant_key: BuildingPlacement["variant_key"];
  costParams: CostParams;
  costAssumptions: CostAssumptions;
};

const INCLUDED_ITEMS = [
  "Above-ground construction",
  "Underground / parking",
  "Internal roads",
  "Open parking",
  "Landscaping allowance",
  "External utilities allowance",
];

const EXCLUDED_ITEMS = [
  "Land cost",
  "VAT",
  "Design and permits",
  "State expertise",
  "Financing costs",
  "Sales and marketing",
  "Utility connection fees",
  "Detailed engineering/geotechnical risks",
];

const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  priceLevelYear: "2025/2026",
  region: "Almaty",
  objectType: "ЖК / multifamily residential",
  buildingClass: "comfort",
  baseRateAboveGround: DEFAULT_COST_PARAMS.base_rate_kzt_m2,
  regionCoefficient: DEFAULT_COST_PARAMS.region_coefficients.Almaty,
  classCoefficient: DEFAULT_COST_PARAMS.quality_coefficients.comfort,
  undergroundFactor: DEFAULT_COST_PARAMS.underground_factor,
  siteWorksMethod: "Parametric area allowances: roads, open parking, landscaping, utilities allowance",
  contingencyPct: DEFAULT_COST_PARAMS.contingency_pct,
  vatIncluded: false,
  rateSourceType: "placeholder",
  rateSourceName: "Internal MVP placeholder rate table",
  rateSourceYear: "2025/2026",
  lastUpdated: "2026-06-05",
  confidenceLevel: "low",
  uploadedRateFileName: null,
  uploadedRateKeys: [],
  includedItems: INCLUDED_ITEMS,
  excludedItems: EXCLUDED_ITEMS,
  missingDataWarnings: [
    "No geotechnical report attached",
    "No exact slope/topography survey attached",
    "No official parking norm selected",
    "Placeholder rates are used",
    "No official cost source is attached",
  ],
};

export const DEFAULT_COST_PLACEMENT_DRAFT: CostPlacementDraft = {
  region: "Almaty",
  site_width_m: 80,
  site_depth_m: 120,
  setback_front_m: 8,
  setback_side_m: 6,
  setback_rear_m: 8,
  quality_class: "comfort",
  gfa_above_ground_m2: 18_000,
  gfa_underground_m2: 3_200,
  efficiency_ratio: 0.78,
  market_price_per_sellable_m2: 620_000,
  floors_above: 12,
  floors_below: 1,
  footprint_width_m: 48,
  footprint_depth_m: 32,
  parking_mode: "mixed",
  parking_spots: 320,
  auto_parking: true,
  complex_soil: false,
  complex_slope: false,
  selected_variant_key: "central",
  costParams: DEFAULT_COST_PARAMS,
  costAssumptions: DEFAULT_COST_ASSUMPTIONS,
};

type Props = {
  value: CostPlacementDraft;
  onChange: (next: CostPlacementDraft) => void;
};

type CostPlacementRow = {
  placement: BuildingPlacement;
  cost: CostSnapshot;
  siteAreaM2: number;
  footprintArea: number;
  coveragePct: number;
  far: number;
  totalGfaM2: number;
  sellableAreaM2: number;
  revenueEstimate: number;
  grossMarginBeforeLand: number;
  grossMarginPct: number;
  breakEvenPricePerSellableM2: number;
  upsideToBreakEvenPct: number;
  revenueScenarios: RevenueScenario[];
  costBuckets: CostBucket[];
  feasibility: FeasibilitySignal;
  deltaToCheapest: number;
  isCheapest: boolean;
  costPerGfaM2: number;
  costPerSellableM2: number;
  siteWorksSharePct: number;
  riskLevel: "low" | "medium" | "high";
};

type CostBucket = {
  key: "construction" | "site_works" | "risk_allowance" | "excluded_soft";
  label: string;
  amount: number | null;
  sharePct: number | null;
  note: string;
  tone: "base" | "warn" | "muted";
};

type FeasibilityGrade = "go" | "caution" | "no_go";

type FeasibilitySignal = {
  grade: FeasibilityGrade;
  label: string;
  score: number;
  reasons: string[];
};

type RevenueScenario = {
  key: "pessimistic" | "base" | "optimistic";
  label: string;
  pricePerSellableM2: number;
  revenue: number;
  margin: number;
  marginPct: number;
};

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type RateImportPatch = Partial<Omit<CostParams, "currency" | "region_coefficients" | "quality_coefficients">> & {
  region_coefficients?: Partial<Record<Region, number>>;
  quality_coefficients?: Partial<Record<QualityClass, number>>;
};

type RateImportResult = {
  paramsPatch: RateImportPatch;
  sourceName: string | null;
  sourceYear: string | null;
  confidenceLevel: ConfidenceLevel | null;
  recognizedKeys: string[];
  unknownKeys: string[];
};

const COST_RATE_IMPORT_KEY_LABELS: Record<string, string> = {
  base_rate_kzt_m2: "Base above-ground rate",
  underground_factor: "Underground factor",
  soil_factor: "Soil factor",
  slope_factor: "Slope factor",
  roads_rate_kzt_m2: "Roads rate",
  open_parking_rate_kzt_m2: "Open parking rate",
  landscape_rate_kzt_m2: "Landscape rate",
  external_utilities_allowance_pct: "External utilities allowance",
  overheads_pct: "Overheads",
  profit_pct: "Profit",
  contingency_pct: "Contingency",
  region_coeff_almaty: "Almaty region coefficient",
  region_coeff_astana: "Astana region coefficient",
  region_coeff_shymkent: "Shymkent region coefficient",
  region_coeff_aktobe: "Aktobe region coefficient",
  region_coeff_default: "Default region coefficient",
  quality_coeff_economy: "Economy class coefficient",
  quality_coeff_comfort: "Comfort class coefficient",
  quality_coeff_business: "Business class coefficient",
  source_name: "Source name",
  source_year: "Source year",
  confidence_level: "Confidence level",
};

function normalizeRateImportKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseRateNumber(rawValue: string): number | null {
  const normalized = rawValue.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseClientRatesCsv(text: string): RateImportResult {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [rawKey, ...rest] = line.split(",");
      return [normalizeRateImportKey(rawKey ?? ""), rest.join(",").trim()] as const;
    })
    .filter(([key]) => key.length > 0);

  const result: RateImportResult = {
    paramsPatch: {},
    sourceName: null,
    sourceYear: null,
    confidenceLevel: null,
    recognizedKeys: [],
    unknownKeys: [],
  };

  for (const [key, rawValue] of rows) {
    if ((key === "key" || key === "field" || key === "name") && normalizeRateImportKey(rawValue) === "value") {
      continue;
    }

    const markRecognized = () => {
      if (!result.recognizedKeys.includes(key)) result.recognizedKeys.push(key);
    };

    if (key === "source_name") {
      result.sourceName = rawValue || null;
      markRecognized();
      continue;
    }
    if (key === "source_year") {
      result.sourceYear = rawValue || null;
      markRecognized();
      continue;
    }
    if (key === "confidence_level") {
      const confidence = normalizeRateImportKey(rawValue);
      if (confidence === "low" || confidence === "medium" || confidence === "high") {
        result.confidenceLevel = confidence;
        markRecognized();
      } else {
        result.unknownKeys.push(key);
      }
      continue;
    }

    const numericValue = parseRateNumber(rawValue);
    if (numericValue === null) {
      result.unknownKeys.push(key);
      continue;
    }

    switch (key) {
      case "base_rate_kzt_m2":
      case "underground_factor":
      case "soil_factor":
      case "slope_factor":
      case "roads_rate_kzt_m2":
      case "open_parking_rate_kzt_m2":
      case "landscape_rate_kzt_m2":
      case "external_utilities_allowance_pct":
      case "overheads_pct":
      case "profit_pct":
      case "contingency_pct":
        result.paramsPatch[key] = numericValue;
        markRecognized();
        break;
      case "region_coeff_almaty":
        result.paramsPatch.region_coefficients = { ...result.paramsPatch.region_coefficients, Almaty: numericValue };
        markRecognized();
        break;
      case "region_coeff_astana":
        result.paramsPatch.region_coefficients = { ...result.paramsPatch.region_coefficients, Astana: numericValue };
        markRecognized();
        break;
      case "region_coeff_shymkent":
        result.paramsPatch.region_coefficients = { ...result.paramsPatch.region_coefficients, Shymkent: numericValue };
        markRecognized();
        break;
      case "region_coeff_aktobe":
        result.paramsPatch.region_coefficients = { ...result.paramsPatch.region_coefficients, Aktobe: numericValue };
        markRecognized();
        break;
      case "region_coeff_default":
        result.paramsPatch.region_coefficients = { ...result.paramsPatch.region_coefficients, default: numericValue };
        markRecognized();
        break;
      case "quality_coeff_economy":
        result.paramsPatch.quality_coefficients = { ...result.paramsPatch.quality_coefficients, economy: numericValue };
        markRecognized();
        break;
      case "quality_coeff_comfort":
        result.paramsPatch.quality_coefficients = { ...result.paramsPatch.quality_coefficients, comfort: numericValue };
        markRecognized();
        break;
      case "quality_coeff_business":
        result.paramsPatch.quality_coefficients = { ...result.paramsPatch.quality_coefficients, business: numericValue };
        markRecognized();
        break;
      default:
        result.unknownKeys.push(key);
    }
  }

  return result;
}

function mergeCostParamsWithImport(current: CostParams, imported: RateImportPatch): CostParams {
  return {
    ...current,
    ...imported,
    currency: current.currency,
    region_coefficients: {
      ...current.region_coefficients,
      ...imported.region_coefficients,
    },
    quality_coefficients: {
      ...current.quality_coefficients,
      ...imported.quality_coefficients,
    },
  };
}

function buildFeasibilitySignal(input: {
  grossMarginPct: number;
  upsideToBreakEvenPct: number;
  far: number;
  coveragePct: number;
  siteWorksSharePct: number;
  missingWarningCount: number;
}): FeasibilitySignal {
  let score = 100;
  const reasons: string[] = [];

  if (input.grossMarginPct < 0) {
    score -= 45;
    reasons.push("Negative gross margin before land and financing");
  } else if (input.grossMarginPct < 20) {
    score -= 25;
    reasons.push("Thin gross margin for early screening");
  } else if (input.grossMarginPct < 30) {
    score -= 10;
    reasons.push("Moderate gross margin; needs validation");
  } else {
    reasons.push("Gross margin has early headroom");
  }

  if (input.upsideToBreakEvenPct < 0) {
    score -= 35;
    reasons.push("Market price is below break-even construction cost");
  } else if (input.upsideToBreakEvenPct < 15) {
    score -= 15;
    reasons.push("Small upside to break-even");
  } else {
    reasons.push("Market price is above break-even");
  }

  if (input.far < 1.2) {
    score -= 10;
    reasons.push("Low FAR/KIT may underuse the site");
  }
  if (input.coveragePct > 45) {
    score -= 10;
    reasons.push("High coverage may create planning risk");
  }
  if (input.siteWorksSharePct >= 12) {
    score -= 10;
    reasons.push("High site works share");
  }
  if (input.missingWarningCount >= 4) {
    score -= 10;
    reasons.push("Several critical inputs are still missing");
  }

  const normalizedScore = clamp(Math.round(score), 0, 100);
  const grade: FeasibilityGrade = normalizedScore >= 75 ? "go" : normalizedScore >= 50 ? "caution" : "no_go";
  const label = grade === "go" ? "GO" : grade === "caution" ? "CAUTION" : "NO-GO";

  return {
    grade,
    label,
    score: normalizedScore,
    reasons: reasons.slice(0, 4),
  };
}

function buildCostBuckets(cost: CostSnapshot): CostBucket[] {
  const total = Math.max(1, cost.total_estimate);
  const construction = cost.c_above + cost.c_underground;
  const siteWorks = cost.c_site;
  const riskAllowance = cost.contingency;
  const share = (amount: number) => amount / total * 100;

  return [
    {
      key: "construction",
      label: "Construction hard costs",
      amount: Math.round(construction),
      sharePct: share(construction),
      note: "Above-ground building plus underground / parking shell.",
      tone: "base",
    },
    {
      key: "site_works",
      label: "Site works allowances",
      amount: Math.round(siteWorks),
      sharePct: share(siteWorks),
      note: "Internal roads, open parking, landscaping, external utility allowance.",
      tone: siteWorks / total >= 0.12 ? "warn" : "base",
    },
    {
      key: "risk_allowance",
      label: "Class 5 contingency",
      amount: Math.round(riskAllowance),
      sharePct: share(riskAllowance),
      note: "Early uncertainty allowance. Not a detailed BoQ risk register.",
      tone: "warn",
    },
    {
      key: "excluded_soft",
      label: "Excluded soft costs",
      amount: null,
      sharePct: null,
      note: "Land, VAT, design, permits, state expertise, financing, sales, utility connection fees.",
      tone: "muted",
    },
  ];
}

export function CostPlacementTab({ value, onChange }: Props) {
  const [rateImportError, setRateImportError] = useState<string | null>(null);
  const model = useMemo(() => buildCostPlacementModel(value), [value]);
  const selected = model.rows.find((row) => row.placement.variant_key === value.selected_variant_key) ?? model.rows[0];
  const cheapest = model.rows.find((row) => row.isCheapest) ?? model.rows[0];

  const update = <K extends keyof CostPlacementDraft>(key: K, next: CostPlacementDraft[K]) => {
    onChange({ ...value, [key]: next });
  };
  const updateCostParam = <K extends keyof CostParams>(key: K, next: CostParams[K]) => {
    onChange({ ...value, costParams: { ...value.costParams, [key]: next } });
  };

  const handleRateUpload = async (file: File) => {
    setRateImportError(null);
    const text = await file.text();
    const parsed = parseClientRatesCsv(text);

    if (parsed.recognizedKeys.length === 0) {
      setRateImportError("CSV parsed, but no supported rate keys were found.");
      return;
    }

    const nextCostParams = mergeCostParamsWithImport(value.costParams ?? DEFAULT_COST_PARAMS, parsed.paramsPatch);
    onChange({
      ...value,
      costParams: nextCostParams,
      costAssumptions: {
        ...value.costAssumptions,
        rateSourceType: "manual",
        rateSourceName: parsed.sourceName ?? `Uploaded client rate file: ${file.name}`,
        rateSourceYear: parsed.sourceYear ?? value.costAssumptions.rateSourceYear,
        lastUpdated: "2026-06-05",
        confidenceLevel: parsed.confidenceLevel ?? "medium",
        uploadedRateFileName: file.name,
        uploadedRateKeys: parsed.recognizedKeys,
      },
    });
  };

  return (
    <>
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] bg-black/10 flex items-center gap-3 flex-shrink-0">
        <Calculator size={14} className="text-white/55" />
        <div>
          <div className="text-[13px] font-medium text-white/85">Стоимость посадки</div>
          <div className="text-[11px] text-white/35">Conceptual Class 5 · расчетная модель, не AI-картинка</div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-white/50 rounded-full bg-white/[0.035] border border-white/[0.07] px-3 py-1">
          <Info size={11} />
          Не официальная смета
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
          <aside className="space-y-3">
            <Panel title="Участок" icon={<MapIcon size={13} className="text-emerald-300" />}>
              <SelectField label="Регион" value={value.region} onChange={(v) => update("region", v as Region)}
                options={[["Almaty", "Алматы"], ["Astana", "Астана"], ["Shymkent", "Шымкент"], ["Aktobe", "Актобе"], ["default", "Другой"]]} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Ширина, м" value={value.site_width_m} onChange={(v) => update("site_width_m", v)} />
                <NumberField label="Глубина, м" value={value.site_depth_m} onChange={(v) => update("site_depth_m", v)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumberField label="Фронт" value={value.setback_front_m} onChange={(v) => update("setback_front_m", v)} />
                <NumberField label="Бок" value={value.setback_side_m} onChange={(v) => update("setback_side_m", v)} />
                <NumberField label="Тыл" value={value.setback_rear_m} onChange={(v) => update("setback_rear_m", v)} />
              </div>
            </Panel>

            <Panel title="Здание" icon={<BarChart3 size={13} className="text-sky-300" />}>
              <SelectField label="Класс" value={value.quality_class} onChange={(v) => update("quality_class", v as QualityClass)}
                options={[["economy", "Economy"], ["comfort", "Comfort"], ["business", "Business"]]} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="GFA надзем., м²" value={value.gfa_above_ground_m2} onChange={(v) => update("gfa_above_ground_m2", v)} />
                <NumberField label="GFA подзем., м²" value={value.gfa_underground_m2} onChange={(v) => update("gfa_underground_m2", v)} />
              </div>
              <NumberField label="Sellable efficiency ratio" value={value.efficiency_ratio} step={0.01} onChange={(v) => update("efficiency_ratio", v)} />
              <NumberField label="Market price, ₸/м² sellable" value={value.market_price_per_sellable_m2} step={10000} onChange={(v) => update("market_price_per_sellable_m2", v)} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Этажей надзем." value={value.floors_above} onChange={(v) => update("floors_above", v)} />
                <NumberField label="Этажей подзем." value={value.floors_below} onChange={(v) => update("floors_below", v)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Пятно шир., м" value={value.footprint_width_m} onChange={(v) => update("footprint_width_m", v)} />
                <NumberField label="Пятно глуб., м" value={value.footprint_depth_m} onChange={(v) => update("footprint_depth_m", v)} />
              </div>
            </Panel>

            <Panel title="Паркинг и условия" icon={<Coins size={13} className="text-amber-300" />}>
              <SelectField label="Паркинг" value={value.parking_mode} onChange={(v) => update("parking_mode", v as ParkingMode)}
                options={[["open", "Открытый"], ["underground", "Подземный"], ["mixed", "Смешанный"]]} />
              <label className="flex items-center gap-2 text-[11.5px] text-white/55">
                <input
                  type="checkbox"
                  checked={value.auto_parking}
                  onChange={(e) => update("auto_parking", e.target.checked)}
                  className="accent-amber-300"
                />
                Авто по простой норме
              </label>
              {!value.auto_parking && (
                <NumberField label="Машиноместа" value={value.parking_spots} onChange={(v) => update("parking_spots", v)} />
              )}
              <label className="flex items-center gap-2 text-[11.5px] text-white/55">
                <input type="checkbox" checked={value.complex_soil} onChange={(e) => update("complex_soil", e.target.checked)} className="accent-amber-300" />
                Сложные грунты
              </label>
              <label className="flex items-center gap-2 text-[11.5px] text-white/55">
                <input type="checkbox" checked={value.complex_slope} onChange={(e) => update("complex_slope", e.target.checked)} className="accent-amber-300" />
                Сложный рельеф
              </label>
            </Panel>
            <Panel title="Rates / assumptions" icon={<Calculator size={13} className="text-white/45" />}>
              <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-[10.5px] leading-relaxed text-white/42">
                Manual Class 5 inputs. Screening only, not official Kazakhstan estimate documentation.
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11.5px] font-medium text-white/75">Client rates CSV</div>
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-white/35">
                      Format: key,value. Example: base_rate_kzt_m2,180000.
                    </div>
                  </div>
                  <label className="shrink-0 cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 text-[10.5px] text-white/70 hover:bg-white/[0.06]">
                    Upload
                    <input
                      data-testid="cost-rate-upload"
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void handleRateUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <div data-testid="cost-rate-upload-status" className="mt-2 text-[10.5px] leading-relaxed text-white/40">
                  {value.costAssumptions.uploadedRateFileName
                    ? `Loaded ${value.costAssumptions.uploadedRateFileName}: ${value.costAssumptions.uploadedRateKeys.length} recognized keys`
                    : "No client rate file uploaded yet."}
                </div>
                {rateImportError && (
                  <div className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1.5 text-[10.5px] text-rose-100/75">
                    {rateImportError}
                  </div>
                )}
              </div>
              <NumberField testId="cost-rate-base-above" label="Base above-ground, KZT/m2" value={value.costParams.base_rate_kzt_m2} step={10000} onChange={(v) => updateCostParam("base_rate_kzt_m2", v)} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField testId="cost-rate-underground-factor" label="Underground factor" value={value.costParams.underground_factor} step={0.05} onChange={(v) => updateCostParam("underground_factor", v)} />
                <NumberField testId="cost-rate-contingency" label="Contingency, %" value={value.costParams.contingency_pct} step={1} onChange={(v) => updateCostParam("contingency_pct", v)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField testId="cost-rate-roads" label="Roads, KZT/m2" value={value.costParams.roads_rate_kzt_m2} step={1000} onChange={(v) => updateCostParam("roads_rate_kzt_m2", v)} />
                <NumberField testId="cost-rate-parking" label="Open parking, KZT/m2" value={value.costParams.open_parking_rate_kzt_m2} step={1000} onChange={(v) => updateCostParam("open_parking_rate_kzt_m2", v)} />
              </div>
              <NumberField testId="cost-rate-landscape" label="Landscape, KZT/m2" value={value.costParams.landscape_rate_kzt_m2} step={1000} onChange={(v) => updateCostParam("landscape_rate_kzt_m2", v)} />
            </Panel>
          </aside>

          <section className="space-y-4 min-w-0">
            {model.warning && (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-[12px] text-rose-200 flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                {model.warning}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" data-testid="cost-placement-variants">
              {model.rows.map((row) => (
                <button
                  key={row.placement.variant_key}
                  data-testid={`cost-placement-variant-${row.placement.variant_key}`}
                  onClick={() => update("selected_variant_key", row.placement.variant_key)}
                  className={[
                    "text-left rounded-xl border p-3.5 transition shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
                    selected?.placement.variant_key === row.placement.variant_key
                      ? "border-white/20 bg-white/[0.065]"
                      : "border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.045]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="text-[13px] font-medium text-white/85">{variantLabel(row.placement.variant_key)}</div>
                    {selected?.placement.variant_key === row.placement.variant_key && <CheckCircle2 size={14} className="text-white/70" />}
                  </div>
                  <PreviewSvg site={model.site} placement={row.placement} />
                  <div className="mt-3 space-y-1 text-[11px]">
                    <Metric label="Итого" value={`${fmt(row.cost.total_estimate)} ₸`} strong />
                    <Metric label="Δ к лучшему" value={row.deltaToCheapest === 0 ? "лучший" : `+${fmt(row.deltaToCheapest)} ₸`} />
                    <Metric label="Диапазон" value={`${fmt(row.cost.range_low)} … ${fmt(row.cost.range_high)} ₸`} />
                    <Metric label="Пятно" value={`${fmt(row.footprintArea)} м²`} />
                    <Metric label="Застройка" value={pct(row.coveragePct)} />
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
                <div className="rounded-xl border border-white/[0.07] bg-[#151515]/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <div className="text-[14px] font-semibold text-white/90">{variantLabel(selected.placement.variant_key)}</div>
                      <div className="text-[11px] text-white/35">Сравнение по структуре затрат на ранней стадии</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wide text-white/30">Expected</div>
                      <div data-testid="cost-placement-total" className="text-[20px] font-semibold text-white/90 tabular-nums">{fmt(selected.cost.total_estimate)} ₸</div>
                      <div className="text-[10.5px] text-white/35">AACE Class 5</div>
                    </div>
                  </div>

                  <div data-testid="cost-placement-class5-range" className="mb-4 rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Class 5 range</div>
                        <div className="text-[10.5px] text-white/38">Screening estimate, not official Kazakhstan estimate documentation</div>
                      </div>
                      <div className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10px] text-white/45">-50% / +50%</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <RangeStat label="Low" value={`${fmt(selected.cost.range_low)} ₸`} />
                      <RangeStat label="Expected" value={`${fmt(selected.cost.total_estimate)} ₸`} active />
                      <RangeStat label="High" value={`${fmt(selected.cost.range_high)} ₸`} />
                    </div>
                  </div>

                  <div data-testid="cost-placement-feasibility-score" className="mb-4 rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Feasibility signal</div>
                        <div className="text-[10.5px] text-white/38">Early go / caution / no-go read from margin, density, site risk and missing data.</div>
                      </div>
                      <div className={["rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide", feasibilityClass(selected.feasibility.grade)].join(" ")}>
                        {selected.feasibility.label}
                      </div>
                    </div>
                    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 items-start">
                      <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-center">
                        <div className="text-[10px] uppercase tracking-wide text-white/35">Score</div>
                        <div className="text-[26px] leading-tight font-semibold text-white tabular-nums">{selected.feasibility.score}</div>
                        <div className="text-[10px] text-white/35">/ 100</div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {selected.feasibility.reasons.map((reason) => (
                          <div key={reason} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[11.5px] text-white/65">
                            {reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div data-testid="cost-placement-developer-kpis" className="mb-4 rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Developer KPIs</div>
                        <div className="text-[10.5px] text-white/35">Site efficiency and early feasibility indicators for this variant.</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      <Stat label="Site area" value={`${fmt(selected.siteAreaM2)} м²`} />
                      <Stat label="Footprint" value={`${fmt(selected.footprintArea)} м²`} />
                      <Stat label="Coverage" value={pct(selected.coveragePct)} />
                      <Stat label="FAR / KIT" value={selected.far.toFixed(2)} />
                      <Stat label="GFA above" value={`${fmt(model.building.gfa_above_ground_m2)} м²`} />
                      <Stat label="GFA underground" value={`${fmt(model.building.gfa_underground_m2)} м²`} />
                      <Stat label="Sellable area" value={`${fmt(selected.sellableAreaM2)} м²`} />
                      <Stat label="Efficiency" value={pct(value.efficiency_ratio * 100)} />
                      <Stat label="Parking" value={`${selected.placement.parking_spots} м/м`} />
                      <Stat label="Cost / м² GFA" value={`${fmt(selected.costPerGfaM2)} ₸`} />
                      <Stat label="Cost / м² sellable" value={`${fmt(selected.costPerSellableM2)} ₸`} />
                    </div>
                  </div>

                  <div data-testid="cost-placement-revenue-check" className="mb-4 rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Revenue sanity-check</div>
                        <div className="text-[10.5px] text-white/38">Early feasibility only: before land, financing, taxes, sales and marketing.</div>
                      </div>
                      <div className={["rounded-full border px-2.5 py-1 text-[10px]", selected.grossMarginBeforeLand >= 0 ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100/80" : "border-rose-300/25 bg-rose-300/10 text-rose-100/80"].join(" ")}>
                        {selected.grossMarginBeforeLand >= 0 ? "positive spread" : "negative spread"}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      <Stat label="Market price" value={`${fmt(value.market_price_per_sellable_m2)} ₸/м²`} />
                      <Stat label="Sellable area" value={`${fmt(selected.sellableAreaM2)} м²`} />
                      <Stat label="Potential revenue" value={`${fmt(selected.revenueEstimate)} ₸`} />
                      <Stat label="Gross margin" value={`${fmt(selected.grossMarginBeforeLand)} ₸`} />
                      <Stat label="Margin %" value={pct(selected.grossMarginPct)} />
                      <Stat label="Cost / sellable" value={`${fmt(selected.costPerSellableM2)} ₸/м²`} />
                      <Stat label="Construction cost" value={`${fmt(selected.cost.total_estimate)} ₸`} />
                      <Stat label="Excluded" value="land / finance" />
                      <Stat label="Break-even price" value={`${fmt(selected.breakEvenPricePerSellableM2)} в‚ё/РјВІ`} />
                      <Stat label="Upside to break-even" value={pct(selected.upsideToBreakEvenPct)} />
                    </div>
                  </div>

                  <div data-testid="cost-placement-revenue-scenarios" className="mb-4 overflow-hidden rounded-xl border border-white/[0.07] bg-black/10">
                    <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[10px] uppercase tracking-wide text-white/32 border-b border-white/[0.06]">
                      <span>Scenario</span>
                      <span>Price</span>
                      <span>Revenue</span>
                      <span>Margin</span>
                    </div>
                    {selected.revenueScenarios.map((scenario) => (
                      <div key={scenario.key} className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[11.5px] border-b border-emerald-300/5 last:border-b-0">
                        <span className="text-white/75">{scenario.label}</span>
                        <span className="tabular-nums text-white/65">{fmt(scenario.pricePerSellableM2)} KZT</span>
                        <span className="tabular-nums text-white/65">{fmt(scenario.revenue)} KZT</span>
                        <span className={scenario.margin >= 0 ? "tabular-nums text-emerald-200/80" : "tabular-nums text-rose-200/80"}>
                          {fmt(scenario.margin)} KZT - {pct(scenario.marginPct)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div data-testid="cost-placement-cost-structure" className="mb-4 rounded-xl border border-white/[0.07] bg-black/10 p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Cost structure</div>
                        <div className="text-[10.5px] text-white/38">What is included in this Class 5 number, grouped for developer review.</div>
                      </div>
                      <div className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10px] text-white/45">ex VAT / ex land</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {selected.costBuckets.map((bucket) => (
                        <div key={bucket.key} className={["rounded-xl border px-3 py-2.5", bucketClass(bucket.tone)].join(" ")}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[12px] font-medium text-white/80">{bucket.label}</div>
                              <div className="mt-1 text-[10.5px] leading-relaxed text-white/38">{bucket.note}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[12.5px] tabular-nums text-white/80">{bucket.amount === null ? "Excluded" : `${fmt(bucket.amount)} KZT`}</div>
                              <div className="text-[10px] text-white/35">{bucket.sharePct === null ? "not in total" : pct(bucket.sharePct)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div data-testid="cost-placement-leveling" className="mb-4 rounded-xl border border-white/[0.06] bg-black/10 overflow-hidden">
                    <div className="grid grid-cols-[1.1fr_1fr_1fr_0.9fr] gap-2 px-3 py-2 text-[10px] uppercase tracking-wide text-white/30 border-b border-white/[0.05]">
                      <span>Variant</span>
                      <span>Total</span>
                      <span>Delta</span>
                      <span>Risk</span>
                    </div>
                    {model.rows.map((row) => (
                      <button
                        key={row.placement.variant_key}
                        type="button"
                        onClick={() => update("selected_variant_key", row.placement.variant_key)}
                        className={[
                          "w-full grid grid-cols-[1.1fr_1fr_1fr_0.9fr] gap-2 px-3 py-2 text-left text-[11.5px] border-b border-white/[0.04] last:border-b-0 transition",
                          selected.placement.variant_key === row.placement.variant_key ? "bg-amber-300/10" : "hover:bg-white/[0.035]",
                        ].join(" ")}
                      >
                        <span className="text-white/75">{variantLabel(row.placement.variant_key)}</span>
                        <span className="text-white/75 tabular-nums">{fmt(row.cost.total_estimate)} ₸</span>
                        <span className={row.deltaToCheapest === 0 ? "text-emerald-300" : "text-amber-200 tabular-nums"}>
                          {row.deltaToCheapest === 0 ? "base" : `+${fmt(row.deltaToCheapest)} ₸`}
                        </span>
                        <span className={riskClass(row.riskLevel)}>{riskLabel(row.riskLevel)}</span>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                    {selected.cost.method_meta.lines.map((line) => (
                      <div key={line.key} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 border-b border-white/[0.045] last:border-b-0 text-[12px]">
                        <span className="text-white/55">{line.label}</span>
                        <span className="text-white/80 tabular-nums">{fmt(line.amount)} ₸</span>
                      </div>
                    ))}
                  </div>
                </div>

                <CostAssumptionsPanel
                  assumptions={model.assumptions}
                  selected={selected}
                  cheapest={cheapest}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function buildCostPlacementModel(value: CostPlacementDraft): {
  site: Site;
  building: Building;
  rows: CostPlacementRow[];
  assumptions: CostAssumptions;
  warning: string | null;
} {
  const assumptions = buildCostAssumptions(value);
  const costParams = value.costParams ?? DEFAULT_COST_PARAMS;
  const siteArea = Math.max(1, value.site_width_m * value.site_depth_m);
  const site: Site = {
    id: "cost-site",
    region: value.region,
    polygon: rectanglePolygon(value.site_width_m, value.site_depth_m),
    area_m2: siteArea,
  };
  const building: Building = {
    id: "cost-building",
    type: "multifamily_residential",
    quality_class: value.quality_class,
    gfa_above_ground_m2: Math.max(0, value.gfa_above_ground_m2),
    gfa_underground_m2: Math.max(0, value.gfa_underground_m2),
    floors_above: Math.max(1, value.floors_above),
    floors_below: Math.max(0, value.floors_below),
    footprint_width_m: Math.max(1, value.footprint_width_m),
    footprint_depth_m: Math.max(1, value.footprint_depth_m),
  };
  const efficiencyRatio = clamp(value.efficiency_ratio, 0.5, 0.95);
  const placements = createPlacementVariants(site, building, {
    setbacks: {
      front: Math.max(0, value.setback_front_m),
      side: Math.max(0, value.setback_side_m),
      rear: Math.max(0, value.setback_rear_m),
    },
    parking_mode: value.parking_mode,
    parking_spots: value.auto_parking ? "auto_by_norms" : value.parking_spots,
    complex_soil: value.complex_soil,
    complex_slope: value.complex_slope,
  });
  const baseRows = placements.map((placement) => {
    const footprintArea = polygonArea(placement.footprint_polygon);
    return {
      placement,
      cost: estimateCost(placement, site, building, costParams),
      siteAreaM2: site.area_m2,
      footprintArea,
      coveragePct: site.area_m2 > 0 ? footprintArea / site.area_m2 * 100 : 0,
      far: site.area_m2 > 0 ? building.gfa_above_ground_m2 / site.area_m2 : 0,
      totalGfaM2: building.gfa_above_ground_m2 + building.gfa_underground_m2,
      sellableAreaM2: building.gfa_above_ground_m2 * efficiencyRatio,
    };
  });
  const cheapestTotal = Math.min(...baseRows.map((row) => row.cost.total_estimate));
  const rows = baseRows.map((row) => {
    const costPerGfaM2 = row.cost.total_estimate / Math.max(1, row.totalGfaM2);
    const costPerSellableM2 = row.cost.total_estimate / Math.max(1, row.sellableAreaM2);
    const revenueEstimate = row.sellableAreaM2 * Math.max(0, value.market_price_per_sellable_m2);
    const grossMarginBeforeLand = revenueEstimate - row.cost.total_estimate;
    const grossMarginPct = revenueEstimate > 0 ? grossMarginBeforeLand / revenueEstimate * 100 : 0;
    const breakEvenPricePerSellableM2 = row.cost.total_estimate / Math.max(1, row.sellableAreaM2);
    const upsideToBreakEvenPct = breakEvenPricePerSellableM2 > 0
      ? (value.market_price_per_sellable_m2 - breakEvenPricePerSellableM2) / breakEvenPricePerSellableM2 * 100
      : 0;
    const scenarioDefs = [
      ["pessimistic", "Pessimistic", 0.9],
      ["base", "Base", 1],
      ["optimistic", "Optimistic", 1.1],
    ] as const;
    const revenueScenarios = scenarioDefs.map(([key, label, coefficient]) => {
      const pricePerSellableM2 = Math.max(0, value.market_price_per_sellable_m2 * coefficient);
      const revenue = row.sellableAreaM2 * pricePerSellableM2;
      const margin = revenue - row.cost.total_estimate;
      return {
        key,
        label,
        pricePerSellableM2: Math.round(pricePerSellableM2),
        revenue: Math.round(revenue),
        margin: Math.round(margin),
        marginPct: revenue > 0 ? margin / revenue * 100 : 0,
      };
    });
    const siteWorksSharePct = row.cost.c_site / Math.max(1, row.cost.total_estimate) * 100;
    const feasibility = buildFeasibilitySignal({
      grossMarginPct,
      upsideToBreakEvenPct,
      far: row.far,
      coveragePct: row.coveragePct,
      siteWorksSharePct,
      missingWarningCount: assumptions.missingDataWarnings.length,
    });
    return {
      ...row,
      deltaToCheapest: Math.max(0, row.cost.total_estimate - cheapestTotal),
      isCheapest: row.cost.total_estimate === cheapestTotal,
      costPerGfaM2: Math.round(costPerGfaM2),
      costPerSellableM2: Math.round(costPerSellableM2),
      revenueEstimate: Math.round(revenueEstimate),
      grossMarginBeforeLand: Math.round(grossMarginBeforeLand),
      grossMarginPct,
      breakEvenPricePerSellableM2: Math.round(breakEvenPricePerSellableM2),
      upsideToBreakEvenPct,
      revenueScenarios,
      costBuckets: buildCostBuckets(row.cost),
      feasibility,
      siteWorksSharePct,
      riskLevel: siteWorksSharePct >= 12 ? "high" as const : siteWorksSharePct >= 8 ? "medium" as const : "low" as const,
    };
  });
  const buildableWidth = value.site_width_m - value.setback_side_m * 2;
  const buildableDepth = value.site_depth_m - value.setback_front_m - value.setback_rear_m;
  const warning = buildableWidth <= 0 || buildableDepth <= 0
    ? "Отступы больше участка: зона застройки схлопнулась. Уменьшите отступы или увеличьте участок."
    : null;
  return { site, building, rows, assumptions, warning };
}

function buildCostAssumptions(value: CostPlacementDraft): CostAssumptions {
  const state = value.costAssumptions;
  const costParams = value.costParams ?? DEFAULT_COST_PARAMS;
  const manualRates = JSON.stringify(costParams) !== JSON.stringify(DEFAULT_COST_PARAMS);
  const uploadedRates = Boolean(state.uploadedRateFileName);
  const missingDataWarnings = [
    "No geotechnical report attached",
    "No exact slope/topography survey attached",
    value.auto_parking ? "No official parking norm selected" : null,
    uploadedRates ? "Client uploaded screening rates are used" : manualRates ? "Manual screening rates are used" : "Placeholder rates are used",
    "No official cost source is attached",
  ].filter(Boolean) as string[];

  return {
    ...state,
    region: value.region,
    buildingClass: value.quality_class,
    baseRateAboveGround: costParams.base_rate_kzt_m2,
    regionCoefficient: costParams.region_coefficients[value.region] ?? costParams.region_coefficients.default,
    classCoefficient: costParams.quality_coefficients[value.quality_class],
    undergroundFactor: costParams.underground_factor,
    contingencyPct: costParams.contingency_pct,
    vatIncluded: false,
    rateSourceType: uploadedRates || manualRates ? "manual" : state.rateSourceType,
    rateSourceName: uploadedRates ? state.rateSourceName : manualRates ? "Manual frontend Class 5 rate inputs" : state.rateSourceName,
    confidenceLevel: uploadedRates ? state.confidenceLevel : manualRates ? "medium" : state.confidenceLevel,
    uploadedRateFileName: state.uploadedRateFileName,
    uploadedRateKeys: state.uploadedRateKeys,
    includedItems: INCLUDED_ITEMS,
    excludedItems: EXCLUDED_ITEMS,
    missingDataWarnings,
  };
}

function CostAssumptionsPanel({
  assumptions,
  selected,
  cheapest,
}: {
  assumptions: CostAssumptions;
  selected: CostPlacementRow;
  cheapest: CostPlacementRow;
}) {
  return (
    <div data-testid="cost-assumptions-panel" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-3">
      <div>
        <div className="text-[12.5px] font-medium text-white/85">Assumptions / источники</div>
        <div className="text-[10.5px] text-white/35">Почему estimate не random: входные допущения, источники и exclusions.</div>
      </div>

      <AssumptionSection title="A) Cost Basis">
        <AssumptionRow label="Price level" value={assumptions.priceLevelYear} />
        <AssumptionRow label="Region" value={regionLabel(assumptions.region)} />
        <AssumptionRow label="Object type" value={assumptions.objectType} />
        <AssumptionRow label="Building class" value={qualityLabel(assumptions.buildingClass)} />
        <AssumptionRow label="Estimate class" value="AACE Class 5" />
        <AssumptionRow label="Purpose" value="Early screening only" warn />
      </AssumptionSection>

      <AssumptionSection title="B) Rate Assumptions">
        <AssumptionRow label="Base above-ground" value={`${fmt(assumptions.baseRateAboveGround)} ₸/м²`} help="Placeholder base rate before region and quality coefficients." />
        <AssumptionRow label="Region coeff." value={assumptions.regionCoefficient.toFixed(2)} />
        <AssumptionRow label="Class coeff." value={assumptions.classCoefficient.toFixed(2)} />
        <AssumptionRow label="Underground factor" value={assumptions.undergroundFactor.toFixed(2)} />
        <AssumptionRow label="Site works" value={assumptions.siteWorksMethod} muted />
        <AssumptionRow label="Contingency" value={`${assumptions.contingencyPct}%`} warn />
        <AssumptionRow label="VAT" value={assumptions.vatIncluded ? "included" : "excluded by default"} warn={!assumptions.vatIncluded} />
      </AssumptionSection>

      <AssumptionSection title="C) Included Items">
        <div className="grid grid-cols-1 gap-1.5">
          {assumptions.includedItems.map((item) => <ItemPill key={item} label={item} included />)}
        </div>
      </AssumptionSection>

      <AssumptionSection title="D) Excluded Items">
        <div className="grid grid-cols-1 gap-1.5">
          {assumptions.excludedItems.map((item) => <ItemPill key={item} label={item} />)}
        </div>
      </AssumptionSection>

      <AssumptionSection title="E) Missing Data Warnings">
        <div className="space-y-1.5">
          {assumptions.missingDataWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-1.5 rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1.5 text-[10.5px] text-amber-100/75">
              <AlertCircle size={10} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      </AssumptionSection>

      <AssumptionSection title="F) Source Metadata">
        <AssumptionRow label="Source type" value={assumptions.rateSourceType} warn={assumptions.rateSourceType === "placeholder"} />
        <AssumptionRow label="Source name" value={assumptions.rateSourceName} />
        <AssumptionRow label="Source year" value={assumptions.rateSourceYear} />
        <AssumptionRow label="Last updated" value={assumptions.lastUpdated} />
        <AssumptionRow label="Confidence" value={assumptions.confidenceLevel} warn={assumptions.confidenceLevel === "low"} />
        {assumptions.uploadedRateFileName && (
          <>
            <AssumptionRow label="Uploaded file" value={assumptions.uploadedRateFileName} warn />
            <AssumptionRow
              label="Imported keys"
              value={assumptions.uploadedRateKeys.map((key) => COST_RATE_IMPORT_KEY_LABELS[key] ?? key).join(", ")}
              muted
            />
          </>
        )}
      </AssumptionSection>

      <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-100/70">
        Base scenario: {variantLabel(cheapest.placement.variant_key)}. Selected: {selected.deltaToCheapest === 0 ? "cheapest option" : `+${fmt(selected.deltaToCheapest)} ₸ vs base`}. Unit cost: {fmt(selected.costPerGfaM2)} ₸/м² GFA. Revenue sanity-check excludes land and financing.
      </div>
    </div>
  );
}

function AssumptionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
      <div className="text-[10px] uppercase tracking-wide text-white/35 mb-2">{title}</div>
      {children}
    </div>
  );
}

function AssumptionRow({ label, value, warn, muted, help }: {
  label: string;
  value: string;
  warn?: boolean;
  muted?: boolean;
  help?: string;
}) {
  return (
    <div className="grid grid-cols-[0.9fr_1.1fr] gap-2 py-1 border-b border-white/[0.04] last:border-b-0 text-[10.8px]" title={help}>
      <span className="text-white/40">{label}</span>
      <span className={[warn ? "text-amber-200" : muted ? "text-white/45" : "text-white/75", "text-right"].join(" ")}>{value}</span>
    </div>
  );
}

function ItemPill({ label, included }: { label: string; included?: boolean }) {
  return (
    <div className={[
      "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[10.5px]",
      included
        ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-100/75"
        : "border-white/[0.06] bg-white/[0.02] text-white/35 line-through",
    ].join(" ")}>
      <span className={included ? "text-emerald-300" : "text-white/25"}>{included ? "✓" : "×"}</span>
      <span>{label}</span>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#151515]/65 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-white/80 mb-3">
        {icon}
        {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function NumberField({ label, value, step = 1, testId, onChange }: {
  label: string;
  value: number;
  step?: number;
  testId?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-white/35 mb-1">{label}</span>
      <input
        type="number"
        data-testid={testId}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-9 rounded-lg bg-black/20 border border-white/[0.08] px-2.5 text-[12px] text-white/80 outline-none focus:border-white/25"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-white/35 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg bg-black/20 border border-white/[0.08] px-2.5 text-[12px] text-white/80 outline-none focus:border-white/25"
      >
        {options.map(([v, labelText]) => <option key={v} value={v} className="bg-neutral-950">{labelText}</option>)}
      </select>
    </label>
  );
}

function PreviewSvg({ site, placement }: { site: Site; placement: BuildingPlacement }) {
  const width = Math.max(...site.polygon.map((p) => p.x));
  const depth = Math.max(...site.polygon.map((p) => p.y));
  const points = placement.footprint_polygon.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${depth}`} className="w-full aspect-[1.45] rounded-xl bg-black/25 border border-white/[0.06]">
      <rect x="0" y="0" width={width} height={depth} fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      <polygon points={points} fill="rgba(251,191,36,0.32)" stroke="rgba(251,191,36,0.85)" strokeWidth="1.5" />
    </svg>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/40">{label}</span>
      <span className={strong ? "text-amber-200 font-semibold tabular-nums" : "text-white/75 tabular-nums"}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/30">{label}</div>
      <div className="text-[13px] text-white/85 tabular-nums mt-1">{value}</div>
    </div>
  );
}

function RangeStat({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={[
      "rounded-xl border px-3 py-2",
      active ? "border-amber-300/25 bg-amber-300/10" : "border-white/[0.06] bg-black/10",
    ].join(" ")}>
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className={["text-[12.5px] tabular-nums mt-1", active ? "text-amber-100 font-semibold" : "text-white/75"].join(" ")}>{value}</div>
    </div>
  );
}

function riskLabel(level: "low" | "medium" | "high"): string {
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  return "Low";
}

function riskClass(level: "low" | "medium" | "high"): string {
  if (level === "high") return "text-rose-300";
  if (level === "medium") return "text-amber-200";
  return "text-emerald-300";
}

function feasibilityClass(grade: FeasibilityGrade): string {
  if (grade === "go") return "border-emerald-300/30 bg-emerald-300/12 text-emerald-100";
  if (grade === "caution") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  return "border-rose-300/30 bg-rose-300/12 text-rose-100";
}

function bucketClass(tone: CostBucket["tone"]): string {
  if (tone === "warn") return "border-amber-300/15 bg-amber-300/[0.045]";
  if (tone === "muted") return "border-white/[0.06] bg-white/[0.018]";
  return "border-white/[0.06] bg-white/[0.028]";
}

function variantLabel(key: BuildingPlacement["variant_key"]): string {
  if (key === "linear_north") return "Linear north";
  if (key === "l_shape") return "L-shape";
  return "Central";
}

function regionLabel(region: Region): string {
  if (region === "Almaty") return "Алматы";
  if (region === "Astana") return "Астана";
  if (region === "Shymkent") return "Шымкент";
  if (region === "Aktobe") return "Актобе";
  return "Другой";
}

function qualityLabel(quality: QualityClass): string {
  if (quality === "economy") return "Economy";
  if (quality === "business") return "Business";
  return "Comfort";
}
