"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Download, TrendingUp, Building2, Lightbulb, BarChart3 } from "lucide-react";
import { APT_TARGETS, type AptType, type Plan } from "@/lib/generator";

type Props = {
  plan: Plan;
  floors: number;
  onExport: () => void;
};

export function Metrics({ plan, floors, onExport }: Props) {
  const m = plan.metrics;
  const totalSaleable = Math.round(m.saleableArea * floors);
  const totalApts = m.aptCount * floors;

  const stats = [
    { label: "Жилая S, этаж", value: `${m.saleableArea}`, suffix: "м²" },
    { label: "Эффективность", value: `${(m.efficiency * 100).toFixed(0)}`, suffix: "%" },
    { label: "Квартир", value: `${m.aptCount}`, suffix: "" },
    { label: "Покрытие", value: `${(m.coverage * 100).toFixed(0)}`, suffix: "%" },
  ];

  return (
    <div className="surface rounded-2xl p-6 h-full overflow-y-auto scroll-area flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/45 font-medium">
          <Building2 size={11} />
          Выбранный вариант
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <div className="text-[18px] font-semibold tracking-display mt-1.5 leading-snug">
              {plan.variantName}
            </div>
            <div className="text-[12.5px] text-white/55 mt-2 leading-relaxed">
              {plan.variantDesc}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="h-px bg-white/[0.07]" />

      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-3.5"
          >
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/45 font-medium">{s.label}</div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-[28px] font-semibold tabular leading-none tracking-display">
                {s.value}
              </span>
              {s.suffix && (
                <span className="text-[12px] text-white/45 tabular">{s.suffix}</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-medium flex items-center gap-1.5">
          <BarChart3 size={11} />
          Структура квартир
        </div>
        <MixBar plan={plan} />
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          {(["studio", "k1", "k2", "k3"] as AptType[]).map((t) => (
            <div key={t} className="flex items-center gap-2 text-[12px]">
              <span className="size-2 rounded-full" style={{ background: APT_TARGETS[t].color }} />
              <span className="text-white/65">{APT_TARGETS[t].label}</span>
              <span className="ml-auto tabular text-white/85">{m.aptByType[t]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-4 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium">
          <TrendingUp size={11} />
          Итого по объекту · {floors} этажей
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[32px] font-semibold tabular tracking-display leading-none">
            {totalSaleable.toLocaleString("ru-RU")}
          </span>
          <span className="text-[12px] text-white/55">м²</span>
        </div>
        <div className="text-[12px] text-white/55 tabular">
          {totalApts} квартир · средняя {m.avgAptArea} м²
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-medium flex items-center gap-1.5">
          <Lightbulb size={11} />
          AI-комментарий
        </div>
        <ul className="flex flex-col gap-2.5">
          {plan.insights.map((tip, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: i * 0.05 }}
              className="text-[12.5px] leading-relaxed text-white/70 pl-3 border-l border-white/15"
            >
              {tip}
            </motion.li>
          ))}
        </ul>
      </div>

      <button
        onClick={onExport}
        className="mt-auto h-11 btn-apple-secondary flex items-center justify-center gap-2 text-[13px]"
      >
        <Download size={14} />
        Экспорт в PDF
      </button>
    </div>
  );
}

function MixBar({ plan }: { plan: Plan }) {
  const m = plan.metrics;
  const total = (["studio", "k1", "k2", "k3"] as AptType[]).reduce(
    (s, t) => s + m.aptByType[t],
    0,
  ) || 1;
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex bg-white/[0.05]">
      {(["studio", "k1", "k2", "k3"] as AptType[]).map((t) => {
        const pct = (m.aptByType[t] / total) * 100;
        if (pct < 0.5) return null;
        return (
          <motion.div
            key={t}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            style={{ background: APT_TARGETS[t].color }}
          />
        );
      })}
    </div>
  );
}
