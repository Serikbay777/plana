import type { EnginePurpose } from "@/lib/gis";

export type Point = [number, number];

export type MasterplanObjectType =
  | "residential_block"
  | "school"
  | "kindergarten"
  | "parking"
  | "commerce"
  | "yard";

export type MasterplanObjectStatus = "draft" | "valid" | "warning" | "error";

export type MasterplanObject = {
  id: string;
  type: MasterplanObjectType;
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotationDeg: number;
  floors: number;
  footprintAreaM2: number;
  gfaM2: number;
  locked: boolean;
  status: MasterplanObjectStatus;
  source: "engine_footprint" | "user_added";
};

export type MasterplanScenario = "max_gfa" | "balanced_courtyard" | "social_mix";

export type MasterplanIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  rule: "parcel_boundary" | "red_line" | "neighbor_setback" | "coverage" | "far" | "green_area" | "parking";
  message: string;
  targetObjectId?: string;
  actual?: number;
  expected?: number;
};

export type MasterplanValidation = {
  issues: MasterplanIssue[];
  errors: number;
  warnings: number;
  infos: number;
  siteAreaM2: number;
  footprintM2: number;
  gfaM2: number;
  coveragePct: number;
  far: number;
  greenAreaM2: number;
  greenPct: number;
};

export type MasterplanCostHandoff = {
  source: "gis_masterplan_workspace";
  site_area_m2: number;
  gfa_above_ground_m2: number;
  footprint_m2: number;
  floors_above: number;
  building_count: number;
  parking_count: number;
  green_area_m2: number;
  coverage_pct: number;
  far: number;
  risk_flags: string[];
};

type ObjectTemplate = {
  type: MasterplanObjectType;
  name: string;
  width: number;
  depth: number;
  floors: number;
};

const templates: Record<MasterplanObjectType, ObjectTemplate> = {
  residential_block: { type: "residential_block", name: "Residential block", width: 32, depth: 18, floors: 9 },
  school: { type: "school", name: "School", width: 52, depth: 30, floors: 3 },
  kindergarten: { type: "kindergarten", name: "Kindergarten", width: 34, depth: 24, floors: 2 },
  parking: { type: "parking", name: "Parking", width: 28, depth: 18, floors: 1 },
  commerce: { type: "commerce", name: "Commercial podium", width: 34, depth: 16, floors: 1 },
  yard: { type: "yard", name: "Green courtyard", width: 42, depth: 28, floors: 0 },
};

export const masterplanObjectTypes: MasterplanObjectType[] = [
  "residential_block",
  "school",
  "kindergarten",
  "parking",
  "commerce",
  "yard",
];

export function masterplanObjectLabel(type: MasterplanObjectType): string {
  return templates[type].name;
}

export function createDefaultMasterplanObjects(
  footprints: Point[][],
  params: { floors: number; purpose: EnginePurpose },
): MasterplanObject[] {
  if (footprints.length === 0) return [];
  return footprints.map((ring, index) => {
    const box = bounds(ring);
    const footprintAreaM2 = polygonArea(ring) || box.width * box.depth;
    const type: MasterplanObjectType = params.purpose === "commercial" ? "commerce" : "residential_block";
    return {
      id: `engine-footprint-${index + 1}`,
      type,
      name: `${masterplanObjectLabel(type)} ${index + 1}`,
      x: box.centerX,
      y: box.centerY,
      width: box.width,
      depth: box.depth,
      rotationDeg: 0,
      floors: params.floors,
      footprintAreaM2,
      gfaM2: footprintAreaM2 * params.floors,
      locked: false,
      status: "draft",
      source: "engine_footprint",
    };
  });
}

export function createMasterplanObject(
  type: MasterplanObjectType,
  index: number,
  siteWidth: number,
  siteDepth: number,
): MasterplanObject {
  const template = templates[type];
  const width = Math.min(template.width, Math.max(8, siteWidth * 0.45));
  const depth = Math.min(template.depth, Math.max(8, siteDepth * 0.45));
  const footprintAreaM2 = type === "yard" ? 0 : width * depth;
  return {
    id: `${type}-${Date.now()}-${index}`,
    type,
    name: `${template.name} ${index}`,
    x: siteWidth / 2,
    y: siteDepth / 2,
    width,
    depth,
    rotationDeg: 0,
    floors: template.floors,
    footprintAreaM2,
    gfaM2: footprintAreaM2 * template.floors,
    locked: false,
    status: "draft",
    source: "user_added",
  };
}

