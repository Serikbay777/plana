"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

export type PromptFormState = {
  // объект
  purpose: "residential" | "commercial" | "mixed_use" | "hotel";
  // габариты
  site_width_m: number;
  site_depth_m: number;
  setback_front_m: number;
  setback_side_m: number;
  setback_rear_m: number;
  floors: number;
  // микс
  studio_pct: number; // в процентах 0..100
  k1_pct: number;
  k2_pct: number;
  k3_pct: number;
  // паркинг
  parking_spaces_per_apt: number;
  parking_underground_levels: number;
  // пожарка
  fire_evacuation_max_m: number;
  fire_evacuation_exits_per_section: number;
  fire_dead_end_corridor_max_m: number;
  // лифты
  lifts_passenger: number;
  lifts_freight: number;
  // инсоляция
  insolation_priority: boolean;
  insolation_min_hours: number;
  // ГПЗУ
  max_coverage_pct: number;
  max_height_m: number;
};

export const DEFAULT_PROMPT_FORM: PromptFormState = {
  purpose: "residential",
  site_width_m: 60,
  site_depth_m: 40,
  setback_front_m: 5,
  setback_side_m: 4,
  setback_rear_m: 5,
  floors: 9,
  studio_pct: 25,
  k1_pct: 35,
  k2_pct: 30,
  k3_pct: 10,
  parking_spaces_per_apt: 1.0,
  parking_underground_levels: 1,
  fire_evacuation_max_m: 25,
  fire_evacuation_exits_per_section: 2,
  fire_dead_end_corridor_max_m: 12,
  lifts_passenger: 2,
  lifts_freight: 1,
  insolation_priority: true,
  insolation_min_hours: 2.0,
  max_coverage_pct: 50,
  max_height_m: 30,
};

const PURPOSE_OPTIONS: { v: PromptFormState["purpose"]; label: string }[] = [
  { v: "residential", label: "Жилой" },
  { v: "commercial", label: "Коммерческий" },
  { v: "mixed_use", label: "Mixed-use" },
  { v: "hotel", label: "Отель" },
];

type Props = {
  value: PromptFormState;
  onChange: (v: PromptFormState) => void;
  onGenerate: () => void;
  generating?: boolean;
};

