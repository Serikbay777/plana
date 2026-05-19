"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, ChevronDown, Loader2, AlertTriangle, CheckCircle2, Info, Download } from "lucide-react";
import {
  getKvartirografiya,
  type KvartirografiyaResponse,
  type AptTypeRow,
  type VisualizeFromInputsRequest,
} from "@/lib/engine";
import { exportKvartirografiyaPdf, exportKvartirografiyaCsv } from "@/lib/pdf-export";

type Props = { request: VisualizeFromInputsRequest; debounceMs?: number };

const TYPE_COLOR: Record<string, string> = {
  studio: "bg-violet-400",
  k1:     "bg-sky-400",
  k2:     "bg-emerald-400",
  k3:     "bg-amber-400",
};

function NormBadge({ row }: { row: AptTypeRow }) {
  if (row.pct_input < 0.1) return null;
  return row.norm_ok
    ? <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
    : <AlertTriangle size={10} className="text-amber-400 shrink-0" />;
}

function AptRow({ row }: { row: AptTypeRow }) {
  const dot = TYPE_COLOR[row.type_code] ?? "bg-white/40";
  return (
    <tr className="border-t border-white/[0.06] text-[11px]">
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          <span className="text-white/80">{row.label}</span>
          <NormBadge row={row} />
        </span>
      </td>
      <td className="py-1.5 pr-2 tabular-nums text-right text-white/60">{row.share_pct.toFixed(0)}%</td>
      <td className="py-1.5 pr-2 tabular-nums text-right text-white/60">{row.total_count}</td>
      <td className="py-1.5 pr-2 tabular-nums text-right text-white/60">{row.area_m2}</td>
      <td className="py-1.5 tabular-nums text-right text-white/60">{row.total_area_m2.toFixed(0)}</td>
    </tr>
  );
}

export function KvartirografiyaPanel({ request, debounceMs = 500 }: Props) {
  const [data, setData] = useState<KvartirografiyaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const reqKey = useMemo(() => JSON.stringify(request), [request]);
  const firstRun = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await getKvartirografiya(request);
        if (!cancelled) setData(res);
      } catch {
        /* silent — backend might not be deployed yet */
      } finally {
        if (!cancelled) {
          setLoading(false);
          firstRun.current = false;
        }
      }
    }, firstRun.current ? 80 : debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [reqKey, request, debounceMs]);

  const tep = data?.tep;
  const hasRecs = (data?.recommendations?.length ?? 0) > 0;

  return (
    <div className="surface-strong rounded-2xl px-3 py-2.5 text-white">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-[12px] font-medium"
      >
        <span className="flex items-center gap-1.5">
          <LayoutGrid size={13} className="text-sky-300" />
          <span>Квартирография</span>
          {loading && <Loader2 size={11} className="animate-spin text-white/40" />}
        </span>
        <span className="flex items-center gap-1.5">
          {tep && (
            <span className="text-[10.5px] text-white/45 tabular-nums">
              {tep.total_apartments} кв.
            </span>
          )}
          {hasRecs && <AlertTriangle size={10} className="text-amber-400" />}
          <ChevronDown size={13} className={`text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && data && (
        <div className="mt-2.5 space-y-3">
          {/* Таблица по типам */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[10px] text-white/35">
                <th className="text-left pb-1 font-normal pr-2">Тип</th>
                <th className="text-right pb-1 font-normal pr-2">Доля</th>
                <th className="text-right pb-1 font-normal pr-2">Кол-во</th>
                <th className="text-right pb-1 font-normal pr-2">м²/кв.</th>
                <th className="text-right pb-1 font-normal">Итого м²</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.filter(r => r.total_count > 0).map(r => (
                <AptRow key={r.type_code} row={r} />
              ))}
            </tbody>
          </table>

          {/* ТЭП */}
          {tep && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-2.5 py-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="col-span-2 text-[10px] text-white/35 font-medium uppercase tracking-wide mb-0.5">ТЭП</div>
              <TepRow label="Всего этажей" value={String(tep.total_floors)} />
              <TepRow label="Всего квартир" value={String(tep.total_apartments)} />
              <TepRow label="Площадь здания" value={`${tep.total_floor_area_m2.toFixed(0)} м²`} />
              <TepRow label="Площадь квартир" value={`${tep.total_apt_area_m2.toFixed(0)} м²`} />
              <TepRow label="Жилая площадь" value={`${tep.total_living_area_m2.toFixed(0)} м²`} />
              <TepRow label="Ср. площадь кв." value={`${tep.avg_apt_area_m2} м²`} />
              <TepRow
                label="КПД планировки"
                value={`${tep.efficiency_pct}%`}
                ok={tep.efficiency_pct >= 55}
              />
              <TepRow
                label="Насыщенность"
                value={`${tep.apt_per_1000m2} кв./1000м²`}
                ok={tep.apt_per_1000m2 <= 18}
              />
            </div>
          )}

          {/* Рекомендации */}
          {hasRecs && (
            <div className="space-y-1">
              {data.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10.5px] text-amber-200/80 rounded-lg bg-amber-500/10 border border-amber-400/20 px-2 py-1.5">
                  <Info size={10} className="shrink-0 mt-0.5" />
                  {r}
                </div>
              ))}
            </div>
          )}

          {!hasRecs && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-300/80">
              <CheckCircle2 size={11} />
              Микс в пределах рыночных норм РК
            </div>
          )}

          {/* Экспорт */}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={() => exportKvartirografiyaCsv(data)}
              className="flex-1 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/60 hover:text-white hover:bg-white/[0.07] transition flex items-center justify-center gap-1.5"
            >
              <Download size={10} /> CSV (Excel)
            </button>
            <button
              onClick={() => exportKvartirografiyaPdf(data)}
              className="flex-1 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/60 hover:text-white hover:bg-white/[0.07] transition flex items-center justify-center gap-1.5"
            >
              <Download size={10} /> PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TepRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const color = ok === undefined ? "text-white/70" : ok ? "text-emerald-300" : "text-amber-300";
  return (
    <>
      <span className="text-white/40">{label}:</span>
      <span className={`text-right tabular-nums ${color}`}>{value}</span>
    </>
  );
}