export function createMasterplanScenario(
  scenario: MasterplanScenario,
  siteBoundary: Point[],
  params: { floors: number; maxCoveragePct: number },
): MasterplanObject[] {
  const box = bounds(siteBoundary);
  const maxFootprint = Math.max(80, polygonArea(siteBoundary) * Math.min(0.7, params.maxCoveragePct / 100));
  const mk = (
    type: MasterplanObjectType,
    index: number,
    xRatio: number,
    yRatio: number,
    width: number,
    depth: number,
    floors: number,
  ) => updateMasterplanObject({
    id: `${scenario}-${type}-${index}`,
    type,
    name: `${masterplanObjectLabel(type)} ${index}`,
    x: box.minX + box.width * xRatio,
    y: box.minY + box.depth * yRatio,
    width: Math.max(8, Math.min(width, box.width * 0.82)),
    depth: Math.max(8, Math.min(depth, box.depth * 0.82)),
    rotationDeg: 0,
    floors,
    footprintAreaM2: 0,
    gfaM2: 0,
    locked: false,
    status: "draft",
    source: "user_added",
  }, {}, siteBoundary);

  if (scenario === "max_gfa") {
    const depth = Math.sqrt(maxFootprint / 2.4);
    const width = depth * 2.4;
    return [mk("residential_block", 1, 0.5, 0.5, width, depth, params.floors)];
  }

  if (scenario === "social_mix") {
    return [
      mk("residential_block", 1, 0.34, 0.44, box.width * 0.36, box.depth * 0.24, params.floors),
      mk("kindergarten", 2, 0.72, 0.34, box.width * 0.24, box.depth * 0.2, 2),
      mk("commerce", 3, 0.52, 0.72, box.width * 0.32, box.depth * 0.12, 1),
      mk("yard", 4, 0.52, 0.52, box.width * 0.28, box.depth * 0.24, 0),
      mk("parking", 5, 0.78, 0.72, box.width * 0.18, box.depth * 0.14, 1),
    ];
  }

  return [
    mk("residential_block", 1, 0.33, 0.42, box.width * 0.28, box.depth * 0.22, params.floors),
    mk("residential_block", 2, 0.67, 0.42, box.width * 0.28, box.depth * 0.22, params.floors),
    mk("yard", 3, 0.5, 0.64, box.width * 0.34, box.depth * 0.22, 0),
    mk("parking", 4, 0.5, 0.18, box.width * 0.32, box.depth * 0.12, 1),
  ];
}

export function updateMasterplanObject(
  object: MasterplanObject,
  patch: Partial<Pick<MasterplanObject, "x" | "y" | "width" | "depth" | "rotationDeg" | "floors" | "locked">>,
  parcelBoundary?: Point[],
): MasterplanObject {
  const next = {
    ...object,
    ...patch,
    width: Math.max(1, patch.width ?? object.width),
    depth: Math.max(1, patch.depth ?? object.depth),
    floors: Math.max(0, Math.round(patch.floors ?? object.floors)),
  };
  const footprintAreaM2 = next.type === "yard" ? 0 : next.width * next.depth;
  return {
    ...next,
    footprintAreaM2,
    gfaM2: footprintAreaM2 * next.floors,
    status: parcelBoundary ? evaluateObjectStatus(next, parcelBoundary) : next.status,
  };
}

export function evaluateObjectStatus(object: MasterplanObject, parcelBoundary: Point[]): MasterplanObjectStatus {
  if (parcelBoundary.length < 3) return "draft";
  const allInside = objectRectPoints(object).every((pt) => pointInPolygon(pt, parcelBoundary));
  return allInside ? "valid" : "error";
}

