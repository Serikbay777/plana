// Reducer для arch-drawings editor — Sprint 1 v1.0 plan.
//
// Объединяет в один state-машину то, что раньше жило россыпью useState/useRef
// в ArchitecturalDrawingsTab: editedLayout / history / hIdx / selected / editMode.
// Также подготавливает multi-floor: state поверх LayoutProject, а не LayoutFloor.
//
// Дизайн: reducer возвращает целиком новый EditorState. History хранит снэпшоты
// project'а целиком (один dispatch COMMIT_HISTORY = одна запись). Все мутации —
// pure, без сайд-эффектов.

import {
  type LayoutFloor,
  type LayoutProject,
  type FloorEntry,
  wrapAsProject,
  getActiveFloor,
  updateActiveFloor,
} from "./engine";

export type RoomRef = {
  sectionIdx: number;
  aptIdx: number;
  roomIdx: number;
};

// Инструменты левого toolbar (Sprint 2 — заглушки, активная логика на Sprint 3).
export type ToolKind =
  | "select"     // V — стрелка выбора
  | "pan"        // H / Space — перемещение по канвасу
  | "wall"       // W — рисование стены
  | "door"       // D
  | "window"     // N
  | "stair"      // S
  | "room"       // R — прямоугольная комната
  | "furniture"  // F — открыть каталог
  | "measure"    // M — линейка
  | "dimension"  // Dim — постоянная размерная линия
  | "eraser";    // E

// Mode tabs сверху canvas (по Maket).
export type EditorMode =
  | "edit"       // геометрия: стены, комнаты
  | "build"      // конструкция: толщины, материалы стен
  | "finishes"   // отделка
  | "objects"    // мебель / сантехника
  | "visualize"; // 3D / рендер

// Видимость и блокировка слоёв.
export type LayerId =
  | "walls"
  | "rooms"
  | "doors"
  | "windows"
  | "furniture"
  | "dimensions"
  | "axes"        // координатные оси А-Ж / 1-N (СПДС)
  | "texts"
  | "grid"
  | "scaleBar";

export type LayerState = { visible: boolean; locked: boolean };
export type LayersState = Record<LayerId, LayerState>;

const ALL_LAYERS: LayerId[] = [
  "walls", "rooms", "doors", "windows",
  "furniture", "dimensions", "axes", "texts", "grid", "scaleBar",
];

function defaultLayers(): LayersState {
  const result = {} as LayersState;
  for (const id of ALL_LAYERS) {
    result[id] = { visible: true, locked: false };
  }
  return result;
}

// Snap settings (Sprint 3). step=0 → off (без привязки к сетке).
// snapToAngle и snapToWall — заготовки для S3 / S5; пока влияют только на
// будущие drawing-инструменты, не на drag комнат.
export type SnapSettings = {
  step: number;          // шаг сетки в метрах: 0 (off) / 0.1 / 0.5 / 1.0
  snapToAngle: boolean;  // только 0/45/90 для draw tools
  snapToWall: boolean;   // привязка к end-points и серединам стен
};

const DEFAULT_SNAP: SnapSettings = {
  step: 0.1,
  snapToAngle: true,
  snapToWall: true,
};

export type EditorState = {
  project: LayoutProject | null;     // null = ничего ещё не сгенерировано
  initialProject: LayoutProject | null; // снэпшот «как сгенерировал AI» — для RESET_EDITS
  history: LayoutProject[];
  hIdx: number;                       // -1 если history пуст
  /** Primary-selection — обратная совместимость с D-2 кодом (outline, drag). */
  selected: RoomRef | null;
  /** Полный набор выделенных объектов — Sprint 3+. Содержит primary первым элементом. */
  selection: RoomRef[];
  /**
   * Заблокированные комнаты — Sprint 5. Lock как UI-фича, НЕ часть data model
   * (LayoutRoom на бэке без поля locked, чтобы не ломать существующий контракт).
   * Drag/MOVE_ROOM игнорирует заблокированные. Передаются в editLayoutWithChat
   * как hint для prompt-injection (backend должен их уважать — TODO).
   */
  lockedRefs: RoomRef[];
  editMode: boolean;
  tool: ToolKind;
  mode: EditorMode;
  layers: LayersState;
  snap: SnapSettings;
};

