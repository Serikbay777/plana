export type Region = "Almaty" | "Astana" | "Shymkent" | "Aktobe" | "default";
export type QualityClass = "economy" | "comfort" | "business";
export type ParkingMode = "open" | "underground" | "mixed";
export type BuildingType = "multifamily_residential";

export type Point = {
  x: number;
  y: number;
};

export type Site = {
  id: string;
  region: Region;
  polygon: Point[];
  area_m2: number;
  max_floors?: number;
  max_far?: number;
};

export type BuildableZone = {
  id: string;
  site_id: string;
  polygon: Point[];
  area_m2: number;
  setbacks: {
    front: number;
    side: number;
    rear: number;
  };
};

export type Building = {
  id: string;
  type: BuildingType;
  quality_class: QualityClass;
  gfa_above_ground_m2: number;
  gfa_underground_m2: number;
  floors_above: number;
  floors_below: number;
  footprint_width_m?: number;
  footprint_depth_m?: number;
};

export type BuildingPlacement = {
  id: string;
  site_id: string;
  building_id: string;
  variant_key: "linear_north" | "central" | "l_shape";
  footprint_polygon: Point[];
  roads_area_m2: number;
  open_parking_area_m2: number;
  landscape_area_m2: number;
  parking_spots: number;
  complex_soil: boolean;
  complex_slope: boolean;
};

export type CostLine = {
  key: string;
  label: string;
  amount: number;
};

export type CostSnapshot = {
  id: string;
  placement_id: string;
  currency: "KZT";
  c_above: number;
  c_underground: number;
  c_site: number;
  contingency: number;
  total_estimate: number;
  range_low: number;
  range_high: number;
  method_meta: {
    estimate_class: string;
    rate_source: string;
    disclaimer: string;
    lines: CostLine[];
  };
};

export type CostParams = {
  currency: "KZT";
  base_rate_kzt_m2: number;
  region_coefficients: Record<Region, number>;
  quality_coefficients: Record<QualityClass, number>;
  underground_factor: number;
  soil_factor: number;
  slope_factor: number;
  roads_rate_kzt_m2: number;
  open_parking_rate_kzt_m2: number;
  landscape_rate_kzt_m2: number;
  external_utilities_allowance_pct: number;
  overheads_pct: number;
  profit_pct: number;
  contingency_pct: number;
};

export type PlacementOptions = {
  setbacks: {
    front: number;
    side: number;
    rear: number;
  };
  parking_mode: ParkingMode;
  parking_spots?: number | "auto_by_norms";
  complex_soil: boolean;
  complex_slope: boolean;
};

export const DEFAULT_COST_PARAMS: CostParams = {
  currency: "KZT",
  // Ставки откалиброваны под канонический бэкенд-движок
  // engine/plana_engine/cost/aggregate_cost.py (единый источник чисел):
  // base × region_coeff × quality_coeff воспроизводит backend
  // региональную ставку × классовый фактор.
  //   default 256k; Алматы 290k, Астана 280k, Шымкент 305k, Актобе 144k.
  //   классовые факторы: эконом 1.0 / комфорт 1.15 / бизнес 1.4.
  // Это бенчмарк stat.gov.kz (official=False), НЕ лицензированный УПСС РК.
  // Site-works (roads/parking/landscape) бэкенд не моделирует — остаются здесь.
  base_rate_kzt_m2: 256_000,
  region_coefficients: {
    Almaty: 1.133,
    Astana: 1.094,
    Shymkent: 1.191,
    Aktobe: 0.5625,
    default: 1,
  },
  quality_coefficients: {
    economy: 1.0,
    comfort: 1.15,
    business: 1.4,
  },
  underground_factor: 1.3,
  soil_factor: 1.25,
  slope_factor: 1.15,
  roads_rate_kzt_m2: 28_000,
  open_parking_rate_kzt_m2: 18_000,
  landscape_rate_kzt_m2: 11_000,
  external_utilities_allowance_pct: 8,
  // НР (накладные расходы) и сметная прибыль = 0 по умолчанию: укрупнённый
  // показатель (base_rate) их УЖЕ включает — начислять сверху = двойной счёт.
  // Та же конвенция, что в бэкенде (aggregate_cost.py: overhead_profit_pct=0).
  // Поля оставлены конфигурируемыми (CSV-импорт официальных ставок).
  overheads_pct: 0,
  profit_pct: 0,
  contingency_pct: 20,
};

