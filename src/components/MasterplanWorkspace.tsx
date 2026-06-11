"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectValidationResponse, SiteContext } from "@/lib/engine";
import type { EnginePurpose } from "@/lib/gis";
import {
  buildMasterplanCostHandoff,
  createDefaultMasterplanObjects,
  createMasterplanObject,
  createMasterplanScenario,
  evaluateObjectStatus,
  masterplanObjectLabel,
  masterplanObjectTypes,
  objectRectPoints,
  updateMasterplanObject,
  validateMasterplan,
  type MasterplanObject,
  type MasterplanObjectType,
  type MasterplanScenario,
} from "@/lib/masterplan";

type WorkspaceParams = {
  housing_class: string;
  purpose: EnginePurpose;
  max_coverage_pct: number;
  floors: number;
};

type ParcelWorkspaceData = {
  name: string;
  designation: string;
  functionalZone: string;
  isSocial: boolean;
  local: [number, number][];
  width: number;
  height: number;
  ctx: SiteContext;
};

type Props = {
  parcel: ParcelWorkspaceData;
  params: WorkspaceParams;
  result: ProjectValidationResponse | null;
  objects: MasterplanObject[];
  saving: boolean;
  onObjectsChange: (objects: MasterplanObject[]) => void;
  onClose: () => void;
  onSave: () => void;
};

type Pt = [number, number];

const pad = 18;

