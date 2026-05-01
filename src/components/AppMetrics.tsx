"use client";

import { Download, Package, FileDown, AlertTriangle } from "lucide-react";
import { dxfDownloadUrl, packageDownloadUrl, type Plan } from "@/lib/engine";

type Props = {
  plan: Plan;
  floors: number;
  requestId: string | null;
  onExportPdf: () => void;
};

export function AppMetrics({ plan, floors, requestId, onExportPdf }: Props) {
  const m = plan.metrics;
  const totalSaleable = Math.round(m.saleable_area * floors);

  const stats = [
    { label: "Жилая, м²", value: m.saleable_area.toFixed(0) },
    { label: "КИТ, %", value: (m.saleable_ratio * 100).toFixed(0) },
    { label: "Квартир", value: String(m.apt_count) },
    { label: "Юг, %", value: (m.south_oriented_share * 100).toFixed(0) },
  ];

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 4 KPI карточки */}
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className="surface rounded-2xl p-4"
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium">
              {s.label}
            </div>
            <div className="text-[30px] font-semibold tabular leading-none tracking-display mt-2">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Итог по объекту */}
      <div className="surface rounded-2xl p-4">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium">
          Всего по объекту · {floors} эт.
        </div>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="text-[28px] font-semibold tabular tracking-display leading-none">
            {totalSaleable.toLocaleString("ru-RU")}
          </span>
          <span className="text-[12px] text-white/55">м²</span>
        </div>
      </div>

      {/* Норм-контроль — только если что-то не так */}
      {plan.norms.violations.length > 0 && (
        <div className="surface rounded-2xl p-4 border-amber-400/20 bg-amber-500/[0.04]">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-amber-400/85 font-medium mb-1.5">
            <AlertTriangle size={11} />
            Замечание · {plan.norms.violations.length}
          </div>
          <div className="text-[12px] text-white/70 leading-relaxed">
            {plan.norms.violations[0].message}
          </div>
        </div>
      )}

      {/* Скачать — только пакет (главная кнопка), DXF/PDF в одной строке */}
      <div className="mt-auto flex flex-col gap-2">
        {requestId && (
          <a
            href={packageDownloadUrl(requestId)}
            download
            className="btn-apple h-12 flex items-center justify-center gap-2 text-[14px]"
          >
            <Package size={15} />
            Скачать пакет
          </a>
        )}
        <div className="grid grid-cols-2 gap-2">
          {requestId && (
            <a
              href={dxfDownloadUrl(requestId, plan.preset)}
              download
              className="h-10 btn-apple-secondary flex items-center justify-center gap-1.5 text-[12px]"
            >
              <FileDown size={13} />
              DXF
            </a>
          )}
          <button
            onClick={onExportPdf}
            className="h-10 btn-apple-secondary flex items-center justify-center gap-1.5 text-[12px]"
          >
            <Download size={13} />
            PDF
          </button>
        </div>
      </div>
    </div>
  );
}
