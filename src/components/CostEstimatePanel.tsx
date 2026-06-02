"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Coins, ChevronDown, Loader2, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { costAggregate, type AggregateCostEstimate } from "@/lib/engine";

const REGIONS: [string, string][] = [
  ["Алматы", "Алматы"],
  ["Астана", "Астана"],
  ["Шымкент", "Шымкент"],
  ["Актобе", "Актобе"],
  ["default", "Другой (средн.)"],
];

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

type Props = {
  widthM: number;
  depthM: number;
  floors: number;
  buildingType?: string;
  debounceMs?: number;
};

/**
 * Укрупнённая РАСЧЁТНАЯ стоимость стадии посадки (Высота-1).
 * GFA ≈ пятно × этажность; считается на бэке (/cost/aggregate) с диапазоном
 * AACE Class 5 и стеком ССР. Это НЕ смета — дисклеймер показывается явно.
 */
export function CostEstimatePanel({
  widthM, depthM, floors, buildingType = "residential", debounceMs = 500,
}: Props) {
  const [region, setRegion] = useState("Алматы");
  const [data, setData] = useState<AggregateCostEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const gfa = useMemo(() => {
    const g = (widthM || 0) * (depthM || 0) * (floors || 0);
    return Number.isFinite(g) && g > 0 ? Math.round(g) : 0;
  }, [widthM, depthM, floors]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (gfa <= 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await costAggregate({ gfa_m2: gfa, region, building_type: buildingType });
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка расчёта");
      } finally {
        if (!cancelled) { setLoading(false); firstRun.current = false; }
      }
    }, firstRun.current ? 80 : debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [gfa, region, buildingType, debounceMs]);

  return (
    <div className="surface-strong rounded-2xl px-3 py-2.5 text-white">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-[12px] font-medium"
      >
        <span className="flex items-center gap-1.5">
          <Coins size={13} className="text-amber-300" />
          <span>Стоимость (укрупнённо)</span>
          {loading && <Loader2 size={11} className="animate-spin text-white/40" />}
        </span>
        <span className="flex items-center gap-1.5">
          {data && gfa > 0 && (
            <span className="text-[10.5px] text-white/45 tabular-nums">{fmt(data.total)} ₸</span>
          )}
          <ChevronDown size={13} className={`text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-3">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <label className="flex items-center gap-1.5 text-white/50">
              Регион
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="bg-white/[0.05] border border-white/[0.1] rounded-lg px-2 py-1 text-white/80 outline-none"
              >
                {REGIONS.map(([v, l]) => (
                  <option key={v} value={v} className="bg-neutral-900">{l}</option>
                ))}
              </select>
            </label>
            <span className="text-white/40 tabular-nums">GFA ≈ {fmt(gfa)} м²</span>
          </div>

          {gfa <= 0 && (
            <div className="text-[10.5px] text-white/40">
              Укажите габариты здания и этажность для расчёта.
            </div>
          )}

          {error && (
            <div className="text-[10.5px] text-rose-300 flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />{error}
            </div>
          )}

          {data && gfa > 0 && (
            <>
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-white/35 uppercase tracking-wide">Расчётная стоимость</span>
                  <span className="text-[15px] font-semibold tabular-nums text-amber-200">{fmt(data.total)} ₸</span>
                </div>
                <div className="text-[10.5px] text-white/45 tabular-nums text-right mt-0.5">
                  диапазон {fmt(data.total_low)} … {fmt(data.total_high)} ₸
                </div>
                <div className="text-[9.5px] text-white/30 text-right">{data.estimate_class}</div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-2.5 py-2 space-y-1 text-[11px]">
                <CostRow label={`Базовая (СМР) · ${fmt(data.rate_per_m2)} ₸/м²`} value={fmt(data.base_construction)} />
                {data.buildup.map((ln, i) => (
                  <CostRow key={i} label={`+ ${ln.label}`} value={fmt(ln.amount)} muted />
                ))}
                <div className="border-t border-white/[0.06] my-1" />
                <CostRow label="Итого без НДС" value={fmt(data.subtotal_ex_vat)} />
                <CostRow label="НДС" value={fmt(data.vat)} muted />
                <CostRow label="ИТОГО" value={fmt(data.total)} strong />
              </div>

              <div className="flex items-start gap-1.5 text-[10px] text-amber-200/70 rounded-lg bg-amber-500/10 border border-amber-400/20 px-2 py-1.5">
                <ShieldAlert size={11} className="shrink-0 mt-0.5" />
                <span>{data.disclaimer}</span>
              </div>

              {data.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] text-white/45">
                  <Info size={10} className="shrink-0 mt-0.5 text-white/30" />{w}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CostRow({ label, value, muted, strong }: {
  label: string; value: string; muted?: boolean; strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={strong ? "text-white/80 font-medium" : muted ? "text-white/40" : "text-white/55"}>
        {label}
      </span>
      <span className={`tabular-nums ${strong ? "text-amber-200 font-semibold" : muted ? "text-white/45" : "text-white/70"}`}>
        {value} ₸
      </span>
    </div>
  );
}
