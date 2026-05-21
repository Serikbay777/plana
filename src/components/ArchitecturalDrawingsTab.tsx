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
  visualizeSheet,
  type LayoutFloor, type BriefLayoutResponse,
  type VisualizeFromInputsRequest,
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
          <button
            onClick={handleGenerate}
            disabled={!brief.trim() || status === "loading"}
            className="btn-apple h-9 px-4 text-[12.5px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Сгенерировать план
          </button>
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
              {/* AI визуализация — overlay поверх SVG */}
              {vizImageUrl ? (
                <div className="flex-1 grid grid-rows-2 gap-2 p-2 min-h-0">
                  <div className="relative bg-white rounded-lg overflow-hidden">
                    <FloorPlanSvg layout={result.layout} />
                    <div className="absolute top-2 left-2 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                      План
                    </div>
                  </div>
                  <div className="relative bg-black/30 rounded-lg overflow-hidden grid place-items-center">
                    <img
                      src={vizImageUrl}
                      alt="AI визуализация"
                      className="max-w-full max-h-full object-contain"
                    />
                    <div className="absolute top-2 left-2 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                      AI Визуализация
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 bg-white">
                  <FloorPlanSvg layout={result.layout} />
                </div>
              )}
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
// ---------------------------------------------------------------------------

const ROOM_COLOR: Record<string, string> = {
  living:   "#fef3c7",   // светло-жёлтый (бежевый)
  bedroom:  "#dbeafe",   // светло-голубой
  kitchen:  "#fed7aa",   // тёплый оранжевый
  bathroom: "#e9d5ff",   // лавандовый
  toilet:   "#e9d5ff",
  hallway:  "#e5e7eb",   // светло-серый
  loggia:   "#d1fae5",   // мятный
  storage:  "#d4d4d8",   // серый
};

const CORE_LABEL: Record<string, string> = {
  lift_passenger: "ЛП",
  lift_freight:   "ЛГ",
  stair:          "ЛК",
};


