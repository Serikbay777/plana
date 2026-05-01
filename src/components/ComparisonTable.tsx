"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { APT_LABELS, type Plan, type AptType } from "@/lib/engine";

type Props = {
  plans: Plan[];
  selectedId: number;
  presetLabels: Record<string, string>;
  onSelect: (idx: number) => void;
  floors: number;
};

export function ComparisonTable({
  plans,
  selectedId,
  presetLabels,
  onSelect,
  floors,
}: Props) {
  if (!plans.length) return null;

  const allTypes: AptType[] = [];
  for (const p of plans) {
    for (const t of Object.keys(p.metrics.apt_by_type) as AptType[]) {
      if (!allTypes.includes(t)) allTypes.push(t);
    }
  }

  const winners = computeWinners(plans);

  return (
    <div className="surface rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/45 font-medium">
          Сравнительная таблица · 5 вариантов
        </div>
        <div className="text-[10px] text-white/40 tabular">по объекту: {floors} этажей</div>
      </div>
      <div className="overflow-x-auto scroll-area">
        <table className="w-full text-[12px] tabular">
          <thead>
            <tr className="text-white/45 text-[10px] uppercase tracking-wider">
              <th className="text-left font-medium px-5 py-2.5">Пресет</th>
              <th className="text-right font-medium px-3 py-2.5">Кв.</th>
              <th className="text-right font-medium px-3 py-2.5">Жилая, м²</th>
              <th className="text-right font-medium px-3 py-2.5">КИТ</th>
              <th className="text-right font-medium px-3 py-2.5">Средняя</th>
              <th className="text-right font-medium px-3 py-2.5">Юг</th>
              {allTypes.map((t) => (
                <th key={t} className="text-right font-medium px-2 py-2.5">
                  {APT_LABELS[t]}
                </th>
              ))}
              <th className="text-right font-medium px-3 py-2.5 pr-5">Итог × этажи</th>
              <th className="text-center font-medium px-3 py-2.5">Нормы</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p, idx) => {
              const m = p.metrics;
              const active = idx === selectedId;
              const total = Math.round(m.saleable_area * floors);
              return (
                <motion.tr
                  key={`${p.preset}-${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: idx * 0.04 }}
                  className={`border-t border-white/[0.04] cursor-pointer transition ${
                    active ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                  }`}
                  onClick={() => onSelect(idx)}
                >
                  <td className="text-left px-5 py-3 text-white/85 max-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-1.5 rounded-full ${
                          active ? "bg-white" : "bg-white/30"
                        }`}
                      />
                      <span className="truncate">
                        {presetLabels[p.preset] ?? p.preset}
                      </span>
                    </div>
                  </td>
                  <Cell highlight={winners.apt_count === idx}>{m.apt_count}</Cell>
                  <Cell highlight={winners.saleable_area === idx}>
                    {m.saleable_area.toFixed(0)}
                  </Cell>
                  <Cell highlight={winners.saleable_ratio === idx}>
                    {(m.saleable_ratio * 100).toFixed(0)}%
                  </Cell>
                  <Cell highlight={winners.avg_apt_area === idx}>
                    {m.avg_apt_area.toFixed(0)}
                  </Cell>
                  <Cell highlight={winners.south_oriented_share === idx}>
                    {(m.south_oriented_share * 100).toFixed(0)}%
                  </Cell>
                  {allTypes.map((t) => (
                    <td key={t} className="text-right px-2 py-3 text-white/65">
                      {m.apt_by_type[t] ?? "—"}
                    </td>
                  ))}
                  <td className="text-right px-3 py-3 pr-5 text-white/85 font-medium">
                    {total.toLocaleString("ru-RU")} м²
                  </td>
                  <td className="text-center px-3 py-3">
                    {p.norms.passed ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400/80">
                        <CheckCircle2 size={12} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-400/80">
                        <AlertTriangle size={12} />
                      </span>
                    )}
                    {p.norms.violations.length > 0 && (
                      <span className="ml-1 text-[10px] text-white/40">
                        {p.norms.violations.length}
                      </span>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight: boolean;
}) {
  return (
    <td
      className={`text-right px-3 py-3 ${
        highlight ? "text-white font-semibold" : "text-white/70"
      }`}
    >
      {children}
    </td>
  );
}

function computeWinners(plans: Plan[]): {
  apt_count: number;
  saleable_area: number;
  saleable_ratio: number;
  avg_apt_area: number;
  south_oriented_share: number;
} {
  const idxOfMax = (key: keyof Plan["metrics"]) =>
    plans.reduce(
      (best, p, i) =>
        (p.metrics[key] as number) > (plans[best].metrics[key] as number) ? i : best,
      0,
    );

  return {
    apt_count: idxOfMax("apt_count"),
    saleable_area: idxOfMax("saleable_area"),
    saleable_ratio: idxOfMax("saleable_ratio"),
    avg_apt_area: idxOfMax("avg_apt_area"),
    south_oriented_share: idxOfMax("south_oriented_share"),
  };
}
