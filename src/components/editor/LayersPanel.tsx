"use client";

// LayersPanel — список слоёв с чекбоксами видимости и lock-иконкой.
// Sprint 2 v1.0 plan: визуальная видимость переключается; lock сохраняется в
// reducer, но логику «нельзя редактировать заблокированный слой» подключаем
// позднее (она привязана к multi-select / drag-логике из Sprint 3 и lock от AI
// из Sprint 5).

import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { type LayerId, type LayersState } from "@/lib/projectReducer";

export type LayersPanelProps = {
  layers: LayersState;
  onToggleVisible: (id: LayerId) => void;
  onToggleLocked?: (id: LayerId) => void;
  variant?: "light" | "dark";
  className?: string;
};

const LAYER_LABELS: Record<LayerId, string> = {
  walls: "Стены",
  rooms: "Комнаты",
  doors: "Двери",
  windows: "Окна",
  furniture: "Мебель",
  dimensions: "Размеры",
  axes: "Оси (А-Ж/1-N)",
  texts: "Подписи",
  grid: "Сетка",
  scaleBar: "Линейка",
};

const ORDER: LayerId[] = [
  "walls", "rooms", "doors", "windows",
  "furniture", "dimensions", "axes", "texts", "grid", "scaleBar",
];

const THEMES = {
  light: {
    container: "border border-zinc-200 bg-white shadow-sm",
    title: "text-zinc-500",
    row: "hover:bg-zinc-50",
    label: "text-zinc-700",
    iconOn: "text-zinc-700",
    iconOff: "text-zinc-300",
    lockOn: "text-amber-600",
    lockOff: "text-zinc-300 hover:text-zinc-500",
  },
  dark: {
    container: "border border-white/15 bg-white/[0.04]",
    title: "text-white/40",
    row: "hover:bg-white/[0.04]",
    label: "text-white/80",
    iconOn: "text-white/80",
    iconOff: "text-white/25",
    lockOn: "text-amber-300",
    lockOff: "text-white/25 hover:text-white/60",
  },
} as const;

export function LayersPanel({
  layers,
  onToggleVisible,
  onToggleLocked,
  variant = "light",
  className,
}: LayersPanelProps) {
  const theme = THEMES[variant];

  return (
    <div
      className={
        "rounded-lg p-1 " + theme.container + " " + (className ?? "")
      }
      role="group"
      aria-label="Слои"
    >
      <div
        className={
          "px-2 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wider " +
          theme.title
        }
      >
        Слои
      </div>
      <ul className="flex flex-col">
        {ORDER.map((id) => {
          const layer = layers[id];
          return (
            <li
              key={id}
              className={
                "flex items-center justify-between gap-2 rounded-md px-2 py-1 transition " +
                theme.row
              }
            >
              <button
                type="button"
                onClick={() => onToggleVisible(id)}
                title={layer.visible ? "Скрыть слой" : "Показать слой"}
                aria-label={layer.visible ? "Скрыть слой" : "Показать слой"}
                aria-pressed={layer.visible}
                className="flex flex-1 items-center gap-2 text-left"
              >
                {layer.visible ? (
                  <Eye className={"h-3.5 w-3.5 " + theme.iconOn} />
                ) : (
                  <EyeOff className={"h-3.5 w-3.5 " + theme.iconOff} />
                )}
                <span
                  className={
                    "text-[12px] " +
                    (layer.visible ? theme.label : theme.iconOff)
                  }
                >
                  {LAYER_LABELS[id]}
                </span>
              </button>

              {onToggleLocked && (
                <button
                  type="button"
                  onClick={() => onToggleLocked(id)}
                  title={layer.locked ? "Разблокировать слой" : "Заблокировать слой"}
                  aria-label={layer.locked ? "Разблокировать слой" : "Заблокировать слой"}
                  aria-pressed={layer.locked}
                  className="rounded p-0.5"
                >
                  {layer.locked ? (
                    <Lock className={"h-3 w-3 " + theme.lockOn} />
                  ) : (
                    <Unlock className={"h-3 w-3 " + theme.lockOff} />
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
