"use client";

import { useEffect, useState, useCallback } from "react";
import { History, ChevronRight, RotateCcw, Layers, Home, LayoutGrid, MapPin, Image as ImageIcon, Loader2, X } from "lucide-react";
import { listRuns, type GenerationRun } from "@/lib/projects";
import type { PromptFormState } from "@/components/PromptForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TAB_LABEL: Record<string, string> = {
  ai_plans:           "AI Чертежи",
  viz_exterior:       "Экстерьер",
  viz_floor:          "Планировка",
  site:               "Посадка",
  viz_interior:       "Интерьер",
  parking:            "Паркинг",
};

const TAB_ICON: Record<string, React.ReactNode> = {
  ai_plans:     <LayoutGrid size={11} />,
  viz_exterior: <Home size={11} />,
  viz_floor:    <Layers size={11} />,
  site:         <MapPin size={11} />,
  viz_interior: <ImageIcon size={11} />,
};

function relativeDate(iso: string): string {
  const d = new Date(iso + "Z");
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "вчера";
  if (diffD < 7) return `${diffD} дня назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function groupByDate(runs: GenerationRun[]): { label: string; runs: GenerationRun[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);

  const groups: Record<string, GenerationRun[]> = {};
  for (const run of runs) {
    const d = new Date(run.created_at + "Z");
    let label: string;
    if (d.toDateString() === todayStr) label = "Сегодня";
    else if (d.toDateString() === yesterdayStr) label = "Вчера";
    else if (d >= weekAgo) label = "На этой неделе";
    else label = "Ранее";

    if (!groups[label]) groups[label] = [];
    groups[label].push(run);
  }

  const order = ["Сегодня", "Вчера", "На этой неделе", "Ранее"];
  return order.filter((l) => groups[l]).map((l) => ({ label: l, runs: groups[l] }));
}

function paramsShortSummary(p: PromptFormState): string {
  const parts: string[] = [];
  if (p.floors) parts.push(`${p.floors} эт.`);
  if (p.building_width_m && p.building_depth_m)
    parts.push(`${p.building_width_m}×${p.building_depth_m} м`);
  if (p.sections) parts.push(`${p.sections} секц.`);
  return parts.join(" · ") || "без параметров";
}

// ---------------------------------------------------------------------------
// RunCard
// ---------------------------------------------------------------------------

type RunCardProps = {
  run: GenerationRun;
  onRestoreImages: (run: GenerationRun) => void;
  onRestoreParams: (params: PromptFormState) => void;
};

function RunCard({ run, onRestoreImages, onRestoreParams }: RunCardProps) {
  const thumbs = run.assets.slice(0, 4).map((a) => a.url);
  const hasImages = thumbs.length > 0;

  return (
    <div className="group rounded-xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.04] transition overflow-hidden">
      {/* Thumbnail grid */}
      {hasImages && (
        <button
          onClick={() => onRestoreImages(run)}
          className="w-full block relative"
          title="Восстановить изображения в редактор"
        >
          <div className={`grid gap-0.5 bg-black/30 ${thumbs.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {thumbs.map((url, i) => (
              <div key={i} className="aspect-square overflow-hidden bg-white/[0.04]">
                <img src={url} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="text-[11px] text-white font-medium bg-black/60 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <RotateCcw size={10} /> Открыть
            </span>
          </div>
        </button>
      )}

      {/* Meta row */}
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 text-[10.5px] text-white/60">
            <span className="text-white/35">{TAB_ICON[run.tab] ?? <Layers size={11} />}</span>
            <span>{TAB_LABEL[run.tab] ?? run.tab}</span>
            {run.tab === "ai_plans" && run.floor > 1 && (
              <span className="text-white/30">· этаж {run.floor}</span>
            )}
          </div>
          <span className="text-[10px] text-white/30 flex-shrink-0">{relativeDate(run.created_at)}</span>
        </div>

        <div className="text-[10.5px] text-white/40 mb-2 truncate">
          {paramsShortSummary(run.params_snapshot)}
        </div>

        <div className="flex gap-1.5">
          {hasImages && (
            <button
              onClick={() => onRestoreImages(run)}
              className="h-6 px-2 rounded-md bg-white/[0.05] border border-white/[0.08] text-[10.5px] text-white/65 hover:text-white hover:bg-white/[0.1] transition flex items-center gap-1"
            >
              <RotateCcw size={9} /> Изображения
            </button>
          )}
          <button
            onClick={() => onRestoreParams(run.params_snapshot)}
            className="h-6 px-2 rounded-md bg-white/[0.05] border border-white/[0.08] text-[10.5px] text-white/65 hover:text-white hover:bg-white/[0.1] transition flex items-center gap-1"
          >
            <ChevronRight size={9} /> Параметры
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryPanel
// ---------------------------------------------------------------------------

export type HistoryPanelProps = {
  projectId: string | null;
  onRestoreImages: (run: GenerationRun) => void;
  onRestoreParams: (params: PromptFormState) => void;
  onClose: () => void;
};

export default function HistoryPanel({
  projectId,
  onRestoreImages,
  onRestoreParams,
  onClose,
}: HistoryPanelProps) {
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!projectId) { setRuns([]); return; }
    setLoading(true);
    listRuns(projectId)
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const groups = groupByDate(runs);

  return (
    <div className="flex flex-col h-full w-72 border-l border-white/[0.06] bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2">
          <History size={13} className="text-white/50" />
          <span className="text-[12.5px] font-medium text-white/80">История генераций</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={load}
            className="size-6 rounded grid place-items-center text-white/30 hover:text-white/70 transition"
            title="Обновить"
          >
            <RotateCcw size={11} />
          </button>
          <button
            onClick={onClose}
            className="size-6 rounded grid place-items-center text-white/30 hover:text-white/70 transition"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {!projectId ? (
          <div className="text-center py-10 text-[12px] text-white/30 leading-relaxed">
            Сохрани проект,<br />чтобы история появилась
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="text-white/30 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-10 text-[12px] text-white/30 leading-relaxed">
            Пока нет сохранённых генераций.<br />Нажми «Сгенерировать» —<br />они появятся здесь автоматически.
          </div>
        ) : (
          groups.map(({ label, runs: groupRuns }) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/30 mb-2 px-0.5">
                {label}
              </div>
              <div className="space-y-2">
                {groupRuns.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    onRestoreImages={onRestoreImages}
                    onRestoreParams={onRestoreParams}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
