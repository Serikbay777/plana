"use client";

// Album Viewer — рендерит альбом чертежей из LayoutAlbum (Sprint 1 MVP).
// Каждый лист — A4 landscape с рамкой и штампом, как в реальных
// архитектурных альбомах (TAIMAS-стиль).

import { useMemo } from "react";
import { FloorPlanSvg } from "./ArchitecturalDrawingsTab";
import type {
  LayoutAlbum, AlbumSheet, LayoutFloor, LayoutRoom, LayoutDoor, LayoutWindow,
} from "@/lib/engine";

const ROOM_LABEL: Record<string, string> = {
  living: "Гостиная",
  bedroom: "Спальня",
  kitchen: "Кухня",
  bathroom: "Сан.узел",
  toilet: "С/У",
  hallway: "Прихожая",
  loggia: "Лоджия",
  storage: "Кладовая",
};

const SIDE_LABEL: Record<string, string> = {
  S: "Юг", N: "Север", W: "Запад", E: "Восток",
};


export function AlbumViewer({
  album,
  inputs,
}: {
  album: LayoutAlbum;
  inputs: {
    floors: number;
    sections: number;
    lifts_passenger: number;
    lifts_freight: number;
    site_width_m: number;
    site_depth_m: number;
    setback_front_m: number;
    setback_side_m: number;
    setback_rear_m: number;
    studio_pct: number;
    k1_pct: number;
    k2_pct: number;
    k3_pct: number;
  };
}) {
  const totalSheets = album.sheets.length;
  return (
    <div className="flex flex-col gap-6 p-5 bg-[#1f1f24]">
      <div className="text-[12px] text-white/55">
        Альбом «{album.project_name}» · {totalSheets} лист{plural(totalSheets)}
      </div>
      {album.sheets.map((sheet, i) => (
        <SheetFrame
          key={i}
          projectName={album.project_name}
          sheetIndex={i + 1}
          sheetTotal={totalSheets}
          sheetTitle={sheet.title}
        >
          <SheetContent sheet={sheet} album={album} inputs={inputs} />
        </SheetFrame>
      ))}
    </div>
  );
}


// ─── Wrapper: рамка A4 + штамп в нижнем правом ────────────────────────────

function SheetFrame({
  projectName, sheetIndex, sheetTotal, sheetTitle, children,
}: {
  projectName: string;
  sheetIndex: number;
  sheetTotal: number;
  sheetTitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow-xl overflow-hidden">
      {/* A4 landscape aspect 1.414 */}
      <div className="relative w-full" style={{ aspectRatio: "1.414/1" }}>
        {/* Внутренняя рамка чертежа */}
        <div className="absolute inset-4 border-2 border-[#1a1a1a]">
          {/* Заголовок листа в верхней области */}
          <div className="absolute top-2 left-3 right-3 flex items-end justify-between border-b border-[#1a1a1a]/30 pb-2">
            <div className="text-[14px] font-semibold tracking-wide text-[#1a1a1a] uppercase">
              {sheetTitle}
            </div>
            <div className="text-[10px] text-[#1a1a1a]/60">М 1:100</div>
          </div>

          {/* Контент */}
          <div className="absolute top-10 left-3 right-3 bottom-20 overflow-hidden">
            {children}
          </div>

          {/* Штамп СПДС в правом нижнем */}
          <Stamp
            projectName={projectName}
            sheetIndex={sheetIndex}
            sheetTotal={sheetTotal}
            sheetTitle={sheetTitle}
          />
        </div>
      </div>
    </div>
  );
}


