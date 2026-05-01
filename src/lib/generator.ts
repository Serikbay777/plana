// Floor plan generator (rule-based, demo-grade).
// All units are meters. Coordinates: origin top-left, +x right, +y down.

export type AptType = "studio" | "k1" | "k2" | "k3";

export type Room = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "apt" | "core" | "corridor" | "service";
  apt?: AptType;
  label: string;
  area: number;
};

export type Plan = {
  id: string;
  variant: VariantKey;
  variantName: string;
  variantDesc: string;
  site: { w: number; h: number };
  building: { x: number; y: number; w: number; h: number };
  rooms: Room[];
  metrics: PlanMetrics;
  insights: string[];
};

export type PlanMetrics = {
  siteArea: number;
  footprint: number;
  coverage: number;          // footprint / site
  coreArea: number;
  corridorArea: number;
  livingArea: number;
  saleableArea: number;      // apt area
  efficiency: number;        // saleable / footprint
  aptCount: number;
  aptByType: Record<AptType, number>;
  avgAptArea: number;
};

export type Inputs = {
  siteW: number;             // m
  siteH: number;             // m
  setbackFront: number;
  setbackSide: number;
  setbackRear: number;
  floors: number;
  mix: Record<AptType, number>; // percentages, sum ≈ 100
};

export const APT_TARGETS: Record<AptType, { min: number; ideal: number; max: number; color: string; label: string }> = {
  studio: { min: 22, ideal: 28, max: 36, color: "#22d3ee", label: "Студия" },
  k1:     { min: 36, ideal: 44, max: 54, color: "#a78bfa", label: "1-комн" },
  k2:     { min: 54, ideal: 62, max: 78, color: "#f59e0b", label: "2-комн" },
  k3:     { min: 78, ideal: 88, max: 110, color: "#f472b6", label: "3-комн" },
};

export type VariantKey = "double-loaded" | "single-loaded" | "compact-tower";

const VARIANTS: { key: VariantKey; name: string; desc: string }[] = [
  {
    key: "double-loaded",
    name: "Секционная · двусторонний коридор",
    desc: "Длинная плита, ядро по центру, квартиры с двух сторон коридора. Максимум эффективности.",
  },
  {
    key: "single-loaded",
    name: "Галерейная · односторонняя",
    desc: "Квартиры по одной стороне, галерея по фасаду. Лучший вид и инсоляция, ниже плотность.",
  },
  {
    key: "compact-tower",
    name: "Башенная · компактная",
    desc: "Квадратное ядро, 4–6 квартир на этаж. Минимальный коридор, премиум-квартирография.",
  },
];

// ---- helpers ---------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeMix(mix: Record<AptType, number>): Record<AptType, number> {
  const sum = mix.studio + mix.k1 + mix.k2 + mix.k3 || 1;
  return {
    studio: mix.studio / sum,
    k1: mix.k1 / sum,
    k2: mix.k2 / sum,
    k3: mix.k3 / sum,
  };
}

