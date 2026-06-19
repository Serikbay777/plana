"use client";

// «Застройка» в /app: выбранный на карте участок открывается в ВАКУУМЕ
// (только этот участок, без карты города). Параметры (этажность/% застройки/
// назначение/класс) пересчитывают пятно застройки + 8 ТЭП в реальном времени
// тем же движком, что и /map (validate/project). Геометрия — в локальных метрах.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Loader2, ArrowRight, Ruler } from "lucide-react";
import { validateProject, type ProjectValidationResponse, type PosadkaBalance } from "@/lib/engine";
import type { PosadkaHandoff } from "@/lib/posadkaHandoff";
import type { EnginePurpose } from "@/lib/gis";

const CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "standard", label: "стандарт" },
  { value: "comfort", label: "комфорт" },
  { value: "comfort_plus", label: "комфорт+" },
  { value: "business", label: "бизнес" },
  { value: "premium", label: "премиум" },
];

const PURPOSE_OPTIONS: { value: EnginePurpose; label: string }[] = [
  { value: "residential", label: "Жильё" },
  { value: "mixed_use", label: "Смешанное" },
  { value: "commercial", label: "Коммерция" },
  { value: "hotel", label: "Гостиница" },
];

type Params = PosadkaHandoff["params"];

export default function BuildPlotView({
  handoff,
  onProceed,
}: {
  handoff: PosadkaHandoff | null;
  onProceed?: (patch: Record<string, unknown>) => void;
}) {
  if (!handoff) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center">
        <div className="max-w-md">
          <Building2 className="mx-auto mb-3 text-white/25" size={36} />
          <div className="mb-1 text-[15px] font-medium text-white/85">Участок не выбран</div>
          <p className="text-[12.5px] leading-relaxed text-white/45">
            Откройте карту, выберите участок и нажмите «Перейти к Застройке» —
            пятно застройки откроется здесь для проработки вариантов.
          </p>
          <a
            href="/map"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-[12px] text-white/80 hover:text-white"
          >
            <Ruler size={13} /> Открыть карту
          </a>
        </div>
      </div>
    );
  }
  return <BuildPlotInner handoff={handoff} onProceed={onProceed} />;
}

