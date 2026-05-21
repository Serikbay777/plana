"use client";

// ModeTabs — segmented control над canvas: Edit / Build / Finishes / Objects /
// Visualize. По UX-карте Maket. Активный mode хранится в editor reducer.
//
// Sprint 2 v1.0 plan — UI и переключение state'а. Полноценная mode-specific
// логика (например, в Visualize включается камера-pose режим) подключается
// позже (Sprint 6 в части Visualize; Build/Finishes — v1.5).

import { type EditorMode } from "@/lib/projectReducer";

export type ModeTabsProps = {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  variant?: "light" | "dark";
  className?: string;
  /** Если задано — отключённые табы не кликаются (например, Visualize до v1.5). */
  disabled?: ReadonlyArray<EditorMode>;
};

type TabDef = { id: EditorMode; label: string; hint: string };

const TABS: ReadonlyArray<TabDef> = [
  { id: "edit",      label: "Edit",      hint: "Геометрия, стены, комнаты (1)" },
  { id: "build",     label: "Build",     hint: "Конструкция: толщины, материалы (2)" },
  { id: "finishes",  label: "Finishes",  hint: "Отделка: полы, обои, потолки (3)" },
  { id: "objects",   label: "Objects",   hint: "Мебель, сантехника, кухня (4)" },
  { id: "visualize", label: "Visualize", hint: "3D / рендер (5)" },
];

const THEMES = {
  light: {
    container: "border border-zinc-200 bg-white shadow-sm",
    active: "bg-zinc-900 text-white",
    idle: "text-zinc-700 hover:bg-zinc-100",
    disabled: "text-zinc-400 cursor-not-allowed",
  },
  dark: {
    container: "border border-white/15 bg-white/[0.04]",
    active: "bg-white/15 text-white",
    idle: "text-white/70 hover:bg-white/[0.06] hover:text-white",
    disabled: "text-white/30 cursor-not-allowed",
  },
} as const;

export function ModeTabs({
  mode,
  onChange,
  variant = "light",
  className,
  disabled = [],
}: ModeTabsProps) {
  const theme = THEMES[variant];

  return (
    <div
      role="tablist"
      aria-label="Режим редактора"
      className={
        "inline-flex items-center gap-0.5 rounded-lg p-0.5 " +
        theme.container +
        " " +
        (className ?? "")
      }
    >
      {TABS.map((t) => {
        const isActive = t.id === mode;
        const isDisabled = disabled.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            onClick={() => onChange(t.id)}
            title={t.hint}
            className={
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition " +
              (isDisabled
                ? theme.disabled
                : isActive
                ? theme.active
                : theme.idle)
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
