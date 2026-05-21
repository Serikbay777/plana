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

export type EditorState = {
  project: LayoutProject | null;     // null = ничего ещё не сгенерировано
  initialProject: LayoutProject | null; // снэпшот «как сгенерировал AI» — для RESET_EDITS
  history: LayoutProject[];
  hIdx: number;                       // -1 если history пуст
  selected: RoomRef | null;
  editMode: boolean;
};

export const initialEditorState: EditorState = {
  project: null,
  initialProject: null,
  history: [],
  hIdx: -1,
  selected: null,
  editMode: false,
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
  | { type: "SET_EDIT_MODE"; on: boolean }
  | { type: "SET_ACTIVE_FLOOR"; idx: number }
  | { type: "ADD_FLOOR"; level?: number; label?: string }
  | { type: "DUPLICATE_ACTIVE_FLOOR" }
  | { type: "DELETE_ACTIVE_FLOOR" }
  | { type: "CLEAR" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SNAP_M = 0.1;
const snap = (v: number) => Math.round(v / SNAP_M) * SNAP_M;

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
): LayoutFloor {
  const next = typeof structuredClone === "function"
    ? structuredClone(layout)
    : (JSON.parse(JSON.stringify(layout)) as LayoutFloor);
  const room =
    next.sections[ref.sectionIdx]?.apartments[ref.aptIdx]?.rooms[ref.roomIdx];
  if (room) {
    room.x = Math.max(0, snap(newX));
    room.y = Math.max(0, snap(newY));
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
      const cur = getActiveFloor(state.project);
      const newFloor = moveRoomInFloor(cur, action.ref, action.newX, action.newY);
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
      return { ...state, selected: action.ref };

    case "SET_EDIT_MODE":
      return { ...state, editMode: action.on, selected: action.on ? state.selected : null };

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

    case "CLEAR":
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
