"use client";

// FloorSelector — Sprint 1 v1.0 plan.
// Полоса кнопок этажей: [-1] [1] [2] [3]  + Добавить.
// На текущем этапе под капотом проект всегда содержит 1 этаж; компонент
// рассчитан и на multi-floor, который придёт в Sprint 4.

import { Plus, Copy, Trash2 } from "lucide-react";
import { type LayoutProject } from "@/lib/engine";

export type FloorSelectorProps = {
  project: LayoutProject;
  onSelect: (idx: number) => void;
  onAddFloor?: () => void;
  onDuplicateActive?: () => void;
  onDeleteActive?: () => void;
  variant?: "light" | "dark";
  className?: string;
};

type Theme = {
  container: string;
  divider: string;
  tabActive: string;
  tabIdle: string;
  iconBtn: string;
  deleteBtn: string;
};

const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    container: "border border-zinc-200 bg-white shadow-sm",
    divider: "bg-zinc-200",
    tabActive: "bg-zinc-900 text-white shadow",
    tabIdle: "text-zinc-700 hover:bg-zinc-100",
    iconBtn: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    deleteBtn: "text-zinc-500 hover:bg-rose-50 hover:text-rose-600",
  },
  dark: {
    container: "border border-white/15 bg-white/[0.04]",
    divider: "bg-white/10",
    tabActive: "bg-white/15 text-white",
    tabIdle: "text-white/70 hover:bg-white/[0.06] hover:text-white",
    iconBtn: "text-white/70 hover:bg-white/[0.06] hover:text-white",
    deleteBtn: "text-white/60 hover:bg-rose-500/15 hover:text-rose-300",
  },
};

function formatLevelLabel(level: number, label?: string): string {
  if (label) return label;
  if (level < 0) return `${level}`;
  if (level === 0) return "0";
  return `${level}`;
}

export function FloorSelector({
  project,
  onSelect,
  onAddFloor,
  onDuplicateActive,
  onDeleteActive,
  variant = "light",
  className,
}: FloorSelectorProps) {
  const active = project.activeFloorIdx;
  const canDelete = project.floors.length > 1;
  const theme = THEMES[variant];

  return (
    <div
      className={
        "inline-flex items-center gap-1 rounded-lg p-1 " +
        theme.container +
        " " +
        (className ?? "")
      }
      role="tablist"
      aria-label="Этажи"
    >
      {project.floors.map((floor, idx) => {
        const isActive = idx === active;
        return (
          <button
            key={`${floor.level}-${idx}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(idx)}
            title={floor.label ?? `Этаж ${floor.level}`}
            className={
              "min-w-[1.75rem] rounded-md px-2 py-0.5 text-[12px] font-medium transition " +
              (isActive ? theme.tabActive : theme.tabIdle)
            }
          >
            {formatLevelLabel(floor.level, floor.label)}
          </button>
        );
      })}

      <div className={"mx-0.5 h-4 w-px " + theme.divider} aria-hidden />

      {onDuplicateActive && (
        <button
          type="button"
          onClick={onDuplicateActive}
          title="Дублировать активный этаж"
          aria-label="Дублировать активный этаж"
          className={"rounded-md p-1 " + theme.iconBtn}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}

      {onAddFloor && (
        <button
          type="button"
          onClick={onAddFloor}
          title="Добавить этаж"
          aria-label="Добавить этаж"
          className={"rounded-md p-1 " + theme.iconBtn}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}

      {onDeleteActive && canDelete && (
        <button
          type="button"
          onClick={onDeleteActive}
          title="Удалить активный этаж"
          aria-label="Удалить активный этаж"
          className={"rounded-md p-1 " + theme.deleteBtn}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
