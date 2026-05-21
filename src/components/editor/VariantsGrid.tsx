"use client";

// VariantsGrid — 2×2 миниатюр-карточек planов для выбора пользователем
// (Sprint 5 v1.0 plan). На v1 параллельные вызовы /generate/layout-from-brief;
// в v1.5 — один backend-вызов, возвращающий массив. Минимальная карточка:
// thumbnail (тот же FloorPlanSvg, не интерактивный) + базовые метрики.

import { Check, Loader2 } from "lucide-react";
import { type BriefLayoutResponse, type LayoutFloor } from "@/lib/engine";
import { FloorPlanSvg } from "@/components/ArchitecturalDrawingsTab";

export type VariantItem = {
  status: "pending" | "ready" | "error";
  data?: BriefLayoutResponse;
  error?: string;
};

export type VariantsGridProps = {
  variants: VariantItem[];
  onSelect: (variant: BriefLayoutResponse) => void;
  selectedIdx?: number | null;
};

function totalRooms(layout: LayoutFloor): number {
  let n = 0;
  for (const s of layout.sections) {
    for (const apt of s.apartments) n += apt.rooms.length;
  }
  return n;
}

function totalArea(layout: LayoutFloor): number {
  return layout.width_m * layout.depth_m;
}

export function VariantsGrid({
  variants, onSelect, selectedIdx,
}: VariantsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {variants.map((v, i) => {
        const isSelected = selectedIdx === i;
        return (
          <button
            key={i}
            type="button"
            disabled={v.status !== "ready" || !v.data}
            onClick={() => v.data && onSelect(v.data)}
            className={
              "relative flex flex-col rounded-lg border bg-white p-2 text-left transition " +
              (isSelected
                ? "border-sky-500 ring-2 ring-sky-500/30"
                : v.status === "ready"
                ? "border-zinc-200 hover:border-zinc-400 cursor-pointer"
                : "border-zinc-150 cursor-default")
            }
          >
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              Вариант {i + 1}
              {isSelected && <span className="ml-1 text-sky-600">· выбран</span>}
            </div>

            <div className="aspect-square w-full rounded bg-zinc-50 overflow-hidden flex items-center justify-center">
              {v.status === "pending" && (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              )}
              {v.status === "error" && (
                <span className="text-[10px] text-rose-500 px-2 text-center">
                  {v.error || "Ошибка"}
                </span>
              )}
              {v.status === "ready" && v.data && (
                <div
                  className="w-full"
                  style={{
                    aspectRatio: `${v.data.layout.width_m + 6}/${v.data.layout.depth_m + 6}`,
                    pointerEvents: "none",
                  }}
                >
                  <FloorPlanSvg layout={v.data.layout} />
                </div>
              )}
            </div>

            {v.status === "ready" && v.data && (
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                <span>
                  {v.data.layout.width_m.toFixed(1)} × {v.data.layout.depth_m.toFixed(1)} м
                </span>
                <span>
                  {totalArea(v.data.layout).toFixed(0)} м² · {totalRooms(v.data.layout)} комн.
                </span>
              </div>
            )}

            {isSelected && (
              <div className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-sky-500 text-white">
                <Check className="h-3 w-3" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
