"use client";

// SnapControls — компактный сегментированный контрол шага привязки к сетке.
// Sprint 3 v1.0 plan. На S3 влияет только на drag комнат (через MOVE_ROOM
// в reducer). Drawing-инструменты подключатся в S4+.

import { Magnet } from "lucide-react";

export type SnapControlsProps = {
  step: number;          // 0 / 0.1 / 0.5 / 1.0
  onChange: (step: number) => void;
  variant?: "light" | "dark";
  className?: string;
};

const STEPS: ReadonlyArray<{ step: number; label: string; hint: string }> = [
  { step: 0,   label: "Off", hint: "Без привязки" },
  { step: 0.1, label: "10",  hint: "Шаг 10 см" },
  { step: 0.5, label: "50",  hint: "Шаг 50 см" },
  { step: 1.0, label: "1м",  hint: "Шаг 1 м" },
];

const THEMES = {
  light: {
    container: "border border-zinc-200 bg-white shadow-sm",
    icon: "text-zinc-500",
    active: "bg-zinc-900 text-white",
    idle: "text-zinc-600 hover:bg-zinc-100",
  },
  dark: {
    container: "border border-white/15 bg-white/[0.04]",
    icon: "text-white/55",
    active: "bg-white/15 text-white",
    idle: "text-white/60 hover:bg-white/[0.06] hover:text-white",
  },
} as const;

export function SnapControls({
  step,
  onChange,
  variant = "light",
  className,
}: SnapControlsProps) {
  const theme = THEMES[variant];
  return (
    <div
      role="group"
      aria-label="Привязка к сетке"
      className={
        "inline-flex items-center gap-0.5 rounded-lg p-1 " +
        theme.container +
        " " +
        (className ?? "")
      }
    >
      <Magnet className={"mr-0.5 h-3.5 w-3.5 " + theme.icon} aria-hidden />
      {STEPS.map((s) => {
        const isActive = Math.abs(s.step - step) < 1e-6;
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => onChange(s.step)}
            title={s.hint}
            aria-pressed={isActive}
            className={
              "min-w-[2rem] rounded-md px-1.5 py-0.5 text-[11px] font-medium transition " +
              (isActive ? theme.active : theme.idle)
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
