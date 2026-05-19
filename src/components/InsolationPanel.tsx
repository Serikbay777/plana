"use client";

import { useEffect, useRef, useState } from "react";
import { Sun, AlertTriangle, CheckCircle2, Loader2, ChevronDown } from "lucide-react";
import { validateInsolation, type InsolationValidationResponse, type FacadeInsolation } from "@/lib/engine";

const CITIES = [
  { label: "Алматы",    lat: 43.3 },
  { label: "Астана",    lat: 51.2 },
  { label: "Шымкент",   lat: 42.3 },
  { label: "Актобе",    lat: 50.3 },
  { label: "Павлодар",  lat: 52.3 },
  { label: "Другой...", lat: null },
] as const;

const HOURS_BAR_MAX = 12;

function HoursBar({ hours, required, compliant }: { hours: number; required: number; compliant: boolean }) {
  const pct = Math.min(100, (hours / HOURS_BAR_MAX) * 100);
  const reqPct = (required / HOURS_BAR_MAX) * 100;
  return (
    <div className="relative h-1.5 rounded-full bg-white/[0.08] overflow-visible">
      <div
        className={`h-full rounded-full transition-all ${compliant ? "bg-emerald-400" : "bg-rose-400"}`}
        style={{ width: `${pct}%` }}
      />
      {/* required marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-white/40"
        style={{ left: `${reqPct}%` }}
      />
    </div>
  );
}

function FacadeRow({ f }: { f: FacadeInsolation }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className={`w-20 shrink-0 ${f.compliant ? "text-white/75" : "text-rose-300"}`}>{f.name}</span>
      <div className="flex-1">
        <HoursBar hours={f.hours} required={f.required} compliant={f.compliant} />
      </div>
      <span className={`w-12 text-right tabular-nums shrink-0 ${f.compliant ? "text-emerald-300" : "text-rose-300"}`}>
        {f.hours.toFixed(1)} ч
      </span>
      {f.compliant
        ? <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
        : <AlertTriangle size={11} className="text-rose-400 shrink-0" />}
    </div>
  );
}

export function InsolationPanel() {
  const [cityIdx, setCityIdx] = useState(0);
  const [customLat, setCustomLat] = useState("50.0");
  const [azimuth, setAzimuth] = useState(0);
  const [data, setData] = useState<InsolationValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedCity = CITIES[cityIdx];
  const latitude = selectedCity.lat !== null ? selectedCity.lat : parseFloat(customLat) || 50.0;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await validateInsolation(latitude, azimuth);
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [latitude, azimuth]);

  const azLabel = (az: number) => {
    const dirs = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ", "С"];
    return dirs[Math.round(az / 45) % 8];
  };

  return (
    <div className="surface-strong rounded-2xl px-3 py-2.5 text-white">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-[12px] font-medium"
      >
        <span className="flex items-center gap-1.5">
          <Sun size={13} className="text-amber-300" />
          <span>Инсоляция</span>
          {loading && <Loader2 size={11} className="animate-spin text-white/40" />}
        </span>
        <span className="flex items-center gap-1.5">
          {data && (
            data.compliant
              ? <span className="text-emerald-300 text-[10.5px] flex items-center gap-0.5"><CheckCircle2 size={10} /> ОК</span>
              : <span className="text-rose-300 text-[10.5px] flex items-center gap-0.5"><AlertTriangle size={10} /> Нарушение</span>
          )}
          <ChevronDown size={13} className={`text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-3">
          {/* Город + широта */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={cityIdx}
              onChange={e => setCityIdx(Number(e.target.value))}
              className="flex-1 min-w-[120px] h-7 px-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11.5px] text-white focus:outline-none"
            >
              {CITIES.map((c, i) => (
                <option key={c.label} value={i} className="bg-[#1a1a2e]">{c.label}</option>
              ))}
            </select>
            {selectedCity.lat === null && (
              <input
                type="number"
                value={customLat}
                onChange={e => setCustomLat(e.target.value)}
                min={35}
                max={75}
                step={0.1}
                placeholder="Широта °N"
                className="w-24 h-7 px-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11.5px] text-white focus:outline-none"
              />
            )}
          </div>

          {/* Азимут здания */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-white/50">Ориентация (сев. фасад)</span>
              <span className="text-[11px] tabular-nums text-white/75">
                {azimuth}° · {azLabel(azimuth)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={359}
              value={azimuth}
              onChange={e => setAzimuth(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-[9.5px] text-white/30 mt-0.5 px-0.5">
              <span>С</span><span>В</span><span>Ю</span><span>З</span><span>С</span>
            </div>
          </div>

          {/* Результаты */}
          {data && (
            <>
              <div className="text-[10.5px] text-white/40">
                Зона: <span className="text-white/60">{data.lat_zone}</span>
                {" · "}норма: <span className="text-white/60">{data.required_hours} ч</span>
                {" · "}широта: <span className="text-white/60">{latitude.toFixed(1)}°N</span>
              </div>
              <div className="space-y-2">
                {data.facades.map(f => <FacadeRow key={f.name} f={f} />)}
              </div>
              <div className="text-[9.5px] text-white/30 leading-snug">
                Расчёт по 22 марта (весеннее равноденствие). Норма: КМК 2.04.01-2017.
                Вертикальная черта на шкале — нормативный минимум.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
