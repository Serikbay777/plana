"use client";

// FootprintEditor — выбор формы контура здания (Sprint 4 v1.0 plan).
// Presets: Rect / L / T / U / Custom. Custom — заготовка под polygon edit
// (v1.5), пока ведёт себя как Rect.

import { type FootprintShape } from "@/lib/engine";

export type FootprintEditorProps = {
  shape: FootprintShape;
  width: number;     // м
  depth: number;     // м
  onChange: (next: { shape: FootprintShape; width: number; depth: number }) => void;
};

type Preset = {
  id: FootprintShape;
  label: string;
  /** SVG path для preview в кв. области (0..100). */
  path: string;
  disabled?: boolean;
};

// Все формы рендерим в окно 100×100, выровненные «здание занимает примерно
// 80% от области».
const PRESETS: ReadonlyArray<Preset> = [
  { id: "rect",   label: "Прямоугольник",    path: "M 15 15 H 85 V 85 H 15 Z" },
  { id: "l",      label: "L-образная",       path: "M 15 15 H 60 V 50 H 85 V 85 H 15 Z" },
  { id: "t",      label: "T-образная",       path: "M 15 15 H 85 V 40 H 60 V 85 H 40 V 40 H 15 Z" },
  { id: "u",      label: "U-образная",       path: "M 15 15 H 35 V 60 H 65 V 15 H 85 V 85 H 15 Z" },
  { id: "custom", label: "Произвольный",     path: "M 20 20 L 70 15 L 85 50 L 80 85 L 25 80 Z", disabled: true },
];

export function FootprintEditor({
  shape, width, depth, onChange,
}: FootprintEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-500">
          Форма контура
        </div>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map((p) => {
            const isActive = p.id === shape;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !p.disabled && onChange({ shape: p.id, width, depth })}
                disabled={p.disabled}
                title={p.disabled ? `${p.label} — в v1.5` : p.label}
                className={
                  "group flex flex-col items-center gap-1 rounded-lg border p-2 transition " +
                  (p.disabled
                    ? "border-zinc-100 bg-zinc-50 text-zinc-300 cursor-not-allowed"
                    : isActive
                    ? "border-zinc-900 bg-zinc-900 text-white shadow"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50")
                }
              >
                <svg
                  viewBox="0 0 100 100"
                  className="h-10 w-10"
                  aria-hidden
                >
                  <path
                    d={p.path}
                    fill={isActive ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.04)"}
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinejoin="miter"
                  />
                </svg>
                <span className="text-[10.5px] font-medium leading-tight text-center">
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-500">
          Габариты здания
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-zinc-500 mb-1">
              Ширина (м)
            </label>
            <input
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={width}
              onChange={(e) => onChange({ shape, width: Number(e.target.value), depth })}
              className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-zinc-400"
            />
          </div>
          <span className="pb-2 text-[14px] text-zinc-400">×</span>
          <div className="flex-1">
            <label className="block text-[11px] text-zinc-500 mb-1">
              Глубина (м)
            </label>
            <input
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={depth}
              onChange={(e) => onChange({ shape, width, depth: Number(e.target.value) })}
              className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-zinc-400"
            />
          </div>
        </div>
        <div className="mt-1 text-[10.5px] text-zinc-500">
          Площадь застройки ≈ {(width * depth).toFixed(0)} м²
        </div>
      </div>
    </div>
  );
}
