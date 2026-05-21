"use client";

// Архитектурные чертежи — таб 6, этап 1.
//
// Юзер пишет свободное ТЗ → GPT-4 парсит параметры → детерминированный
// генератор строит JSON-граф этажа (стены, секции, ядра, комнаты) →
// фронт рендерит план в SVG. Эспорт DXF/IFC и AI-визуализация — на уже
// существующих endpoints (передаём извлечённые inputs туда).
//
// Этапы 2-3 (drag-edit стен, авто-замыкание комнат, размеры) — следующие
// итерации поверх той же модели данных.

import { useState, type ReactElement } from "react";
import {
  Sparkles, Loader2, Download, AlertCircle, Wand2, Network, FileText,
} from "lucide-react";
import {
  generateLayoutFromBrief, exportFloorplanDxf, exportFloorplanIfc,
  visualizeSheet, enhanceBrief,
  type LayoutFloor, type LayoutDoor, type LayoutWindow, type LayoutSide,
  type LayoutFurniture,
  type BriefLayoutResponse,
} from "@/lib/engine";

type Status = "idle" | "loading" | "ready" | "error";

type ExportKind = "dxf" | "ifc" | "viz";


const BRIEF_PLACEHOLDER = `Например:

4-этажный жилой дом 30×16 метров в Алматы. 1 секция,
2 пассажирских лифта. Микс квартир: 30% студий, 40% однушек,
30% двушек. Высота 14 м. Отступы от границ участка 5 м.`;


