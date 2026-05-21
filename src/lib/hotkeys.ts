// Hotkeys — Sprint 3 v1.0 plan.
//
// Один источник правды для всех keyboard-шорткатов редактора. Определения
// (def-объекты с label и категорией) используются и HotkeysHelp-модалкой,
// и собственно матчингом в useEditorHotkeys.

import { type ToolKind, type EditorMode, type LayerId } from "./projectReducer";

export type HotkeyCategory = "tools" | "modes" | "navigation" | "editing" | "view" | "help";

export type HotkeyDef = {
  id: string;            // уникальный, для документации
  keys: string;          // отображаемая комбинация: "V", "Ctrl+Z", "Shift+Drag" и т.п.
  label: string;         // человекочитаемое описание
  category: HotkeyCategory;
};

/** Полный каталог hotkey'ев — для HotkeysHelp и для будущей кастомизации. */
export const HOTKEYS: ReadonlyArray<HotkeyDef> = [
  // Tools
  { id: "tool.select",   keys: "V", label: "Инструмент: Выбор", category: "tools" },
  { id: "tool.pan",      keys: "H", label: "Инструмент: Панорама", category: "tools" },
  { id: "tool.wall",     keys: "W", label: "Инструмент: Стена", category: "tools" },
  { id: "tool.door",     keys: "D", label: "Инструмент: Дверь", category: "tools" },
  { id: "tool.window",   keys: "N", label: "Инструмент: Окно", category: "tools" },
  { id: "tool.stair",    keys: "S", label: "Инструмент: Лестница", category: "tools" },
  { id: "tool.room",     keys: "R", label: "Инструмент: Комната", category: "tools" },
  { id: "tool.furniture", keys: "F", label: "Инструмент: Мебель", category: "tools" },
  { id: "tool.measure",  keys: "M", label: "Инструмент: Линейка", category: "tools" },
  { id: "tool.eraser",   keys: "E", label: "Инструмент: Ластик", category: "tools" },
  // Modes
  { id: "mode.edit",      keys: "1", label: "Режим: Edit", category: "modes" },
  { id: "mode.build",     keys: "2", label: "Режим: Build", category: "modes" },
  { id: "mode.finishes",  keys: "3", label: "Режим: Finishes", category: "modes" },
  { id: "mode.objects",   keys: "4", label: "Режим: Objects", category: "modes" },
  { id: "mode.visualize", keys: "5", label: "Режим: Visualize", category: "modes" },
  // Navigation
  { id: "floor.prev",  keys: "[", label: "Предыдущий этаж", category: "navigation" },
  { id: "floor.next",  keys: "]", label: "Следующий этаж", category: "navigation" },
  // Editing
  { id: "edit.undo",   keys: "Ctrl+Z", label: "Отменить", category: "editing" },
  { id: "edit.redo",   keys: "Ctrl+Y / Ctrl+Shift+Z", label: "Повторить", category: "editing" },
  { id: "edit.lock",   keys: "L", label: "Заблокировать выделение (S5)", category: "editing" },
  { id: "edit.delete", keys: "Delete", label: "Удалить выделение (S5)", category: "editing" },
  { id: "edit.escape", keys: "Esc", label: "Снять выделение", category: "editing" },
  // View
  { id: "view.grid",   keys: "G", label: "Сетка вкл/выкл", category: "view" },
  // Help
  { id: "help.show",   keys: "?", label: "Открыть список горячих клавиш", category: "help" },
];

// ---------------------------------------------------------------------------
// Маппинг: keyboard event → action.
// Возвращает {kind, payload} либо null. Чёрный ящик для useEditorHotkeys.
// ---------------------------------------------------------------------------

export type HotkeyMatch =
  | { kind: "setTool"; tool: ToolKind }
  | { kind: "setMode"; mode: EditorMode }
  | { kind: "toggleLayer"; id: LayerId }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "floorPrev" }
  | { kind: "floorNext" }
  | { kind: "lock" }
  | { kind: "deleteSelected" }
  | { kind: "escape" }
  | { kind: "openHelp" };

/** Безопасно ли реагировать на key event сейчас? (нет — если фокус в input/textarea) */
export function isEventInTextField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
}

export function matchHotkey(e: KeyboardEvent): HotkeyMatch | null {
  if (isEventInTextField(e)) return null;
  const k = e.key;
  const lower = k.toLowerCase();
  const isMod = e.ctrlKey || e.metaKey;

  // Editing — Ctrl/Cmd combos сначала.
  if (isMod && lower === "z" && !e.shiftKey) return { kind: "undo" };
  if (isMod && (lower === "y" || (lower === "z" && e.shiftKey))) return { kind: "redo" };

  // Без модификаторов — простые буквы и цифры.
  if (isMod || e.altKey) return null;

  // Tools (single-letter)
  switch (lower) {
    case "v": return { kind: "setTool", tool: "select" };
    case "h": return { kind: "setTool", tool: "pan" };
    case "w": return { kind: "setTool", tool: "wall" };
    case "d": return { kind: "setTool", tool: "door" };
    case "n": return { kind: "setTool", tool: "window" };
    case "s": return { kind: "setTool", tool: "stair" };
    case "r": return { kind: "setTool", tool: "room" };
    case "f": return { kind: "setTool", tool: "furniture" };
    case "m": return { kind: "setTool", tool: "measure" };
    case "e": return { kind: "setTool", tool: "eraser" };
    case "l": return { kind: "lock" };
    case "g": return { kind: "toggleLayer", id: "grid" };
  }

  // Modes (цифры).
  switch (k) {
    case "1": return { kind: "setMode", mode: "edit" };
    case "2": return { kind: "setMode", mode: "build" };
    case "3": return { kind: "setMode", mode: "finishes" };
    case "4": return { kind: "setMode", mode: "objects" };
    case "5": return { kind: "setMode", mode: "visualize" };
  }

  // Navigation
  if (k === "[") return { kind: "floorPrev" };
  if (k === "]") return { kind: "floorNext" };

  // Special
  if (k === "Escape") return { kind: "escape" };
  if (k === "Delete" || k === "Backspace") return { kind: "deleteSelected" };
  if (k === "?" || (e.shiftKey && k === "/")) return { kind: "openHelp" };

  return null;
}
