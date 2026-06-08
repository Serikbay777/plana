"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Undo2, Trash2, CheckCircle2 } from "lucide-react";

export type Pt = [number, number]; // [x_m, y_m]

interface Props {
  value: Pt[] | null;
  onChange: (pts: Pt[] | null) => void;
}

const CANVAS_PX = 360;
const CELL_PX = 40;       // pixels per grid cell
const SNAP_PX = 12;       // pixel distance to snap to existing vertex
const SCALES = [5, 10, 20, 50] as const; // meters per cell

function mToPx(m: number, scale: number) { return (m / scale) * CELL_PX; }
function pxToM(px: number, scale: number) { return (px / CELL_PX) * scale; }

function ptToPx(pt: Pt, scale: number): [number, number] {
  return [mToPx(pt[0], scale), CANVAS_PX - mToPx(pt[1], scale)];
}
function pxToPt(px: number, py: number, scale: number): Pt {
  return [pxToM(px, scale), pxToM(CANVAS_PX - py, scale)];
}

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

function polyBbox(pts: Pt[]): { w: number; d: number } {
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    d: Math.max(...ys) - Math.min(...ys),
  };
}

function nearestVertex(
  px: number, py: number,
  pts: Pt[], scale: number,
): number | null {
  for (let i = 0; i < pts.length; i++) {
    const [vx, vy] = ptToPx(pts[i], scale);
    const d = Math.hypot(px - vx, py - vy);
    if (d <= SNAP_PX) return i;
  }
  return null;
}

