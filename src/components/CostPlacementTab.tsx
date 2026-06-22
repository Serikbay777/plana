"use client";

import { useMemo, useState } from "react";
import { AlertCircle, BarChart3, Calculator, CheckCircle2, Coins, Info, Map as MapIcon } from "lucide-react";
import {
  analyzeSiteImageRisks,
  explainCostSnapshot,
  extractCostInputsFromBrief,
  type CostAnalystExplanation,
  type CostInputExtractionResponse,
  type SiteImageRiskAnalysisResponse,
} from "@/lib/engine";
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
type AssumptionFieldSource = "manual" | "client_uploaded" | "ai_extracted" | "vision_extracted";
type CostSourceType = "placeholder" | "manual" | "client_uploaded" | "ai_extracted" | "vision_extracted" | "market_calibrated" | "official";

type CostSourceRegistryEntry = {
  id: string;
  label: string;
  sourceType: CostSourceType;
  sourceName: string;
  sourceYear: string;
  lastUpdated: string;
  confidenceLevel: ConfidenceLevel;
  appliesTo: string[];
  note: string;
};

type CalibrationVerificationStatus = "draft" | "verified" | "rejected";

type CalibrationDatasetRow = {
  projectId: string;
  projectName: string;
  region: string;
  objectType: string;
  buildingClass: string;
  gfaAboveGroundM2: number;
  gfaUndergroundM2: number;
  floorsAbove: number;
  floorsBelow: number;
  parkingMode: string;
  parkingSpots: number | null;
  complexSoil: boolean | null;
  complexSlope: boolean | null;
  actualTotalCostKzt: number;
  actualCostYear: string;
  sourceName: string;
  verificationStatus: CalibrationVerificationStatus;
  notes: string;
};

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
  aiExtractedAt: string | null;
  aiModelUsed: string | null;
  aiConfidenceLevel: ConfidenceLevel | null;
  aiAppliedFields: string[];
  aiRejectedFields: string[];
  aiMissingDataWarnings: string[];
  fieldSources: Record<string, AssumptionFieldSource>;
  geoAddress: string | null;
  geoCoordinates: string | null;
  geoRegionConfidence: ConfidenceLevel | null;
  geoWarnings: string[];
  visionAnalyzedAt: string | null;
  visionModelUsed: string | null;
  visionConfidenceLevel: ConfidenceLevel | null;
  visionAppliedFlags: string[];
  visionRejectedFlags: string[];
  visionWarnings: string[];
  sourceRegistry: CostSourceRegistryEntry[];
  analystExplainedAt: string | null;
  analystModelUsed: string | null;
  analystExplanation: CostAnalystExplanation | null;
  calibrationRows: CalibrationDatasetRow[];
  calibrationImportedAt: string | null;
  calibrationImportWarnings: string[];
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
  site_address: string;
  site_latitude: number | null;
  site_longitude: number | null;
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
  rateSourceName: "stat.gov.kz benchmark, aligned with backend engine (aggregate_cost.py)",
  rateSourceYear: "2025/2026",
  lastUpdated: "2026-06-22",
  confidenceLevel: "low",
  uploadedRateFileName: null,
  uploadedRateKeys: [],
  aiExtractedAt: null,
  aiModelUsed: null,
  aiConfidenceLevel: null,
  aiAppliedFields: [],
  aiRejectedFields: [],
  aiMissingDataWarnings: [],
  fieldSources: {},
  geoAddress: null,
  geoCoordinates: null,
  geoRegionConfidence: null,
  geoWarnings: [],
  visionAnalyzedAt: null,
  visionModelUsed: null,
  visionConfidenceLevel: null,
  visionAppliedFlags: [],
  visionRejectedFlags: [],
  visionWarnings: [],
  sourceRegistry: [],
  analystExplainedAt: null,
  analystModelUsed: null,
  analystExplanation: null,
  calibrationRows: [],
  calibrationImportedAt: null,
  calibrationImportWarnings: [],
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
  site_address: "",
  site_latitude: null,
  site_longitude: null,
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

const CALIBRATION_TEMPLATE_HEADERS = [
  "project_id",
  "project_name",
  "region",
  "object_type",
  "building_class",
  "gfa_above_ground_m2",
  "gfa_underground_m2",
  "floors_above",
  "floors_below",
  "parking_mode",
  "parking_spots",
  "complex_soil",
  "complex_slope",
  "actual_total_cost_kzt",
  "actual_cost_year",
  "source_name",
  "verification_status",
  "notes",
];

type CalibrationImportResult = {
  rows: CalibrationDatasetRow[];
  warnings: string[];
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && insideQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === "," && !insideQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseOptionalBoolean(rawValue: string): boolean | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "yes", "1", "y"].includes(normalized)) return true;
  if (["false", "no", "0", "n"].includes(normalized)) return false;
  return null;
}

function normalizeVerificationStatus(rawValue: string): CalibrationVerificationStatus {
  const normalized = normalizeRateImportKey(rawValue);
  if (normalized === "verified") return "verified";
  if (normalized === "rejected") return "rejected";
  return "draft";
}

function parseCalibrationDatasetCsv(text: string): CalibrationImportResult {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length < 2) {
    return { rows: [], warnings: ["CSV must include a header row and at least one historical project row."] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeRateImportKey);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "project_id",
    "project_name",
    "region",
    "building_class",
    "gfa_above_ground_m2",
    "actual_total_cost_kzt",
    "actual_cost_year",
    "source_name",
    "verification_status",
  ];

  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) warnings.push(`Missing required column: ${header}`);
  }
  if (warnings.some((warning) => warning.startsWith("Missing required column"))) {
    return { rows: [], warnings };
  }

  const getCell = (cells: string[], key: string) => cells[headerIndex.get(key) ?? -1] ?? "";
  const rows: CalibrationDatasetRow[] = [];

  for (const [lineIndex, line] of lines.slice(1, 201).entries()) {
    const cells = parseCsvLine(line);
    const rowNumber = lineIndex + 2;
    const projectId = getCell(cells, "project_id");
    const projectName = getCell(cells, "project_name");
    const gfaAboveGroundM2 = parseRateNumber(getCell(cells, "gfa_above_ground_m2"));
    const actualTotalCostKzt = parseRateNumber(getCell(cells, "actual_total_cost_kzt"));

    if (!projectId || !projectName) {
      warnings.push(`Row ${rowNumber}: project_id and project_name are required.`);
      continue;
    }
    if (gfaAboveGroundM2 === null || gfaAboveGroundM2 <= 0) {
      warnings.push(`Row ${rowNumber}: gfa_above_ground_m2 must be a positive number.`);
      continue;
    }
    if (actualTotalCostKzt === null || actualTotalCostKzt <= 0) {
      warnings.push(`Row ${rowNumber}: actual_total_cost_kzt must be a positive number.`);
      continue;
    }

    const gfaUndergroundM2 = parseRateNumber(getCell(cells, "gfa_underground_m2")) ?? 0;
    const floorsAbove = parseRateNumber(getCell(cells, "floors_above")) ?? 0;
    const floorsBelow = parseRateNumber(getCell(cells, "floors_below")) ?? 0;
    const parkingSpots = parseRateNumber(getCell(cells, "parking_spots"));
    rows.push({
      projectId,
      projectName,
      region: getCell(cells, "region") || "unknown",
      objectType: getCell(cells, "object_type") || "unknown",
      buildingClass: getCell(cells, "building_class") || "unknown",
      gfaAboveGroundM2,
      gfaUndergroundM2,
      floorsAbove,
      floorsBelow,
      parkingMode: getCell(cells, "parking_mode") || "unknown",
      parkingSpots,
      complexSoil: parseOptionalBoolean(getCell(cells, "complex_soil")),
      complexSlope: parseOptionalBoolean(getCell(cells, "complex_slope")),
      actualTotalCostKzt,
      actualCostYear: getCell(cells, "actual_cost_year"),
      sourceName: getCell(cells, "source_name"),
      verificationStatus: normalizeVerificationStatus(getCell(cells, "verification_status")),
      notes: getCell(cells, "notes"),
    });
  }

  if (lines.length > 201) warnings.push("Only the first 200 historical rows were imported in the MVP frontend placeholder.");
  if (rows.length === 0 && warnings.length === 0) warnings.push("No valid historical project rows were found.");

  return { rows, warnings };
}

