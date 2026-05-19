"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, ShieldCheck,
} from "lucide-react";
import {
  validateProject,
  type ProjectValidationResponse,
  type ProjectViolation,
  type VisualizeFromInputsRequest,
  type ViolationSeverity,
} from "@/lib/engine";

type Props = {
  /** Запрос для эндпоинта /validate/project — обычно результат buildVisReq(form). */
  request: VisualizeFromInputsRequest;
  /** Дебаунс ms между правкой формы и запросом. По умолчанию 400. */
  debounceMs?: number;
};

const SEV_STYLES: Record<ViolationSeverity, string> = {
  error:   "bg-rose-500/15  border-rose-400/30  text-rose-200",
  warning: "bg-amber-500/15 border-amber-400/30 text-amber-200",
  info:    "bg-sky-500/15   border-sky-400/30   text-sky-200",
};

const SEV_ICON: Record<ViolationSeverity, React.ReactNode> = {
  error:   <AlertOctagon size={11} className="shrink-0 mt-0.5" />,
  warning: <AlertTriangle size={11} className="shrink-0 mt-0.5" />,
  info:    <Info size={11} className="shrink-0 mt-0.5" />,
};

export function ValidationPanel({ request, debounceMs = 400 }: Props) {
  const [data, setData] = useState<ProjectValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const reqKey = useMemo(() => JSON.stringify(request), [request]);
  const firstRunRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await validateProject(request);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось проверить проект");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          firstRunRef.current = false;
        }
      }
    }, firstRunRef.current ? 50 : debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reqKey, request, debounceMs]);

  const summary = data?.summary;
  const errors   = data?.errors_count ?? 0;
  const warnings = data?.warnings_count ?? 0;
  const infos    = data?.infos_count ?? 0;
  const violations = data?.violations ?? [];

  const allOk = data && errors === 0 && warnings === 0;

  return (
    <div className="surface-strong rounded-2xl px-3 py-2.5 text-white">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-[12px] font-medium"
      >
        <span className="flex items-center gap-1.5">
          <ShieldCheck size={13} className="text-emerald-300" />
          <span>Проверка норм РК</span>
          {loading && <Loader2 size={11} className="animate-spin text-white/40" />}
        </span>
        <span className="flex items-center gap-1.5">
          {data && (
            <span className="flex items-center gap-1 text-[10.5px] tabular">
              {errors > 0 && (
                <span className="text-rose-300">
                  <AlertOctagon size={10} className="inline -mt-0.5 mr-0.5" />
                  {errors}
                </span>
              )}
              {warnings > 0 && (
                <span className="text-amber-300">
                  <AlertTriangle size={10} className="inline -mt-0.5 mr-0.5" />
                  {warnings}
                </span>
              )}
              {infos > 0 && (
                <span className="text-sky-300">
                  <Info size={10} className="inline -mt-0.5 mr-0.5" />
                  {infos}
                </span>
              )}
              {allOk && (
                <span className="text-emerald-300">
                  <CheckCircle2 size={11} className="inline -mt-0.5 mr-0.5" />
                  ОК
                </span>
              )}
            </span>
          )}
          <ChevronDown
            size={13}
            className={`text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-2">
          {/* Summary */}
          {summary && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-white/75">
              <div className="flex justify-between gap-2">
                <span className="text-white/45">Участок:</span>
                <span className="tabular">{summary.site_area_m2.toFixed(0)} м²</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/45">Пятно:</span>
                <span className="tabular">{summary.total_footprint_m2.toFixed(0)} м²</span>
              </div>
              {summary.coverage_pct < 99 && (
                <div className="flex justify-between gap-2 col-span-2">
                  <span className="text-white/45">% застройки:</span>
                  <span className="tabular">{summary.coverage_pct.toFixed(1)}%</span>
                </div>
              )}
            </div>
          )}

          {/* Error from API */}
          {error && (
            <div className="text-[11px] text-rose-300/90 px-2 py-1.5 rounded bg-rose-500/10 border border-rose-400/20">
              {error}
            </div>
          )}

          {/* No data yet */}
          {!data && !error && !loading && (
            <div className="text-[11px] text-white/45 italic">
              Заполните участок/этажность, чтобы запустить проверку.
            </div>
          )}

          {/* Violations list */}
          {violations.length > 0 && (
            <ul className="space-y-1.5">
              {violations.map((v, idx) => (
                <ViolationRow key={`${v.rule}-${idx}`} v={v} />
              ))}
            </ul>
          )}

          {/* All clean state */}
          {data && violations.length === 0 && !error && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-300/90 px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-400/20">
              <CheckCircle2 size={12} />
              <span>Нарушений не обнаружено.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViolationRow({ v }: { v: ProjectViolation }) {
  return (
    <li
      className={`rounded border px-2 py-1.5 text-[11px] leading-snug ${SEV_STYLES[v.severity]}`}
    >
      <div className="flex items-start gap-1.5">
        {SEV_ICON[v.severity]}
        <div className="flex-1 min-w-0">
          <div className="text-white/90">{v.message}</div>
          {v.norm && (
            <div className="text-[10px] text-white/45 mt-0.5">{v.norm}</div>
          )}
        </div>
      </div>
    </li>
  );
}
