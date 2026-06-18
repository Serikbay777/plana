// Передача выбранного участка из /map в /app («Перейти к Застройке»).
// Данные (полигон, контекст GIS, параметры, текущее пятно) большие для URL,
// поэтому кладём в localStorage; /app читает по флагу ?build=1.

import type { SiteContext } from "@/lib/engine";
import type { EnginePurpose } from "@/lib/gis";

export type PosadkaHandoff = {
  name: string;
  designation: string;
  isHousing: boolean;
  isSocial: boolean;
  owner: string;
  cadastral: string;
  address: string;
  zone: string;                 // функциональная зона (Градрегламент)
  local: [number, number][];    // кольцо участка в ЛОКАЛЬНЫХ метрах (origin = 0)
  width: number;                // габарит участка по X, м
  height: number;               // габарит участка по Y, м
  ctx: SiteContext;             // красные линии/соседи/зона — в тех же локальных метрах
  params: {
    housing_class: string;
    purpose: EnginePurpose;
    max_coverage_pct: number;   // цель массинга по % застройки (допущение)
    floors: number;
  };
  footprints_local: number[][][]; // текущее пятно застройки (для мгновенного показа)
  savedAt: string;
};

const KEY = "plana_posadka_handoff";

export function writePosadkaHandoff(h: PosadkaHandoff): void {
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* приватный режим/квота */ }
}

export function readPosadkaHandoff(): PosadkaHandoff | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as PosadkaHandoff) : null;
  } catch {
    return null;
  }
}

export function clearPosadkaHandoff(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}