export function SitePolygonEditor({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState<number>(10);
  const [vertices, setVertices] = useState<Pt[]>(value ?? []);
  const [closed, setClosed] = useState(value !== null && (value?.length ?? 0) >= 3);
  const [guide, setGuide] = useState<[number, number] | null>(null); // pixel pos
  const dragIdx = useRef<number | null>(null);
  const dragging = useRef(false);

  // Sync incoming value
  useEffect(() => {
    if (value !== null) return;
    const timeoutId = window.setTimeout(() => {
      setVertices([]);
      setClosed(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [value]);

  // Emit when closed or modified
  const emit = useCallback((verts: Pt[], isClosed: boolean) => {
    if (isClosed && verts.length >= 3) {
      onChange([...verts]);
    } else {
      onChange(null);
    }
  }, [onChange]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = CANVAS_PX, H = CANVAS_PX;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0f0f1a";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    const cells = CANVAS_PX / CELL_PX;
    for (let i = 0; i <= cells; i++) {
      const x = i * CELL_PX, y = i * CELL_PX;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Axes labels
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "9px monospace";
    for (let i = 0; i <= cells; i++) {
      const m = i * scale;
      if (m > 0) {
        ctx.fillText(`${m}`, i * CELL_PX + 2, H - 2);
        if (i <= cells - 1) ctx.fillText(`${m}`, 2, H - i * CELL_PX - 2);
      }
    }

    if (vertices.length === 0) return;

    const pxPts = vertices.map(v => ptToPx(v, scale));

    // Filled polygon (when closed)
    if (closed) {
      ctx.beginPath();
      ctx.moveTo(pxPts[0][0], pxPts[0][1]);
      for (let i = 1; i < pxPts.length; i++) ctx.lineTo(pxPts[i][0], pxPts[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(139,92,246,0.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(167,139,250,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Open polyline
      ctx.beginPath();
      ctx.moveTo(pxPts[0][0], pxPts[0][1]);
      for (let i = 1; i < pxPts.length; i++) ctx.lineTo(pxPts[i][0], pxPts[i][1]);
      ctx.strokeStyle = "rgba(167,139,250,0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Guide line to cursor
      if (guide) {
        ctx.beginPath();
        ctx.moveTo(pxPts[pxPts.length - 1][0], pxPts[pxPts.length - 1][1]);
        ctx.lineTo(guide[0], guide[1]);
        ctx.strokeStyle = "rgba(167,139,250,0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Vertices
    for (let i = 0; i < pxPts.length; i++) {
      const [vx, vy] = pxPts[i];
      const isFirst = i === 0;
      ctx.beginPath();
      ctx.arc(vx, vy, isFirst && !closed ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isFirst && !closed && vertices.length >= 3
        ? "rgba(52,211,153,0.9)"   // green = "click to close"
        : "rgba(167,139,250,0.95)";
      ctx.fill();
      ctx.strokeStyle = "#0f0f1a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [vertices, closed, guide, scale]);

  function getCanvasPx(e: React.MouseEvent<HTMLCanvasElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = CANVAS_PX / rect.width;
    const scaleY = CANVAS_PX / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const [px, py] = getCanvasPx(e);

    if (closed) {
      // Drag existing vertex
      const idx = nearestVertex(px, py, vertices, scale);
      if (idx !== null) { dragIdx.current = idx; dragging.current = true; }
      return;
    }

    const near = nearestVertex(px, py, vertices, scale);

    // Click near first vertex with ≥3 points → close polygon
    if (near === 0 && vertices.length >= 3) {
      setClosed(true);
      emit(vertices, true);
      setGuide(null);
      return;
    }

    // Click near any existing vertex → start drag
    if (near !== null) { dragIdx.current = near; dragging.current = true; return; }

    // Add new vertex
    const pt = pxToPt(px, py, scale);
    const next = [...vertices, pt];
    setVertices(next);
    emit(next, false);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const [px, py] = getCanvasPx(e);

    if (dragging.current && dragIdx.current !== null) {
      const pt = pxToPt(px, py, scale);
      const next = vertices.map((v, i) => i === dragIdx.current ? pt : v) as Pt[];
      setVertices(next);
      emit(next, closed);
      return;
    }

    if (!closed) setGuide([px, py]);
  }

  function handleMouseUp() {
    dragging.current = false;
    dragIdx.current = null;
  }

  function handleMouseLeave() {
    dragging.current = false;
    dragIdx.current = null;
    setGuide(null);
  }

  function closePoly() {
    if (vertices.length < 3) return;
    setClosed(true);
    emit(vertices, true);
    setGuide(null);
  }

  function undoLast() {
    if (closed) {
      setClosed(false);
      emit(vertices, false);
    } else {
      const next = vertices.slice(0, -1);
      setVertices(next);
      emit(next, false);
    }
  }

  function clear() {
    setVertices([]);
    setClosed(false);
    setGuide(null);
    onChange(null);
  }

  const area = closed && vertices.length >= 3 ? polyArea(vertices) : null;
  const bbox = closed && vertices.length >= 3 ? polyBbox(vertices) : null;
  const maxM = CANVAS_PX / CELL_PX * scale;

  return (
    <div className="space-y-2">
      {/* Scale selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] text-white/40 shrink-0">1 кл. =</span>
        <div className="flex gap-1">
          {SCALES.map(s => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={[
                "h-6 px-2 rounded text-[10.5px] transition",
                scale === s
                  ? "bg-violet-500/30 text-violet-200 border border-violet-400/40"
                  : "bg-white/[0.04] text-white/45 border border-white/[0.07] hover:text-white",
              ].join(" ")}
            >
              {s}м
            </button>
          ))}
        </div>
        <span className="text-[10px] text-white/25 ml-1">≈ {maxM}×{maxM}м</span>
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden" style={{ width: CANVAS_PX, height: CANVAS_PX }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_PX}
          height={CANVAS_PX}
          style={{ width: CANVAS_PX, height: CANVAS_PX, cursor: closed ? "default" : "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        {vertices.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[11px] text-white/25 text-center leading-snug">
              Кликайте чтобы добавить вершины.<br />
              Кликните на зелёную точку чтобы закрыть контур.
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={undoLast}
          disabled={vertices.length === 0}
          className="h-7 px-2.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] text-white/55 hover:text-white transition flex items-center gap-1 disabled:opacity-30"
        >
          <Undo2 size={11} /> Отмена
        </button>
        {!closed && vertices.length >= 3 && (
          <button
            onClick={closePoly}
            className="h-7 px-2.5 rounded-lg bg-violet-500/20 border border-violet-400/30 text-[11px] text-violet-200 hover:bg-violet-500/30 transition flex items-center gap-1"
          >
            <CheckCircle2 size={11} /> Закрыть
          </button>
        )}
        <button
          onClick={clear}
          disabled={vertices.length === 0}
          className="h-7 px-2.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] text-white/55 hover:text-rose-300 transition flex items-center gap-1 disabled:opacity-30 ml-auto"
        >
          <Trash2 size={11} /> Очистить
        </button>
      </div>

      {/* Info */}
      {area !== null && bbox !== null && (
        <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2 py-1.5 text-center">
            <div className="text-white/40 text-[9.5px]">Площадь</div>
            <div className="text-white font-medium tabular-nums">{area.toFixed(0)} м²</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2 py-1.5 text-center">
            <div className="text-white/40 text-[9.5px]">Длина</div>
            <div className="text-white font-medium tabular-nums">{bbox.w.toFixed(1)} м</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2 py-1.5 text-center">
            <div className="text-white/40 text-[9.5px]">Ширина</div>
            <div className="text-white font-medium tabular-nums">{bbox.d.toFixed(1)} м</div>
          </div>
        </div>
      )}
      {!closed && vertices.length > 0 && (
        <div className="text-[10.5px] text-white/35">
          Вершин: {vertices.length}{vertices.length >= 3 ? " · нажмите «Закрыть» или на первую точку" : ""}
        </div>
      )}
    </div>
  );
}