function BuildPlotInner({
  handoff,
  onProceed,
}: {
  handoff: PosadkaHandoff;
  onProceed?: (patch: Record<string, unknown>) => void;
}) {
  const [params, setParams] = useState<Params>(handoff.params);
  const [result, setResult] = useState<ProjectValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Пересчёт пятна + ТЭП при правке параметров (дебаунс, без запросов в GIS).
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setErr(null);
      validateProject({
        site_width_m: handoff.width,
        site_depth_m: handoff.height,
        site_polygon: handoff.local,
        floors: params.floors,
        housing_class: params.housing_class,
        purpose: params.purpose,
        // % застройки — ЦЕЛЬ массинга (допущение), а не лимит ГПЗУ.
        coverage_target_pct: params.max_coverage_pct,
        studio_pct: 0.2, k1_pct: 0.4, k2_pct: 0.3, k3_pct: 0.1,
        red_lines: handoff.ctx.red_lines,
        neighbors: handoff.ctx.neighbor_buildings,
        functional_zone: handoff.ctx.functional_zone,
      })
        .then((r) => { if (!cancelled) setResult(r); })
        .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [params, handoff]);

  const s = result?.summary;
  // Пятно: свежий расчёт, иначе — снимок из посадки (мгновенный показ).
  const footprints = s?.footprints_local ?? handoff.footprints_local;

  const proceed = () => {
    onProceed?.({
      site_width_m: handoff.width,
      site_depth_m: handoff.height,
      site_polygon: handoff.local,
      floors: params.floors,
      purpose: params.purpose,
      max_coverage_pct: params.max_coverage_pct,
    });
    setApplied(true);
    window.setTimeout(() => setApplied(false), 2500);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 p-5 lg:flex-row">
      {/* ВАКУУМ: только этот участок + пятно застройки */}
      <div className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0b0d10]">
        <PlotCanvas
          local={handoff.local}
          width={handoff.width}
          height={handoff.height}
          redLines={handoff.ctx.red_lines}
          footprints={footprints}
          greenZones={s?.green_zones_local ?? []}
          parkingZones={s?.parking_zones_local ?? []}
        />
        <div className="pointer-events-none absolute left-4 top-4 text-[11px] text-white/40">
          участок в вакууме · {Math.round(handoff.width)}×{Math.round(handoff.height)} м
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/55">
          <LegendDot color="#22c55e" label="озеленение" />
          <LegendDot color="#38bdf8" label="паркинг" />
          <LegendDot color="#f97316" label="пятно дома" />
          <LegendDot color="#ef4444" label="красные линии" />
        </div>
        {loading && (
          <div className="absolute right-4 top-4 flex items-center gap-1.5 text-[11px] text-cyan-300/80">
            <Loader2 size={12} className="animate-spin" /> пересчёт пятна…
          </div>
        )}
      </div>

      {/* ПАНЕЛЬ: параметры + ТЭП + нормоконтроль */}
      <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[360px]">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-white/90">{handoff.name}</div>
              <div className="mt-0.5 text-[11.5px] text-white/45">{handoff.designation}</div>
            </div>
            <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/55">
              {handoff.zone ? `зона «${handoff.zone}»` : "зона —"}
            </span>
          </div>
          {(handoff.cadastral || handoff.owner) && (
            <dl className="mt-2 space-y-0.5 text-[11px]">
              {handoff.owner && <KV label="застройщик">{handoff.owner}</KV>}
              {handoff.cadastral && <KV label="кадастр">{handoff.cadastral}</KV>}
              {handoff.address && <KV label="адрес">{handoff.address}</KV>}
            </dl>
          )}
          {!handoff.isHousing && (
            <div className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200/90">
              Назначение отвода — не жильё. ТЭП ниже — гипотеза «если бы строили ЖК».
            </div>
          )}
        </div>

        {/* Параметры застройки */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 text-[12px] font-medium text-white/70">Параметры застройки</div>
          <div className="space-y-2.5">
            <Field label="Назначение">
              <select
                value={params.purpose}
                onChange={(e) => setParams({ ...params, purpose: e.target.value as EnginePurpose })}
                className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[12px] text-white/90"
              >
                {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-[#15181c]">{o.label}</option>)}
              </select>
            </Field>
            <Field label="Класс жилья">
              <select
                value={params.housing_class}
                onChange={(e) => setParams({ ...params, housing_class: e.target.value })}
                className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[12px] text-white/90"
              >
                {CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-[#15181c]">{o.label}</option>)}
              </select>
            </Field>
            <Field label="Этажность">
              <input
                type="number" min={1} max={60}
                value={params.floors}
                onChange={(e) => setParams({ ...params, floors: Math.max(1, +e.target.value || 1) })}
                className="w-24 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-right text-[12px] text-white/90"
              />
            </Field>
            <Field label="% застройки">
              <input
                type="number" min={1} max={100}
                value={params.max_coverage_pct}
                onChange={(e) => setParams({ ...params, max_coverage_pct: Math.min(100, Math.max(1, +e.target.value || 1)) })}
                className="w-24 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-right text-[12px] text-white/90"
              />
            </Field>
          </div>
          <p className="mt-2 text-[10px] leading-tight text-white/35">
            % застройки — допущение (нет в ГИС/Градрегламенте, уточняется ГПЗУ).
            Пятно и ТЭП пересчитываются движком на лету.
          </p>
        </div>

        {/* Баланс площади участка (2a): нормы (озеленение+паркинг) → остаток под дом */}
        {s?.balance && (
          <BalancePanel b={s.balance} siteArea={s.site_area_m2} greenPct={s.green_pct} coveragePct={s.coverage_pct} />
        )}

        {err && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[11.5px] text-red-200">{err}</div>}

        {/* 8 ТЭП */}
        {s && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-2 text-[12px] font-medium text-white/70">8 ТЭП</div>
            <table className="w-full text-[12px] text-white/75">
              <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:font-medium [&_td:last-child]:text-white/90">
                <tr><td>Площадь территории</td><td>{fmt(s.site_area_m2)} м²</td></tr>
                <tr><td>Площадь застройки</td><td>{fmt(s.total_footprint_m2)} м²</td></tr>
                <tr><td>Процент застройки</td><td>{s.coverage_pct}%</td></tr>
                <tr><td>Строит. объём</td><td>{fmt(s.total_volume_m3)} м³</td></tr>
                <tr><td>Поэтажная площадь (GFA)</td><td>{fmt(s.total_floor_area_m2)} м²</td></tr>
                <tr><td>КИТ</td><td>{s.far}</td></tr>
                <tr><td>Озеленение</td><td>{fmt(s.green_area_m2)} м² ({s.green_pct}%)</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Нормоконтроль */}
        {result && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-white/70">
              Нормоконтроль
              <span className="text-[11px] font-normal text-white/45">
                ⛔{result.errors_count} ⚠️{result.warnings_count} ℹ️{result.infos_count}
              </span>
            </div>
            {result.violations.length === 0 ? (
              <p className="text-[12px] text-emerald-300/90">Нарушений нет ✓</p>
            ) : (
              <ul className="space-y-1">
                {result.violations.map((v, i) => (
                  <li key={i} className={`rounded-lg px-2.5 py-1.5 text-[11.5px] ${sevCls(v.severity)}`}>
                    {v.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          onClick={proceed}
          className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[12.5px] font-medium text-black transition hover:bg-white/90"
        >
          {applied ? "Применено ✓" : <>Застраивать в AI Чертежах <ArrowRight size={14} /></>}
        </button>
        <p className="text-center text-[10px] text-white/35">
          Перенесёт участок и параметры в генерацию планов/визуализаций.
        </p>
      </aside>
    </div>
  );
}

// Кольца (внешние + дырки) → один SVG path; рисуется с fill-rule=evenodd.
function ringsToPath(rings: number[][][], fy: (y: number) => number): string {
  return rings
    .map((ring) => ring.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${fy(p[1])}`).join(" ") + "Z")
    .join(" ");
}

// SVG-холст вакуума: участок (контур) + зоны (озеленение/паркинг) + пятно.
// Локальные метры; ось Y инвертируется (север вверх).
function PlotCanvas({
  local, width, height, redLines, footprints, greenZones, parkingZones,
}: {
  local: [number, number][];
  width: number;
  height: number;
  redLines: number[][][];
  footprints: number[][][];
  greenZones: number[][][];
  parkingZones: number[][][];
}) {
  // Поле вокруг участка во viewBox: ~20% от большей стороны — чтобы участок не
  // упирался в края холста и был целиком виден с запасом (а не «огромным»).
  const pad = useMemo(() => Math.max(width, height) * 0.2 + 8, [width, height]);
  const fy = (y: number) => height - y; // флип: север вверх
  const pts = (ring: number[][]) => ring.map((p) => `${p[0]},${fy(p[1])}`).join(" ");

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* участок */}
      <polygon
        points={pts(local)}
        fill="#1f2937"
        fillOpacity={0.55}
        stroke="#22c55e"
        strokeWidth={Math.max(width, height) * 0.004}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {/* зона озеленения (2b) — один path с evenodd (дырка на месте пятна) */}
      {greenZones.length > 0 && (
        <path
          d={ringsToPath(greenZones, fy)}
          fill="#22c55e"
          fillOpacity={0.28}
          fillRule="evenodd"
          stroke="#16a34a"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
      {/* зона наземного паркинга (2b) */}
      {parkingZones.length > 0 && (
        <path
          d={ringsToPath(parkingZones, fy)}
          fill="#38bdf8"
          fillOpacity={0.30}
          fillRule="evenodd"
          stroke="#0ea5e9"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
      {/* красные линии (если попали в кадр участка) */}
      {redLines.map((line, i) => (
        <polyline
          key={`r${i}`}
          points={line.map((p) => `${p[0]},${fy(p[1])}`).join(" ")}
          fill="none"
          stroke="#ef4444"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* пятно застройки */}
      {footprints.map((fp, i) => (
        <polygon
          key={`f${i}`}
          points={pts(fp)}
          fill="#f97316"
          fillOpacity={0.55}
          stroke="#ea580c"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

// Баланс площади участка (2a): озеленение + паркинг (нормы) → пятно → остаток.
function BalancePanel({ b, siteArea, greenPct, coveragePct }: {
  b: PosadkaBalance; siteArea: number; greenPct: number; coveragePct: number;
}) {
  const pct = (v: number) => (siteArea > 0 ? (v / siteArea) * 100 : 0);
  const over = b.leftover_m2 < 0;
  const freeP = Math.max(0, pct(b.leftover_m2));
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-1 text-[12px] font-medium text-white/70">Баланс площади участка</div>
      <div className="mb-2 text-[10px] text-white/35">
        Сначала нормы (озеленение + наземный паркинг) → остаток под дом.
      </div>
      {/* стек-бар: доли участка */}
      <div className="mb-2.5 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <span style={{ width: `${pct(b.green_required_m2)}%`, backgroundColor: "#22c55e" }} />
        <span style={{ width: `${pct(b.parking_area_m2)}%`, backgroundColor: "#38bdf8" }} />
        <span style={{ width: `${pct(b.footprint_m2)}%`, backgroundColor: "#f97316" }} />
        {!over && <span style={{ width: `${freeP}%`, backgroundColor: "#334155" }} />}
      </div>
      <div className="space-y-1 text-[11.5px]">
        <BalRow color="#22c55e" label="Озеленение" note={`${greenPct}%`} value={`${fmt(b.green_required_m2)} м²`} />
        <BalRow color="#38bdf8" label="Паркинг наземный" note={`${b.parking_spaces} мест`} value={`${fmt(b.parking_area_m2)} м²`} />
        <BalRow color="#f97316" label="Пятно застройки" note={`${coveragePct}%`} value={`${fmt(b.footprint_m2)} м²`} />
        <div className="my-1 border-t border-white/[0.06]" />
        {over ? (
          <div className="flex items-center justify-between rounded-lg bg-red-500/10 px-2 py-1 text-red-200">
            <span>Перебор — не помещается</span>
            <span className="font-medium">−{fmt(Math.abs(b.leftover_m2))} м²</span>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-200">
            <span>Свободно под двор/резерв</span>
            <span className="font-medium">{fmt(b.leftover_m2)} м²</span>
          </div>
        )}
      </div>
      <dl className="mt-2 space-y-0.5 text-[11px] text-white/55">
        <KV label="квартир (оценка)">{b.apartments}</KV>
        <KV label="жителей">{b.residents}</KV>
        <KV label="озеленение на жителя (город, справочно)">{fmt(b.green_per_capita_m2)} м²</KV>
      </dl>
      <p className="mt-1 text-[10px] leading-tight text-white/30">
        Коэффициенты озеленения/паркинга — черновые (DRAFT), уточняются ГПЗУ и нормами РК.
      </p>
    </div>
  );
}

function BalRow({ color, label, note, value }: { color: string; label: string; note?: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      <span className="flex-1 text-white/65">{label}</span>
      {note && <span className="text-white/35">{note}</span>}
      <span className="w-20 text-right font-medium text-white/90">{value}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-white/65">{label}</span>
      {children}
    </label>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-white/35">{label}:</dt>
      <dd className="min-w-0 break-words text-white/70">{children}</dd>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function sevCls(sev: string): string {
  if (sev === "error") return "bg-red-500/10 text-red-200";
  if (sev === "warning") return "bg-amber-500/10 text-amber-200";
  return "bg-sky-500/10 text-sky-200";
}
