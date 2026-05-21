"use client";

// LeftToolbar — вертикальная панель инструментов слева от canvas (как в Maket
// и любом CAD-софте). Sprint 2 v1.0 plan: только UI + переключение
// state.tool через reducer. Реальная логика инструментов (wall draw, measure,
// dimension, eraser, multi-select…) подключается в Sprint 3.
//
// Кнопки сгруппированы по смыслу с разделителями.

import {
  MousePointer2, Hand, Slash, DoorClosed, RectangleVertical,
  StretchHorizontal, Square, Sofa, Ruler, Pencil, Eraser,
  type LucideIcon,
} from "lucide-react";
import { type ToolKind } from "@/lib/projectReducer";

export type LeftToolbarProps = {
  tool: ToolKind;
  onChange: (tool: ToolKind) => void;
  /** Список инструментов в виде заглушек — клик переключает state, но реальной логики ещё нет. */
  disabled?: ReadonlyArray<ToolKind>;
  variant?: "light" | "dark";
  className?: string;
};

type ToolDef = {
  id: ToolKind;
  icon: LucideIcon;
  label: string;
  hotkey: string;
};

// Группы разделены `null`.
const TOOLS: ReadonlyArray<ToolDef | null> = [
  { id: "select", icon: MousePointer2, label: "Выбор",       hotkey: "V" },
  { id: "pan",    icon: Hand,          label: "Панорама",    hotkey: "H" },
  null,
  { id: "wall",   icon: Slash,             label: "Стена",   hotkey: "W" },
  { id: "door",   icon: DoorClosed,        label: "Дверь",   hotkey: "D" },
  { id: "window", icon: RectangleVertical, label: "Окно",    hotkey: "N" },
  { id: "stair",  icon: StretchHorizontal, label: "Лестница", hotkey: "S" },
  { id: "room",   icon: Square,            label: "Комната",  hotkey: "R" },
  null,
  { id: "furniture", icon: Sofa,   label: "Мебель",    hotkey: "F" },
  null,
  { id: "measure",   icon: Ruler,  label: "Линейка",  hotkey: "M" },
  { id: "dimension", icon: Pencil, label: "Размер",   hotkey: "Dim" },
  null,
  { id: "eraser",    icon: Eraser, label: "Ластик",   hotkey: "E" },
];

const THEMES = {
  light: {
    container: "border border-zinc-200 bg-white shadow-sm",
    divider: "bg-zinc-200",
    active: "bg-zinc-900 text-white",
    idle: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    disabled: "text-zinc-300 cursor-not-allowed hover:bg-transparent",
    hotkey: "text-zinc-400 group-hover:text-zinc-600",
  },
  dark: {
    container: "border border-white/15 bg-white/[0.04]",
    divider: "bg-white/10",
    active: "bg-white/15 text-white",
    idle: "text-white/70 hover:bg-white/[0.06] hover:text-white",
    disabled: "text-white/20 cursor-not-allowed hover:bg-transparent",
    hotkey: "text-white/30 group-hover:text-white/60",
  },
} as const;

export function LeftToolbar({
  tool,
  onChange,
  disabled = [],
  variant = "light",
  className,
}: LeftToolbarProps) {
  const theme = THEMES[variant];

  return (
    <div
      className={
        "inline-flex w-11 flex-col items-stretch gap-0.5 rounded-lg p-1 " +
        theme.container +
        " " +
        (className ?? "")
      }
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Инструменты"
    >
      {TOOLS.map((t, i) => {
        if (t === null) {
          return (
            <div
              key={`divider-${i}`}
              className={"my-0.5 h-px w-full " + theme.divider}
              aria-hidden
            />
          );
        }
        const Icon = t.icon;
        const isActive = tool === t.id;
        const isDisabled = disabled.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            disabled={isDisabled}
            aria-pressed={isActive}
            aria-disabled={isDisabled}
            title={`${t.label} (${t.hotkey})`}
            className={
              "group relative flex h-9 items-center justify-center rounded-md transition " +
              (isDisabled
                ? theme.disabled
                : isActive
                ? theme.active
                : theme.idle)
            }
          >
            <Icon className="h-4 w-4" />
            <span
              className={
                "pointer-events-none absolute right-0.5 bottom-0.5 text-[8px] font-mono " +
                (isActive ? "text-white/70" : theme.hotkey)
              }
            >
              {t.hotkey}
            </span>
          </button>
        );
      })}
    </div>
  );
}
