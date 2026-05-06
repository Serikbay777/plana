"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Home, Briefcase, Building2, Hotel,
  Minus, Plus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Тип формы — минимум essential полей для среза этажа.
// Поля, которые нужны бэкенду, но архитектору не нужны на UI (отступы, КИТ,
// паркинг для других пайплайнов) — хранятся со sensible defaults
// и при необходимости настраиваются в раскрывашке "Расширенные".
// ---------------------------------------------------------------------------

export type PromptFormState = {
  // ──── Essential для среза этажа ────
  purpose: "residential" | "commercial" | "mixed_use" | "hotel";

  /** Габариты пятна застройки (footprint здания, а не участка). */
  building_width_m: number;
  building_depth_m: number;

  floors: number;

  /** Квартирография в процентах 0..100 (только для residential/mixed_use). */
  studio_pct: number;
  k1_pct: number;
  k2_pct: number;
  k3_pct: number;

  /** Количество подъездов/секций (1=точечный, 2-4=линейный/угловой). */
  sections: number;

  /** Лестнично-лифтовый узел — НА СЕКЦИЮ (по СНиП РК). */
  lifts_passenger: number;
  lifts_freight: number;

  /** Эвакуация — рисуются стрелки. По СНиП РК ≤ 25 м. */
  fire_evacuation_max_m: number;

  // ──── Auto-defaults (для других пайплайнов) ────
  // Эти поля бэкенд всё ещё ждёт, но на UI среза этажа их нет.
  // Они либо считаются автоматически, либо берутся из advanced-блока.
  site_width_m: number;
  site_depth_m: number;
  setback_front_m: number;
  setback_side_m: number;
  setback_rear_m: number;
  parking_spaces_per_apt: number;
  parking_underground_levels: number;
  fire_evacuation_exits_per_section: number;
  fire_dead_end_corridor_max_m: number;
  insolation_priority: boolean;
  insolation_min_hours: number;
  max_coverage_pct: number;
  max_height_m: number;
};

export const DEFAULT_PROMPT_FORM: PromptFormState = {
  purpose: "residential",
  building_width_m: 60,
  building_depth_m: 40,
  floors: 9,
  studio_pct: 25,
  k1_pct: 35,
  k2_pct: 30,
  k3_pct: 10,
  sections: 2,
  lifts_passenger: 2,
  lifts_freight: 1,
  fire_evacuation_max_m: 25,
  // auto / sensible
  site_width_m: 60,
  site_depth_m: 40,
  setback_front_m: 0,
  setback_side_m: 0,
  setback_rear_m: 0,
  parking_spaces_per_apt: 1.0,
  parking_underground_levels: 1,
  fire_evacuation_exits_per_section: 2,
  fire_dead_end_corridor_max_m: 12,
  insolation_priority: true,
  insolation_min_hours: 2.0,
  max_coverage_pct: 50,
  max_height_m: 30,
};

// ---------------------------------------------------------------------------

