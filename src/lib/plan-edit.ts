// Локальные правки уже сгенерированного плана (Phase 4.1):
// смена типа квартиры и удаление tile. Геометрия не меняется — это
// MVP «интерактивной корректировки». Изменения хранятся в виде
// overrides поверх оригинала, а отрисовка использует applyOverrides.

import type { AptType, Plan, PlacedTile } from "./engine";
import { APT_LABELS } from "./engine";

export type TileOverride = {
  apt_type?: AptType;
  deleted?: boolean;
};

/** key = apt_number (1..N) — стабилен между ребилдами оверлея. */
export type PlanOverrides = Record<number, TileOverride>;

/**
 * Пересчитать метрики плана на основе изменённого списка tiles.
 * Считаем то, что детерминированно зависит только от tiles + floor_area:
 * apt_count, saleable_area, avg_apt_area, apt_by_type, saleable_ratio.
 * Поля, которые требуют пересчёта движком (insolation_score,
 * south_oriented_share), оставляем как было — это compromise.
 */
function recomputeMetrics(plan: Plan, tiles: PlacedTile[]): Plan["metrics"] {
  const apt_count = tiles.length;
  const saleable_area = tiles.reduce((s, t) => s + t.area, 0);
  const avg_apt_area = apt_count ? saleable_area / apt_count : 0;
  const apt_by_type: Partial<Record<AptType, number>> = {};
  for (const t of tiles) apt_by_type[t.apt_type] = (apt_by_type[t.apt_type] ?? 0) + 1;
  const floor_area = plan.metrics.floor_area;
  const saleable_ratio = floor_area > 0 ? saleable_area / floor_area : 0;
  return {
    ...plan.metrics,
    apt_count,
    saleable_area,
    avg_apt_area,
    apt_by_type,
    saleable_ratio,
  };
}

/** Применить overrides к плану — вернуть новый Plan c обновлёнными tiles и metrics. */
export function applyOverrides(plan: Plan, overrides: PlanOverrides): Plan {
  if (!Object.keys(overrides).length) return plan;

  const newTiles: PlacedTile[] = [];
  for (const t of plan.tiles) {
    const ov = overrides[t.apt_number];
    if (ov?.deleted) continue;
    if (ov?.apt_type && ov.apt_type !== t.apt_type) {
      newTiles.push({
        ...t,
        apt_type: ov.apt_type,
        label: APT_LABELS[ov.apt_type] ?? t.label,
      });
    } else {
      newTiles.push(t);
    }
  }

  return {
    ...plan,
    tiles: newTiles,
    metrics: recomputeMetrics(plan, newTiles),
  };
}

export function isEdited(overrides: PlanOverrides): boolean {
  return Object.keys(overrides).length > 0;
}