function csvEscape(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function downloadCsv(filename: string, rows: unknown[][]): void {
  const body = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildCostReportRows(input: {
  selected: CostPlacementRow;
  cheapest: CostPlacementRow;
  assumptions: CostAssumptions;
  building: Building;
  draft: CostPlacementDraft;
}): unknown[][] {
  const { selected, cheapest, assumptions, building, draft } = input;
  const rows: unknown[][] = [
    ["section", "item", "value", "notes"],
    ["Report", "Title", "Plana Class 5 Cost Placement Screening Report", ""],
    ["Report", "Disclaimer", "Screening estimate, not official Kazakhstan estimate documentation", "Do not use as official estimate documentation."],
    ["Cost Basis", "Selected variant", variantLabel(selected.placement.variant_key), ""],
    ["Cost Basis", "Cheapest baseline", variantLabel(cheapest.placement.variant_key), selected.deltaToCheapest === 0 ? "Selected is baseline" : `Selected delta: ${selected.deltaToCheapest} KZT`],
    ["Cost Basis", "Price level year", assumptions.priceLevelYear, ""],
    ["Cost Basis", "Region", regionLabel(assumptions.region), ""],
    ["Cost Basis", "Object type", assumptions.objectType, ""],
    ["Cost Basis", "Building class", qualityLabel(assumptions.buildingClass), ""],
    ["Cost Basis", "Estimate class", "AACE Class 5", "Early screening only"],
    ["Class 5 Range", "Low", selected.cost.range_low, "KZT"],
    ["Class 5 Range", "Expected", selected.cost.total_estimate, "KZT"],
    ["Class 5 Range", "High", selected.cost.range_high, "KZT"],
    ["Developer KPIs", "GFA above ground", building.gfa_above_ground_m2, "m2"],
    ["Developer KPIs", "GFA underground", building.gfa_underground_m2, "m2"],
    ["Developer KPIs", "Sellable area", selected.sellableAreaM2, "m2"],
    ["Developer KPIs", "FAR / KIT", selected.far.toFixed(2), ""],
    ["Developer KPIs", "Coverage", selected.coveragePct.toFixed(1), "%"],
    ["Developer KPIs", "Cost per GFA", selected.costPerGfaM2, "KZT/m2"],
    ["Developer KPIs", "Cost per sellable", selected.costPerSellableM2, "KZT/m2"],
    ["Revenue", "Market price", draft.market_price_per_sellable_m2, "KZT/m2 sellable"],
    ["Revenue", "Potential revenue", selected.revenueEstimate, "KZT"],
    ["Revenue", "Gross margin before land", selected.grossMarginBeforeLand, "KZT"],
    ["Revenue", "Gross margin pct", selected.grossMarginPct.toFixed(1), "%"],
    ["Feasibility", "Signal", selected.feasibility.label, `Score ${selected.feasibility.score}/100`],
    ["Rate Assumptions", "Base above-ground rate", assumptions.baseRateAboveGround, "KZT/m2"],
    ["Rate Assumptions", "Region coefficient", assumptions.regionCoefficient, ""],
    ["Rate Assumptions", "Class/quality coefficient", assumptions.classCoefficient, ""],
    ["Rate Assumptions", "Underground factor", assumptions.undergroundFactor, ""],
    ["Rate Assumptions", "Site works method", assumptions.siteWorksMethod, ""],
    ["Rate Assumptions", "Contingency", assumptions.contingencyPct, "%"],
    ["Rate Assumptions", "VAT status", assumptions.vatIncluded ? "included" : "excluded by default", ""],
  ];

  for (const bucket of selected.costBuckets) {
    rows.push(["Cost Buckets", bucket.label, bucket.amount ?? "Excluded", bucket.sharePct === null ? bucket.note : `${bucket.sharePct.toFixed(1)}% - ${bucket.note}`]);
  }
  for (const line of selected.cost.method_meta.lines) {
    rows.push(["Cost Lines", line.label, line.amount, "KZT"]);
  }
  for (const item of assumptions.includedItems) rows.push(["Included Items", item, "included", ""]);
  for (const item of assumptions.excludedItems) rows.push(["Excluded Items", item, "excluded", ""]);
  for (const warning of assumptions.missingDataWarnings) rows.push(["Missing Data Warnings", warning, "warning", ""]);
  for (const entry of assumptions.sourceRegistry) {
    rows.push(["Source Registry", entry.label, entry.sourceType, `${entry.sourceName}; year=${entry.sourceYear}; confidence=${entry.confidenceLevel}; applies=${entry.appliesTo.join(" | ")}`]);
  }
  if (assumptions.aiModelUsed) {
    rows.push(["AI Extraction", "Model", assumptions.aiModelUsed, `Confidence=${assumptions.aiConfidenceLevel ?? "not recorded"}`]);
    rows.push(["AI Extraction", "Applied fields", assumptions.aiAppliedFields.map(sourceFieldLabel).join(" | "), "User-confirmed fields"]);
    rows.push(["AI Extraction", "Rejected fields", assumptions.aiRejectedFields.map(sourceFieldLabel).join(" | "), "Not applied"]);
  }
  if (assumptions.visionModelUsed) {
    rows.push(["Vision Analysis", "Model", assumptions.visionModelUsed, `Confidence=${assumptions.visionConfidenceLevel ?? "not recorded"}`]);
    rows.push(["Vision Analysis", "Applied flags", assumptions.visionAppliedFlags.map((key) => VISION_RISK_LABELS[key] ?? key).join(" | "), "User-confirmed flags"]);
  }
  if (assumptions.analystExplanation) {
    rows.push(["AI Analyst", "Summary", assumptions.analystExplanation.summary, assumptions.analystModelUsed ?? ""]);
    for (const item of assumptions.analystExplanation.key_drivers) rows.push(["AI Analyst", "Key driver", item, ""]);
    for (const item of assumptions.analystExplanation.risk_notes) rows.push(["AI Analyst", "Risk note", item, ""]);
    for (const item of assumptions.analystExplanation.next_documents) rows.push(["AI Analyst", "Next document", item, ""]);
  }
  rows.push(["Calibration Dataset", "Imported rows", assumptions.calibrationRows.length, "Not used in current deterministic totals."]);
  rows.push(["Calibration Dataset", "ML status", "No predictive ML model is trained until enough verified data exists", ""]);

  return rows;
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

function sourceFieldLabel(key: string): string {
  if (key === "geo_region") return "Geo region confirmation";
  if (key === "complex_slope") return "Complex slope";
  if (key.startsWith("vision_")) return VISION_RISK_LABELS[key.replace(/^vision_/, "")] ?? key;
  return COST_AI_FIELD_LABELS[key] ?? COST_RATE_IMPORT_KEY_LABELS[key] ?? key;
}

function fieldSourceToRegistryType(source: AssumptionFieldSource | undefined): CostSourceType | null {
  if (!source) return null;
  if (source === "manual") return "manual";
  if (source === "client_uploaded") return "client_uploaded";
  if (source === "ai_extracted") return "ai_extracted";
  if (source === "vision_extracted") return "vision_extracted";
  return null;
}

function buildSourceRegistry(input: {
  state: CostAssumptions;
  manualRates: boolean;
  uploadedRates: boolean;
  fieldSources: Record<string, AssumptionFieldSource>;
}): CostSourceRegistryEntry[] {
  const { state, manualRates, uploadedRates, fieldSources } = input;
  const entries: CostSourceRegistryEntry[] = [];
  const rateKeys = [
    "base_rate_kzt_m2",
    "underground_factor",
    "roads_rate_kzt_m2",
    "open_parking_rate_kzt_m2",
    "landscape_rate_kzt_m2",
    "contingency_pct",
  ];
  const uploadedRateKeys = (state.uploadedRateKeys ?? []).filter((key) => rateKeys.includes(key));
  const manualRateKeys = rateKeys.filter((key) => fieldSources[key] === "manual");
  const placeholderRateKeys = rateKeys.filter((key) => !uploadedRateKeys.includes(key) && !manualRateKeys.includes(key));

  if (uploadedRates && uploadedRateKeys.length > 0) {
    entries.push({
      id: "rates.client_uploaded",
      label: "Client uploaded rate inputs",
      sourceType: "client_uploaded",
      sourceName: state.rateSourceName,
      sourceYear: state.rateSourceYear,
      lastUpdated: state.lastUpdated,
      confidenceLevel: state.confidenceLevel,
      appliesTo: uploadedRateKeys.map(sourceFieldLabel),
      note: `Loaded from ${state.uploadedRateFileName ?? "uploaded CSV"}. Screening only, not official Kazakhstan estimate documentation.`,
    });
  }

  if (manualRates && manualRateKeys.length > 0) {
    entries.push({
      id: "rates.manual",
      label: "Manual frontend rate overrides",
      sourceType: "manual",
      sourceName: "Manual frontend Class 5 rate inputs",
      sourceYear: state.rateSourceYear,
      lastUpdated: state.lastUpdated,
      confidenceLevel: "medium",
      appliesTo: manualRateKeys.map(sourceFieldLabel),
      note: "User-edited rates in the MVP cost panel.",
    });
  }

  if (placeholderRateKeys.length > 0) {
    entries.push({
      id: "rates.placeholder",
      label: "Benchmark rate table (backend-aligned)",
      sourceType: "placeholder",
      sourceName: "stat.gov.kz benchmark, aligned with backend engine (aggregate_cost.py)",
      sourceYear: state.rateSourceYear,
      lastUpdated: state.lastUpdated,
      confidenceLevel: "low",
      appliesTo: placeholderRateKeys.map(sourceFieldLabel),
      note: "Same benchmark rates as the backend cost engine (official=False). Replace with licensed УПСС РК before client use.",
    });
  }

  const aiFields = state.aiAppliedFields ?? [];
  if (state.aiModelUsed && aiFields.length > 0) {
    entries.push({
      id: "assumptions.ai_extracted",
      label: "GPT brief extraction",
      sourceType: "ai_extracted",
      sourceName: state.aiModelUsed,
      sourceYear: state.aiExtractedAt ?? "not recorded",
      lastUpdated: state.aiExtractedAt ?? "not recorded",
      confidenceLevel: state.aiConfidenceLevel ?? "low",
      appliesTo: aiFields.map(sourceFieldLabel),
      note: "AI normalized user brief into inputs. User confirmed selected fields; totals remain deterministic.",
    });
  }

  if (state.geoRegionConfidence) {
    entries.push({
      id: "assumptions.geo",
      label: "Geo region confirmation",
      sourceType: "manual",
      sourceName: state.geoAddress ?? state.geoCoordinates ?? "User geo input",
      sourceYear: state.lastUpdated,
      lastUpdated: state.lastUpdated,
      confidenceLevel: state.geoRegionConfidence,
      appliesTo: ["Region coefficient"],
      note: "MVP keyword/bounding-box geo helper, not official geocoding or cadastre.",
    });
  }

  const visionFlags = state.visionAppliedFlags ?? [];
  if (state.visionModelUsed && visionFlags.length > 0) {
    entries.push({
      id: "assumptions.vision",
      label: "Vision site risk analysis",
      sourceType: "vision_extracted",
      sourceName: state.visionModelUsed,
      sourceYear: state.visionAnalyzedAt ?? "not recorded",
      lastUpdated: state.visionAnalyzedAt ?? "not recorded",
      confidenceLevel: state.visionConfidenceLevel ?? "low",
      appliesTo: visionFlags.map((key) => VISION_RISK_LABELS[key] ?? key),
      note: "OpenAI Vision risk hints confirmed by user. Not a survey or engineering conclusion.",
    });
  }

  const otherFieldSources = Object.entries(fieldSources)
    .map(([key, source]) => ({ key, sourceType: fieldSourceToRegistryType(source) }))
    .filter(({ key, sourceType }) =>
      sourceType !== null
      && !rateKeys.includes(key)
      && !aiFields.includes(key)
      && key !== "geo_region"
      && !key.startsWith("vision_")
    );

  if (otherFieldSources.length > 0) {
    entries.push({
      id: "assumptions.field_sources",
      label: "Confirmed field source map",
      sourceType: "manual",
      sourceName: "User-confirmed MVP assumptions",
      sourceYear: state.lastUpdated,
      lastUpdated: state.lastUpdated,
      confidenceLevel: "medium",
      appliesTo: otherFieldSources.map(({ key, sourceType }) => `${sourceFieldLabel(key)}: ${sourceType}`),
      note: "Compatibility source map for fields edited before the registry was introduced.",
    });
  }

  if ((state.calibrationRows ?? []).length > 0) {
    entries.push({
      id: "calibration.historical_outcomes",
      label: "Historical outcome dataset",
      sourceType: "market_calibrated",
      sourceName: "User imported historical project cost rows",
      sourceYear: state.calibrationImportedAt ?? state.lastUpdated,
      lastUpdated: state.calibrationImportedAt ?? state.lastUpdated,
      confidenceLevel: "low",
      appliesTo: ["Future ML calibration dataset path"],
      note: `${state.calibrationRows.length} row(s) imported for future calibration only. Not used in current deterministic Class 5 totals.`,
    });
  }

  return entries;
}

const COST_AI_FIELD_LABELS: Record<string, string> = {
  region: "Region",
  object_type: "Object type",
  site_width_m: "Site width",
  site_depth_m: "Site depth",
  setback_front_m: "Front setback",
  setback_side_m: "Side setback",
  setback_rear_m: "Rear setback",
  quality_class: "Building class",
  gfa_above_ground_m2: "GFA above ground",
  gfa_underground_m2: "GFA underground",
  efficiency_ratio: "Sellable efficiency",
  market_price_per_sellable_m2: "Market price",
  floors_above: "Floors above",
  floors_below: "Floors below",
  footprint_width_m: "Footprint width",
  footprint_depth_m: "Footprint depth",
  parking_mode: "Parking mode",
  parking_spots: "Parking spots",
  complex_soil: "Complex soil",
  complex_slope: "Complex slope",
};

type CostAiField = keyof CostPlacementDraft | "object_type";

function extractionToDraftPatch(extraction: CostInputExtractionResponse["extraction"]): Partial<CostPlacementDraft> {
  const patch: Partial<CostPlacementDraft> = {};
  if (extraction.region) patch.region = extraction.region;
  if (extraction.building_class) patch.quality_class = extraction.building_class;
  if (extraction.site_width_m !== null) patch.site_width_m = extraction.site_width_m;
  if (extraction.site_depth_m !== null) patch.site_depth_m = extraction.site_depth_m;
  if (extraction.setback_front_m !== null) patch.setback_front_m = extraction.setback_front_m;
  if (extraction.setback_side_m !== null) patch.setback_side_m = extraction.setback_side_m;
  if (extraction.setback_rear_m !== null) patch.setback_rear_m = extraction.setback_rear_m;
  if (extraction.gfa_above_ground_m2 !== null) patch.gfa_above_ground_m2 = extraction.gfa_above_ground_m2;
  if (extraction.gfa_underground_m2 !== null) patch.gfa_underground_m2 = extraction.gfa_underground_m2;
  if (extraction.efficiency_ratio !== null) patch.efficiency_ratio = extraction.efficiency_ratio;
  if (extraction.market_price_per_sellable_m2 !== null) patch.market_price_per_sellable_m2 = extraction.market_price_per_sellable_m2;
  if (extraction.floors_above !== null) patch.floors_above = extraction.floors_above;
  if (extraction.floors_below !== null) patch.floors_below = extraction.floors_below;
  if (extraction.footprint_width_m !== null) patch.footprint_width_m = extraction.footprint_width_m;
  if (extraction.footprint_depth_m !== null) patch.footprint_depth_m = extraction.footprint_depth_m;
  if (extraction.parking_mode) patch.parking_mode = extraction.parking_mode;
  if (extraction.parking_spots !== null) {
    patch.parking_spots = extraction.parking_spots;
    patch.auto_parking = false;
  }
  if (extraction.complex_soil !== null) patch.complex_soil = extraction.complex_soil;
  if (extraction.complex_slope !== null) patch.complex_slope = extraction.complex_slope;
  return patch;
}

function formatAiValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? fmt(value) : String(Math.round(value * 100) / 100);
  if (value === null || value === undefined) return "not set";
  return String(value);
}

const VISION_RISK_LABELS: Record<string, string> = {
  apparent_slope: "Apparent slope",
  limited_road_access: "Limited road access",
  dense_context: "Dense context",
  visible_site_constraints: "Visible site constraints",
  uncertain_image: "Image uncertainty",
};

type GeoRegionSuggestion = {
  region: Region | null;
  confidence: ConfidenceLevel;
  method: "coordinates" | "address" | "none";
  reason: string;
  warnings: string[];
};

const CITY_BOUNDS: Array<{ region: Region; label: string; lat: [number, number]; lon: [number, number]; keywords: string[] }> = [
  { region: "Almaty", label: "Almaty", lat: [42.95, 43.45], lon: [76.65, 77.25], keywords: ["almaty", "алматы", "алма-ата"] },
  { region: "Astana", label: "Astana", lat: [50.95, 51.35], lon: [71.15, 71.75], keywords: ["astana", "астана", "nur-sultan", "nursultan", "нур-султан"] },
  { region: "Shymkent", label: "Shymkent", lat: [42.15, 42.55], lon: [69.35, 70.05], keywords: ["shymkent", "шымкент", "чимкент"] },
  { region: "Aktobe", label: "Aktobe", lat: [50.05, 50.45], lon: [56.65, 57.45], keywords: ["aktobe", "актобе", "ақтөбе"] },
];

function deriveGeoRegion(value: CostPlacementDraft): GeoRegionSuggestion {
  const warnings: string[] = [];
  const lat = value.site_latitude;
  const lon = value.site_longitude;
  const hasLat = typeof lat === "number" && Number.isFinite(lat);
  const hasLon = typeof lon === "number" && Number.isFinite(lon);

  if (hasLat || hasLon) {
    if (!hasLat || !hasLon) {
      return {
        region: null,
        confidence: "low",
        method: "coordinates",
        reason: "Both latitude and longitude are required for coordinate matching.",
        warnings: ["Incomplete coordinate pair"],
      };
    }

    if (lat < 40 || lat > 56 || lon < 46 || lon > 88) {
      warnings.push("Coordinates are outside a coarse Kazakhstan bounding box");
    }

    const match = CITY_BOUNDS.find((city) => lat >= city.lat[0] && lat <= city.lat[1] && lon >= city.lon[0] && lon <= city.lon[1]);
    if (match) {
      return {
        region: match.region,
        confidence: "high",
        method: "coordinates",
        reason: `Coordinates fall inside the coarse ${match.label} city bounding box.`,
        warnings,
      };
    }

    return {
      region: "default",
      confidence: "low",
      method: "coordinates",
      reason: "Coordinates do not match the MVP city boxes; using default regional coefficient.",
      warnings: [...warnings, "No official GIS/cadastre lookup attached"],
    };
  }

  const address = value.site_address.trim().toLowerCase();
  if (address) {
    const match = CITY_BOUNDS.find((city) => city.keywords.some((keyword) => address.includes(keyword)));
    if (match) {
      return {
        region: match.region,
        confidence: "medium",
        method: "address",
        reason: `Address text contains ${match.label}.`,
        warnings: ["Address matching is keyword-based, not official geocoding"],
      };
    }

    return {
      region: null,
      confidence: "low",
      method: "address",
      reason: "Address text does not contain a supported MVP city name.",
      warnings: ["No official geocoding source attached"],
    };
  }

  return {
    region: null,
    confidence: "low",
    method: "none",
    reason: "No address or coordinates provided.",
    warnings: ["No geo input provided"],
  };
}

type AiReviewRow = {
  key: string;
  label: string;
  current: unknown;
  next: unknown;
  changed: boolean;
};

function buildAiReviewRows(value: CostPlacementDraft, extraction: CostInputExtractionResponse["extraction"]): AiReviewRow[] {
  const patch = extractionToDraftPatch(extraction);
  const rows: AiReviewRow[] = Object.entries(patch)
    .filter(([key]) => key !== "auto_parking" && Object.prototype.hasOwnProperty.call(COST_AI_FIELD_LABELS, key))
    .map(([key, next]) => ({
      key,
      label: COST_AI_FIELD_LABELS[key],
      current: value[key as keyof CostPlacementDraft],
      next,
      changed: formatAiValue(value[key as keyof CostPlacementDraft]) !== formatAiValue(next),
    }));

  if (extraction.object_type) {
    rows.unshift({
      key: "object_type",
      label: COST_AI_FIELD_LABELS.object_type,
      current: value.costAssumptions.objectType,
      next: extraction.object_type,
      changed: formatAiValue(value.costAssumptions.objectType) !== formatAiValue(extraction.object_type),
    });
  }

  return rows;
}

function buildSelectedAiPatch(extraction: CostInputExtractionResponse["extraction"], selectedFields: string[]): Partial<CostPlacementDraft> {
  const selected = new Set(selectedFields);
  const patch: Partial<CostPlacementDraft> = {};
  const extractedPatch = extractionToDraftPatch(extraction);

  for (const [key, next] of Object.entries(extractedPatch)) {
    if (key === "auto_parking") continue;
    if (selected.has(key)) {
      patch[key as keyof CostPlacementDraft] = next as never;
    }
  }

  if (selected.has("parking_spots") && extraction.parking_spots !== null) {
    patch.auto_parking = false;
  }

  return patch;
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
  const [calibrationImportError, setCalibrationImportError] = useState<string | null>(null);
  const [aiBrief, setAiBrief] = useState("");
  const [aiExtraction, setAiExtraction] = useState<CostInputExtractionResponse | null>(null);
  const [aiSelectedFields, setAiSelectedFields] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [visionAnalysis, setVisionAnalysis] = useState<SiteImageRiskAnalysisResponse | null>(null);
  const [visionSelectedFlags, setVisionSelectedFlags] = useState<string[]>([]);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const model = useMemo(() => buildCostPlacementModel(value), [value]);
  const selected = model.rows.find((row) => row.placement.variant_key === value.selected_variant_key) ?? model.rows[0];
  const cheapest = model.rows.find((row) => row.isCheapest) ?? model.rows[0];
  const geoSuggestion = deriveGeoRegion(value);

  const update = <K extends keyof CostPlacementDraft>(key: K, next: CostPlacementDraft[K]) => {
    const fieldSources = Object.prototype.hasOwnProperty.call(COST_AI_FIELD_LABELS, key)
      ? { ...(value.costAssumptions.fieldSources ?? {}), [key]: "manual" as AssumptionFieldSource }
      : (value.costAssumptions.fieldSources ?? {});
    onChange({ ...value, [key]: next, costAssumptions: { ...value.costAssumptions, fieldSources } });
  };
  const updateCostParam = <K extends keyof CostParams>(key: K, next: CostParams[K]) => {
    onChange({
      ...value,
      costParams: { ...value.costParams, [key]: next },
      costAssumptions: {
        ...value.costAssumptions,
        fieldSources: { ...(value.costAssumptions.fieldSources ?? {}), [String(key)]: "manual" },
      },
    });
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
    const nextFieldSources = {
      ...(value.costAssumptions.fieldSources ?? {}),
      ...Object.fromEntries(parsed.recognizedKeys.map((key) => [key, "client_uploaded" as AssumptionFieldSource])),
    };
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
        fieldSources: nextFieldSources,
      },
    });
  };

  const handleCalibrationUpload = async (file: File) => {
    setCalibrationImportError(null);
    const text = await file.text();
    const parsed = parseCalibrationDatasetCsv(text);
    if (parsed.rows.length === 0) {
      setCalibrationImportError(parsed.warnings[0] ?? "No valid historical project rows were found.");
      onChange({
        ...value,
        costAssumptions: {
          ...value.costAssumptions,
          calibrationRows: [],
          calibrationImportedAt: new Date().toISOString().slice(0, 10),
          calibrationImportWarnings: parsed.warnings,
        },
      });
      return;
    }

    onChange({
      ...value,
      costAssumptions: {
        ...value.costAssumptions,
        calibrationRows: parsed.rows,
        calibrationImportedAt: new Date().toISOString().slice(0, 10),
        calibrationImportWarnings: parsed.warnings,
      },
    });
  };

  const exportCalibrationTemplate = () => {
    downloadCsv("plana-calibration-template.csv", [
      CALIBRATION_TEMPLATE_HEADERS,
      [
        "KZ-ALM-001",
        "Almaty comfort residential benchmark",
        "Almaty",
        "multifamily residential",
        "comfort",
        18000,
        3200,
        12,
        1,
        "mixed",
        320,
        "false",
        "false",
        4200000000,
        "2026",
        "Verified internal project cost closeout",
        "draft",
        "Example row. Replace with actual verified outcome data.",
      ],
    ]);
  };

  const exportCostReport = () => {
    const rows = buildCostReportRows({
      selected,
      cheapest,
      assumptions: model.assumptions,
      building: model.building,
      draft: value,
    });
    downloadCsv(`plana-cost-report-${selected.placement.variant_key}.csv`, rows);
  };

  const analyzeCostBrief = async () => {
    if (!aiBrief.trim()) {
      setAiError("Paste a project brief first.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await extractCostInputsFromBrief(aiBrief);
      setAiExtraction(result);
      const reviewRows = buildAiReviewRows(value, result.extraction);
      setAiSelectedFields(reviewRows.filter((row) => row.changed).map((row) => row.key));
    } catch (error) {
      setAiError((error as Error).message || "AI extraction failed");
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiExtraction = () => {
    if (!aiExtraction) return;
    const selected = new Set(aiSelectedFields);
    const allReviewFields = buildAiReviewRows(value, aiExtraction.extraction).map((row) => row.key);
    const patch = buildSelectedAiPatch(aiExtraction.extraction, aiSelectedFields);
    const appliedFields = aiSelectedFields.filter((key) => Object.prototype.hasOwnProperty.call(COST_AI_FIELD_LABELS, key));
    const rejectedFields = allReviewFields.filter((key) => !selected.has(key));
    const nextFieldSources = {
      ...(value.costAssumptions.fieldSources ?? {}),
      ...Object.fromEntries(appliedFields.map((field) => [field, "ai_extracted" as AssumptionFieldSource])),
    };

    onChange({
      ...value,
      ...patch,
      costAssumptions: {
        ...value.costAssumptions,
        objectType: selected.has("object_type") && aiExtraction.extraction.object_type
          ? aiExtraction.extraction.object_type
          : value.costAssumptions.objectType,
        aiExtractedAt: new Date().toISOString().slice(0, 10),
        aiModelUsed: aiExtraction.model_used,
        aiConfidenceLevel: aiExtraction.extraction.confidence_level,
        aiAppliedFields: appliedFields,
        aiRejectedFields: rejectedFields,
        aiMissingDataWarnings: aiExtraction.extraction.missing_data_warnings,
        fieldSources: nextFieldSources,
      },
    });
  };
  const toggleAiField = (field: string) => {
    setAiSelectedFields((current) =>
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field],
    );
  };
  const aiReviewRows = aiExtraction ? buildAiReviewRows(value, aiExtraction.extraction) : [];
  const applyGeoRegion = () => {
    if (!geoSuggestion.region) return;
    onChange({
      ...value,
      region: geoSuggestion.region,
      costAssumptions: {
        ...value.costAssumptions,
        geoAddress: value.site_address.trim() || null,
        geoCoordinates: value.site_latitude !== null && value.site_longitude !== null
          ? `${value.site_latitude}, ${value.site_longitude}`
          : null,
        geoRegionConfidence: geoSuggestion.confidence,
        geoWarnings: geoSuggestion.warnings,
        fieldSources: {
          ...(value.costAssumptions.fieldSources ?? {}),
          region: "manual",
          geo_region: "manual",
        },
      },
    });
  };
  const analyzeSitePhoto = async (file: File) => {
    setVisionLoading(true);
    setVisionError(null);
    try {
      const result = await analyzeSiteImageRisks(file);
      setVisionAnalysis(result);
      setVisionSelectedFlags(result.analysis.risk_flags.filter((flag) => flag.suggested_value).map((flag) => flag.key));
    } catch (error) {
      setVisionError((error as Error).message || "Site image analysis failed");
    } finally {
      setVisionLoading(false);
    }
  };
  const toggleVisionFlag = (key: string) => {
    setVisionSelectedFlags((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };
  const applyVisionFlags = () => {
    if (!visionAnalysis) return;
    const selected = new Set(visionSelectedFlags);
    const flags = visionAnalysis.analysis.risk_flags;
    const appliedFlags = flags.filter((flag) => selected.has(flag.key)).map((flag) => flag.key);
    const rejectedFlags = flags.filter((flag) => !selected.has(flag.key)).map((flag) => flag.key);
    const applySlope = flags.some((flag) => flag.key === "apparent_slope" && selected.has(flag.key) && flag.suggested_value);
    const selectedWarnings = flags
      .filter((flag) => selected.has(flag.key))
      .map((flag) => `${flag.label}: ${flag.reason}`);

    onChange({
      ...value,
      complex_slope: applySlope ? true : value.complex_slope,
      costAssumptions: {
        ...value.costAssumptions,
        visionAnalyzedAt: new Date().toISOString().slice(0, 10),
        visionModelUsed: visionAnalysis.model_used,
        visionConfidenceLevel: visionAnalysis.analysis.confidence_level,
        visionAppliedFlags: appliedFlags,
        visionRejectedFlags: rejectedFlags,
        visionWarnings: [
          ...visionAnalysis.analysis.missing_data_warnings,
          ...selectedWarnings,
        ],
        fieldSources: {
          ...(value.costAssumptions.fieldSources ?? {}),
          ...(applySlope ? { complex_slope: "vision_extracted" as AssumptionFieldSource } : {}),
          ...Object.fromEntries(appliedFlags.map((flag) => [`vision_${flag}`, "vision_extracted" as AssumptionFieldSource])),
        },
      },
    });
  };
  const explainSelectedCost = async () => {
    setAnalystLoading(true);
    setAnalystError(null);
    try {
      const response = await explainCostSnapshot({
        selected_variant: selected.placement.variant_key,
        cost_snapshot: {
          total_estimate: selected.cost.total_estimate,
          total_low: selected.cost.range_low,
          total_high: selected.cost.range_high,
          cost_per_gfa_m2: selected.costPerGfaM2,
          cost_per_sellable_m2: selected.costPerSellableM2,
          cost_buckets: selected.costBuckets,
          revenue_estimate: selected.revenueEstimate,
          gross_margin_before_land: selected.grossMarginBeforeLand,
          gross_margin_pct: selected.grossMarginPct,
          feasibility: selected.feasibility,
          selected_variant_delta_to_cheapest: selected.deltaToCheapest,
        },
        assumptions: {
          region: model.assumptions.region,
          building_class: model.assumptions.buildingClass,
          rate_source_type: model.assumptions.rateSourceType,
          base_rate_above_ground: model.assumptions.baseRateAboveGround,
          region_coefficient: model.assumptions.regionCoefficient,
          class_coefficient: model.assumptions.classCoefficient,
          contingency_pct: model.assumptions.contingencyPct,
          vat_included: model.assumptions.vatIncluded,
          included_items: model.assumptions.includedItems,
          excluded_items: model.assumptions.excludedItems,
        },
        source_registry: model.assumptions.sourceRegistry as unknown as Array<Record<string, unknown>>,
        missing_data_warnings: model.assumptions.missingDataWarnings,
      });

      onChange({
        ...value,
        costAssumptions: {
          ...value.costAssumptions,
          analystExplainedAt: new Date().toISOString().slice(0, 10),
          analystModelUsed: response.model_used,
          analystExplanation: response.explanation,
        },
      });
    } catch (error) {
      setAnalystError((error as Error).message || "AI analyst explanation failed");
    } finally {
      setAnalystLoading(false);
    }
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
            <Panel title="AI brief extraction" icon={<Info size={13} className="text-violet-300" />}>
              <div className="rounded-xl border border-violet-300/10 bg-violet-300/[0.045] px-3 py-2 text-[10.5px] leading-relaxed text-violet-100/65">
                GPT extracts assumptions only. It never calculates the Class 5 total.
              </div>
              <textarea
                data-testid="cost-ai-brief"
                value={aiBrief}
                onChange={(event) => setAiBrief(event.target.value)}
                placeholder="Example: ЖК comfort class in Almaty, 12 floors, 80x120 m site, 24,000 m2 above ground, 1 underground level..."
                className="min-h-24 w-full resize-y rounded-lg bg-black/20 border border-white/[0.08] px-2.5 py-2 text-[11.5px] leading-relaxed text-white/75 outline-none focus:border-violet-300/35 placeholder:text-white/25"
              />
              <button
                type="button"
                data-testid="cost-ai-analyze"
                onClick={analyzeCostBrief}
                disabled={aiLoading}
                className="w-full rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-[11.5px] font-medium text-violet-100/80 hover:bg-violet-300/15 disabled:opacity-50"
              >
                {aiLoading ? "Analyzing with GPT..." : "Analyze brief with GPT"}
              </button>
              {aiError && (
                <div data-testid="cost-ai-error" className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1.5 text-[10.5px] text-rose-100/75">
                  {aiError}
                </div>
              )}
              {aiExtraction && (
                <div data-testid="cost-ai-preview" className="rounded-xl border border-white/[0.06] bg-black/10 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11.5px] font-medium text-white/78">Extracted assumptions</div>
                      <div className="text-[10px] text-white/35">{aiExtraction.model_used} · {aiExtraction.extraction.confidence_level} confidence</div>
                    </div>
                    <button
                      type="button"
                      data-testid="cost-ai-apply"
                      onClick={applyAiExtraction}
                      disabled={aiSelectedFields.length === 0}
                      className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1.5 text-[10.5px] text-emerald-100/80 hover:bg-emerald-300/15 disabled:opacity-45"
                    >
                      Apply selected ({aiSelectedFields.length})
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="cost-ai-select-changed"
                      onClick={() => setAiSelectedFields(aiReviewRows.filter((row) => row.changed).map((row) => row.key))}
                      className="rounded-md border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-[10px] text-white/55 hover:text-white/75"
                    >
                      Select changed
                    </button>
                    <button
                      type="button"
                      data-testid="cost-ai-clear-selection"
                      onClick={() => setAiSelectedFields([])}
                      className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] text-white/45 hover:text-white/65"
                    >
                      Clear
                    </button>
                    <div className="ml-auto text-[10px] text-white/35">Current → GPT</div>
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {aiReviewRows.map((row) => (
                      <label
                        key={row.key}
                        data-testid={`cost-ai-field-${row.key}`}
                        className={[
                          "grid grid-cols-[18px_0.85fr_0.85fr_0.85fr] items-center gap-2 rounded-lg border px-2 py-1.5 text-[10.5px]",
                          aiSelectedFields.includes(row.key)
                            ? "border-violet-300/20 bg-violet-300/[0.06]"
                            : "border-white/[0.045] bg-white/[0.02]",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={aiSelectedFields.includes(row.key)}
                          onChange={() => toggleAiField(row.key)}
                          className="h-3.5 w-3.5 accent-violet-400"
                        />
                        <span className="text-white/50">{row.label}</span>
                        <span className="truncate text-right text-white/35" title={formatAiValue(row.current)}>
                          {formatAiValue(row.current)}
                        </span>
                        <span className={["truncate text-right", row.changed ? "text-violet-100/80" : "text-white/45"].join(" ")} title={formatAiValue(row.next)}>
                          {formatAiValue(row.next)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {aiExtraction.extraction.missing_data_warnings.length > 0 && (
                    <div className="space-y-1">
                      {aiExtraction.extraction.missing_data_warnings.slice(0, 3).map((warning) => (
                        <div key={warning} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[10px] text-amber-100/70">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Panel>
            <Panel title="Site photo risk analysis" icon={<Info size={13} className="text-cyan-300" />}>
              <div className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.045] px-3 py-2 text-[10.5px] leading-relaxed text-cyan-100/65">
                GPT Vision suggests visible risk flags only. It does not measure engineering conditions or calculate cost.
              </div>
              <label className="block">
                <span className="block text-[10.5px] text-white/35 mb-1">Upload site photo / aerial image</span>
                <input
                  data-testid="cost-vision-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={visionLoading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void analyzeSitePhoto(file);
                    event.currentTarget.value = "";
                  }}
                  className="block w-full text-[11px] text-white/55 file:mr-3 file:rounded-lg file:border file:border-cyan-300/20 file:bg-cyan-300/10 file:px-3 file:py-1.5 file:text-[10.5px] file:text-cyan-100/80 hover:file:bg-cyan-300/15"
                />
              </label>
              {visionLoading && (
                <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-1.5 text-[10.5px] text-cyan-100/70">
                  Analyzing image with GPT Vision...
                </div>
              )}
              {visionError && (
                <div data-testid="cost-vision-error" className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1.5 text-[10.5px] text-rose-100/75">
                  {visionError}
                </div>
              )}
              {visionAnalysis && (
                <div data-testid="cost-vision-preview" className="rounded-xl border border-white/[0.06] bg-black/10 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11.5px] font-medium text-white/78">Visible risk flags</div>
                      <div className="text-[10px] text-white/35">{visionAnalysis.model_used} · {visionAnalysis.analysis.confidence_level} confidence</div>
                    </div>
                    <button
                      type="button"
                      data-testid="cost-vision-apply"
                      disabled={visionSelectedFlags.length === 0}
                      onClick={applyVisionFlags}
                      className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1.5 text-[10.5px] text-emerald-100/80 hover:bg-emerald-300/15 disabled:opacity-45"
                    >
                      Apply selected ({visionSelectedFlags.length})
                    </button>
                  </div>
                  <div className="space-y-1">
                    {visionAnalysis.analysis.risk_flags.map((flag) => (
                      <label
                        key={flag.key}
                        data-testid={`cost-vision-flag-${flag.key}`}
                        className={[
                          "grid grid-cols-[18px_1fr_auto] items-start gap-2 rounded-lg border px-2 py-1.5 text-[10.5px]",
                          visionSelectedFlags.includes(flag.key)
                            ? "border-cyan-300/20 bg-cyan-300/[0.06]"
                            : "border-white/[0.045] bg-white/[0.02]",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={visionSelectedFlags.includes(flag.key)}
                          onChange={() => toggleVisionFlag(flag.key)}
                          className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
                        />
                        <span>
                          <span className="block text-white/65">{flag.label}</span>
                          <span className="block text-white/38">{flag.reason}</span>
                        </span>
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[9.5px] uppercase text-white/45">
                          {flag.severity}
                        </span>
                      </label>
                    ))}
                  </div>
                  {visionAnalysis.analysis.missing_data_warnings.slice(0, 3).map((warning) => (
                    <div key={warning} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[10px] text-amber-100/70">
                      {warning}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Участок" icon={<MapIcon size={13} className="text-emerald-300" />}>
              <SelectField label="Регион" value={value.region} onChange={(v) => update("region", v as Region)}
                options={[["Almaty", "Алматы"], ["Astana", "Астана"], ["Shymkent", "Шымкент"], ["Aktobe", "Актобе"], ["default", "Другой"]]} />
              <TextField
                label="Address / geo hint"
                testId="cost-geo-address"
                value={value.site_address}
                placeholder="Алматы, Бостандыкский район..."
                onChange={(next) => update("site_address", next)}
              />
              <div className="grid grid-cols-2 gap-2">
                <NullableNumberField label="Latitude" testId="cost-geo-latitude" value={value.site_latitude} step={0.000001} onChange={(v) => update("site_latitude", v)} />
                <NullableNumberField label="Longitude" testId="cost-geo-longitude" value={value.site_longitude} step={0.000001} onChange={(v) => update("site_longitude", v)} />
              </div>
              <div data-testid="cost-geo-suggestion" className="rounded-xl border border-emerald-300/10 bg-emerald-300/[0.045] p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-emerald-100/80">
                      Geo suggestion: {geoSuggestion.region ? regionLabel(geoSuggestion.region) : "not matched"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/40">
                      {geoSuggestion.method} · {geoSuggestion.confidence} confidence
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="cost-geo-apply"
                    disabled={!geoSuggestion.region}
                    onClick={applyGeoRegion}
                    className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1.5 text-[10.5px] text-emerald-100/80 hover:bg-emerald-300/15 disabled:opacity-40"
                  >
                    Apply region
                  </button>
                </div>
                <div className="text-[10.5px] leading-relaxed text-white/50">{geoSuggestion.reason}</div>
                {geoSuggestion.warnings.length > 0 && (
                  <div className="space-y-1">
                    {geoSuggestion.warnings.map((warning) => (
                      <div key={warning} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[10px] text-amber-100/70">
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

            <Panel title="Calibration dataset path" icon={<BarChart3 size={13} className="text-blue-300" />}>
              <div className="rounded-xl border border-blue-300/10 bg-blue-300/[0.045] px-3 py-2 text-[10.5px] leading-relaxed text-blue-100/65">
                Collect verified historical project outcomes for future ML calibration. This import does not change current Class 5 totals.
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11.5px] font-medium text-white/75">Historical costs CSV</div>
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-white/35">
                      Required: project_id, region, GFA, actual cost, source, verification status.
                    </div>
                  </div>
                  <label className="shrink-0 cursor-pointer rounded-lg border border-blue-300/20 bg-blue-300/10 px-2.5 py-1.5 text-[10.5px] text-blue-100/80 hover:bg-blue-300/15">
                    Import
                    <input
                      data-testid="cost-calibration-upload"
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void handleCalibrationUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <div data-testid="cost-calibration-status" className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-white/42">
                  <div>
                    {value.costAssumptions.calibrationRows.length > 0
                      ? `${value.costAssumptions.calibrationRows.length} historical row(s) imported on ${value.costAssumptions.calibrationImportedAt ?? "unknown date"}`
                      : "No historical outcome dataset imported yet."}
                  </div>
                  <div className="text-amber-100/70">No predictive ML model is trained until enough verified data exists.</div>
                </div>
                {calibrationImportError && (
                  <div data-testid="cost-calibration-error" className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1.5 text-[10.5px] text-rose-100/75">
                    {calibrationImportError}
                  </div>
                )}
                {value.costAssumptions.calibrationImportWarnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {value.costAssumptions.calibrationImportWarnings.slice(0, 3).map((warning) => (
                      <div key={warning} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[10px] text-amber-100/70">
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid="cost-calibration-template"
                onClick={exportCalibrationTemplate}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[11px] font-medium text-white/65 hover:bg-white/[0.055]"
              >
                Download calibration CSV template
              </button>
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
                      <div className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10px] text-white/45">
                        {selected.cost.total_estimate > 0
                          ? `${Math.round((selected.cost.range_low / selected.cost.total_estimate - 1) * 100)}% / +${Math.round((selected.cost.range_high / selected.cost.total_estimate - 1) * 100)}%`
                          : "−20% / +30%"}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <RangeStat label="Low" value={`${fmt(selected.cost.range_low)} ₸`} />
                      <RangeStat label="Expected" value={`${fmt(selected.cost.total_estimate)} ₸`} active />
                      <RangeStat label="High" value={`${fmt(selected.cost.range_high)} ₸`} />
                    </div>
                  </div>

                  <div data-testid="cost-report-export" className="mb-4 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.035] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">Shareable cost report</div>
                        <div className="mt-0.5 text-[10.5px] leading-relaxed text-white/42">
                          CSV includes Class 5 range, buckets, included/excluded items, source registry, warnings, and AI confirmation metadata.
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="cost-report-export-csv"
                        onClick={exportCostReport}
                        className="shrink-0 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[10.5px] font-medium text-emerald-100/80 hover:bg-emerald-300/15"
                      >
                        Export CSV
                      </button>
                    </div>
                    <div className="mt-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.06] px-2 py-1.5 text-[10.5px] text-amber-100/70">
                      Screening estimate, not official Kazakhstan estimate documentation.
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

                  <div data-testid="cost-analyst-explanation" className="mb-4 rounded-xl border border-violet-300/10 bg-violet-300/[0.035] p-3.5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-[12.5px] font-medium text-white/85">AI cost analyst</div>
                        <div className="text-[10.5px] text-white/38">Explains the deterministic Class 5 estimate. It does not recalculate totals.</div>
                      </div>
                      <button
                        type="button"
                        data-testid="cost-analyst-generate"
                        onClick={explainSelectedCost}
                        disabled={analystLoading}
                        className="rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-[10.5px] font-medium text-violet-100/80 hover:bg-violet-300/15 disabled:opacity-45"
                      >
                        {analystLoading ? "Explaining..." : "Explain with GPT"}
                      </button>
                    </div>
                    {analystError && (
                      <div data-testid="cost-analyst-error" className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1.5 text-[10.5px] text-rose-100/75">
                        {analystError}
                      </div>
                    )}
                    {model.assumptions.analystExplanation ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-white/30 mb-1">
                            {model.assumptions.analystModelUsed ?? "GPT"} · {model.assumptions.analystExplanation.confidence_level} confidence · {model.assumptions.analystExplainedAt ?? "not recorded"}
                          </div>
                          <div className="text-[12px] leading-relaxed text-white/75">{model.assumptions.analystExplanation.summary}</div>
                        </div>
                        <AnalystBulletGroup title="Key drivers" items={model.assumptions.analystExplanation.key_drivers} />
                        <AnalystBulletGroup title="Risks" items={model.assumptions.analystExplanation.risk_notes} tone="warn" />
                        <AnalystBulletGroup title="Missing data" items={model.assumptions.analystExplanation.missing_data} tone="warn" />
                        <AnalystBulletGroup title="Next documents" items={model.assumptions.analystExplanation.next_documents} />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-[10.5px] leading-relaxed text-white/45">
                        Generate a short analyst note after rates, AI inputs, geo, or site-photo risks are confirmed.
                      </div>
                    )}
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
  const aiMissingDataWarnings = state.aiMissingDataWarnings ?? [];
  const geoWarnings = state.geoWarnings ?? [];
  const visionWarnings = state.visionWarnings ?? [];
  const fieldSources = state.fieldSources ?? {};
  const sourceRegistry = buildSourceRegistry({ state, manualRates, uploadedRates, fieldSources });
  const missingDataWarnings = [
    "No geotechnical report attached",
    "No exact slope/topography survey attached",
    value.auto_parking ? "No official parking norm selected" : null,
    uploadedRates ? "Client uploaded screening rates are used" : manualRates ? "Manual screening rates are used" : "Placeholder rates are used",
    ...aiMissingDataWarnings.map((warning) => `AI extraction: ${warning}`),
    ...geoWarnings.map((warning) => `Geo: ${warning}`),
    ...visionWarnings.map((warning) => `Vision: ${warning}`),
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
    aiExtractedAt: state.aiExtractedAt,
    aiModelUsed: state.aiModelUsed,
    aiConfidenceLevel: state.aiConfidenceLevel,
    aiAppliedFields: state.aiAppliedFields ?? [],
    aiRejectedFields: state.aiRejectedFields ?? [],
    aiMissingDataWarnings,
    fieldSources,
    geoAddress: state.geoAddress ?? (value.site_address.trim() || null),
    geoCoordinates: state.geoCoordinates ?? (
      value.site_latitude !== null && value.site_longitude !== null
        ? `${value.site_latitude}, ${value.site_longitude}`
        : null
    ),
    geoRegionConfidence: state.geoRegionConfidence ?? null,
    geoWarnings,
    visionAnalyzedAt: state.visionAnalyzedAt ?? null,
    visionModelUsed: state.visionModelUsed ?? null,
    visionConfidenceLevel: state.visionConfidenceLevel ?? null,
    visionAppliedFlags: state.visionAppliedFlags ?? [],
    visionRejectedFlags: state.visionRejectedFlags ?? [],
    visionWarnings,
    sourceRegistry,
    analystExplainedAt: state.analystExplainedAt ?? null,
    analystModelUsed: state.analystModelUsed ?? null,
    analystExplanation: state.analystExplanation ?? null,
    calibrationRows: state.calibrationRows ?? [],
    calibrationImportedAt: state.calibrationImportedAt ?? null,
    calibrationImportWarnings: state.calibrationImportWarnings ?? [],
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
        {assumptions.geoAddress && <AssumptionRow label="Geo address" value={assumptions.geoAddress} muted />}
        {assumptions.geoCoordinates && <AssumptionRow label="Geo coordinates" value={assumptions.geoCoordinates} muted />}
        {assumptions.geoRegionConfidence && <AssumptionRow label="Geo confidence" value={assumptions.geoRegionConfidence} warn={assumptions.geoRegionConfidence !== "high"} />}
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
        {assumptions.aiModelUsed && (
          <>
            <AssumptionRow label="AI extraction" value="brief-to-inputs only" warn={assumptions.aiConfidenceLevel !== "high"} />
            <AssumptionRow label="AI model" value={assumptions.aiModelUsed} />
            <AssumptionRow label="AI extracted" value={assumptions.aiExtractedAt ?? "not recorded"} />
            <AssumptionRow label="AI confidence" value={assumptions.aiConfidenceLevel ?? "low"} warn={assumptions.aiConfidenceLevel !== "high"} />
            <AssumptionRow
              label="AI-applied fields"
              value={assumptions.aiAppliedFields.map((key) => COST_AI_FIELD_LABELS[key as CostAiField] ?? key).join(", ")}
              muted
              help="GPT normalizes the user brief into form inputs. Cost totals still come from deterministic formulas."
            />
            {assumptions.aiRejectedFields.length > 0 && (
              <AssumptionRow
                label="AI-rejected fields"
                value={assumptions.aiRejectedFields.map((key) => COST_AI_FIELD_LABELS[key as CostAiField] ?? key).join(", ")}
                warn
                help="Fields were visible in the GPT diff but were not applied by the user."
              />
            )}
            <AssumptionRow
              label="Field sources"
              value={Object.entries(assumptions.fieldSources)
                .filter(([key]) => key === "geo_region" || key.startsWith("vision_") || Object.prototype.hasOwnProperty.call(COST_AI_FIELD_LABELS, key) || Object.prototype.hasOwnProperty.call(COST_RATE_IMPORT_KEY_LABELS, key))
                .map(([key, source]) => `${sourceFieldLabel(key)}: ${source}`)
                .join(", ")}
              muted
            />
          </>
        )}
        {assumptions.visionModelUsed && (
          <>
            <AssumptionRow label="Vision analysis" value="site image risk flags only" warn={assumptions.visionConfidenceLevel !== "high"} />
            <AssumptionRow label="Vision model" value={assumptions.visionModelUsed} />
            <AssumptionRow label="Vision analyzed" value={assumptions.visionAnalyzedAt ?? "not recorded"} />
            <AssumptionRow label="Vision confidence" value={assumptions.visionConfidenceLevel ?? "low"} warn={assumptions.visionConfidenceLevel !== "high"} />
            <AssumptionRow
              label="Vision-applied flags"
              value={assumptions.visionAppliedFlags.map((key) => VISION_RISK_LABELS[key] ?? key).join(", ")}
              muted
              help="Vision flags are screening hints only. Cost totals still come from deterministic formulas."
            />
            {assumptions.visionRejectedFlags.length > 0 && (
              <AssumptionRow
                label="Vision-rejected flags"
                value={assumptions.visionRejectedFlags.map((key) => VISION_RISK_LABELS[key] ?? key).join(", ")}
                warn
              />
            )}
          </>
        )}
      </AssumptionSection>

      <AssumptionSection title="G) Source Registry">
        <div data-testid="cost-source-registry" className="space-y-2">
          {assumptions.sourceRegistry.length === 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10.5px] text-white/40">
              No source registry entries yet.
            </div>
          )}
          {assumptions.sourceRegistry.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-white/75">{entry.label}</div>
                  <div className="text-[10px] text-white/35">{entry.sourceName}</div>
                </div>
                <span className={["rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide", sourceBadgeClass(entry.sourceType)].join(" ")}>
                  {entry.sourceType}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-white/42">
                <span>Year: <span className="text-white/62">{entry.sourceYear}</span></span>
                <span className="text-right">Confidence: <span className={entry.confidenceLevel === "low" ? "text-amber-200" : "text-white/62"}>{entry.confidenceLevel}</span></span>
                <span className="col-span-2">Updated: <span className="text-white/62">{entry.lastUpdated}</span></span>
              </div>
              <div className="text-[10px] leading-relaxed text-white/42">
                Applies to: <span className="text-white/62">{entry.appliesTo.join(", ")}</span>
              </div>
              <div className="text-[10px] leading-relaxed text-white/35">{entry.note}</div>
            </div>
          ))}
        </div>
      </AssumptionSection>

      <AssumptionSection title="H) Calibration Dataset Path">
        <div data-testid="cost-calibration-assumptions" className="space-y-2">
          <AssumptionRow label="Imported rows" value={String(assumptions.calibrationRows.length)} warn={assumptions.calibrationRows.length === 0} />
          <AssumptionRow label="Imported at" value={assumptions.calibrationImportedAt ?? "not imported"} muted={!assumptions.calibrationImportedAt} />
          <AssumptionRow
            label="ML status"
            value="No predictive ML model is trained until enough verified data exists"
            warn
            help="Historical rows are stored for future calibration only and do not modify current deterministic totals."
          />
          <AssumptionRow
            label="Required fields"
            value="project_id, region, building_class, GFA, actual cost, cost year, source, verification status"
            muted
          />
          {assumptions.calibrationRows.slice(0, 2).map((row) => (
            <div key={row.projectId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10.5px] text-white/52">
              {row.projectName}: {fmt(row.actualTotalCostKzt)} KZT, {fmt(row.gfaAboveGroundM2)} m2, {row.verificationStatus}
            </div>
          ))}
          {assumptions.calibrationImportWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-1.5 rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1.5 text-[10.5px] text-amber-100/75">
              <AlertCircle size={10} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
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

function sourceBadgeClass(sourceType: CostSourceType): string {
  if (sourceType === "placeholder") return "border-amber-300/20 bg-amber-300/[0.08] text-amber-100/70";
  if (sourceType === "official") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/75";
  if (sourceType === "market_calibrated") return "border-sky-300/20 bg-sky-300/[0.08] text-sky-100/75";
  if (sourceType === "client_uploaded") return "border-blue-300/20 bg-blue-300/[0.08] text-blue-100/75";
  if (sourceType === "ai_extracted") return "border-violet-300/20 bg-violet-300/[0.08] text-violet-100/75";
  if (sourceType === "vision_extracted") return "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100/75";
  return "border-white/[0.08] bg-white/[0.04] text-white/60";
}

function AnalystBulletGroup({ title, items, tone = "base" }: { title: string; items: string[]; tone?: "base" | "warn" }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/30 mb-1.5">{title}</div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className={["text-[10.8px] leading-relaxed", tone === "warn" ? "text-amber-100/72" : "text-white/65"].join(" ")}>
            - {item}
          </li>
        ))}
      </ul>
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

function NullableNumberField({ label, value, step = 1, testId, onChange }: {
  label: string;
  value: number | null;
  step?: number;
  testId?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-white/35 mb-1">{label}</span>
      <input
        type="number"
        data-testid={testId}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full h-9 rounded-lg bg-black/20 border border-white/[0.08] px-2.5 text-[12px] text-white/80 outline-none focus:border-white/25"
      />
    </label>
  );
}

function TextField({ label, value, testId, placeholder, onChange }: {
  label: string;
  value: string;
  testId?: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-white/35 mb-1">{label}</span>
      <input
        type="text"
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg bg-black/20 border border-white/[0.08] px-2.5 text-[12px] text-white/80 outline-none focus:border-white/25 placeholder:text-white/25"
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