const PURPOSE_OPTIONS: {
  v: PromptFormState["purpose"];
  label: string;
  Icon: typeof Home;
  hint: string;
}[] = [
  { v: "residential", label: "Жильё",     Icon: Home,       hint: "Многоквартирный дом" },
  { v: "commercial",  label: "Офис",      Icon: Briefcase,  hint: "Бизнес-центр" },
  { v: "mixed_use",   label: "MFC",       Icon: Building2,  hint: "Жильё + коммерция" },
  { v: "hotel",       label: "Отель",     Icon: Hotel,      hint: "Гостиница" },
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

  const update = <K extends keyof PromptFormState>(
    key: K, v: PromptFormState[K],
  ) => {
    const next = { ...local, [key]: v };

    // Авто-синк: building → site (для бэкенда), height = floors × 3.15
    if (key === "building_width_m") next.site_width_m = v as number;
    if (key === "building_depth_m") next.site_depth_m = v as number;
    if (key === "floors") next.max_height_m = (v as number) * 3.15;

    setLocal(next);
    onChange(next);
  };

  const showApartmentMix =
    local.purpose === "residential" || local.purpose === "mixed_use";
  const showSections =
    local.purpose === "residential" || local.purpose === "mixed_use";

  // Расчёт примерного количества квартир (для residential/mixed_use)
  const unitsPerFloor = useMemo(() => {
    if (!showApartmentMix) return null;
    const floorArea = local.building_width_m * local.building_depth_m;
    const saleable = floorArea * 0.55;
    const pct = local.studio_pct + local.k1_pct + local.k2_pct + local.k3_pct;
    if (pct < 1) return Math.max(2, Math.round(saleable / 50));
    const avg =
      (30 * local.studio_pct +
       45 * local.k1_pct +
       65 * local.k2_pct +
       90 * local.k3_pct) / pct;
    return Math.max(2, Math.min(40, Math.round(saleable / avg)));
  }, [
    showApartmentMix, local.building_width_m, local.building_depth_m,
    local.studio_pct, local.k1_pct, local.k2_pct, local.k3_pct,
  ]);

  // Квартир на секцию = total / sections, целое число вверх
  const unitsPerSection =
    unitsPerFloor !== null && local.sections > 0
      ? Math.ceil(unitsPerFloor / local.sections)
      : null;

  return (
    <aside className="surface rounded-2xl flex flex-col h-full overflow-y-auto scroll-area">
      {/* ─── Тип объекта ─── */}
      <Section icon="🏗️" title="Тип объекта">
        <div className="grid grid-cols-2 gap-2">
          {PURPOSE_OPTIONS.map((opt) => {
            const active = local.purpose === opt.v;
            return (
              <button
                key={opt.v}
                onClick={() => update("purpose", opt.v)}
                className={[
                  "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition",
                  active
                    ? "bg-white text-black border-white font-medium"
                    : "bg-white/[0.03] border-white/[0.07] text-white/75 hover:bg-white/[0.06] hover:border-white/15",
                ].join(" ")}
              >
                <opt.Icon size={18} className={active ? "" : "text-white/55"} />
                <span className="text-[12px]">{opt.label}</span>
                <span className={[
                  "text-[9.5px]",
                  active ? "text-black/55" : "text-white/35",
                ].join(" ")}>
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ─── Пятно застройки ─── */}
      <Section icon="📐" title="Пятно застройки">
        <FootprintVisualizer
          width={local.building_width_m}
          depth={local.building_depth_m}
        />
        <div className="grid grid-cols-2 gap-2 mt-3">
          <NumField
            label="Длина"
            suffix="м"
            value={local.building_width_m}
            min={8}
            max={150}
            onChange={(v) => update("building_width_m", v)}
          />
          <NumField
            label="Ширина"
            suffix="м"
            value={local.building_depth_m}
            min={8}
            max={150}
            onChange={(v) => update("building_depth_m", v)}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/45 mt-2.5 pt-2.5 border-t border-white/[0.04]">
          <span>Площадь этажа</span>
          <span className="tabular text-white/85 font-medium">
            {(local.building_width_m * local.building_depth_m).toLocaleString("ru-RU")} м²
          </span>
        </div>
      </Section>

      {/* ─── Этажность ─── */}
      <Section icon="🏢" title="Этажность">
        <FloorsVisualizer floors={local.floors} />
        <div className="flex items-center gap-3 mt-3">
          <input
            type="range"
            min={1}
            max={25}
            value={local.floors}
            onChange={(e) => update("floors", Number(e.target.value))}
            className="flex-1 accent-white"
            style={{ height: 4 }}
          />
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08]">
            <span className="text-[14px] font-medium tabular">{local.floors}</span>
            <span className="text-[10px] text-white/45">эт.</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[10.5px] text-white/35 mt-2">
          <span>≈ {(local.floors * 3.15).toFixed(1)} м высоты</span>
          <span>{getFloorsCategory(local.floors)}</span>
        </div>
      </Section>

      {/* ─── Квартирография (только для жилого/MFC) ─── */}
      {showApartmentMix && (
        <Section icon="🏠" title="Квартирография">
          <PieMix
            studio={local.studio_pct}
            k1={local.k1_pct}
            k2={local.k2_pct}
            k3={local.k3_pct}
          />
          <div className="space-y-2 mt-3">
            <MixSlider color="from-cyan-400 to-cyan-500" label="Студии"
              value={local.studio_pct} onChange={(v) => update("studio_pct", v)} />
            <MixSlider color="from-violet-400 to-violet-500" label="1-комнатные"
              value={local.k1_pct} onChange={(v) => update("k1_pct", v)} />
            <MixSlider color="from-amber-400 to-amber-500" label="2-комнатные"
              value={local.k2_pct} onChange={(v) => update("k2_pct", v)} />
            <MixSlider color="from-pink-400 to-pink-500" label="3-комнатные"
              value={local.k3_pct} onChange={(v) => update("k3_pct", v)} />
          </div>
          {unitsPerFloor !== null && (
            <div className="flex items-center justify-between text-[11px] text-white/55 mt-3 pt-2.5 border-t border-white/[0.04]">
              <span>≈ <span className="text-white font-medium">{unitsPerFloor}</span> кв./этаж</span>
              <span className="text-white/40">
                {unitsPerFloor * local.floors} всего
              </span>
            </div>
          )}
        </Section>
      )}

      {/* ─── Подъездность ─── */}
      {showSections && (
        <Section icon="🏘️" title="Подъездность">
          <SectionsVisualizer
            sections={local.sections}
            width={local.building_width_m}
          />
          <div className="mt-3">
            <Stepper
              label="Подъездов (секций)"
              value={local.sections}
              min={1} max={6}
              onChange={(v) => update("sections", v)}
            />
          </div>
          {unitsPerSection !== null && (
            <div className="flex items-center justify-between text-[11px] mt-3 pt-2.5 border-t border-white/[0.04]">
              <span className="text-white/55">
                ≈ <span className="text-white font-medium">{unitsPerSection}</span> кв./секцию
              </span>
              <span className="text-white/40">
                {sectionTypeLabel(local.sections)}
              </span>
            </div>
          )}
          <p className="text-[10px] text-white/35 mt-1.5 leading-relaxed">
            СП РК · каждая секция = отдельная лестнично-лифтовая клетка
          </p>
        </Section>
      )}

      {/* ─── Лестнично-лифтовый узел ─── */}
      <Section icon="🛗" title="Лифты и эвакуация">
        <div className="space-y-3">
          <Stepper
            label={showSections ? "Пасс. лифтов / секцию" : "Пассажирские лифты"}
            value={local.lifts_passenger}
            min={1} max={6}
            onChange={(v) => update("lifts_passenger", v)}
          />
          <Stepper
            label={showSections ? "Груз. лифтов / секцию" : "Грузовые лифты"}
            value={local.lifts_freight}
            min={0} max={3}
            onChange={(v) => update("lifts_freight", v)}
          />
          {showSections && local.sections > 1 && (
            <div className="text-[10px] text-white/35 -mt-1">
              Всего: {local.lifts_passenger * local.sections} пасс. + {local.lifts_freight * local.sections} груз. на здание
            </div>
          )}
          <div className="pt-3 mt-1 border-t border-white/[0.04]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] text-white/75">
                Макс. путь эвакуации
              </span>
              <span className="text-[11px] tabular text-white/85 font-medium">
                {local.fire_evacuation_max_m} м
              </span>
            </div>
            <input
              type="range"
              min={10} max={40}
              value={local.fire_evacuation_max_m}
              onChange={(e) => update("fire_evacuation_max_m", Number(e.target.value))}
              className="w-full accent-white"
              style={{ height: 4 }}
            />
            <p className="text-[10px] text-white/35 mt-1.5 leading-relaxed">
              СНиП РК 3.02-43-2007 · норма ≤ 25 м для жилых
            </p>
          </div>
        </div>
      </Section>

      {/* Главная кнопка */}
      <div className="px-4 py-4 mt-auto sticky bottom-0 bg-[#0a0a12]/80 backdrop-blur border-t border-white/[0.08]">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="btn-apple h-12 w-full flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
        >
          <Sparkles size={15} />
          {generating ? "Рисуем чертёж…" : "Сгенерировать"}
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Section({
  icon, title, children,
}: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.05] px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[10.5px] uppercase tracking-[0.16em] text-white/55 font-medium">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function NumField({
  label, suffix, value, min, max, onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-wider text-white/40">{label}</span>
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] px-2.5 pr-9 text-[14px] tabular focus:outline-none focus:border-white/30 focus:bg-white/[0.06] transition"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/40 uppercase">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function Stepper({
  label, value, min = 0, max = 99, onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-white/75">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="size-7 rounded-md bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center justify-center"
        >
          <Minus size={12} />
        </button>
        <span className="min-w-[22px] text-center text-[13px] font-medium tabular">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="size-7 rounded-md bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center justify-center"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
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
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-white/75">{label}</span>
        <span className="text-[11px] tabular text-white/55">
          {Math.round(value)}<span className="text-white/30">%</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${color} transition-all duration-150`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
        <input
          type="range"
          min={0}
          max={70}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ── визуализация пятна застройки ──

function FootprintVisualizer({ width, depth }: { width: number; depth: number }) {
  const ratio = width / depth;
  const maxBoxW = 240;
  const maxBoxH = 80;
  let boxW: number;
  let boxH: number;
  if (ratio >= maxBoxW / maxBoxH) {
    boxW = maxBoxW;
    boxH = maxBoxW / ratio;
  } else {
    boxH = maxBoxH;
    boxW = maxBoxH * ratio;
  }

  return (
    <div className="flex items-center justify-center py-3 px-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <div className="relative" style={{ width: boxW + 60, height: boxH + 36 }}>
        {/* размер сверху */}
        <div className="absolute top-0 left-0 right-[60px] flex items-center text-[10px] text-white/45">
          <span className="flex-1 border-b border-dashed border-white/20" />
          <span className="px-1.5 tabular">{width} м</span>
          <span className="flex-1 border-b border-dashed border-white/20" />
        </div>
        {/* пятно */}
        <div
          className="absolute top-[14px] left-0 rounded-md bg-gradient-to-br from-violet-500/30 to-blue-500/20 border border-white/15 shadow-lg shadow-violet-500/10"
          style={{ width: boxW, height: boxH }}
        >
          <div className="absolute inset-0 grid grid-cols-8 grid-rows-3 opacity-30">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="border border-white/10" />
            ))}
          </div>
        </div>
        {/* размер сбоку */}
        <div className="absolute top-[14px] right-0 h-[80px] flex flex-col items-center text-[10px] text-white/45 w-[60px]">
          <span className="flex-1 border-r border-dashed border-white/20 w-px" />
          <span className="px-1 py-0.5 tabular -rotate-90 origin-center whitespace-nowrap">{depth} м</span>
          <span className="flex-1 border-r border-dashed border-white/20 w-px" />
        </div>
      </div>
    </div>
  );
}

// ── визуализация этажности ──

function FloorsVisualizer({ floors }: { floors: number }) {
  const max = 25;
  const filled = Math.min(floors, max);
  return (
    <div className="flex items-end justify-center gap-[3px] h-[60px] py-1">
      {Array.from({ length: max }).map((_, i) => {
        const isFilled = i < filled;
        const heightPct = ((i + 1) / max) * 100;
        return (
          <div
            key={i}
            className={[
              "flex-1 rounded-t-sm transition-colors duration-150",
              isFilled
                ? "bg-gradient-to-t from-violet-400/70 to-blue-400/70"
                : "bg-white/[0.04]",
            ].join(" ")}
            style={{ height: `${heightPct}%`, maxWidth: 8 }}
          />
        );
      })}
    </div>
  );
}

// ── pie chart для квартирографии ──

function PieMix({ studio, k1, k2, k3 }: {
  studio: number; k1: number; k2: number; k3: number;
}) {
  const total = studio + k1 + k2 + k3;
  if (total < 1) {
    return (
      <div className="flex items-center justify-center py-2 text-[10px] text-white/30">
        Распределение пустое
      </div>
    );
  }
  const segments = [
    { value: studio, color: "#22d3ee", label: "Студии" },
    { value: k1,     color: "#a78bfa", label: "1к" },
    { value: k2,     color: "#fbbf24", label: "2к" },
    { value: k3,     color: "#f472b6", label: "3к" },
  ];

  // строим conic-gradient
  let acc = 0;
  const stops: string[] = [];
  for (const s of segments) {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    stops.push(`${s.color} ${start}% ${end}%`);
  }

  return (
    <div className="flex items-center justify-center gap-4 py-2">
      <div
        className="size-16 rounded-full border-2 border-white/10"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            <span className="text-white/55">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── категория этажности ──

function getFloorsCategory(floors: number): string {
  if (floors <= 3) return "Малоэтажное";
  if (floors <= 5) return "Среднеэтажное";
  if (floors <= 9) return "Многоэтажное";
  if (floors <= 16) return "Повышенной этажности";
  return "Высотное";
}

// ── визуализация секций ──

function SectionsVisualizer({
  sections, width,
}: { sections: number; width: number }) {
  const boxW = 240;
  const boxH = 70;
  const sectionWidthM = width / sections;
  return (
    <div className="flex flex-col items-center justify-center py-2 px-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <div className="relative" style={{ width: boxW, height: boxH }}>
        {Array.from({ length: sections }).map((_, i) => {
          const w = boxW / sections;
          return (
            <div
              key={i}
              className="absolute top-0 h-full border border-white/15 bg-gradient-to-br from-violet-500/25 to-blue-500/15"
              style={{
                left: i * w,
                width: w - 1,
                borderLeft: i > 0 ? "1.5px solid rgba(255, 100, 100, 0.4)" : undefined,
              }}
            >
              {/* лифтовое ядро в каждой секции (квадратик в центре) */}
              <div
                className="absolute size-2.5 bg-white/20 border border-white/30 rounded-sm"
                style={{
                  left: "50%", top: "50%",
                  transform: "translate(-50%, -50%)",
                }}
              />
              {/* номер секции */}
              <div className="absolute top-1 left-1.5 text-[8px] text-white/55 font-medium">
                №{i + 1}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-white/40 mt-2 tabular">
        ≈ {sectionWidthM.toFixed(1)} м на секцию
      </div>
    </div>
  );
}

function sectionTypeLabel(sections: number): string {
  if (sections === 1) return "Точечный";
  if (sections === 2) return "2-секционный";
  if (sections <= 4) return "Линейный";
  return "Длинный линейный";
}