export function MasterplanWorkspace({ parcel, params, result, objects, saving, onObjectsChange, onClose, onSave }: Props) {
  const footprints = useMemo(() => (result?.summary.footprints_local ?? []) as Pt[][], [result]);
  const redLines = useMemo(() => (parcel.ctx.red_lines ?? []) as Pt[][], [parcel.ctx.red_lines]);
  const neighbors = useMemo(() => (parcel.ctx.neighbor_buildings ?? []) as Pt[][], [parcel.ctx.neighbor_buildings]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(objects[0]?.id ?? null);
  const initialObjects = useMemo(
    () => createDefaultMasterplanObjects(footprints, params),
    [footprints, params],
  );
  const checkedObjects = useMemo(
    () => objects.map((object) => ({ ...object, status: evaluateObjectStatus(object, parcel.local) })),
    [objects, parcel.local],
  );
  const masterplanValidation = useMemo(
    () => validateMasterplan({
      objects: checkedObjects,
      parcelBoundary: parcel.local,
      redLines,
      neighbors,
      maxCoveragePct: params.max_coverage_pct,
    }),
    [checkedObjects, parcel.local, redLines, neighbors, params.max_coverage_pct],
  );
  const costHandoff = useMemo(
    () => buildMasterplanCostHandoff(masterplanValidation, checkedObjects),
    [masterplanValidation, checkedObjects],
  );
  const selectedObject = checkedObjects.find((object) => object.id === selectedObjectId) ?? null;
  const objectRings = checkedObjects.map(objectRectPoints);
  const bounds = geometryBounds([parcel.local, ...footprints, ...redLines, ...neighbors, ...objectRings]);
  const viewBox = `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`;
  const objectTotals = checkedObjects.reduce(
    (acc, object) => ({
      footprint: acc.footprint + object.footprintAreaM2,
      gfa: acc.gfa + object.gfaM2,
    }),
    { footprint: 0, gfa: 0 },
  );

  useEffect(() => {
    if (objects.length > 0 || initialObjects.length === 0) return;
    onObjectsChange(initialObjects);
  }, [initialObjects, objects.length, onObjectsChange]);

  useEffect(() => {
    if (selectedObjectId && checkedObjects.some((object) => object.id === selectedObjectId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedObjectId(checkedObjects[0]?.id ?? null);
  }, [checkedObjects, selectedObjectId]);

  function addObject(type: MasterplanObjectType) {
    const nextObject = updateMasterplanObject(
      createMasterplanObject(type, objects.length + 1, parcel.width, parcel.height),
      {},
      parcel.local,
    );
    onObjectsChange([
      ...objects,
      nextObject,
    ]);
    setSelectedObjectId(nextObject.id);
  }

  function updateObject(id: string, patch: Parameters<typeof updateMasterplanObject>[1]) {
    onObjectsChange(objects.map((object) => (
      object.id === id ? updateMasterplanObject(object, patch, parcel.local) : object
    )));
  }

  function deleteObject(id: string) {
    const object = objects.find((item) => item.id === id);
    if (!object || object.source === "engine_footprint" || object.locked) return;
    onObjectsChange(objects.filter((item) => item.id !== id));
    setSelectedObjectId(null);
  }

  function applyScenario(scenario: MasterplanScenario) {
    const nextObjects = createMasterplanScenario(scenario, parcel.local, {
      floors: params.floors,
      maxCoveragePct: params.max_coverage_pct,
    });
    onObjectsChange(nextObjects);
    setSelectedObjectId(nextObjects[0]?.id ?? null);
  }

  function sendToCostModel() {
    window.localStorage.setItem("__plana_masterplan_cost_handoff", JSON.stringify(costHandoff));
    window.location.href = "/app?tab=cost_placement";
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300/70">Parcel Workspace MVP</div>
            <h2 className="mt-1 text-xl font-semibold">{parcel.name}</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Locked GIS boundary, calculated footprint, red lines, neighbors, validation and early site metrics in one control surface.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !result}
              className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-300/15 disabled:opacity-45"
            >
              {saving ? "Saving..." : "Save parcel project"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/65 hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-h-[520px] rounded-2xl border border-white/10 bg-[#111]/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white/85">Site control canvas</div>
                <div className="text-xs text-white/38">Select an object to edit its position, dimensions, rotation and floors.</div>
              </div>
              <Legend />
            </div>
            <div className="h-[calc(100%-56px)] min-h-[440px] overflow-hidden rounded-xl border border-white/10 bg-black/35">
              <svg viewBox={viewBox} className="h-full w-full" onClick={() => setSelectedObjectId(null)}>
                <g>
                  {neighbors.map((ring, index) => (
                    <polygon key={`neighbor-${index}`} points={points(ring)} fill="rgba(148,163,184,0.22)" stroke="rgba(148,163,184,0.5)" strokeWidth="0.7" />
                  ))}
                  {redLines.map((line, index) => (
                    <polyline key={`red-${index}`} points={points(line)} fill="none" stroke="rgba(248,113,113,0.95)" strokeDasharray="4 3" strokeWidth="1.5" />
                  ))}
                  <polygon points={points(parcel.local)} fill="rgba(16,185,129,0.08)" stroke="rgba(16,185,129,0.95)" strokeWidth="2.2" />
                  {footprints.map((ring, index) => (
                    <polygon key={`footprint-${index}`} points={points(ring)} fill="rgba(249,115,22,0.48)" stroke="rgba(251,146,60,0.95)" strokeWidth="1.4" />
                  ))}
                  {checkedObjects.map((object) => (
                    <polygon
                      key={object.id}
                      points={points(objectRectPoints(object))}
                      fill={objectFill(object)}
                      stroke={objectStroke(object)}
                      strokeWidth={object.id === selectedObjectId ? "2.8" : "1.2"}
                      className="cursor-pointer transition-opacity hover:opacity-85"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedObjectId(object.id);
                      }}
                    />
                  ))}
                </g>
              </svg>
            </div>
          </section>

          <aside className="space-y-3">
            <Panel title="Parcel">
              <Row label="Designation" value={parcel.designation} />
              <Row label="Functional zone" value={parcel.functionalZone || "not detected"} warn={!parcel.functionalZone} />
              <Row label="GIS width" value={`${parcel.width.toFixed(1)} m`} />
              <Row label="GIS depth" value={`${parcel.height.toFixed(1)} m`} />
              {parcel.isSocial && (
                <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100/75">
                  This parcel looks like a social object. Residential use must be checked against PDP/GPZU.
                </div>
              )}
            </Panel>

            <Panel title="Editable parameters">
              <Row label="Housing class" value={params.housing_class} />
              <Row label="Purpose" value={params.purpose} />
              <Row label="Floors" value={String(params.floors)} />
              <Row label="Coverage limit" value={`${params.max_coverage_pct}%`} />
            </Panel>

            <Panel title="TEP summary">
              {result ? (
                <>
                  <Row label="Site area" value={`${fmt(result.summary.site_area_m2)} m2`} />
                  <Row label="Footprint" value={`${fmt(result.summary.total_footprint_m2)} m2`} />
                  <Row label="Coverage" value={`${result.summary.coverage_pct}%`} warn={result.summary.coverage_pct > params.max_coverage_pct} />
                  <Row label="GFA" value={`${fmt(result.summary.total_floor_area_m2)} m2`} />
                  <Row label="FAR / KIT" value={String(result.summary.far)} />
                  <Row label="Green area" value={`${fmt(result.summary.green_area_m2)} m2 (${result.summary.green_pct}%)`} />
                </>
              ) : (
                <div className="text-sm text-white/45">Select a parcel and wait for validation.</div>
              )}
            </Panel>

            <Panel title="Masterplan objects">
              <div className="grid grid-cols-2 gap-2">
                <Count tone="info" label="Objects" value={checkedObjects.length} />
                <Count tone="error" label="Errors" value={masterplanValidation.errors} />
              </div>
              <Row label="Object footprint" value={`${fmt(objectTotals.footprint)} m2`} warn={masterplanValidation.coveragePct > params.max_coverage_pct} />
              <Row label="Object GFA" value={`${fmt(objectTotals.gfa)} m2`} />
              <Row label="Object coverage" value={`${masterplanValidation.coveragePct.toFixed(1)}%`} warn={masterplanValidation.coveragePct > params.max_coverage_pct} />
              <Row label="Object FAR" value={masterplanValidation.far.toFixed(2)} warn={masterplanValidation.far > 4.5} />
              <div className="max-h-44 space-y-2 overflow-auto pr-1">
                {checkedObjects.length === 0 ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/45">
                    No objects yet. Add a building or social object below.
                  </div>
                ) : (
                  checkedObjects.map((object) => (
                    <ObjectRow
                      key={object.id}
                      object={object}
                      selected={object.id === selectedObjectId}
                      onSelect={() => setSelectedObjectId(object.id)}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Scenario variants">
              <div className="grid grid-cols-1 gap-2">
                <ScenarioButton title="Max GFA" detail="One stronger massing, screens maximum buildable volume." onClick={() => applyScenario("max_gfa")} />
                <ScenarioButton title="Balanced courtyard" detail="Two residential blocks, parking and a green courtyard." onClick={() => applyScenario("balanced_courtyard")} />
                <ScenarioButton title="Social mix" detail="Residential + kindergarten + commerce + yard + parking." onClick={() => applyScenario("social_mix")} />
              </div>
            </Panel>

            <Panel title="Selected object">
              {selectedObject ? (
                <ObjectEditor
                  object={selectedObject}
                  onChange={(patch) => updateObject(selectedObject.id, patch)}
                  onDelete={() => deleteObject(selectedObject.id)}
                />
              ) : (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/45">
                  Select an object on the canvas or in the list.
                </div>
              )}
            </Panel>

            <Panel title="Object rule check">
              <div className="grid grid-cols-3 gap-2">
                <Count tone="error" label="Errors" value={masterplanValidation.errors} />
                <Count tone="warn" label="Warnings" value={masterplanValidation.warnings} />
                <Count tone="info" label="Info" value={masterplanValidation.infos} />
              </div>
              <Row label="Green / yard" value={`${fmt(masterplanValidation.greenAreaM2)} m2 (${masterplanValidation.greenPct.toFixed(1)}%)`} warn={masterplanValidation.greenPct < 20} />
              {masterplanValidation.issues.length === 0 ? (
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100/75">
                  No object-level issues detected.
                </div>
              ) : (
                <div className="max-h-40 space-y-2 overflow-auto pr-1">
                  {masterplanValidation.issues.slice(0, 8).map((issue) => (
                    <div key={issue.id} className={issueClass(issue.severity)}>
                      <div className="text-[10px] uppercase tracking-wide opacity-70">{issue.rule}</div>
                      <div>{issue.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Rule check">
              {result ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Count tone="error" label="Errors" value={result.errors_count} />
                    <Count tone="warn" label="Warnings" value={result.warnings_count} />
                    <Count tone="info" label="Info" value={result.infos_count} />
                  </div>
                  {result.violations.length === 0 ? (
                    <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100/75">
                      No violations detected for the current MVP parameters.
                    </div>
                  ) : (
                    result.violations.slice(0, 6).map((violation, index) => (
                      <div key={`${violation.rule}-${index}`} className={violationClass(violation.severity)}>
                        <div className="text-[10px] uppercase tracking-wide opacity-70">{violation.rule}</div>
                        <div>{violation.message}</div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="text-sm text-white/45">Validation will appear after calculation.</div>
              )}
            </Panel>

            <Panel title="Add object">
              <div className="grid grid-cols-2 gap-2">
                {masterplanObjectTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addObject(type)}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/70 hover:border-emerald-300/30 hover:bg-emerald-300/10 hover:text-emerald-100"
                  >
                    + {masterplanObjectLabel(type)}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-sky-300/15 bg-sky-300/10 px-3 py-2 text-xs leading-relaxed text-sky-100/70">
                Objects are real frontend data now. Drag, resize and rule-aware editing come in the next slice.
              </div>
            </Panel>

            <Panel title="Cost handoff">
              <Row label="GFA for cost" value={`${fmt(costHandoff.gfa_above_ground_m2)} m2`} />
              <Row label="Avg floors" value={String(costHandoff.floors_above)} />
              <Row label="Risk flags" value={String(costHandoff.risk_flags.length)} warn={costHandoff.risk_flags.length > 0} />
              <button
                type="button"
                onClick={sendToCostModel}
                className="w-full rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-left text-xs font-medium text-amber-100 hover:bg-amber-300/15"
              >
                Send workspace metrics to cost tab
              </button>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/45">
                Saves a structured handoff in localStorage for the next integration step. Cost formulas are not changed here.
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

function geometryBounds(rings: Pt[][]) {
  const flat = rings.flat().filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  if (flat.length === 0) return { minX: 0, minY: 0, width: 100, height: 100 };
  const xs = flat.map((pt) => pt[0]);
  const ys = flat.map((pt) => pt[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function points(ring: Pt[]) {
  return ring.map(([x, y]) => `${x},${y}`).join(" ");
}

function fmt(value: number) {
  return Math.round(value).toLocaleString("ru-RU");
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-white/45">
      <LegendItem color="bg-emerald-400" label="parcel" />
      <LegendItem color="bg-orange-400" label="footprint" />
      <LegendItem color="bg-rose-400" label="red lines" />
      <LegendItem color="bg-slate-400" label="neighbors" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/38">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.06] pb-1.5 text-xs last:border-b-0 last:pb-0">
      <span className="text-white/42">{label}</span>
      <span className={warn ? "text-amber-200" : "text-white/76"}>{value}</span>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: "error" | "warn" | "info" }) {
  const cls = tone === "error"
    ? "border-rose-300/20 bg-rose-300/10 text-rose-100"
    : tone === "warn"
      ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
      : "border-sky-300/20 bg-sky-300/10 text-sky-100";
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${cls}`}>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] opacity-70">{label}</div>
    </div>
  );
}

function ScenarioButton({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-emerald-300/30 hover:bg-emerald-300/10"
    >
      <div className="text-xs font-medium text-white/78">{title}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-white/42">{detail}</div>
    </button>
  );
}

function ObjectRow({
  object,
  selected,
  onSelect,
}: {
  object: MasterplanObject;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
        selected ? "border-emerald-300/40 bg-emerald-300/10" : "border-white/10 bg-black/20 hover:bg-white/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-white/75">{object.name}</span>
        <StatusBadge object={object} />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-white/42">
        <span>{object.width.toFixed(1)} x {object.depth.toFixed(1)} m</span>
        <span>{object.floors} floors</span>
        <span>{fmt(object.gfaM2)} m2 GFA</span>
      </div>
    </button>
  );
}

function ObjectEditor({
  object,
  onChange,
  onDelete,
}: {
  object: MasterplanObject;
  onChange: (patch: Parameters<typeof updateMasterplanObject>[1]) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-white/80">{object.name}</div>
          <div className="text-xs text-white/38">{masterplanObjectLabel(object.type)}</div>
        </div>
        <StatusBadge object={object} />
      </div>

      {object.status === "error" && (
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100/75">
          Object corners are outside the selected parcel boundary.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={object.x} min={0} max={5000} step={1} disabled={object.locked} onChange={(x) => onChange({ x })} />
        <NumberField label="Y" value={object.y} min={0} max={5000} step={1} disabled={object.locked} onChange={(y) => onChange({ y })} />
        <NumberField label="Width" value={object.width} min={1} max={5000} step={1} disabled={object.locked} onChange={(width) => onChange({ width })} />
        <NumberField label="Depth" value={object.depth} min={1} max={5000} step={1} disabled={object.locked} onChange={(depth) => onChange({ depth })} />
        <NumberField label="Rotation" value={object.rotationDeg} min={-180} max={180} step={5} disabled={object.locked} onChange={(rotationDeg) => onChange({ rotationDeg })} />
        <NumberField label="Floors" value={object.floors} min={0} max={100} step={1} disabled={object.locked} onChange={(floors) => onChange({ floors })} />
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={object.locked}
          onChange={(event) => onChange({ locked: event.target.checked })}
        />
        Lock object
      </label>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Row label="Footprint" value={`${fmt(object.footprintAreaM2)} m2`} />
        <Row label="GFA" value={`${fmt(object.gfaM2)} m2`} />
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={object.source === "engine_footprint" || object.locked}
        className="w-full rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs font-medium text-rose-100 hover:bg-rose-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/35"
      >
        Delete manual object
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
      <span className="text-white/42">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded border border-white/10 bg-neutral-950 px-2 py-1 text-white/78 outline-none focus:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-45"
      />
    </label>
  );
}

function StatusBadge({ object }: { object: MasterplanObject }) {
  const statusClass = object.status === "error"
    ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
    : object.status === "valid"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : "border-white/10 bg-white/5 text-white/42";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
      {object.status === "error" ? "outside" : object.source === "engine_footprint" ? "engine" : object.status}
    </span>
  );
}

function objectFill(object: MasterplanObject) {
  if (object.status === "error") return "rgba(244,63,94,0.32)";
  if (object.type === "yard") return "rgba(34,197,94,0.22)";
  if (object.type === "school" || object.type === "kindergarten") return "rgba(56,189,248,0.34)";
  if (object.type === "parking") return "rgba(168,85,247,0.28)";
  if (object.type === "commerce") return "rgba(234,179,8,0.34)";
  return object.source === "engine_footprint" ? "rgba(249,115,22,0.58)" : "rgba(16,185,129,0.36)";
}

function objectStroke(object: MasterplanObject) {
  if (object.status === "error") return "rgba(251,113,133,0.95)";
  if (object.type === "yard") return "rgba(74,222,128,0.9)";
  if (object.type === "school" || object.type === "kindergarten") return "rgba(125,211,252,0.95)";
  if (object.type === "parking") return "rgba(216,180,254,0.9)";
  if (object.type === "commerce") return "rgba(253,224,71,0.9)";
  return object.source === "engine_footprint" ? "rgba(251,146,60,0.95)" : "rgba(52,211,153,0.95)";
}

function violationClass(severity: string) {
  if (severity === "error") return "rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100/78";
  if (severity === "warning") return "rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100/78";
  return "rounded-lg border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-xs leading-relaxed text-sky-100/78";
}

function issueClass(severity: string) {
  if (severity === "error") return "rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100/78";
  if (severity === "warning") return "rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100/78";
  return "rounded-lg border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-xs leading-relaxed text-sky-100/78";
}
