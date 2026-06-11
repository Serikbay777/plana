import type { EnginePurpose } from "@/lib/gis";
import type { SiteContext } from "@/lib/engine";

export const GIS_MASTERPLAN_HANDOFF_KEY = "__plana_gis_masterplan_handoff";

export type GisMasterplanParcel = {
  id: string;
  name: string;
  designation: string;
  functionalZone: string;
  isSocial: boolean;
  ringWgs84: [number, number][];
  local: [number, number][];
  width: number;
  height: number;
  areaM2: number;
  ctx: SiteContext;
  params: {
    housing_class: string;
    purpose: EnginePurpose;
    max_coverage_pct: number;
    floors: number;
  };
};

export type GisMasterplanHandoff = {
  source: "gis_multi_parcel_map";
  createdAt: string;
  parcels: GisMasterplanParcel[];
  summary: {
    parcelsCount: number;
    totalAreaM2: number;
    maxWidthM: number;
    maxDepthM: number;
    avgFloors: number;
    functionalZones: string[];
    hasSocialParcel: boolean;
  };
};

export function buildGisMasterplanHandoff(parcels: GisMasterplanParcel[]): GisMasterplanHandoff {
  const totalAreaM2 = parcels.reduce((sum, parcel) => sum + parcel.areaM2, 0);
  const weightedFloors = parcels.reduce((sum, parcel) => sum + parcel.params.floors * Math.max(1, parcel.areaM2), 0);
  return {
    source: "gis_multi_parcel_map",
    createdAt: new Date().toISOString(),
    parcels,
    summary: {
      parcelsCount: parcels.length,
      totalAreaM2,
      maxWidthM: Math.max(1, ...parcels.map((parcel) => parcel.width)),
      maxDepthM: Math.max(1, ...parcels.map((parcel) => parcel.height)),
      avgFloors: Math.max(1, Math.round(weightedFloors / Math.max(1, totalAreaM2))),
      functionalZones: Array.from(new Set(parcels.map((parcel) => parcel.functionalZone).filter(Boolean))),
      hasSocialParcel: parcels.some((parcel) => parcel.isSocial),
    },
  };
}

export function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