export function validateMasterplan(input: {
  objects: MasterplanObject[];
  parcelBoundary: Point[];
  redLines: Point[][];
  neighbors: Point[][];
  maxCoveragePct: number;
}): MasterplanValidation {
  const siteAreaM2 = polygonArea(input.parcelBoundary);
  const issues: MasterplanIssue[] = [];
  const footprintObjects = input.objects.filter((object) => object.type !== "yard");
  const footprintM2 = footprintObjects.reduce((sum, object) => sum + object.footprintAreaM2, 0);
  const gfaM2 = footprintObjects.reduce((sum, object) => sum + object.gfaM2, 0);
  const greenAreaM2 = input.objects
    .filter((object) => object.type === "yard")
    .reduce((sum, object) => sum + object.width * object.depth, 0);
  const coveragePct = siteAreaM2 > 0 ? (footprintM2 / siteAreaM2) * 100 : 0;
  const far = siteAreaM2 > 0 ? gfaM2 / siteAreaM2 : 0;
  const greenPct = siteAreaM2 > 0 ? (greenAreaM2 / siteAreaM2) * 100 : 0;

  for (const object of input.objects) {
    const ring = objectRectPoints(object);
    if (ring.some((pt) => !pointInPolygon(pt, input.parcelBoundary))) {
      issues.push({
        id: `${object.id}:parcel-boundary`,
        severity: "error",
        rule: "parcel_boundary",
        targetObjectId: object.id,
        message: `${object.name} is outside parcel boundary.`,
      });
    }
    if (input.redLines.some((line) => polygonIntersectsPolyline(ring, line))) {
      issues.push({
        id: `${object.id}:red-line`,
        severity: "error",
        rule: "red_line",
        targetObjectId: object.id,
        message: `${object.name} intersects a red line.`,
      });
    }
    const minNeighborDistance = minDistanceToPolygons(ring, input.neighbors);
    if (Number.isFinite(minNeighborDistance) && minNeighborDistance < 6) {
      issues.push({
        id: `${object.id}:neighbor-setback`,
        severity: "warning",
        rule: "neighbor_setback",
        targetObjectId: object.id,
        actual: Math.round(minNeighborDistance * 10) / 10,
        expected: 6,
        message: `${object.name} is closer than 6 m to a neighbor building.`,
      });
    }
  }

  if (coveragePct > input.maxCoveragePct) {
    issues.push({
      id: "site:coverage",
      severity: "error",
      rule: "coverage",
      actual: Math.round(coveragePct * 10) / 10,
      expected: input.maxCoveragePct,
      message: `Object coverage exceeds limit: ${Math.round(coveragePct * 10) / 10}% > ${input.maxCoveragePct}%.`,
    });
  }
  if (far > 4.5) {
    issues.push({
      id: "site:far",
      severity: "warning",
      rule: "far",
      actual: Math.round(far * 100) / 100,
      expected: 4.5,
      message: "FAR is high for early screening. Confirm zoning/GPZU limits.",
    });
  }
  if (greenPct < 20) {
    issues.push({
      id: "site:green-area",
      severity: "warning",
      rule: "green_area",
      actual: Math.round(greenPct * 10) / 10,
      expected: 20,
      message: "Green/courtyard area is below 20% screening target.",
    });
  }
  if (footprintObjects.some((object) => object.type === "residential_block") && !input.objects.some((object) => object.type === "parking")) {
    issues.push({
      id: "site:parking",
      severity: "warning",
      rule: "parking",
      message: "Residential scenario has no parking object yet.",
    });
  }

  return {
    issues,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    infos: issues.filter((issue) => issue.severity === "info").length,
    siteAreaM2,
    footprintM2,
    gfaM2,
    coveragePct,
    far,
    greenAreaM2,
    greenPct,
  };
}

export function buildMasterplanCostHandoff(validation: MasterplanValidation, objects: MasterplanObject[]): MasterplanCostHandoff {
  const footprintObjects = objects.filter((object) => object.type !== "yard");
  const weightedFloors = footprintObjects.reduce((sum, object) => sum + object.footprintAreaM2 * object.floors, 0);
  const footprintM2 = Math.max(1, validation.footprintM2);
  return {
    source: "gis_masterplan_workspace",
    site_area_m2: Math.round(validation.siteAreaM2),
    gfa_above_ground_m2: Math.round(validation.gfaM2),
    footprint_m2: Math.round(validation.footprintM2),
    floors_above: Math.max(1, Math.round(weightedFloors / footprintM2)),
    building_count: footprintObjects.length,
    parking_count: objects.filter((object) => object.type === "parking").length,
    green_area_m2: Math.round(validation.greenAreaM2),
    coverage_pct: Math.round(validation.coveragePct * 10) / 10,
    far: Math.round(validation.far * 100) / 100,
    risk_flags: validation.issues
      .filter((issue) => issue.severity !== "info")
      .map((issue) => `${issue.rule}: ${issue.message}`),
  };
}

export function objectRectPoints(object: MasterplanObject): Point[] {
  const halfW = object.width / 2;
  const halfD = object.depth / 2;
  const angle = (object.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([dx, dy]) => [
    object.x + dx * cos - dy * sin,
    object.y + dx * sin + dy * cos,
  ]);
}

function pointInPolygon(point: Point, polygon: Point[]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonIntersectsPolyline(polygon: Point[], line: Point[]) {
  const polygonEdges = edges(polygon);
  const lineEdges = edges(line, false);
  return polygonEdges.some(([a, b]) => lineEdges.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}

function minDistanceToPolygons(points: Point[], polygons: Point[][]) {
  if (polygons.length === 0) return Number.POSITIVE_INFINITY;
  const objectEdges = edges(points);
  let min = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const [a, b] of objectEdges) {
      for (const [c, d] of edges(polygon)) {
        if (segmentsIntersect(a, b, c, d)) return 0;
        min = Math.min(min, pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
      }
    }
  }
  return min;
}

function edges(points: Point[], closed = true): Array<[Point, Point]> {
  const result: Array<[Point, Point]> = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    const next = (i + 1) % points.length;
    if (points[i] && points[next]) result.push([points[i], points[next]]);
  }
  return result;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
  return distance(point, [a[0] + t * dx, a[1] + t * dy]);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function bounds(points: Point[]) {
  const xs = points.map((pt) => pt[0]);
  const ys = points.map((pt) => pt[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxY - minY),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