function Stamp({
  projectName, sheetIndex, sheetTotal, sheetTitle,
}: {
  projectName: string;
  sheetIndex: number;
  sheetTotal: number;
  sheetTitle: string;
}) {
  return (
    <div
      className="absolute right-0 bottom-0 border-l border-t border-[#1a1a1a] bg-white"
      style={{ width: "32%", height: "16%" }}
    >
      <table className="w-full h-full text-[8.5px] text-[#1a1a1a]" style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr style={{ height: "40%" }}>
            <td className="border border-[#1a1a1a] px-2 align-middle" colSpan={2}>
              <div className="uppercase font-semibold leading-tight">{projectName}</div>
              <div className="text-[7.5px] text-[#1a1a1a]/55">{sheetTitle}</div>
            </td>
            <td className="border border-[#1a1a1a] px-2 text-center align-middle" style={{ width: "14%" }}>
              <div className="text-[7.5px] text-[#1a1a1a]/50">Стадия</div>
              <div className="font-semibold">ЭП</div>
            </td>
            <td className="border border-[#1a1a1a] px-2 text-center align-middle" style={{ width: "14%" }}>
              <div className="text-[7.5px] text-[#1a1a1a]/50">Лист</div>
              <div className="font-semibold tabular-nums">{sheetIndex}</div>
            </td>
            <td className="border border-[#1a1a1a] px-2 text-center align-middle" style={{ width: "14%" }}>
              <div className="text-[7.5px] text-[#1a1a1a]/50">Листов</div>
              <div className="font-semibold tabular-nums">{sheetTotal}</div>
            </td>
          </tr>
          <tr style={{ height: "60%" }}>
            <td className="border border-[#1a1a1a] px-2 align-middle" style={{ width: "26%" }}>
              <div className="text-[7.5px] text-[#1a1a1a]/50">Разработал</div>
              <div className="font-medium">Plana AI</div>
            </td>
            <td className="border border-[#1a1a1a] px-2 align-middle">
              <div className="text-[7.5px] text-[#1a1a1a]/50">Дата</div>
              <div className="font-medium tabular-nums">{new Date().toLocaleDateString("ru-RU")}</div>
            </td>
            <td className="border border-[#1a1a1a] px-2 text-center align-middle" colSpan={3}>
              <div className="text-[7.5px] text-[#1a1a1a]/50">plana.kz · автогенерация</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


// ─── Switch по типам листов ──────────────────────────────────────────────

function SheetContent({
  sheet, album, inputs,
}: {
  sheet: AlbumSheet;
  album: LayoutAlbum;
  inputs: AlbumViewerProps["inputs"];
}) {
  switch (sheet.kind) {
    case "title":
      return <TitleSheet projectName={album.project_name} album={album} inputs={inputs} />;
    case "general_data":
      return <GeneralDataSheet album={album} inputs={inputs} />;
    case "floor_plan":
      return <FloorPlanSheet layout={album.layout} />;
    case "room_explication":
      return <RoomExplicationSheet layout={album.layout} />;
    case "doors_spec":
      return <DoorsSpecSheet layout={album.layout} />;
    case "windows_spec":
      return <WindowsSpecSheet layout={album.layout} />;
    default:
      return (
        <div className="w-full h-full grid place-items-center text-[#1a1a1a]/40 text-sm">
          Лист «{sheet.title}» — будет в Спринте 2/3
        </div>
      );
  }
}

type AlbumViewerProps = Parameters<typeof AlbumViewer>[0];


// ─── Лист: Титул ──────────────────────────────────────────────────────────

function TitleSheet({
  projectName, album, inputs,
}: {
  projectName: string;
  album: LayoutAlbum;
  inputs: AlbumViewerProps["inputs"];
}) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-[#1a1a1a] px-12 py-8">
      <div className="text-[8.5px] uppercase tracking-[0.3em] text-[#1a1a1a]/55 mb-3">
        Архитектурно-строительные решения
      </div>
      <div className="text-[40px] font-bold leading-tight text-center max-w-2xl mb-1">
        {projectName}
      </div>
      <div className="text-[12px] text-[#1a1a1a]/55 mb-8">
        Многоквартирный жилой дом
      </div>

      <div className="w-32 h-px bg-[#1a1a1a]/30 mb-8" />

      <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-[11px]">
        <KV k="Габариты пятна" v={`${album.layout.width_m.toFixed(0)} × ${album.layout.depth_m.toFixed(0)} м`} />
        <KV k="Этажность" v={`${album.floors_total} эт.`} />
        <KV k="Секций" v={`${inputs.sections}`} />
        <KV k="Лифтов на секцию" v={`${inputs.lifts_passenger} пасс.${inputs.lifts_freight > 0 ? ` + ${inputs.lifts_freight} груз.` : ""}`} />
        <KV k="Дата" v={new Date().toLocaleDateString("ru-RU")} />
        <KV k="Стадия" v="ЭП" />
      </div>

      <div className="mt-auto pt-8 text-[9px] uppercase tracking-wider text-[#1a1a1a]/40">
        plana.kz · автогенерируемый альбом
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <div className="text-[8.5px] uppercase tracking-wider text-[#1a1a1a]/50">{k}</div>
      <div className="text-[12px] font-medium tabular-nums">{v}</div>
    </div>
  );
}


// ─── Лист: Общие данные ──────────────────────────────────────────────────

function GeneralDataSheet({
  album, inputs,
}: {
  album: LayoutAlbum;
  inputs: AlbumViewerProps["inputs"];
}) {
  const innerW = inputs.site_width_m - 2 * inputs.setback_side_m;
  const innerD = inputs.site_depth_m - inputs.setback_front_m - inputs.setback_rear_m;
  const floorArea = innerW * innerD;
  const totalApartments = album.layout.sections.reduce(
    (s, sec) => s + sec.apartments.length, 0,
  );
  return (
    <div className="w-full h-full grid grid-cols-2 gap-8 text-[#1a1a1a] px-6 py-4">
      <SimpleTable title="Габариты" rows={[
        ["Длина участка", `${inputs.site_width_m.toFixed(1)} м`],
        ["Ширина участка", `${inputs.site_depth_m.toFixed(1)} м`],
        ["Отступы (перед / боковые / зад)", `${inputs.setback_front_m} / ${inputs.setback_side_m} / ${inputs.setback_rear_m} м`],
        ["Пятно застройки", `${album.layout.width_m.toFixed(1)} × ${album.layout.depth_m.toFixed(1)} м`],
        ["Площадь застройки", `${floorArea.toFixed(0)} м²`],
        ["Этажность", `${album.floors_total} эт.`],
      ]} />
      <SimpleTable title="Параметры" rows={[
        ["Секций (подъездов)", `${inputs.sections}`],
        ["Пасс. лифтов / секцию", `${inputs.lifts_passenger}`],
        ["Груз. лифтов / секцию", `${inputs.lifts_freight}`],
        ["Квартир на этаже", `${totalApartments}`],
        ["Квартир всего", `${totalApartments * album.floors_total}`],
        ["Микс (студии / 1к / 2к / 3к)", `${inputs.studio_pct}% / ${inputs.k1_pct}% / ${inputs.k2_pct}% / ${inputs.k3_pct}%`],
      ]} />
    </div>
  );
}


function SimpleTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/55 mb-2 border-b border-[#1a1a1a]/40 pb-1">
        {title}
      </div>
      <table className="text-[11px]" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b border-[#1a1a1a]/10">
              <td className="py-1.5 pr-3 text-[#1a1a1a]/65">{k}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ─── Лист: План этажа ─────────────────────────────────────────────────────

function FloorPlanSheet({ layout }: { layout: LayoutFloor }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-white">
      <FloorPlanSvg layout={layout} />
    </div>
  );
}


// ─── Лист: Экспликация ───────────────────────────────────────────────────

type RoomRow = { aptNumber: number; roomIdx: number; kind: string; name: string; area: number };

function collectRooms(layout: LayoutFloor): RoomRow[] {
  const out: RoomRow[] = [];
  for (const sec of layout.sections) {
    for (const apt of sec.apartments) {
      apt.rooms.forEach((room, ri) => {
        out.push({
          aptNumber: apt.number,
          roomIdx: ri,
          kind: room.kind,
          name: room.name_ru || ROOM_LABEL[room.kind] || room.kind,
          area: room.w * room.d,
        });
      });
    }
  }
  return out;
}


function RoomExplicationSheet({ layout }: { layout: LayoutFloor }) {
  const rows = useMemo(() => collectRooms(layout), [layout]);
  const totalArea = rows.reduce((s, r) => s + r.area, 0);
  return (
    <div className="w-full h-full overflow-y-auto px-6 py-4 text-[#1a1a1a]">
      <table className="w-full text-[10px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="bg-[#1a1a1a]/8">
            <Th w="6%">№</Th>
            <Th w="14%">Квартира</Th>
            <Th w="50%">Наименование помещения</Th>
            <Th w="15%" right>Площадь, м²</Th>
            <Th w="15%">Категория</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#1a1a1a]/10">
              <Td>{i + 1}</Td>
              <Td>Кв.{r.aptNumber}</Td>
              <Td>{r.name}</Td>
              <Td right tabular>{r.area.toFixed(1)}</Td>
              <Td>{r.kind}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-[#1a1a1a] font-semibold">
            <Td colSpan={3}>Итого помещений: {rows.length}</Td>
            <Td right tabular>{totalArea.toFixed(1)}</Td>
            <Td>—</Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


// ─── Лист: Спецификация дверей ───────────────────────────────────────────

type DoorRow = { mark: string; aptNumber: number; room: string; side: string; width: number; swing: string };

function collectDoors(layout: LayoutFloor): DoorRow[] {
  const out: DoorRow[] = [];
  let counter = 1;
  for (const sec of layout.sections) {
    for (const apt of sec.apartments) {
      for (const room of apt.rooms) {
        for (const door of (room.doors ?? []) as LayoutDoor[]) {
          out.push({
            mark: `Д-${counter++}`,
            aptNumber: apt.number,
            room: room.name_ru || ROOM_LABEL[room.kind] || room.kind,
            side: SIDE_LABEL[door.side] || door.side,
            width: door.width,
            swing: door.swing === "in" ? "внутрь" : "наружу",
          });
        }
      }
    }
  }
  return out;
}


function DoorsSpecSheet({ layout }: { layout: LayoutFloor }) {
  const rows = useMemo(() => collectDoors(layout), [layout]);
  return (
    <div className="w-full h-full overflow-y-auto px-6 py-4 text-[#1a1a1a]">
      <table className="w-full text-[10px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="bg-[#1a1a1a]/8">
            <Th w="10%">Марка</Th>
            <Th w="14%">Квартира</Th>
            <Th w="30%">Помещение</Th>
            <Th w="14%">Сторона</Th>
            <Th w="16%" right>Ширина, мм</Th>
            <Th w="16%">Открывание</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#1a1a1a]/10">
              <Td>{r.mark}</Td>
              <Td>Кв.{r.aptNumber}</Td>
              <Td>{r.room}</Td>
              <Td>{r.side}</Td>
              <Td right tabular>{(r.width * 1000).toFixed(0)}</Td>
              <Td>{r.swing}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[9px] text-[#1a1a1a]/55">
        Всего дверных проёмов: {rows.length}
      </div>
    </div>
  );
}


// ─── Лист: Спецификация окон ─────────────────────────────────────────────

type WindowRow = { mark: string; aptNumber: number; room: string; side: string; width: number };

function collectWindows(layout: LayoutFloor): WindowRow[] {
  const out: WindowRow[] = [];
  let counter = 1;
  for (const sec of layout.sections) {
    for (const apt of sec.apartments) {
      for (const room of apt.rooms) {
        for (const win of (room.windows ?? []) as LayoutWindow[]) {
          out.push({
            mark: `В-${counter++}`,
            aptNumber: apt.number,
            room: room.name_ru || ROOM_LABEL[room.kind] || room.kind,
            side: SIDE_LABEL[win.side] || win.side,
            width: win.width,
          });
        }
      }
    }
  }
  return out;
}


function WindowsSpecSheet({ layout }: { layout: LayoutFloor }) {
  const rows = useMemo(() => collectWindows(layout), [layout]);
  return (
    <div className="w-full h-full overflow-y-auto px-6 py-4 text-[#1a1a1a]">
      <table className="w-full text-[10px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="bg-[#1a1a1a]/8">
            <Th w="12%">Марка</Th>
            <Th w="16%">Квартира</Th>
            <Th w="35%">Помещение</Th>
            <Th w="17%">Сторона</Th>
            <Th w="20%" right>Ширина, мм</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#1a1a1a]/10">
              <Td>{r.mark}</Td>
              <Td>Кв.{r.aptNumber}</Td>
              <Td>{r.room}</Td>
              <Td>{r.side}</Td>
              <Td right tabular>{(r.width * 1000).toFixed(0)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[9px] text-[#1a1a1a]/55">
        Всего оконных проёмов: {rows.length}
      </div>
    </div>
  );
}


// ─── helpers ──────────────────────────────────────────────────────────────

function Th({ children, right, w }: { children: React.ReactNode; right?: boolean; w?: string }) {
  return (
    <th
      className={`px-2 py-1.5 border border-[#1a1a1a]/30 text-[#1a1a1a]/85 font-semibold uppercase text-[8.5px] tracking-wider ${right ? "text-right" : "text-left"}`}
      style={w ? { width: w } : undefined}
    >
      {children}
    </th>
  );
}

function Td({
  children, right, tabular, colSpan,
}: {
  children: React.ReactNode;
  right?: boolean;
  tabular?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-2 py-1 border border-[#1a1a1a]/15 ${right ? "text-right" : "text-left"}`}
      style={tabular ? { fontVariantNumeric: "tabular-nums" } : undefined}
    >
      {children}
    </td>
  );
}

function plural(n: number): string {
  const m = n % 10;
  if (n >= 11 && n <= 14) return "ов";
  if (m === 1) return "";
  if (m >= 2 && m <= 4) return "а";
  return "ов";
}