export function PromptForm({ value, onChange, onGenerate, generating }: Props) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const update = <K extends keyof PromptFormState>(key: K, v: PromptFormState[K]) => {
    const next = { ...local, [key]: v };
    setLocal(next);
    onChange(next);
  };

  return (
    <aside className="surface rounded-2xl flex flex-col gap-1 h-full overflow-y-auto scroll-area">
      {/* Назначение объекта */}
      <Section title="Назначение" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          {PURPOSE_OPTIONS.map((opt) => (
            <button
              key={opt.v}
              onClick={() => update("purpose", opt.v)}
              className={`h-9 rounded-lg text-[12px] transition ${
                local.purpose === opt.v
                  ? "bg-white text-black font-medium"
                  : "bg-white/[0.04] border border-white/[0.07] text-white/70 hover:bg-white/[0.07]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Габариты */}
      <Section title="Габариты" defaultOpen>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <NumField label="Ширина" suffix="м" value={local.site_width_m} onChange={(v) => update("site_width_m", v)} />
          <NumField label="Глубина" suffix="м" value={local.site_depth_m} onChange={(v) => update("site_depth_m", v)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumField label="Перед" suffix="м" value={local.setback_front_m} onChange={(v) => update("setback_front_m", v)} />
          <NumField label="Зад" suffix="м" value={local.setback_rear_m} onChange={(v) => update("setback_rear_m", v)} />
          <NumField label="Бок" suffix="м" value={local.setback_side_m} onChange={(v) => update("setback_side_m", v)} />
        </div>
      </Section>

      {/* Этажность */}
      <Section title="Этажей" defaultOpen>
        <NumField label="" suffix="эт" value={local.floors} onChange={(v) => update("floors", v)} />
      </Section>

      {/* Квартирография */}
      <Section title="Квартирография" defaultOpen>
        <MixSlider color="bg-cyan-400" label="Студии" value={local.studio_pct} onChange={(v) => update("studio_pct", v)} />
        <MixSlider color="bg-violet-400" label="1-комн" value={local.k1_pct} onChange={(v) => update("k1_pct", v)} />
        <MixSlider color="bg-amber-400" label="2-комн" value={local.k2_pct} onChange={(v) => update("k2_pct", v)} />
        <MixSlider color="bg-pink-400" label="3-комн" value={local.k3_pct} onChange={(v) => update("k3_pct", v)} />
      </Section>

      {/* Паркинг */}
      <Section title="Паркинг">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Мест/кв." value={local.parking_spaces_per_apt} step={0.1} onChange={(v) => update("parking_spaces_per_apt", v)} />
          <NumField label="Подз. эт." suffix="эт" value={local.parking_underground_levels} onChange={(v) => update("parking_underground_levels", v)} />
        </div>
      </Section>

      {/* Пожарка */}
      <Section title="Пожарные нормы">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <NumField label="Эвакуация" suffix="м" value={local.fire_evacuation_max_m} onChange={(v) => update("fire_evacuation_max_m", v)} />
          <NumField label="Тупик" suffix="м" value={local.fire_dead_end_corridor_max_m} onChange={(v) => update("fire_dead_end_corridor_max_m", v)} />
        </div>
        <NumField label="Выходов на секцию" value={local.fire_evacuation_exits_per_section} onChange={(v) => update("fire_evacuation_exits_per_section", v)} />
      </Section>

      {/* Лифты */}
      <Section title="Лифты">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Пассажир." value={local.lifts_passenger} onChange={(v) => update("lifts_passenger", v)} />
          <NumField label="Грузовых" value={local.lifts_freight} onChange={(v) => update("lifts_freight", v)} />
        </div>
      </Section>

      {/* Инсоляция */}
      <Section title="Инсоляция">
        <label className="flex items-center justify-between cursor-pointer mb-2.5">
          <span className="text-[12px] text-white/75">Юг для больших квартир</span>
          <Toggle
            checked={local.insolation_priority}
            onChange={(v) => update("insolation_priority", v)}
          />
        </label>
        <NumField label="Минимум часов" suffix="ч" value={local.insolation_min_hours} step={0.5} onChange={(v) => update("insolation_min_hours", v)} />
      </Section>

      {/* ГПЗУ */}
      <Section title="ГПЗУ">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="КИТ макс." suffix="%" value={local.max_coverage_pct} onChange={(v) => update("max_coverage_pct", v)} />
          <NumField label="Высота макс." suffix="м" value={local.max_height_m} onChange={(v) => update("max_height_m", v)} />
        </div>
      </Section>

      {/* Главная кнопка */}
      <div className="px-4 py-4 border-t border-white/[0.05] mt-auto">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="btn-apple h-12 w-full flex items-center justify-center gap-2 text-[14px] disabled:opacity-60"
        >
          <Sparkles size={15} />
          {generating ? "Рисуем…" : "Сгенерировать"}
        </button>
      </div>
    </aside>
  );
}

function Section({
  title, children, defaultOpen,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-b border-white/[0.04]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition"
      >
        <span className="text-[11px] uppercase tracking-[0.14em] text-white/55 font-medium">
          {title}
        </span>
        <ChevronDown
          size={13}
          className={`text-white/35 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function NumField({
  label, suffix, value, step, onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-white/55">{label}</span>}
      <div className="relative">
        <input
          type="number"
          value={value}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full h-9 rounded-lg bg-white/[0.04] border border-white/[0.07] px-2.5 pr-7 text-[13px] tabular focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition"
        />
        {suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/35 uppercase">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function MixSlider({
  color, label, value, onChange,
}: {
  color: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${color}`} />
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full transition flex items-center px-0.5 ${
        checked ? "bg-white" : "bg-white/[0.12]"
      }`}
    >
      <span
        className={`size-4 rounded-full transition-transform ${
          checked ? "bg-black translate-x-4" : "bg-white/85"
        }`}
      />
    </button>
  );
}
