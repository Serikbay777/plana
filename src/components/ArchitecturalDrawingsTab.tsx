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

import { useState } from "react";
import {
  Sparkles, Loader2, Download, AlertCircle, Wand2, Network, FileText,
} from "lucide-react";
import {
  generateLayoutFromBrief, exportFloorplanDxf, exportFloorplanIfc,
  visualizeSheet, enhanceBrief,
  type LayoutFloor, type BriefLayoutResponse,
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
                  // «12.4 m²» с латинским m, чтобы Chrome не глючил на «м²»
                  // в мелком кегле (бывало что superscript-«²» рендерился
                  // не в той позиции и казалось будто строка перевёрнута).
                  const areaText = `${(room.w * room.d).toFixed(1)} m²`;
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


function upperCaseRoom(nameRu: string, kind: string): string {
  const trimmed = (nameRu || "").trim();
  if (trimmed) return trimmed.toUpperCase();
  return ROOM_LABEL_FALLBACK_RU[kind] ?? kind.toUpperCase();
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