export function rectanglePolygon(width: number, depth: number, x = 0, y = 0): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

export function polygonBounds(polygon: Point[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

export function rectangleArea(width: number, depth: number): number {
  return Math.max(0, width) * Math.max(0, depth);
}

export function polygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

export function computeBuildableZone(
  site: Site,
  setbacks: { front: number; side: number; rear: number },
): BuildableZone {
  const b = polygonBounds(site.polygon);
  const width = Math.max(0, b.width - setbacks.side * 2);
  const depth = Math.max(0, b.depth - setbacks.front - setbacks.rear);
  const polygon = rectanglePolygon(width, depth, b.minX + setbacks.side, b.minY + setbacks.front);
  return {
    id: `${site.id}:buildable`,
    site_id: site.id,
    polygon,
    area_m2: polygonArea(polygon),
    setbacks,
  };
}

export function createPlacementVariants(
  site: Site,
  building: Building,
  options: PlacementOptions,
): BuildingPlacement[] {
  const buildable = computeBuildableZone(site, options.setbacks);
  const zone = polygonBounds(buildable.polygon);
  const targetFootprintArea = Math.max(
    1,
    building.footprint_width_m && building.footprint_depth_m
      ? building.footprint_width_m * building.footprint_depth_m
      : building.gfa_above_ground_m2 / Math.max(1, building.floors_above),
  );
  const baseWidth = Math.min(building.footprint_width_m ?? Math.sqrt(targetFootprintArea * 1.7), zone.width);
  const baseDepth = Math.min(building.footprint_depth_m ?? targetFootprintArea / Math.max(1, baseWidth), zone.depth);
  const parkingSpots = resolveParkingSpots(building, options.parking_spots);

  const variants: Array<{
    key: BuildingPlacement["variant_key"];
    w: number;
    d: number;
    x: number;
    y: number;
    roadsRatio: number;
    landscapeRatio: number;
  }> = [
    {
      key: "linear_north",
      w: Math.min(zone.width, baseWidth * 1.15),
      d: Math.min(zone.depth, baseDepth * 0.9),
      x: zone.minX + Math.max(0, zone.width - Math.min(zone.width, baseWidth * 1.15)) / 2,
      y: zone.minY,
      roadsRatio: 0.11,
      landscapeRatio: 0.32,
    },
    {
      key: "central",
      w: Math.min(zone.width, baseWidth),
      d: Math.min(zone.depth, baseDepth),
      x: zone.minX + Math.max(0, zone.width - baseWidth) / 2,
      y: zone.minY + Math.max(0, zone.depth - baseDepth) / 2,
      roadsRatio: 0.09,
      landscapeRatio: 0.38,
    },
    {
      key: "l_shape",
      w: Math.min(zone.width, baseWidth * 1.05),
      d: Math.min(zone.depth, baseDepth * 1.05),
      x: zone.minX,
      y: zone.minY + Math.max(0, zone.depth - Math.min(zone.depth, baseDepth * 1.05)),
      roadsRatio: 0.13,
      landscapeRatio: 0.28,
    },
  ];

  return variants.map((v) => {
    const footprint = rectanglePolygon(v.w, v.d, v.x, v.y);
    const footprintArea = polygonArea(footprint);
    const siteRemainder = Math.max(0, site.area_m2 - footprintArea);
    const openParkingArea = options.parking_mode === "underground"
      ? 0
      : parkingSpots * 25 * (options.parking_mode === "mixed" ? 0.45 : 1);
    const roadsArea = site.area_m2 * v.roadsRatio;
    const landscapeArea = Math.max(0, siteRemainder * v.landscapeRatio - openParkingArea * 0.2);

    return {
      id: `${site.id}:${building.id}:${v.key}`,
      site_id: site.id,
      building_id: building.id,
      variant_key: v.key,
      footprint_polygon: footprint,
      roads_area_m2: Math.round(roadsArea),
      open_parking_area_m2: Math.round(openParkingArea),
      landscape_area_m2: Math.round(landscapeArea),
      parking_spots: parkingSpots,
      complex_soil: options.complex_soil,
      complex_slope: options.complex_slope,
    };
  });
}

export function estimateCost(
  placement: BuildingPlacement,
  site: Site,
  building: Building,
  params: CostParams = DEFAULT_COST_PARAMS,
): CostSnapshot {
  const buildRate = rateBuild(site.region, building.quality_class, params);
  const cAbove = building.gfa_above_ground_m2 * buildRate;
  const undergroundRate = buildRate * params.underground_factor;
  const soilMultiplier = placement.complex_soil ? params.soil_factor : 1;
  const cUnderground = building.gfa_underground_m2 * undergroundRate * soilMultiplier;

  const cRoads = placement.roads_area_m2 * params.roads_rate_kzt_m2;
  const cOpenParking = placement.open_parking_area_m2 * params.open_parking_rate_kzt_m2;
  const cLandscape = placement.landscape_area_m2 * params.landscape_rate_kzt_m2;
  const cUtilities = (cRoads + cOpenParking + cLandscape) * params.external_utilities_allowance_pct / 100;
  const siteSlopeMultiplier = placement.complex_slope ? params.slope_factor : 1;
  const cSite = (cRoads + cOpenParking + cLandscape + cUtilities) * siteSlopeMultiplier;

  const baseCost = cAbove + cUnderground + cSite;
  // НР+прибыль обычно 0 (см. DEFAULT_COST_PARAMS) — укрупнённая ставка их уже
  // содержит; формула оставлена для случая загрузки официальных ставок без них.
  const withOverheads = baseCost * (1 + params.overheads_pct / 100);
  const withProfit = withOverheads * (1 + params.profit_pct / 100);
  const contingency = withProfit * params.contingency_pct / 100;
  const totalEstimate = withProfit + contingency;

  return {
    id: `${placement.id}:cost:${Date.now()}`,
    placement_id: placement.id,
    currency: params.currency,
    c_above: Math.round(cAbove),
    c_underground: Math.round(cUnderground),
    c_site: Math.round(cSite),
    contingency: Math.round(contingency),
    total_estimate: Math.round(totalEstimate),
    // Диапазон AACE Class 5 −20%/+30% — как в бэкенде (aggregate_cost.py),
    // а не симметричные ±50%.
    range_low: Math.round(totalEstimate * 0.8),
    range_high: Math.round(totalEstimate * 1.3),
    method_meta: {
      estimate_class: "AACE Class 5 (concept screening)",
      rate_source: "Placeholder KZT rates; replace with Kazakhstan USN/UPSS/BNS calibrated dataset",
      disclaimer:
        "Предварительная расчётная стоимость (укрупнённый показатель стадии " +
        "посадки), НЕ сметная стоимость. Не является сертифицированной сметой — " +
        "требует подтверждения аттестованным сметчиком и Госэкспертизой РК. " +
        "Точность: AACE Class 5, диапазон −20%/+30%.",
      lines: [
        { key: "above", label: "Above-ground building", amount: Math.round(cAbove) },
        { key: "underground", label: "Underground / parking", amount: Math.round(cUnderground) },
        { key: "roads", label: "Internal roads", amount: Math.round(cRoads) },
        { key: "open_parking", label: "Open parking", amount: Math.round(cOpenParking) },
        { key: "landscape", label: "Landscaping", amount: Math.round(cLandscape) },
        { key: "utilities", label: "External utilities allowance", amount: Math.round(cUtilities) },
        { key: "contingency", label: "Class 5 contingency", amount: Math.round(contingency) },
      ],
    },
  };
}

export function rateBuild(region: Region, quality: QualityClass, params: CostParams): number {
  return params.base_rate_kzt_m2
    * (params.region_coefficients[region] ?? params.region_coefficients.default)
    * params.quality_coefficients[quality];
}

function resolveParkingSpots(building: Building, parkingSpots?: number | "auto_by_norms"): number {
  if (typeof parkingSpots === "number" && Number.isFinite(parkingSpots) && parkingSpots >= 0) {
    return Math.round(parkingSpots);
  }
  const avgApartmentArea = 62;
  const estimatedApartments = Math.max(1, Math.round(building.gfa_above_ground_m2 / avgApartmentArea));
  return Math.round(estimatedApartments * 1.1);
}