export const initialEditorState: EditorState = {
  project: null,
  initialProject: null,
  history: [],
  hIdx: -1,
  selected: null,
  selection: [],
  lockedRefs: [],
  editMode: false,
  tool: "select",
  mode: "edit",
  layers: defaultLayers(),
  snap: DEFAULT_SNAP,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EditorAction =
  | { type: "SET_PROJECT_FROM_LAYOUT"; layout: LayoutFloor; name?: string }
  | { type: "SET_PROJECT"; project: LayoutProject }
  | { type: "MOVE_ROOM"; ref: RoomRef; newX: number; newY: number }
  | { type: "REPLACE_ACTIVE_FLOOR"; layout: LayoutFloor; pushHistory?: boolean }
  | { type: "COMMIT_HISTORY" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET_EDITS" }
  | { type: "SELECT_ROOM"; ref: RoomRef | null }
  | { type: "TOGGLE_SELECT_ROOM"; ref: RoomRef }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_EDIT_MODE"; on: boolean }
  | { type: "SET_ACTIVE_FLOOR"; idx: number }
  | { type: "ADD_FLOOR"; level?: number; label?: string }
  | { type: "DUPLICATE_ACTIVE_FLOOR" }
  | { type: "DELETE_ACTIVE_FLOOR" }
  | { type: "SET_TOOL"; tool: ToolKind }
  | { type: "SET_MODE"; mode: EditorMode }
  | { type: "TOGGLE_LAYER"; id: LayerId }
  | { type: "SET_LAYER_VISIBLE"; id: LayerId; visible: boolean }
  | { type: "SET_LAYER_LOCKED"; id: LayerId; locked: boolean }
  | { type: "SET_SNAP"; snap: Partial<SnapSettings> }
  | { type: "TOGGLE_LOCK_REF"; ref: RoomRef }
  | { type: "LOCK_SELECTION" }
  | { type: "UNLOCK_ALL" }
  | { type: "CLEAR" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Привязать значение к шагу сетки. step=0 → возвращаем как есть. */
function snapValue(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

/** Сравнение RoomRef по содержимому. */
export function sameRef(a: RoomRef, b: RoomRef): boolean {
  return a.sectionIdx === b.sectionIdx
    && a.aptIdx === b.aptIdx
    && a.roomIdx === b.roomIdx;
}

/** Входит ли ref в selection. Для рендера outline на canvas. */
export function isInSelection(selection: RoomRef[], ref: RoomRef): boolean {
  return selection.some((r) => sameRef(r, ref));
}

/** Заблокирована ли комната. */
export function isLocked(lockedRefs: RoomRef[], ref: RoomRef): boolean {
  return lockedRefs.some((r) => sameRef(r, ref));
}

function cloneProject(p: LayoutProject): LayoutProject {
  return typeof structuredClone === "function"
    ? structuredClone(p)
    : (JSON.parse(JSON.stringify(p)) as LayoutProject);
}

function moveRoomInFloor(
  layout: LayoutFloor,
  ref: RoomRef,
  newX: number,
  newY: number,
  step: number,
): LayoutFloor {
  const next = typeof structuredClone === "function"
    ? structuredClone(layout)
    : (JSON.parse(JSON.stringify(layout)) as LayoutFloor);
  const room =
    next.sections[ref.sectionIdx]?.apartments[ref.aptIdx]?.rooms[ref.roomIdx];
  if (room) {
    room.x = Math.max(0, snapValue(newX, step));
    room.y = Math.max(0, snapValue(newY, step));
  }
  return next;
}

function emptyFloor(width = 12, depth = 10): LayoutFloor {
  return { width_m: width, depth_m: depth, sections: [] };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function projectReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "SET_PROJECT_FROM_LAYOUT": {
      const project = wrapAsProject(action.layout, action.name);
      return {
        ...state,
        project,
        initialProject: project,
        history: [project],
        hIdx: 0,
        selected: null,
        editMode: false,
      };
    }

    case "SET_PROJECT": {
      const project = action.project;
      return {
        ...state,
        project,
        initialProject: project,
        history: [project],
        hIdx: 0,
        selected: null,
        editMode: false,
      };
    }

    case "MOVE_ROOM": {
      if (!state.project) return state;
      // Заблокированные комнаты не двигаются
      if (state.lockedRefs.some((r) => sameRef(r, action.ref))) return state;
      const cur = getActiveFloor(state.project);
      const newFloor = moveRoomInFloor(
        cur, action.ref, action.newX, action.newY, state.snap.step,
      );
      const newProject = updateActiveFloor(state.project, newFloor);
      // history НЕ пушим — это идёт через COMMIT_HISTORY на mouseup
      return { ...state, project: newProject };
    }

    case "REPLACE_ACTIVE_FLOOR": {
      if (!state.project) return state;
      const newProject = updateActiveFloor(state.project, action.layout);
      if (action.pushHistory) {
        const trimmed = state.history.slice(0, state.hIdx + 1);
        const nextHistory = [...trimmed, cloneProject(newProject)];
        return {
          ...state,
          project: newProject,
          history: nextHistory,
          hIdx: nextHistory.length - 1,
        };
      }
      return { ...state, project: newProject };
    }

    case "COMMIT_HISTORY": {
      if (!state.project) return state;
      const trimmed = state.history.slice(0, state.hIdx + 1);
      const last = trimmed[trimmed.length - 1];
      // Если ничего не изменилось — не пушим
      if (last && JSON.stringify(last) === JSON.stringify(state.project)) {
        return state;
      }
      const nextHistory = [...trimmed, cloneProject(state.project)];
      return { ...state, history: nextHistory, hIdx: nextHistory.length - 1 };
    }

    case "UNDO": {
      if (state.hIdx <= 0) return state;
      const newIdx = state.hIdx - 1;
      return {
        ...state,
        project: cloneProject(state.history[newIdx]!),
        hIdx: newIdx,
      };
    }

    case "REDO": {
      if (state.hIdx < 0 || state.hIdx >= state.history.length - 1) return state;
      const newIdx = state.hIdx + 1;
      return {
        ...state,
        project: cloneProject(state.history[newIdx]!),
        hIdx: newIdx,
      };
    }

    case "RESET_EDITS": {
      if (!state.initialProject) return state;
      const fresh = cloneProject(state.initialProject);
      return {
        ...state,
        project: fresh,
        history: [fresh],
        hIdx: 0,
        selected: null,
      };
    }

    case "SELECT_ROOM":
      return {
        ...state,
        selected: action.ref,
        selection: action.ref ? [action.ref] : [],
      };

    case "TOGGLE_SELECT_ROOM": {
      const idx = state.selection.findIndex((r) => sameRef(r, action.ref));
      if (idx >= 0) {
        // remove
        const next = state.selection.filter((_, i) => i !== idx);
        return { ...state, selection: next, selected: next[0] ?? null };
      }
      // add: новый идёт в primary
      const next = [action.ref, ...state.selection];
      return { ...state, selection: next, selected: action.ref };
    }

    case "CLEAR_SELECTION":
      return { ...state, selection: [], selected: null };

    case "SET_EDIT_MODE":
      return {
        ...state,
        editMode: action.on,
        selected: action.on ? state.selected : null,
        selection: action.on ? state.selection : [],
      };

    case "SET_ACTIVE_FLOOR": {
      if (!state.project) return state;
      const idx = Math.max(0, Math.min(action.idx, state.project.floors.length - 1));
      if (idx === state.project.activeFloorIdx) return state;
      return {
        ...state,
        project: { ...state.project, activeFloorIdx: idx },
        selected: null,
      };
    }

    case "ADD_FLOOR": {
      if (!state.project) return state;
      const existingLevels = state.project.floors.map((f) => f.level);
      const nextLevel =
        action.level ?? Math.max(0, ...existingLevels) + 1;
      const entry: FloorEntry = {
        level: nextLevel,
        label: action.label ?? `${nextLevel} этаж`,
        layout: emptyFloor(),
      };
      const floors = [...state.project.floors, entry];
      return {
        ...state,
        project: {
          ...state.project,
          floors,
          activeFloorIdx: floors.length - 1,
          meta: { ...state.project.meta, updatedAt: new Date().toISOString() },
        },
      };
    }

    case "DUPLICATE_ACTIVE_FLOOR": {
      if (!state.project) return state;
      const src = state.project.floors[state.project.activeFloorIdx]!;
      const existingLevels = state.project.floors.map((f) => f.level);
      const nextLevel = Math.max(0, ...existingLevels) + 1;
      const dup: FloorEntry = {
        level: nextLevel,
        label: `${nextLevel} этаж`,
        layout: typeof structuredClone === "function"
          ? structuredClone(src.layout)
          : (JSON.parse(JSON.stringify(src.layout)) as LayoutFloor),
      };
      const floors = [...state.project.floors, dup];
      return {
        ...state,
        project: {
          ...state.project,
          floors,
          activeFloorIdx: floors.length - 1,
          meta: { ...state.project.meta, updatedAt: new Date().toISOString() },
        },
      };
    }

    case "DELETE_ACTIVE_FLOOR": {
      if (!state.project) return state;
      if (state.project.floors.length <= 1) return state; // нельзя удалять последний
      const floors = state.project.floors.filter((_, i) => i !== state.project!.activeFloorIdx);
      const idx = Math.min(state.project.activeFloorIdx, floors.length - 1);
      return {
        ...state,
        project: {
          ...state.project,
          floors,
          activeFloorIdx: idx,
          meta: { ...state.project.meta, updatedAt: new Date().toISOString() },
        },
        selected: null,
      };
    }

    case "SET_TOOL":
      return { ...state, tool: action.tool };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "TOGGLE_LAYER": {
      const cur = state.layers[action.id];
      return {
        ...state,
        layers: { ...state.layers, [action.id]: { ...cur, visible: !cur.visible } },
      };
    }

    case "SET_LAYER_VISIBLE":
      return {
        ...state,
        layers: {
          ...state.layers,
          [action.id]: { ...state.layers[action.id], visible: action.visible },
        },
      };

    case "SET_LAYER_LOCKED":
      return {
        ...state,
        layers: {
          ...state.layers,
          [action.id]: { ...state.layers[action.id], locked: action.locked },
        },
      };

    case "SET_SNAP":
      return { ...state, snap: { ...state.snap, ...action.snap } };

    case "TOGGLE_LOCK_REF": {
      const idx = state.lockedRefs.findIndex((r) => sameRef(r, action.ref));
      const next = idx >= 0
        ? state.lockedRefs.filter((_, i) => i !== idx)
        : [...state.lockedRefs, action.ref];
      return { ...state, lockedRefs: next };
    }

    case "LOCK_SELECTION": {
      if (state.selection.length === 0) return state;
      // Добавляем все выделенные, которые ещё не заблокированы
      const additions = state.selection.filter(
        (s) => !state.lockedRefs.some((l) => sameRef(l, s)),
      );
      if (additions.length === 0) return state;
      return { ...state, lockedRefs: [...state.lockedRefs, ...additions] };
    }

    case "UNLOCK_ALL":
      return { ...state, lockedRefs: [] };

    case "CLEAR":
      // tool/mode/layers сбрасываются вместе с проектом
      return initialEditorState;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Selectors (для удобства потребителей reducer'а)
// ---------------------------------------------------------------------------

export function selectCurrentLayout(state: EditorState): LayoutFloor | null {
  return state.project ? getActiveFloor(state.project) : null;
}

export function selectCanUndo(state: EditorState): boolean {
  return state.hIdx > 0;
}

export function selectCanRedo(state: EditorState): boolean {
  return state.hIdx >= 0 && state.hIdx < state.history.length - 1;
}