export function ArchitecturalDrawingsTab({
  onAutoSave,
}: {
  onAutoSave?: (asset: { variantKey: string; imageUrl: string; modelUsed?: string }) => void;
} = {}) {
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BriefLayoutResponse | null>(null);
  const [exportBusy, setExportBusy] = useState<ExportKind | null>(null);
  const [vizImageUrl, setVizImageUrl] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);

  const handleEnhance = async () => {
    if (!brief.trim() || enhancing || status === "loading") return;
    setEnhancing(true);
    setError(null);
    try {
      const improved = await enhanceBrief(brief);
      setBrief(improved);
    } catch (e) {
      setError(`Улучшение: ${(e as Error).message}`);
    } finally {
      setEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    if (!brief.trim() || status === "loading") return;
    setStatus("loading");
    setError(null);
    if (vizImageUrl) { URL.revokeObjectURL(vizImageUrl); setVizImageUrl(null); }
    try {
      const res = await generateLayoutFromBrief(brief);
      setResult(res);
      setStatus("ready");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  };

  const handleExportDxf = async () => {
    if (!result || exportBusy) return;
    setExportBusy("dxf");
    try {
      const { blob, filename } = await exportFloorplanDxf(result.inputs);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(`DXF: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportIfc = async () => {
    if (!result || exportBusy) return;
    setExportBusy("ifc");
    try {
      const { blob, filename } = await exportFloorplanIfc(result.inputs);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(`IFC: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  const handleAiViz = async () => {
    if (!result || exportBusy) return;
    setExportBusy("viz");
    try {
      // Используем уже существующий /visualize/sheet режим A на типе "floor_plan".
      // Этого достаточно для этапа 1: красивый рендер «по теме».
      // На этапе 3 можно будет передавать сам SVG как референс (mode B).
      const res = await visualizeSheet({
        sheet_type: "floor_plan",
        mode: "A",
        hint: `Building footprint ${result.layout.width_m.toFixed(1)}×${result.layout.depth_m.toFixed(1)} m, ${result.layout.sections.length} section(s).`,
      });
      const url = URL.createObjectURL(res.blob);
      if (vizImageUrl) URL.revokeObjectURL(vizImageUrl);
      setVizImageUrl(url);
      if (onAutoSave) {
        onAutoSave({
          variantKey: `arch_${Date.now()}`,
          imageUrl: url,
          modelUsed: res.modelUsed ?? undefined,
        });
      }
    } catch (e) {
      setError(`AI Виз: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <>
      {/* Шапка */}
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0 flex-wrap">
        <FileText size={13} className="text-sky-300" />
        <span className="text-[13px] font-medium text-white/85">
          Архитектурные чертежи
        </span>
        {result && (
          <>
            <div className="h-4 w-px bg-white/[0.07]" />
            <span className="text-[11.5px] text-white/55">
              {result.layout.width_m.toFixed(1)} × {result.layout.depth_m.toFixed(1)} м · {result.layout.sections.length} секц. · {totalApartments(result.layout)} кв.
            </span>
            {result.used_defaults.length > 0 && (
              <span
                className="text-[10.5px] text-amber-300/80"
                title={`Дефолты подставлены для: ${result.used_defaults.join(", ")}`}
              >
                · {result.used_defaults.length} полей по дефолту
              </span>
            )}
          </>
        )}

        {result && (
          <>
            <div className="flex-1" />
            <button
              onClick={handleExportDxf}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-violet-400/30 text-violet-200/90 hover:bg-violet-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "dxf" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} DXF
            </button>
            <button
              onClick={handleExportIfc}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-cyan-400/30 text-cyan-200/90 hover:bg-cyan-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "ifc" ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />} IFC
            </button>
            <button
              onClick={handleAiViz}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-rose-400/30 text-rose-200/90 hover:bg-rose-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "viz" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} AI Виз
            </button>
          </>
        )}
      </div>

      {/* Контент: split-view */}
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}>
        {/* LEFT — текстовое ТЗ */}
        <div className="border-r border-white/[0.04] p-4 flex flex-col gap-3 min-h-0">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1.5">
              Техническое задание
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={BRIEF_PLACEHOLDER}
              disabled={status === "loading"}
              rows={14}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white/85 placeholder-white/25 resize-none leading-relaxed focus:outline-none focus:border-sky-400/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEnhance}
              disabled={!brief.trim() || enhancing || status === "loading"}
              title="Улучшить ТЗ через AI-архитектора (нормы, отступы, микс)"
              className="h-9 px-3 rounded-lg text-[12.5px] flex items-center gap-1.5 border border-sky-400/30 text-sky-200/90 hover:bg-sky-500/15 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {enhancing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              Улучшить
            </button>
            <button
              onClick={handleGenerate}
              disabled={!brief.trim() || status === "loading" || enhancing}
              className="btn-apple flex-1 h-9 px-4 text-[12.5px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Сгенерировать план
            </button>
          </div>
          {result?.notes && (
            <div className="text-[10.5px] text-white/45 leading-relaxed">
              <div className="uppercase tracking-wider text-white/30 mb-1">Заметки модели</div>
              {result.notes}
            </div>
          )}
          {result && result.used_defaults.length > 0 && (
            <div className="text-[10px] text-amber-200/55 leading-relaxed">
              <div className="uppercase tracking-wider text-amber-200/40 mb-1">Дефолты</div>
              В ТЗ не указано: {result.used_defaults.join(", ")}
            </div>
          )}
        </div>

        {/* RIGHT — canvas */}
        <div className="relative overflow-hidden">
          {status === "idle" && !result && (
            <div className="absolute inset-0 grid place-items-center text-center p-8">
              <div className="max-w-md">
                <div className="mx-auto w-12 h-12 rounded-full bg-sky-500/15 grid place-items-center mb-4">
                  <Sparkles size={20} className="text-sky-300" />
                </div>
                <div className="text-[15px] font-semibold tracking-display mb-1.5">
                  Опиши здание словами
                </div>
                <div className="text-[12.5px] text-white/55 leading-relaxed">
                  AI распарсит параметры, построит технический план этажа.
                  Дальше — экспорт в DXF/IFC или AI-визуализация поверх.
                </div>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 text-white/60">
                <Loader2 size={20} className="animate-spin text-sky-300" />
                <span className="text-[12.5px]">Строим план…</span>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="flex flex-col items-center gap-2 text-rose-300 text-center max-w-md">
                <AlertCircle size={20} />
                <span className="text-[12.5px]">{error}</span>
                <button
                  onClick={handleGenerate}
                  className="mt-2 h-7 px-3 rounded text-[11px] text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] transition"
                >
                  Повторить
                </button>
              </div>
            </div>
          )}

          {status === "ready" && result && (
            <div className="absolute inset-0 flex flex-col">
              {/* Скроллируемая область — пускаем вертикальный скролл */}
              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {vizImageUrl ? (
                  <div className="flex flex-col gap-2">
                    {/* План — фиксированная пропорция, чтобы не схлопывался */}
                    <div className="relative bg-white rounded-lg overflow-hidden">
                      <div className="absolute top-2 left-2 z-10 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                        План
                      </div>
                      <div style={{ aspectRatio: `${result.layout.width_m + 6}/${result.layout.depth_m + 6}` }}>
                        <FloorPlanSvg layout={result.layout} />
                      </div>
                    </div>
                    {/* AI визуализация — natural-height */}
                    <div className="relative bg-black/30 rounded-lg overflow-hidden">
                      <div className="absolute top-2 left-2 z-10 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                        AI Визуализация
                      </div>
                      <img
                        src={vizImageUrl}
                        alt="AI визуализация"
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg" style={{ aspectRatio: `${result.layout.width_m + 6}/${result.layout.depth_m + 6}` }}>
                    <FloorPlanSvg layout={result.layout} />
                  </div>
                )}
              </div>
              {error && (
                <div className="px-4 py-2 text-[11px] text-rose-300/85 bg-rose-900/15 border-t border-rose-500/20 flex items-center gap-1.5">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}


// ---------------------------------------------------------------------------
// FloorPlanSvg — рендерер LayoutFloor в SVG
//
// Стиль вдохновлён maket.ai: тяжёлые чёрные внешние стены, бежевый фон комнат
// без цветовых различий, толстые перегородки между комнатами (визуально
// симулируют реальную толщину стен), UPPERCASE-подписи. Технический эстетик.
// ---------------------------------------------------------------------------

// Бежевая палитра (тон листа архитектурного чертежа)
const CANVAS_BG    = "#FAF5E6";   // фон всего SVG
const ROOM_FILL    = "#F0E8D2";   // заливка комнат
const CORRIDOR_FILL = "#E8DFC4";  // коридор — чуть темнее
const CORE_FILL    = "#222426";   // ядра (лифты, лестница) — почти чёрные
const CORE_TEXT    = "#FAF5E6";   // надписи на ядрах
const WALL_COLOR   = "#1a1a1a";   // основной цвет стен
const LABEL_COLOR  = "#2d2d2d";   // подписи комнат
const AREA_COLOR   = "#7a6a4a";   // подписи площадей

// Толщины стен в метрах SVG-единиц (соответствует реальной толщине).
const WALL_EXTERIOR = 0.35;   // внешние стены здания
const WALL_PARTITION = 0.15;  // внутренние перегородки между комнатами
const WALL_CORE     = 0.10;   // ядра — тонкий контур (т.к. заливка тёмная)
const WALL_SECTION  = 0.25;   // межсекционная противопожарная стена

// Типографика — фиксированные размеры (в метрах), без зависимости от размера
// комнаты. Если комната слишком мала для подписи — она просто не отрисуется.
const FONT_ROOM_LABEL = 0.42;       // «СПАЛЬНЯ 1», «ГОСТИНАЯ»
const FONT_ROOM_AREA  = 0.30;       // «12.4 m²»
const FONT_APT_NUMBER = 0.36;       // «КВ.1» в углу
const FONT_CORE_LABEL = 0.50;       // «ЛИФТ», «ЛЕСТН.»
const FONT_DIM_TEXT   = 0.55;       // размерные подписи «24.00 М»
const MIN_ROOM_LABEL_W = 1.8;       // меньше — подпись не пишем
const MIN_ROOM_LABEL_D = 1.4;       // меньше — подпись не пишем
const MIN_ROOM_AREA_W = 1.3;        // площадь скрываем независимо от label

const CORE_LABEL_RU: Record<string, string> = {
  lift_passenger: "ЛИФТ",
  lift_freight:   "ГРУЗ",
  stair:          "ЛЕСТН.",
};

// Перевод kind на UPPERCASE-русский для подписи. Если в name_ru уже стоит
// конкретное название («Спальня 1») — используем его, просто в UPPERCASE.
const ROOM_LABEL_FALLBACK_RU: Record<string, string> = {
  living:   "ГОСТИНАЯ",
  bedroom:  "СПАЛЬНЯ",
  kitchen:  "КУХНЯ",
  bathroom: "С/У",
  toilet:   "С/У",
  hallway:  "ПРИХОЖАЯ",
  loggia:   "ЛОДЖИЯ",
  storage:  "КЛАДОВАЯ",
};


function FloorPlanSvg({ layout }: { layout: LayoutFloor }) {
  // Padding в метрах вокруг здания (для подписей размеров)
  const PAD = 3;
  const W = layout.width_m;
  const D = layout.depth_m;
  const viewBoxW = W + PAD * 2;
  const viewBoxH = D + PAD * 2;

  // Архитектурные координаты Y: 0 внизу, растут вверх (юг → север).
  // SVG Y: 0 сверху, растёт вниз. Инвертируем на месте.
  const ry = (archY: number, h: number = 0) => D - archY - h;

  const fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  // Уникальный id для точечной сетки на фоне
  const gridId = `dot-grid-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
      style={{ background: CANVAS_BG }}
      fontFamily={fontFamily}
    >
      {/* Точечная сетка на фоне — как в maket.ai */}
      <defs>
        <pattern id={gridId} width={1} height={1} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={0.025} fill="#b8a878" opacity={0.5} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={viewBoxW} height={viewBoxH} fill={`url(#${gridId})`} />

      <g transform={`translate(${PAD}, ${PAD})`}>
        {/* ── Заливка всех комнат и коридора единым бежевым ────────────── */}
        {/* Сначала рисуем заливку всего внутреннего пространства,
            потом сверху — стены толстыми чёрными линиями. */}

        {layout.sections.map((section) => (
          <g key={`fill-${section.index}`}>
            {/* Коридор — чуть темнее общего бежевого */}
            <rect
              x={section.x_start}
              y={ry(section.corridor_y, section.corridor_d)}
              width={section.width} height={section.corridor_d}
              fill={CORRIDOR_FILL}
            />

            {/* Квартиры — заливаем по комнатам единым тоном */}
            {section.apartments.map((apt) => (
              <g key={`apt-fill-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  return (
                    <rect
                      key={rIdx}
                      x={rx} y={ry(archY, room.d)}
                      width={room.w} height={room.d}
                      fill={ROOM_FILL}
                    />
                  );
                })}
              </g>
            ))}
          </g>
        ))}

        {/* ── Внутренние перегородки между комнатами ───────────────────── */}
        {/* Рисуем серединные линии внутри здания — это даст «толщину» стен
            визуально, без фактического вычитания их из геометрии комнат. */}
        {layout.sections.map((section) => (
          <g key={`partitions-${section.index}`} stroke={WALL_COLOR} strokeLinecap="square">
            {/* Перегородки между комнатами внутри квартир */}
            {section.apartments.map((apt) => (
              <g key={`apt-walls-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  return (
                    <rect
                      key={rIdx}
                      x={rx} y={ry(archY, room.d)}
                      width={room.w} height={room.d}
                      fill="none"
                      stroke={WALL_COLOR}
                      strokeWidth={WALL_PARTITION}
                    />
                  );
                })}
                {/* Контур квартиры — чуть толще для разделения соседних */}
                <rect
                  x={apt.x} y={ry(apt.y, apt.d)}
                  width={apt.w} height={apt.d}
                  fill="none"
                  stroke={WALL_COLOR}
                  strokeWidth={WALL_PARTITION + 0.05}
                />
              </g>
            ))}

            {/* Контур коридора */}
            <rect
              x={section.x_start}
              y={ry(section.corridor_y, section.corridor_d)}
              width={section.width} height={section.corridor_d}
              fill="none"
              stroke={WALL_COLOR}
              strokeWidth={WALL_PARTITION}
            />

            {/* Межсекционная стена (если секций > 1) */}
            {layout.sections.length > 1 && section.index > 0 && (
              <line
                x1={section.x_start} y1={0}
                x2={section.x_start} y2={D}
                stroke={WALL_COLOR} strokeWidth={WALL_SECTION}
              />
            )}
          </g>
        ))}

        {/* ── Двери и окна — рисуем поверх стен, до ядер и контура ───── */}
        {layout.sections.map((section) => (
          <g key={`apertures-${section.index}`}>
            {section.apartments.map((apt) =>
              apt.rooms.flatMap((room, rIdx) => {
                const rx = apt.x + room.x;
                const archY = apt.y + room.y;
                const childKey = `${apt.number}-${rIdx}`;
                return [
                  ...(room.windows ?? []).map((win, wi) => (
                    <WindowSymbol
                      key={`w-${childKey}-${wi}`}
                      rx={rx} archY={archY} rw={room.w} rd={room.d}
                      win={win} ry={ry}
                    />
                  )),
                  ...(room.doors ?? []).map((door, di) => (
                    <DoorSymbol
                      key={`d-${childKey}-${di}`}
                      rx={rx} archY={archY} rw={room.w} rd={room.d}
                      door={door} ry={ry}
                    />
                  )),
                ];
              })
            )}
          </g>
        ))}

        {/* ── Мебель — мелкие иконки внутри комнат ────────────────────── */}
        {layout.sections.map((section) => (
          <g key={`furniture-${section.index}`}>
            {section.apartments.map((apt) =>
              apt.rooms.map((room, rIdx) =>
                (room.furniture ?? []).map((furn, fi) => {
                  const fx = apt.x + room.x + furn.x;
                  const fArchY = apt.y + room.y + furn.y;
                  return (
                    <FurnitureItem
                      key={`f-${apt.number}-${rIdx}-${fi}`}
                      furn={furn}
                      svgX={fx}
                      svgY={ry(fArchY, furn.d)}
                    />
                  );
                })
              )
            )}
          </g>
        ))}

        {/* ── Ядра: лифты и лестницы ──────────────────────────────────── */}
        {layout.sections.map((section) => (
          <g key={`cores-${section.index}`}>
            {section.cores.map((core, ci) => {
              const canShowLabel = core.w >= 1.2 && core.d >= 1.0;
              return (
                <g key={ci}>
                  <rect
                    x={core.x} y={ry(core.y, core.d)}
                    width={core.w} height={core.d}
                    fill={CORE_FILL}
                    stroke={WALL_COLOR}
                    strokeWidth={WALL_CORE}
                  />
                  {canShowLabel && (
                    <text
                      x={core.x + core.w / 2}
                      y={ry(core.y + core.d / 2)}
                      textAnchor="middle" dominantBaseline="central"
                      fill={CORE_TEXT}
                      fontSize={FONT_CORE_LABEL}
                      fontWeight={700}
                      letterSpacing={0.04}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {CORE_LABEL_RU[core.kind] ?? "?"}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* ── Внешний контур здания — самый толстый ───────────────────── */}
        <rect
          x={0} y={0} width={W} height={D}
          fill="none"
          stroke={WALL_COLOR}
          strokeWidth={WALL_EXTERIOR}
          strokeLinejoin="miter"
        />

        {/* ── Подписи комнат и номера квартир ─────────────────────────── */}
        {layout.sections.map((section) => (
          <g key={`labels-${section.index}`}>
            {section.apartments.map((apt) => (
              <g key={`apt-label-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  const cx = rx + room.w / 2;
                  const cy = archY + room.d / 2;
                  const canShowLabel = room.w >= MIN_ROOM_LABEL_W && room.d >= MIN_ROOM_LABEL_D;
                  const canShowArea  = room.w >= MIN_ROOM_AREA_W && room.d >= 0.9;
                  if (!canShowLabel && !canShowArea) return null;
                  const label = upperCaseRoom(room.name_ru, room.kind);
                  // «12.4 м.кв.» — однозначная LTR-кириллица без superscript-
                  // символов. Chrome bidi-алгоритм путается с «²» + цифрами в
                  // SVG-тексте, рендерит порядок задом наперёд («²м 2.21»).
                  const areaText = `${(room.w * room.d).toFixed(1)} м.кв.`;
                  return (
                    <g key={rIdx}>
                      {canShowLabel && (
                        <text
                          x={cx}
                          y={ry(cy + 0.18)}
                          textAnchor="middle" dominantBaseline="central"
                          fill={LABEL_COLOR}
                          fontSize={FONT_ROOM_LABEL}
                          fontWeight={700}
                          letterSpacing={0.04}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {label}
                        </text>
                      )}
                      {canShowArea && (
                        <text
                          x={cx}
                          y={ry(canShowLabel ? cy - 0.32 : cy)}
                          textAnchor="middle" dominantBaseline="central"
                          fill={AREA_COLOR}
                          fontSize={FONT_ROOM_AREA}
                          fontWeight={500}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {areaText}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Номер квартиры — в углу */}
                <text
                  x={apt.x + 0.25}
                  y={ry(apt.y + apt.d - 0.25)}
                  textAnchor="start" dominantBaseline="central"
                  fill={AREA_COLOR}
                  fontSize={FONT_APT_NUMBER}
                  fontWeight={700}
                  letterSpacing={0.05}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  КВ.{apt.number}
                </text>
              </g>
            ))}
          </g>
        ))}

        {/* ── Размерные линии в CAD-стиле (засечки 45° на концах) ─────── */}
        <DimensionLine
          orientation="horizontal"
          x1={0} x2={W} pos={ry(D + 1.5)}
          label={`${W.toFixed(2)} М`}
          color={LABEL_COLOR}
        />
        <DimensionLine
          orientation="vertical"
          y1={ry(D)} y2={ry(0)} pos={-1.5}
          label={`${D.toFixed(2)} М`}
          color={LABEL_COLOR}
        />
      </g>
    </svg>
  );
}


// ---------------------------------------------------------------------------
// CAD-стиль размерная линия с засечками 45° и центрированной подписью.
// ---------------------------------------------------------------------------

function DimensionLine(props:
  | {
      orientation: "horizontal";
      x1: number; x2: number; pos: number;
      label: string; color: string;
    }
  | {
      orientation: "vertical";
      y1: number; y2: number; pos: number;
      label: string; color: string;
    }
) {
  const tick = 0.22;           // длина засечки 45°
  const dt = tick / Math.SQRT2;
  const sw = 0.045;

  if (props.orientation === "horizontal") {
    const { x1, x2, pos, label, color } = props;
    return (
      <g stroke={color} strokeWidth={sw} fill="none">
        <line x1={x1} y1={pos} x2={x2} y2={pos} />
        {/* засечки 45° на концах */}
        <line x1={x1 - dt} y1={pos - dt} x2={x1 + dt} y2={pos + dt} />
        <line x1={x2 - dt} y1={pos - dt} x2={x2 + dt} y2={pos + dt} />
        {/* подсечки-extension в сторону объекта */}
        <line x1={x1} y1={pos + 0.25} x2={x1} y2={pos - 0.25} strokeWidth={sw * 0.6} />
        <line x1={x2} y1={pos + 0.25} x2={x2} y2={pos - 0.25} strokeWidth={sw * 0.6} />
        <text
          x={(x1 + x2) / 2}
          y={pos - 0.5}
          textAnchor="middle" dominantBaseline="central"
          fill={color}
          fontSize={FONT_DIM_TEXT}
          fontWeight={600}
          letterSpacing={0.04}
          stroke="none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {label}
        </text>
      </g>
    );
  }

  const { y1, y2, pos, label, color } = props;
  return (
    <g stroke={color} strokeWidth={sw} fill="none">
      <line x1={pos} y1={y1} x2={pos} y2={y2} />
      <line x1={pos - dt} y1={y1 - dt} x2={pos + dt} y2={y1 + dt} />
      <line x1={pos - dt} y1={y2 - dt} x2={pos + dt} y2={y2 + dt} />
      <line x1={pos - 0.25} y1={y1} x2={pos + 0.25} y2={y1} strokeWidth={sw * 0.6} />
      <line x1={pos - 0.25} y1={y2} x2={pos + 0.25} y2={y2} strokeWidth={sw * 0.6} />
      <text
        x={pos - 0.55}
        y={(y1 + y2) / 2}
        textAnchor="middle" dominantBaseline="central"
        fill={color}
        fontSize={FONT_DIM_TEXT}
        fontWeight={600}
        letterSpacing={0.04}
        stroke="none"
        style={{ fontVariantNumeric: "tabular-nums" }}
        transform={`rotate(-90, ${pos - 0.55}, ${(y1 + y2) / 2})`}
      >
        {label}
      </text>
    </g>
  );
}


// ---------------------------------------------------------------------------
// FurnitureItem — стилизованная иконка мебели/сантехники
// ---------------------------------------------------------------------------

const FURN_STROKE = "#5a5a5a";
const FURN_FILL   = "#E5DBC0";
const FURN_WATER  = "#cfd8dc";
const FURN_SCREEN = "#1f2937";


function FurnitureItem({
  furn, svgX, svgY,
}: {
  furn: LayoutFurniture;
  svgX: number;       // left-X в SVG
  svgY: number;       // top-Y в SVG (после ry-инверсии)
}) {
  const { w, d, kind } = furn;
  const sw = 0.02;    // тонкие линии деталей

  const baseRect = (
    <rect
      x={svgX} y={svgY} width={w} height={d}
      fill={FURN_FILL}
      stroke={FURN_STROKE}
      strokeWidth={sw}
    />
  );

  switch (kind) {
    case "bed": {
      // Кровать с подушкой и одеялом. Подушка наверху (там где SVG-Y маленький =
      // голова кровати у «back» стены комнаты).
      const pillowW = w * 0.7;
      const pillowD = d * 0.18;
      const px = svgX + (w - pillowW) / 2;
      const py = svgY + d * 0.05;
      return (
        <g>
          {baseRect}
          {/* Одеяло — линия отделяющая верх от низа */}
          <line
            x1={svgX} y1={svgY + d * 0.32}
            x2={svgX + w} y2={svgY + d * 0.32}
            stroke={FURN_STROKE} strokeWidth={sw}
          />
          {/* Подушка */}
          <rect
            x={px} y={py} width={pillowW} height={pillowD}
            fill="#fff" stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
        </g>
      );
    }

    case "wardrobe":
      return (
        <g>
          {baseRect}
          {/* Две створки */}
          <line
            x1={svgX + w / 2} y1={svgY}
            x2={svgX + w / 2} y2={svgY + d}
            stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "nightstand":
      return baseRect;

    case "sofa": {
      // Диван с тремя секциями + спинка отделена линией
      const backY = svgY + d * 0.25;
      return (
        <g>
          {baseRect}
          {/* Спинка */}
          <line x1={svgX} y1={backY} x2={svgX + w} y2={backY}
                stroke={FURN_STROKE} strokeWidth={sw} />
          {/* Подлокотники */}
          <line x1={svgX + w * 0.08} y1={backY} x2={svgX + w * 0.08} y2={svgY + d}
                stroke={FURN_STROKE} strokeWidth={sw} />
          <line x1={svgX + w * 0.92} y1={backY} x2={svgX + w * 0.92} y2={svgY + d}
                stroke={FURN_STROKE} strokeWidth={sw} />
          {/* Разделение на 3 подушки */}
          <line x1={svgX + w * 0.36} y1={backY} x2={svgX + w * 0.36} y2={svgY + d}
                stroke={FURN_STROKE} strokeWidth={sw} />
          <line x1={svgX + w * 0.64} y1={backY} x2={svgX + w * 0.64} y2={svgY + d}
                stroke={FURN_STROKE} strokeWidth={sw} />
        </g>
      );
    }

    case "coffee_table":
      return (
        <rect
          x={svgX} y={svgY} width={w} height={d}
          fill={FURN_FILL}
          stroke={FURN_STROKE}
          strokeWidth={sw}
          rx={0.08} ry={0.08}
        />
      );

    case "tv":
      return (
        <rect
          x={svgX} y={svgY} width={w} height={d}
          fill={FURN_SCREEN}
          stroke={FURN_STROKE}
          strokeWidth={sw}
        />
      );

    case "stove": {
      // Конфорки — 4 круга по углам
      const cr = Math.min(w, d) * 0.13;
      const ox = w * 0.27;
      const oy = d * 0.27;
      return (
        <g>
          {baseRect}
          <circle cx={svgX + ox} cy={svgY + oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + w - ox} cy={svgY + oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + ox} cy={svgY + d - oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + w - ox} cy={svgY + d - oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
        </g>
      );
    }

    case "sink": {
      const insetW = w * 0.78;
      const insetD = d * 0.65;
      const ix = svgX + (w - insetW) / 2;
      const iy = svgY + (d - insetD) / 2;
      return (
        <g>
          {baseRect}
          <rect
            x={ix} y={iy} width={insetW} height={insetD}
            fill={FURN_WATER}
            stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.08} ry={0.08}
          />
        </g>
      );
    }

    case "fridge":
      return (
        <g>
          {baseRect}
          {/* Дверь морозильника отделена линией наверху */}
          <line
            x1={svgX} y1={svgY + d * 0.3}
            x2={svgX + w} y2={svgY + d * 0.3}
            stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "dining_table":
      return (
        <rect
          x={svgX} y={svgY} width={w} height={d}
          fill="none"
          stroke={FURN_STROKE} strokeWidth={sw}
          rx={0.05} ry={0.05}
        />
      );

    case "bathtub":
      return (
        <g>
          <rect
            x={svgX} y={svgY} width={w} height={d}
            fill={FURN_WATER}
            stroke={FURN_STROKE} strokeWidth={sw}
            rx={d * 0.35} ry={d * 0.35}
          />
          {/* Слив — кружок */}
          <circle
            cx={svgX + w * 0.85} cy={svgY + d * 0.5}
            r={d * 0.08}
            fill="none" stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "toilet": {
      // Бачок наверху + чаша унитаза снизу
      const tankH = d * 0.32;
      const bowlH = d - tankH;
      return (
        <g>
          {/* Бачок */}
          <rect
            x={svgX} y={svgY} width={w} height={tankH}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw}
          />
          {/* Чаша */}
          <ellipse
            cx={svgX + w / 2} cy={svgY + tankH + bowlH / 2}
            rx={w / 2 - sw} ry={bowlH / 2 - sw}
            fill={FURN_WATER} stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );
    }

    case "washbasin": {
      // Тумба + чаша внутри
      const bowlW = w * 0.72;
      const bowlD = d * 0.65;
      const bx = svgX + (w - bowlW) / 2;
      const by = svgY + (d - bowlD) / 2;
      return (
        <g>
          {baseRect}
          <ellipse
            cx={bx + bowlW / 2} cy={by + bowlD / 2}
            rx={bowlW / 2} ry={bowlD / 2}
            fill={FURN_WATER} stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );
    }

    case "armchair":
      return (
        <g>
          {baseRect}
          {/* Спинка */}
          <line x1={svgX} y1={svgY + d * 0.25}
                x2={svgX + w} y2={svgY + d * 0.25}
                stroke={FURN_STROKE} strokeWidth={sw} />
        </g>
      );

    default:
      return baseRect;
  }
}


function upperCaseRoom(nameRu: string, kind: string): string {
  const trimmed = (nameRu || "").trim();
  if (trimmed) return trimmed.toUpperCase();
  return ROOM_LABEL_FALLBACK_RU[kind] ?? kind.toUpperCase();
}


// ---------------------------------------------------------------------------
// WindowSymbol — окно как разрыв стены + двойная линия по центру (стеклопакет)
// ---------------------------------------------------------------------------

type SymbolProps = {
  rx: number;          // абсолютный X левой кромки комнаты в системе здания (м)
  archY: number;       // абсолютный архитектурный Y нижней кромки комнаты
  rw: number;          // ширина комнаты по X (м)
  rd: number;          // глубина комнаты по Y (м)
  ry: (archY: number, h?: number) => number;
};


function WindowSymbol({
  rx, archY, rw, rd, win, ry,
}: SymbolProps & { win: LayoutWindow }) {
  const { p1, p2, horizontal } = wallSegment(win.side, win.offset, win.width, rx, archY, rw, rd, ry);
  const wallT = WALL_PARTITION;       // толщина внешней стены, на которой окно
  // Окно: белый «вырез» в стене + две тонкие линии (символ стеклопакета)
  const gap = wallT * 0.55;           // расстояние между двумя линиями
  if (horizontal) {
    const wy = (p1.y + p2.y) / 2;
    return (
      <g>
        <rect
          x={Math.min(p1.x, p2.x)} y={wy - wallT / 2}
          width={Math.abs(p2.x - p1.x)} height={wallT}
          fill={CANVAS_BG} stroke="none"
        />
        <line x1={p1.x} y1={wy - gap / 2} x2={p2.x} y2={wy - gap / 2} stroke={WALL_COLOR} strokeWidth={0.04} />
        <line x1={p1.x} y1={wy + gap / 2} x2={p2.x} y2={wy + gap / 2} stroke={WALL_COLOR} strokeWidth={0.04} />
      </g>
    );
  }
  const wx = (p1.x + p2.x) / 2;
  return (
    <g>
      <rect
        x={wx - wallT / 2} y={Math.min(p1.y, p2.y)}
        width={wallT} height={Math.abs(p2.y - p1.y)}
        fill={CANVAS_BG} stroke="none"
      />
      <line x1={wx - gap / 2} y1={p1.y} x2={wx - gap / 2} y2={p2.y} stroke={WALL_COLOR} strokeWidth={0.04} />
      <line x1={wx + gap / 2} y1={p1.y} x2={wx + gap / 2} y2={p2.y} stroke={WALL_COLOR} strokeWidth={0.04} />
    </g>
  );
}


// ---------------------------------------------------------------------------
// DoorSymbol — дверь как разрыв стены + дуга 90° (траектория открывания)
// ---------------------------------------------------------------------------

function DoorSymbol({
  rx, archY, rw, rd, door, ry,
}: SymbolProps & { door: LayoutDoor }) {
  const { p1, p2, horizontal, inward } = wallSegment(
    door.side, door.offset, door.width, rx, archY, rw, rd, ry,
  );
  const wallT = WALL_PARTITION;

  // Петля и противоположный конец проёма.
  // door.hinge = "left" → петля на той точке, которая ближе к началу offset'а.
  // wallSegment возвращает p1 как «начальный конец» (соответствует offset),
  // p2 — как «дальний конец» (offset + width).
  const hinge = door.hinge === "left" ? p1 : p2;
  const opposite = door.hinge === "left" ? p2 : p1;
  const doorLen = door.width;

  // Открытое положение полотна: на 90° от стены вглубь комнаты.
  // inward.dx/dy — единичный вектор «внутрь комнаты» относительно стены.
  const open = {
    x: hinge.x + inward.dx * doorLen,
    y: hinge.y + inward.dy * doorLen,
  };

  // Дуга от opposite (closed) до open (open). Радиус = doorLen, центр в hinge.
  const arcLargeFlag = 0;     // 90° — малая дуга
  const arcSweepFlag = computeSweep(hinge, opposite, open);

  // Вырез в стене (белый прямоугольник в проёме)
  let cutout: ReactElement;
  if (horizontal) {
    const wy = (p1.y + p2.y) / 2;
    cutout = (
      <rect
        x={Math.min(p1.x, p2.x)} y={wy - wallT / 2}
        width={Math.abs(p2.x - p1.x)} height={wallT}
        fill={CANVAS_BG} stroke="none"
      />
    );
  } else {
    const wx = (p1.x + p2.x) / 2;
    cutout = (
      <rect
        x={wx - wallT / 2} y={Math.min(p1.y, p2.y)}
        width={wallT} height={Math.abs(p2.y - p1.y)}
        fill={CANVAS_BG} stroke="none"
      />
    );
  }

  return (
    <g stroke={WALL_COLOR} strokeWidth={0.04} fill="none" strokeLinecap="round">
      {cutout}
      {/* Дуга открывания */}
      <path
        d={`M ${opposite.x} ${opposite.y} A ${doorLen} ${doorLen} 0 ${arcLargeFlag} ${arcSweepFlag} ${open.x} ${open.y}`}
        strokeDasharray="0.06 0.06"
        strokeWidth={0.025}
      />
      {/* Полотно двери в открытом положении */}
      <line x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} strokeWidth={0.06} />
    </g>
  );
}


// ---------------------------------------------------------------------------
// wallSegment — выдаёт 2 точки SVG-сегмента стены + ориентацию +
// единичный вектор «внутрь комнаты» (для дуги двери).
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

function wallSegment(
  side: LayoutSide,
  offset: number,
  width: number,
  rx: number,
  archY: number,
  rw: number,
  rd: number,
  ry: (archY: number, h?: number) => number,
): { p1: Pt; p2: Pt; horizontal: boolean; inward: { dx: number; dy: number } } {
  switch (side) {
    case "S":
      return {
        p1: { x: rx + offset,         y: ry(archY) },
        p2: { x: rx + offset + width, y: ry(archY) },
        horizontal: true,
        inward: { dx: 0, dy: -1 },   // внутрь комнаты вверх в SVG = -1 по Y
      };
    case "N":
      return {
        p1: { x: rx + offset,         y: ry(archY + rd) },
        p2: { x: rx + offset + width, y: ry(archY + rd) },
        horizontal: true,
        inward: { dx: 0, dy: +1 },
      };
    case "W":
      return {
        p1: { x: rx, y: ry(archY + offset) },
        p2: { x: rx, y: ry(archY + offset + width) },
        horizontal: false,
        inward: { dx: +1, dy: 0 },
      };
    case "E":
      return {
        p1: { x: rx + rw, y: ry(archY + offset) },
        p2: { x: rx + rw, y: ry(archY + offset + width) },
        horizontal: false,
        inward: { dx: -1, dy: 0 },
      };
  }
}


/** SVG arc sweep-flag — 1 если идём по часовой стрелке от p1 до p2 при
 *  взгляде из центра, иначе 0. Для двери: дуга от closed к open. */
function computeSweep(center: Pt, from: Pt, to: Pt): number {
  // Cross product (from-center) × (to-center). В SVG Y растёт вниз,
  // поэтому положительный cross = против часовой → sweepFlag=0.
  const cross = (from.x - center.x) * (to.y - center.y)
              - (from.y - center.y) * (to.x - center.x);
  return cross > 0 ? 0 : 1;
}


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function totalApartments(layout: LayoutFloor): number {
  return layout.sections.reduce((s, sec) => s + sec.apartments.length, 0);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
