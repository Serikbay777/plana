"use client";

import { useEffect, useState } from "react";
import { Sparkles, Upload } from "lucide-react";
import type { GenerateRectRequest } from "@/lib/engine";

export type ControlsState = GenerateRectRequest & {
  setback_front_m: number;
  setback_side_m: number;
  setback_rear_m: number;
  floors: number;
  target_mix: { studio: number; k1: number; k2: number; k3: number };
};

type Props = {
  value: ControlsState;
  onChange: (v: ControlsState) => void;
  onGenerate: () => void;
  onUploadDxf: (f: File) => void;
  generating?: boolean;
};

const MIX_LABELS = { studio: "Студии", k1: "1-комн", k2: "2-комн", k3: "3-комн" };
const MIX_DOT = {
  studio: "bg-cyan-400",
  k1: "bg-violet-400",
  k2: "bg-amber-400",
  k3: "bg-pink-400",
};

const DEFAULT: ControlsState = {
  site_width_m: 60,
  site_depth_m: 40,
  setback_front_m: 5,
  setback_side_m: 4,
  setback_rear_m: 5,
  floors: 9,
  target_mix: { studio: 0.25, k1: 0.35, k2: 0.30, k3: 0.10 },
};

export const DEFAULT_CONTROLS: ControlsState = DEFAULT;

export function PresetControls({
  value,
  onChange,
  onGenerate,
  onUploadDxf,
  generating,
}: Props) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const update = (patch: Partial<ControlsState>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  };

  const updateMix = (k: keyof ControlsState["target_mix"], v: number) => {
    const next = { ...local, target_mix: { ...local.target_mix, [k]: v / 100 } };
    setLocal(next);
    onChange(next);
  };

  return (
    <aside className="surface rounded-2xl p-5 flex flex-col gap-5 h-full overflow-y-auto scroll-area">
      {/* DXF загрузка — компактная */}
      <label className="flex items-center gap-2.5 cursor-pointer rounded-xl border border-dashed border-white/[0.12] hover:border-white/[0.22] transition px-3 py-2.5 bg-white/[0.015]">
        <Upload size={14} className="text-white/55" />
        <span className="text-[12px] text-white/70 flex-1">Загрузить DXF</span>
        <span className="text-[10px] text-white/35">опц.</span>
        <input
          type="file"
          accept=".dxf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadDxf(f);
            e.target.value = "";
          }}
        />
      </label>

      {/* Габариты участка */}
      <Section title="Участок">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Ширина" value={local.site_width_m} onChange={(v) => update({ site_width_m: v })} />
          <NumField label="Глубина" value={local.site_depth_m} onChange={(v) => update({ site_depth_m: v })} />
        </div>
      </Section>

      {/* Отступы */}
      <Section title="Отступы">
        <div className="grid grid-cols-3 gap-2">
          <NumField label="Перед" value={local.setback_front_m} onChange={(v) => update({ setback_front_m: v })} />
          <NumField label="Зад" value={local.setback_rear_m} onChange={(v) => update({ setback_rear_m: v })} />
          <NumField label="Бок" value={local.setback_side_m} onChange={(v) => update({ setback_side_m: v })} />
        </div>
      </Section>

      {/* Этажность */}
      <Section title="Этажей">
        <NumField label="" value={local.floors} onChange={(v) => update({ floors: v })} suffixOverride="эт" />
      </Section>

      {/* Микс */}
      <Section title="Квартирография">
        <div className="flex flex-col gap-3">
          {(["studio", "k1", "k2", "k3"] as const).map((k) => (
            <MixSlider
              key={k}
              label={MIX_LABELS[k]}
              dot={MIX_DOT[k]}
              value={local.target_mix[k] * 100}
              onChange={(v) => updateMix(k, v)}
            />
          ))}
        </div>
      </Section>

      <button
        onClick={onGenerate}
        disabled={generating}
        className="btn-apple h-11 flex items-center justify-center gap-2 text-[14px] disabled:opacity-60 mt-auto"
      >
        <Sparkles size={15} />
        {generating ? "Генерация…" : "Сгенерировать"}
      </button>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/40 font-medium mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function NumField({
  label, value, onChange, suffixOverride,
}: {
  label: string; value: number; onChange: (v: number) => void; suffixOverride?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-white/55">{label}</span>}
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full h-9 rounded-lg bg-white/[0.04] border border-white/[0.07] px-2.5 pr-7 text-[13px] tabular focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/35 uppercase">
          {suffixOverride ?? "м"}
        </span>
      </div>
    </label>
  );
}

function MixSlider({
  label, dot, value, onChange,
}: { label: string; dot: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${dot}`} />
          <span className="text-[12px] text-white/75">{label}</span>
        </div>
        <span className="text-[11px] tabular text-white/55">{Math.round(value)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={70}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-white"
        style={{ height: 4 }}
      />
    </div>
  );
}