function FloorPlanSvg({ layout }: { layout: LayoutFloor }) {
  // Padding в метрах вокруг здания (для подписей размеров)
  const PAD = 3;
  const W = layout.width_m;
  const D = layout.depth_m;
  const viewBoxW = W + PAD * 2;
  const viewBoxH = D + PAD * 2;

  // SVG ось Y направлена вниз. Архитектурные координаты Y направлены вверх.
  // Чтобы план не был перевёрнут — flip через scale(1, -1) и translate.
  // То есть transform: translate(PAD, viewBoxH - PAD) scale(1, -1).

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
      style={{ background: "#fafafa" }}
    >
      <g transform={`translate(${PAD}, ${viewBoxH - PAD}) scale(1, -1)`}>
        {/* Внешний контур здания */}
        <rect
          x={0} y={0} width={W} height={D}
          fill="#ffffff" stroke="#1f2937" strokeWidth={0.18}
        />

        {/* Секции */}
        {layout.sections.map((section) => (
          <g key={section.index}>
            {/* Граница секции (если их > 1) */}
            {layout.sections.length > 1 && section.index > 0 && (
              <line
                x1={section.x_start} y1={0}
                x2={section.x_start} y2={D}
                stroke="#374151" strokeWidth={0.12} strokeDasharray="0.2 0.15"
              />
            )}

            {/* Коридор */}
            <rect
              x={section.x_start} y={section.corridor_y}
              width={section.width} height={section.corridor_d}
              fill="#f3f4f6" stroke="#9ca3af" strokeWidth={0.04}
            />

            {/* Ядра (лифты/лестница) */}
            {section.cores.map((core, ci) => (
              <g key={ci}>
                <rect
                  x={core.x} y={core.y}
                  width={core.w} height={core.d}
                  fill="#374151" stroke="#1f2937" strokeWidth={0.05}
                />
                <text
                  x={core.x + core.w / 2}
                  y={core.y + core.d / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fill="#f9fafb"
                  fontSize={0.5}
                  transform={`scale(1, -1) translate(0, -${(core.y + core.d / 2) * 2})`}
                >
                  {CORE_LABEL[core.kind] ?? "?"}
                </text>
              </g>
            ))}

            {/* Квартиры → комнаты */}
            {section.apartments.map((apt) => (
              <g key={apt.number}>
                {/* Контур квартиры */}
                <rect
                  x={apt.x} y={apt.y}
                  width={apt.w} height={apt.d}
                  fill="none" stroke="#6b7280" strokeWidth={0.06}
                />

                {/* Комнаты внутри */}
                {apt.rooms.map((room, ri) => {
                  const rx = apt.x + room.x;
                  const ry = apt.y + room.y;
                  return (
                    <g key={ri}>
                      <rect
                        x={rx} y={ry}
                        width={room.w} height={room.d}
                        fill={ROOM_COLOR[room.kind] ?? "#f3f4f6"}
                        stroke="#9ca3af" strokeWidth={0.025}
                      />
                      {/* Подпись комнаты — два текста: имя сверху, площадь снизу */}
                      {room.w > 1.6 && room.d > 1.0 && (
                        <>
                          <text
                            x={rx + room.w / 2}
                            y={ry + room.d / 2 - 0.1}
                            textAnchor="middle" dominantBaseline="central"
                            fill="#1f2937"
                            fontSize={Math.min(0.32, room.w * 0.07, room.d * 0.12)}
                            transform={`scale(1, -1) translate(0, -${(ry + room.d / 2 - 0.1) * 2})`}
                          >
                            {room.name_ru}
                          </text>
                          <text
                            x={rx + room.w / 2}
                            y={ry + room.d / 2 + 0.35}
                            textAnchor="middle" dominantBaseline="central"
                            fill="#6b7280"
                            fontSize={Math.min(0.24, room.w * 0.05, room.d * 0.10)}
                            transform={`scale(1, -1) translate(0, -${(ry + room.d / 2 + 0.35) * 2})`}
                          >
                            {(room.w * room.d).toFixed(1)} м²
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Номер квартиры в углу */}
                <text
                  x={apt.x + 0.3}
                  y={apt.y + apt.d - 0.3}
                  textAnchor="start" dominantBaseline="hanging"
                  fill="#1f2937"
                  fontSize={0.4} fontWeight={700}
                  transform={`scale(1, -1) translate(0, -${(apt.y + apt.d - 0.3) * 2})`}
                >
                  #{apt.number}
                </text>
              </g>
            ))}
          </g>
        ))}

        {/* Размер по ширине */}
        <g>
          <line
            x1={0} y1={-1.5} x2={W} y2={-1.5}
            stroke="#1f2937" strokeWidth={0.04}
          />
          <line x1={0} y1={-1.7} x2={0} y2={-1.3} stroke="#1f2937" strokeWidth={0.04} />
          <line x1={W} y1={-1.7} x2={W} y2={-1.3} stroke="#1f2937" strokeWidth={0.04} />
          <text
            x={W / 2} y={-2.0}
            textAnchor="middle" dominantBaseline="central"
            fill="#1f2937" fontSize={0.45} fontWeight={600}
            transform={`scale(1, -1) translate(0, -${-2.0 * 2})`}
          >
            {W.toFixed(2)} м
          </text>
        </g>

        {/* Размер по высоте */}
        <g>
          <line
            x1={-1.5} y1={0} x2={-1.5} y2={D}
            stroke="#1f2937" strokeWidth={0.04}
          />
          <line x1={-1.7} y1={0} x2={-1.3} y2={0} stroke="#1f2937" strokeWidth={0.04} />
          <line x1={-1.7} y1={D} x2={-1.3} y2={D} stroke="#1f2937" strokeWidth={0.04} />
          <text
            x={-2.2} y={D / 2}
            textAnchor="middle" dominantBaseline="central"
            fill="#1f2937" fontSize={0.45} fontWeight={600}
            transform={`scale(1, -1) translate(0, -${(D / 2) * 2}) rotate(-90 ${-2.2} ${D / 2})`}
          >
            {D.toFixed(2)} м
          </text>
        </g>
      </g>
    </svg>
  );
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
