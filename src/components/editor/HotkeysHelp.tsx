"use client";

// HotkeysHelp — модалка со списком всех hotkey'ев. Открывается клавишей ?.
// Sprint 3 v1.0 plan.

import { X } from "lucide-react";
import { HOTKEYS, type HotkeyCategory } from "@/lib/hotkeys";

export type HotkeysHelpProps = {
  open: boolean;
  onClose: () => void;
};

const CATEGORY_TITLES: Record<HotkeyCategory, string> = {
  tools:      "Инструменты",
  modes:      "Режимы",
  navigation: "Навигация",
  editing:    "Редактирование",
  view:       "Вид",
  help:       "Справка",
};

const CATEGORY_ORDER: HotkeyCategory[] = [
  "tools", "modes", "navigation", "editing", "view", "help",
];

export function HotkeysHelp({ open, onClose }: HotkeysHelpProps) {
  if (!open) return null;

  // Группировка hotkey'ев по категориям
  const byCategory: Record<HotkeyCategory, typeof HOTKEYS> = {
    tools: [], modes: [], navigation: [], editing: [], view: [], help: [],
  };
  for (const h of HOTKEYS) {
    byCategory[h.category] = [...byCategory[h.category], h];
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Горячие клавиши"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-[14px] font-semibold text-white tracking-display">
            Горячие клавиши
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/55 hover:bg-white/[0.06] hover:text-white"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-5 py-4 md:grid-cols-2">
          {CATEGORY_ORDER.map((cat) => {
            const items = byCategory[cat];
            if (items.length === 0) return null;
            return (
              <section key={cat}>
                <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/40">
                  {CATEGORY_TITLES[cat]}
                </h3>
                <ul className="flex flex-col gap-1">
                  {items.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-white/[0.03]"
                    >
                      <span className="text-[12px] text-white/80 leading-tight">
                        {h.label}
                      </span>
                      <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] font-mono text-white/75">
                        {h.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="border-t border-white/10 px-5 py-2 text-[10.5px] text-white/40">
          Подсказка: чтобы открыть это окно ещё раз — нажми <kbd className="rounded border border-white/15 bg-white/[0.05] px-1 py-0.5 font-mono">?</kbd> где угодно в редакторе.
        </div>
      </div>
    </div>
  );
}