// Pick apartment types greedily to fit a row of given length and depth.
function fitApartments(
  rowLen: number,
  depth: number,
  mixWeights: Record<AptType, number>,
  yOff: number,
  xStart: number,
  facing: "north" | "south",
  prefix: string,
): Room[] {
  const rooms: Room[] = [];
  let x = xStart;
  let remaining = rowLen;

  // build a queue weighted by mix; cycle through types proportionally
  const order: AptType[] = [];
  const counts: Record<AptType, number> = { studio: 0, k1: 0, k2: 0, k3: 0 };
  // produce ~24 picks weighted by mix
  for (let i = 0; i < 24; i++) {
    let best: AptType = "k1";
    let bestScore = -Infinity;
    for (const t of ["studio", "k1", "k2", "k3"] as AptType[]) {
      const want = mixWeights[t] * (i + 1);
      const have = counts[t];
      const score = want - have;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    counts[best]++;
    order.push(best);
  }

  let idx = 0;
  while (remaining > 4 && idx < order.length) {
    const t = order[idx++];
    const target = APT_TARGETS[t];
    // width from area: w = ideal / depth, but clamp to reasonable façade width
    let w = target.ideal / depth;
    w = Math.max(3.6, Math.min(w, 9.5));
    if (w > remaining) {
      // try smaller type
      const fallback: AptType[] = ["studio", "k1", "k2", "k3"];
      const cand = fallback.find((ft) => APT_TARGETS[ft].ideal / depth <= remaining);
      if (!cand) break;
      w = Math.max(3.2, Math.min(APT_TARGETS[cand].ideal / depth, remaining));
      const area = round1(w * depth);
      rooms.push({
        id: `${prefix}-${rooms.length}`,
        x, y: yOff, w, h: depth,
        kind: "apt", apt: cand,
        label: APT_TARGETS[cand].label,
        area,
      });
      x += w; remaining -= w;
      continue;
    }
    const area = round1(w * depth);
    rooms.push({
      id: `${prefix}-${rooms.length}`,
      x, y: yOff, w, h: depth,
      kind: "apt", apt: t,
      label: APT_TARGETS[t].label,
      area,
    });
    x += w; remaining -= w;
  }
  // stretch last apt to fill any leftover sliver
  if (rooms.length && remaining > 0.5) {
    const last = rooms[rooms.length - 1];
    last.w += remaining;
    last.area = round1(last.w * last.h);
  }
  // mark facing in label suffix (used elsewhere if needed)
  void facing;
  return rooms;
}

function computeMetrics(plan: Omit<Plan, "metrics" | "insights">): PlanMetrics {
  const siteArea = plan.site.w * plan.site.h;
  const footprint = plan.building.w * plan.building.h;
  let coreArea = 0, corridorArea = 0, saleableArea = 0;
  const aptByType: Record<AptType, number> = { studio: 0, k1: 0, k2: 0, k3: 0 };
  let aptCount = 0;
  for (const r of plan.rooms) {
    if (r.kind === "core") coreArea += r.w * r.h;
    else if (r.kind === "corridor") corridorArea += r.w * r.h;
    else if (r.kind === "apt") {
      saleableArea += r.w * r.h;
      aptCount++;
      if (r.apt) aptByType[r.apt]++;
    }
  }
  const livingArea = saleableArea; // demo: living ≈ saleable
  return {
    siteArea: round1(siteArea),
    footprint: round1(footprint),
    coverage: round2(footprint / siteArea),
    coreArea: round1(coreArea),
    corridorArea: round1(corridorArea),
    livingArea: round1(livingArea),
    saleableArea: round1(saleableArea),
    efficiency: round2(saleableArea / footprint),
    aptCount,
    aptByType,
    avgAptArea: aptCount ? round1(saleableArea / aptCount) : 0,
  };
}

function buildInsights(plan: Omit<Plan, "insights">, mix: Record<AptType, number>): string[] {
  const m = plan.metrics;
  const tips: string[] = [];
  tips.push(
    `Эффективность плана ${(m.efficiency * 100).toFixed(0)}% — ${
      m.efficiency > 0.74 ? "отличный показатель для сегмента" :
      m.efficiency > 0.66 ? "в рамках рыночной нормы" : "ниже рынка, можно дожать"
    }.`,
  );
  tips.push(
    `Средняя площадь квартиры ${m.avgAptArea} м². Покрытие участка ${(m.coverage * 100).toFixed(0)}%.`,
  );
  if (plan.variant === "double-loaded") {
    tips.push("Двусторонний коридор даёт максимум выхода кв. м с этажа, но требует контроля инсоляции с северной стороны.");
  } else if (plan.variant === "single-loaded") {
    tips.push("Все квартиры получают сквозную ориентацию и инсоляцию — премиум-сегмент платит +8–12% к цене за м².");
  } else {
    tips.push("Башня на компактном пятне освобождает участок под ландшафт и паркинг, минимизирует длину сетей.");
  }
  // mix sanity
  const wantStudios = mix.studio;
  if (wantStudios > 0.4) tips.push("Высокая доля студий — заложите общественные пространства первого этажа.");
  return tips;
}

// ---- variants --------------------------------------------------------------

function variantDoubleLoaded(inputs: Inputs, mix: Record<AptType, number>): Omit<Plan, "metrics" | "insights"> {
  const bx = inputs.setbackSide;
  const by = inputs.setbackFront;
  const bw = inputs.siteW - inputs.setbackSide * 2;
  const bh = Math.min(18, inputs.siteH - inputs.setbackFront - inputs.setbackRear);

  const corridorH = 1.8;
  const coreW = 7.2;
  const coreH = bh;
  const coreX = bx + bw / 2 - coreW / 2;
  const coreY = by;

  const aptDepth = (bh - corridorH) / 2;
  const corridorY = by + aptDepth;

  const leftLen = coreX - bx;
  const rightLen = (bx + bw) - (coreX + coreW);

  const rooms: Room[] = [];
  // core
  rooms.push({
    id: "core", x: coreX, y: coreY, w: coreW, h: coreH,
    kind: "core", label: "Лифтово-лестничный узел", area: round1(coreW * coreH),
  });
  // corridor (split by core)
  rooms.push({
    id: "cor-l", x: bx, y: corridorY, w: leftLen, h: corridorH,
    kind: "corridor", label: "Коридор", area: round1(leftLen * corridorH),
  });
  rooms.push({
    id: "cor-r", x: coreX + coreW, y: corridorY, w: rightLen, h: corridorH,
    kind: "corridor", label: "Коридор", area: round1(rightLen * corridorH),
  });

  // apartments: 4 rows (left/right × north/south)
  rooms.push(...fitApartments(leftLen, aptDepth, mix, by, bx, "south", "ln"));
  rooms.push(...fitApartments(leftLen, aptDepth, mix, by + aptDepth + corridorH, bx, "north", "ls"));
  rooms.push(...fitApartments(rightLen, aptDepth, mix, by, coreX + coreW, "south", "rn"));
  rooms.push(...fitApartments(rightLen, aptDepth, mix, by + aptDepth + corridorH, coreX + coreW, "north", "rs"));

  return {
    id: `dl-${Date.now()}`,
    variant: "double-loaded",
    variantName: VARIANTS[0].name,
    variantDesc: VARIANTS[0].desc,
    site: { w: inputs.siteW, h: inputs.siteH },
    building: { x: bx, y: by, w: bw, h: bh },
    rooms,
  };
}

function variantSingleLoaded(inputs: Inputs, mix: Record<AptType, number>): Omit<Plan, "metrics" | "insights"> {
  const bx = inputs.setbackSide;
  const by = inputs.setbackFront;
  const bw = inputs.siteW - inputs.setbackSide * 2;
  const bh = Math.min(13, inputs.siteH - inputs.setbackFront - inputs.setbackRear);

  const corridorH = 1.6;
  const coreW = 6.4;
  const coreH = bh;
  // core on left side (1/4 in)
  const coreX = bx + bw * 0.22 - coreW / 2;
  const coreY = by;

  const aptDepth = bh - corridorH;
  const corridorY = by + aptDepth;

  const rooms: Room[] = [];
  rooms.push({
    id: "core", x: coreX, y: coreY, w: coreW, h: coreH,
    kind: "core", label: "Ядро", area: round1(coreW * coreH),
  });
  // single corridor along the front (south edge)
  const corLeftLen = coreX - bx;
  const corRightLen = (bx + bw) - (coreX + coreW);
  rooms.push({
    id: "cor-l", x: bx, y: corridorY, w: corLeftLen, h: corridorH,
    kind: "corridor", label: "Галерея", area: round1(corLeftLen * corridorH),
  });
  rooms.push({
    id: "cor-r", x: coreX + coreW, y: corridorY, w: corRightLen, h: corridorH,
    kind: "corridor", label: "Галерея", area: round1(corRightLen * corridorH),
  });

  rooms.push(...fitApartments(corLeftLen, aptDepth, mix, by, bx, "north", "l"));
  rooms.push(...fitApartments(corRightLen, aptDepth, mix, by, coreX + coreW, "north", "r"));

  return {
    id: `sl-${Date.now()}`,
    variant: "single-loaded",
    variantName: VARIANTS[1].name,
    variantDesc: VARIANTS[1].desc,
    site: { w: inputs.siteW, h: inputs.siteH },
    building: { x: bx, y: by, w: bw, h: bh },
    rooms,
  };
}

function variantCompactTower(inputs: Inputs, mix: Record<AptType, number>): Omit<Plan, "metrics" | "insights"> {
  const buildable = Math.min(
    inputs.siteW - inputs.setbackSide * 2,
    inputs.siteH - inputs.setbackFront - inputs.setbackRear,
  );
  const side = Math.min(buildable, 30);
  const bx = (inputs.siteW - side) / 2;
  const by = (inputs.siteH - side) / 2;
  const bw = side;
  const bh = side;

  const coreSide = Math.min(8, side * 0.28);
  const coreX = bx + bw / 2 - coreSide / 2;
  const coreY = by + bh / 2 - coreSide / 2;

  const rooms: Room[] = [];
  rooms.push({
    id: "core", x: coreX, y: coreY, w: coreSide, h: coreSide,
    kind: "core", label: "Ядро", area: round1(coreSide * coreSide),
  });

  // Determine apt count by area: target ~6 apts of mixed sizes around core
  // Use a ring layout: 4 corner zones + optional 2 mid edges
  const ringDepth = (bh - coreSide) / 2;

  // corners: NW, NE, SE, SW
  const types: AptType[] = (["k2", "k1", "k3", "k1"] as AptType[]);
  // adjust by mix preference
  if (mix.k3 > 0.25) types[2] = "k3";
  if (mix.studio > 0.35) types[1] = "studio";

  const cornerW = (bw - coreSide) / 2;
  const cornerH = ringDepth;
  const corners: Array<[number, number, AptType, string]> = [
    [bx,                  by,                  types[0], "NW"],
    [bx + cornerW + coreSide, by,              types[1], "NE"],
    [bx + cornerW + coreSide, by + cornerH + coreSide, types[2], "SE"],
    [bx,                  by + cornerH + coreSide, types[3], "SW"],
  ];
  corners.forEach(([x, y, t, tag], i) => {
    rooms.push({
      id: `apt-${i}`,
      x, y, w: cornerW, h: cornerH,
      kind: "apt", apt: t,
      label: APT_TARGETS[t].label,
      area: round1(cornerW * cornerH),
    });
    void tag;
  });

  // top & bottom mid (between core and edge horizontally — actually flanks of core)
  // Place 2 more apts left/right of core
  const sideMidT: AptType = mix.studio > mix.k2 ? "studio" : "k1";
  rooms.push({
    id: "apt-w",
    x: bx, y: by + cornerH, w: cornerW, h: coreSide,
    kind: "apt", apt: sideMidT,
    label: APT_TARGETS[sideMidT].label,
    area: round1(cornerW * coreSide),
  });
  rooms.push({
    id: "apt-e",
    x: bx + cornerW + coreSide, y: by + cornerH, w: cornerW, h: coreSide,
    kind: "apt", apt: sideMidT,
    label: APT_TARGETS[sideMidT].label,
    area: round1(cornerW * coreSide),
  });

  // small corridor strips top/bottom of core
  rooms.push({
    id: "cor-n", x: coreX, y: by + cornerH, w: coreSide, h: 1.2,
    kind: "corridor", label: "Холл", area: round1(coreSide * 1.2),
  });
  rooms.push({
    id: "cor-s", x: coreX, y: by + cornerH + coreSide - 1.2, w: coreSide, h: 1.2,
    kind: "corridor", label: "Холл", area: round1(coreSide * 1.2),
  });

  return {
    id: `ct-${Date.now()}`,
    variant: "compact-tower",
    variantName: VARIANTS[2].name,
    variantDesc: VARIANTS[2].desc,
    site: { w: inputs.siteW, h: inputs.siteH },
    building: { x: bx, y: by, w: bw, h: bh },
    rooms,
  };
}

// ---- public API ------------------------------------------------------------

export function generatePlans(inputs: Inputs): Plan[] {
  const mix = normalizeMix(inputs.mix);
  const builders = [variantDoubleLoaded, variantSingleLoaded, variantCompactTower];
  return builders.map((b) => {
    const partial = b(inputs, mix);
    const metrics = computeMetrics(partial);
    const withMetrics = { ...partial, metrics };
    const insights = buildInsights(withMetrics as Plan, mix);
    return { ...withMetrics, insights };
  });
}

export const VARIANT_LIST = VARIANTS;
