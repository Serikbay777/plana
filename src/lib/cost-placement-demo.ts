import {
  DEFAULT_COST_PARAMS,
  computeBuildableZone,
  createPlacementVariants,
  estimateCost,
  rectanglePolygon,
  type Building,
  type CostSnapshot,
  type Site,
} from "./cost-placement";

export function runCostPlacementDemo(): Array<{
  variant_key: string;
  gfa_above: number;
  total_estimate: number;
  range_low: number;
  range_high: number;
  c_above: number;
  c_underground: number;
  c_site: number;
}> {
  const site: Site = {
    id: "demo-site",
    region: "Almaty",
    polygon: rectanglePolygon(80, 120),
    area_m2: 9_600,
  };
  const building: Building = {
    id: "demo-building",
    type: "multifamily_residential",
    quality_class: "comfort",
    gfa_above_ground_m2: 18_000,
    gfa_underground_m2: 3_200,
    floors_above: 12,
    floors_below: 1,
    footprint_width_m: 48,
    footprint_depth_m: 32,
  };
  const setbacks = { front: 8, side: 6, rear: 8 };
  computeBuildableZone(site, setbacks);
  const placements = createPlacementVariants(site, building, {
    setbacks,
    parking_mode: "mixed",
    parking_spots: "auto_by_norms",
    complex_soil: false,
    complex_slope: false,
  });

  return placements.map((placement) => {
    const cost: CostSnapshot = estimateCost(placement, site, building, DEFAULT_COST_PARAMS);
    return {
      variant_key: placement.variant_key,
      gfa_above: building.gfa_above_ground_m2,
      total_estimate: cost.total_estimate,
      range_low: cost.range_low,
      range_high: cost.range_high,
      c_above: cost.c_above,
      c_underground: cost.c_underground,
      c_site: cost.c_site,
    };
  });
}

if (typeof require !== "undefined" && require.main === module) {
  console.table(runCostPlacementDemo());
}
