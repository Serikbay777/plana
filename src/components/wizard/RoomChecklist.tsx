"use client";

// RoomChecklist — программа помещений в wizard'е (Sprint 4 v1.0 plan).
// Список комнат с +/– counter'ом. На v1 — фиксированный набор; user-defined
// rooms (custom kinds) откладываются в v1.5.

import { Minus, Plus } from "lucide-react";
import { type RoomReq, type RoomReqKind } from "@/lib/engine";

export type RoomChecklistProps = {
  rooms: RoomReq[];
  onChange: (next: RoomReq[]) => void;
};

const ROOM_LABELS: Record<RoomReqKind, string> = {
  bedroom:  "Спальня",
  bathroom: "Санузел",
  kitchen:  "Кухня",
  living:   "Гостиная",
  dining:   "Столовая",
  office:   "Кабинет",
  garage:   "Гараж",
  utility:  "Подсобка",
  storage:  "Кладовка",
};

const ROOM_HINTS: Record<RoomReqKind, string> = {
  bedroom:  "от 9 м²",
  bathroom: "совмещённые / раздельные",
  kitchen:  "от 6 м²",
  living:   "обычно 16-30 м²",
  dining:   "может быть кухня-столовая",
  office:   "рабочая комната",
  garage:   "1-2 машины",
  utility:  "стиральная, гладильная",
  storage:  "в т.ч. встроенная",
};

const DEFAULT_ORDER: ReadonlyArray<RoomReqKind> = [
  "bedroom", "bathroom", "kitchen", "living",
  "dining", "office", "garage", "utility", "storage",
];

export const DEFAULT_ROOMS: RoomReq[] = [
  { kind: "bedroom",  count: 2 },
  { kind: "bathroom", count: 1 },
  { kind: "kitchen",  count: 1 },
  { kind: "living",   count: 1 },
  { kind: "dining",   count: 0 },
  { kind: "office",   count: 0 },
  { kind: "garage",   count: 0 },
  { kind: "utility",  count: 0 },
  { kind: "storage",  count: 0 },
];

function setCount(rooms: RoomReq[], kind: RoomReqKind, delta: number): RoomReq[] {
  const next = rooms.map((r) =>
    r.kind === kind ? { ...r, count: Math.max(0, r.count + delta) } : r,
  );
  if (next.find((r) => r.kind === kind)) return next;
  // Если по какой-то причине нет такой записи — добавим
  return [...next, { kind, count: Math.max(0, delta) }];
}

export function RoomChecklist({ rooms, onChange }: RoomChecklistProps) {
  const byKind = new Map(rooms.map((r) => [r.kind, r.count]));

  const totalRooms = rooms.reduce((s, r) => s + r.count, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-wider text-zinc-500">
          Состав помещений
        </div>
        <div className="text-[10.5px] text-zinc-500">
          Всего: {totalRooms}
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {DEFAULT_ORDER.map((kind) => {
          const count = byKind.get(kind) ?? 0;
          return (
            <li
              key={kind}
              className={
                "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 " +
                (count > 0
                  ? "border-zinc-300 bg-white"
                  : "border-zinc-150 bg-zinc-50")
              }
            >
              <div className="flex flex-col min-w-0">
                <span className={"text-[12px] font-medium " + (count > 0 ? "text-zinc-900" : "text-zinc-500")}>
                  {ROOM_LABELS[kind]}
                </span>
                <span className="text-[10px] text-zinc-400 truncate">
                  {ROOM_HINTS[kind]}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onChange(setCount(rooms, kind, -1))}
                  disabled={count === 0}
                  aria-label="Меньше"
                  className="grid h-6 w-6 place-items-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span
                  className={
                    "min-w-[1.5rem] text-center text-[12.5px] font-mono font-semibold " +
                    (count > 0 ? "text-zinc-900" : "text-zinc-400")
                  }
                >
                  {count}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(setCount(rooms, kind, +1))}
                  aria-label="Больше"
                  className="grid h-6 w-6 place-items-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
