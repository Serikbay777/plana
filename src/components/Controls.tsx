"use client";

import { useState, useEffect } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import type { Inputs, AptType } from "@/lib/generator";

type Props = {
  value: Inputs;
  onChange: (v: Inputs) => void;
  onGenerate: () => void;
  generating?: boolean;
};

const FIELD_GROUPS: { title: string; fields: { key: keyof Omit<Inputs, "mix">; label: string; suffix: string; min?: number; max?: number }[] }[] = [
  {
    title: "Участок",
    fields: [
      { key: "siteW", label: "Ширина", suffix: "м", min: 20, max: 200 },
      { key: "siteH", label: "Глубина", suffix: "м", min: 20, max: 200 },
    ],
  },
  {
    title: "Отступы по ГПЗУ",
    fields: [
      { key: "setbackFront", label: "Передний", suffix: "м", min: 0, max: 30 },
      { key: "setbackRear", label: "Задний", suffix: "м", min: 0, max: 30 },
      { key: "setbackSide", label: "Боковой", suffix: "м", min: 0, max: 30 },
    ],
  },
  {
    title: "Здание",
    fields: [{ key: "floors", label: "Этажность", suffix: "эт", min: 1, max: 40 }],
  },
];

const MIX_LABELS: Record<AptType, string> = {
  studio: "Студии",
  k1: "1-комн",
  k2: "2-комн",
  k3: "3-комн",
};

const MIX_DOT: Record<AptType, string> = {
  studio: "bg-cyan-400",
  k1: "bg-violet-400",
  k2: "bg-amber-400",
  k3: "bg-pink-400",
};

export function Controls({ value, onChange, onGenerate, generating }: Props) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const update = (patch: Partial<Inputs>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  };

  const updateMix = (k: AptType, v: number) => {
    const next = { ...local, mix: { ...local.mix, [k]: v } };
    setLocal(next);
    onChange(next);
  };

  const mixSum = local.mix.studio + local.mix.k1 + local.mix.k2 + local.mix.k3;

  return (
    <aside className="surface rounded-2xl p-6 flex flex-col gap-6 h-full overflow-y-auto scroll-area">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/45 font-medium">
            Параметры
          </div>
          <div className="text-[17px] tracking-display font-semibold mt-1">Входные данные</div>
        </div>
        <button
          aria-label="Сбросить"
          onClick={() => onChange({
            siteW: 60, siteH: 40,
            setbackFront: 5, setbackSide: 4, setbackRear: 5,
            floors: 9,
            mix: { studio: 25, k1: 35, k2: 30, k3: 10 },
          })}
          className="size-8 rounded-full hover:bg-white/[0.06] grid place-items-center text-white/50 hover:text-white transition"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-2.5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-white/40 font-medium">
            {group.title}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {group.fields.map((f) => (
              <NumField
                key={f.key}
                label={f.label}
                suffix={f.suffix}
                value={local[f.key]}
                min={f.min}
                max={f.max}
                onChange={(v) => update({ [f.key]: v } as Partial<Inputs>)}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.16em] text-white/40 font-medium">
            Квартирография
          </div>
          <div className={`text-[10px] tabular ${Math.abs(mixSum - 100) < 1 ? "text-white/40" : "text-amber-400"}`}>
            {Math.round(mixSum)}%
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {(["studio", "k1", "k2", "k3"] as AptType[]).map((k) => (
            <MixSlider
              key={k}
              label={MIX_LABELS[k]}
              dot={MIX_DOT[k]}
              value={local.mix[k]}
              onChange={(v) => updateMix(k, v)}
            />
          ))}
        </div>
      </div>

      <div className="mt-auto pt-2">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="btn-apple w-full h-11 flex items-center justify-center gap-2 text-[14px] disabled:opacity-60"
        >
          <Sparkles size={15} />
          {generating ? "Генерация…" : "Сгенерировать"}
        </button>
        <div className="text-[11px] text-white/40 text-center mt-2.5">
          3 варианта · ~2 секунды
        </div>
      </div>
    </aside>
  );
}

function NumField({
  label, suffix, value, min, max, onChange,
}: {
  label: string; suffix: string; value: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-white/55">{label}</span>
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full h-9 rounded-lg bg-white/[0.04] border border-white/[0.07] px-2.5 pr-8 text-[13px] tabular focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/35 uppercase tracking-wider">
          {suffix}
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
          <span className={`size-2 rounded-full ${dot}`} />
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
