"use client";

// Архитектурные чертежи — таб 6, этап 1.
//
// Юзер пишет свободное ТЗ → GPT-4 парсит параметры → детерминированный
// генератор строит JSON-граф этажа (стены, секции, ядра, комнаты) →
// фронт рендерит план в SVG. Эспорт DXF/IFC и AI-визуализация — на уже
// существующих endpoints (передаём извлечённые inputs туда).
//
// Этапы 2-3 (drag-edit стен, авто-замыкание комнат, размеры) — следующие
// итерации поверх той же модели данных.

import { useState, useRef, useCallback, useEffect, useReducer, type ReactElement } from "react";
import {
  Sparkles, Loader2, Download, AlertCircle, Wand2, Network, FileText,
  Pencil, RefreshCw, Undo2, Redo2, Grid3x3, Box,
} from "lucide-react";
import { IfcViewerModal } from "@/components/IfcViewerModal";
import { PromptForm, DEFAULT_PROMPT_FORM, type PromptFormState } from "@/components/PromptForm";
import {
  generateFloorLayout,
  exportFloorplanDxf, exportFloorplanIfc,
  visualizeSheet,
  type LayoutFloor, type LayoutDoor, type LayoutWindow, type LayoutSide,
  type LayoutFurniture,
  type BriefLayoutResponse,
  type VisualizeFromInputsRequest,
} from "@/lib/engine";
import {
  projectReducer,
  initialEditorState,
  selectCurrentLayout,
  selectCanUndo,
  selectCanRedo,
  type RoomRef,
  type LayersState,
  type LayerId,
} from "@/lib/projectReducer";
import { FloorSelector } from "@/components/editor/FloorSelector";
import { LeftToolbar } from "@/components/editor/LeftToolbar";
import { ModeTabs } from "@/components/editor/ModeTabs";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { SnapControls } from "@/components/editor/SnapControls";
import { HotkeysHelp } from "@/components/editor/HotkeysHelp";
import { ExportModal } from "@/components/export/ExportModal";
import { downloadProjectJson } from "@/lib/export/toJson";
import { downloadSvgAsPng } from "@/lib/export/toPng";
import { downloadSvgAsPdf } from "@/lib/export/toPdf";
import { matchHotkey } from "@/lib/hotkeys";

type Status = "idle" | "loading" | "ready" | "error";

type ExportKind = "dxf" | "ifc" | "viz";


// buildVisReq: PromptFormState → VisualizeFromInputsRequest для бэкенда.
// Те же поля что в page.tsx (AI Чертежи), но дублирую локально чтобы не
// тащить page.tsx в зависимости таба.
const _D = DEFAULT_PROMPT_FORM;
const _nn = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && isFinite(v) ? v : fallback;

function buildVisReq(form: PromptFormState): VisualizeFromInputsRequest {
  return {
    site_width_m:    _nn(form.site_width_m,    _D.site_width_m),
    site_depth_m:    _nn(form.site_depth_m,    _D.site_depth_m),
    setback_front_m: _nn(form.setback_front_m, _D.setback_front_m),
    setback_side_m:  _nn(form.setback_side_m,  _D.setback_side_m),
    setback_rear_m:  _nn(form.setback_rear_m,  _D.setback_rear_m),
    floors:  _nn(form.floors,  _D.floors),
    purpose: form.purpose ?? _D.purpose,
    studio_pct: _nn(form.studio_pct, _D.studio_pct) / 100,
    k1_pct:     _nn(form.k1_pct,     _D.k1_pct)     / 100,
    k2_pct:     _nn(form.k2_pct,     _D.k2_pct)     / 100,
    k3_pct:     _nn(form.k3_pct,     _D.k3_pct)     / 100,
    k4_pct:     _nn(form.k4_pct,     _D.k4_pct)     / 100,
    sections:   _nn(form.sections,   _D.sections),
    parking_spaces_per_apt:       _nn(form.parking_spaces_per_apt,       _D.parking_spaces_per_apt),
    parking_underground_levels:   _nn(form.parking_underground_levels,   _D.parking_underground_levels),
    fire_evacuation_max_m:        _nn(form.fire_evacuation_max_m,        _D.fire_evacuation_max_m),
    fire_evacuation_exits_per_section: _nn(form.fire_evacuation_exits_per_section, _D.fire_evacuation_exits_per_section),
    fire_dead_end_corridor_max_m: _nn(form.fire_dead_end_corridor_max_m, _D.fire_dead_end_corridor_max_m),
    lifts_passenger: _nn(form.lifts_passenger, _D.lifts_passenger),
    lifts_freight:   _nn(form.lifts_freight,   _D.lifts_freight),
    insolation_priority:  form.insolation_priority  ?? _D.insolation_priority,
    insolation_min_hours: _nn(form.insolation_min_hours, _D.insolation_min_hours),
    max_coverage_pct: _nn(form.max_coverage_pct, _D.max_coverage_pct),
    max_height_m:     _nn(form.max_height_m,     _D.max_height_m),
    quality: "medium",
    site_polygon: form.site_polygon ?? null,
  };
}


export function ArchitecturalDrawingsTab({
  onAutoSave,
}: {
  onAutoSave?: (asset: { variantKey: string; imageUrl: string; modelUsed?: string }) => void;
} = {}) {
  // Структурированная форма (как в табе «AI Чертежи»), вместо free-form ТЗ.
  const [form, setForm] = useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  // Типология этажа — пока без UI в PromptForm, поэтому селектор локальный.
  // Доступные значения см. engine/plana_engine/visualizer/marketing_prompt.py:68+
  // и docs/TYPOLOGIES_HANDOFF.md
  const [floorTypology, setFloorTypology] = useState<string>("symmetric");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BriefLayoutResponse | null>(null);
  const [exportBusy, setExportBusy] = useState<ExportKind | null>(null);
  const [vizImageUrl, setVizImageUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  // ── Editor state via useReducer (Sprint 1 v1.0 plan) ───────────────
  // Один reducer над всем editor state: project (с multi-floor),
  // history/hIdx (undo/redo), selected, editMode. Все мутации — pure через
  // dispatch. Заменил россыпь useState и editedLayoutRef из D-2/D-3.
  const [editorState, dispatch] = useReducer(projectReducer, initialEditorState);
  const { project, selected, editMode } = editorState;
  const currentLayout = selectCurrentLayout(editorState);
  const canUndo = selectCanUndo(editorState);
  const canRedo = selectCanRedo(editorState);

  // При новой генерации — заворачиваем layout в LayoutProject (1 этаж),
  // history и selection сбрасываются reducer'ом сами.
  useEffect(() => {
    if (result) {
      dispatch({ type: "SET_PROJECT_FROM_LAYOUT", layout: result.layout });
    } else {
      dispatch({ type: "CLEAR" });
    }
  }, [result]);

  const handleRoomSelect = (ref: RoomRef | null, multi?: boolean) => {
    if (multi && ref) {
      dispatch({ type: "TOGGLE_SELECT_ROOM", ref });
    } else {
      dispatch({ type: "SELECT_ROOM", ref });
    }
  };
  const handleRoomMove = (ref: RoomRef, newX: number, newY: number) => {
    dispatch({ type: "MOVE_ROOM", ref, newX, newY });
  };
  const handleRoomMoveCommit = () => dispatch({ type: "COMMIT_HISTORY" });
  const handleResetEdits = () => dispatch({ type: "RESET_EDITS" });
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  // ── Hotkeys ─────────────────────────────────────────────────────────
  // Один глобальный handler через matchHotkey: tool/mode переключение, undo/
  // redo, навигация между этажами, toggle сетки, help-модалка по ?. Часть
  // действий (lock, delete) пока заглушки до Sprint 5.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      const m = matchHotkey(e);
      if (!m) return;
      e.preventDefault();
      switch (m.kind) {
        case "setTool": dispatch({ type: "SET_TOOL", tool: m.tool }); break;
        case "setMode": dispatch({ type: "SET_MODE", mode: m.mode }); break;
        case "toggleLayer": dispatch({ type: "TOGGLE_LAYER", id: m.id }); break;
        case "undo": undo(); break;
        case "redo": redo(); break;
        case "floorPrev":
          if (project) {
            dispatch({ type: "SET_ACTIVE_FLOOR", idx: project.activeFloorIdx - 1 });
          }
          break;
        case "floorNext":
          if (project) {
            dispatch({ type: "SET_ACTIVE_FLOOR", idx: project.activeFloorIdx + 1 });
          }
          break;
        case "escape": dispatch({ type: "CLEAR_SELECTION" }); break;
        case "openHelp": setHelpOpen(true); break;
        case "lock":
          // Sprint 5: hotkey L → toggle lock на primary selected,
          // если есть multi-selection — заблокировать всех.
          if (editorState.selection.length > 1) {
            dispatch({ type: "LOCK_SELECTION" });
          } else if (editorState.selected) {
            dispatch({ type: "TOGGLE_LOCK_REF", ref: editorState.selected });
          }
          break;
        case "deleteSelected":
          // TODO Sprint 6 — delete нужно для удаления комнаты из layout
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, undo, redo, editorState.selection, editorState.selected]);

  const handleGenerate = async () => {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    if (vizImageUrl) { URL.revokeObjectURL(vizImageUrl); setVizImageUrl(null); }
    try {
      const visReq: VisualizeFromInputsRequest = {
        ...buildVisReq(form),
        floor_typology: floorTypology,
      };
      // Structured endpoint — без LLM-парсинга брифа. Бэк сам построит
      // LayoutFloor через detеrministic generator. Типология выбирается через
      // селектор floorTypology (см. ниже).
      const layout = await generateFloorLayout(visReq);
      // Адаптируем под BriefLayoutResponse-форму, которую дальше использует UI
      setResult({
        layout,
        inputs: visReq,
        used_defaults: [],
        notes: "",
      });
      setStatus("ready");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  };

  // ── Export (Sprint 6) ───────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const getMainSvg = (): SVGSVGElement => {
    const el = document.querySelector<SVGSVGElement>("[data-plana-canvas=\"main\"]");
    if (!el) throw new Error("Не нашли активный canvas с планом");
    return el;
  };
  const handleExportPdf = async () => {
    const svg = getMainSvg();
    const name = project?.name || "Проект";
    const floorLabel = project?.floors[project.activeFloorIdx]?.label;
    await downloadSvgAsPdf(svg, `${name}.pdf`, { projectName: name, floorLabel });
  };
  const handleExportPng = async () => {
    const svg = getMainSvg();
    const name = project?.name || "plan";
    await downloadSvgAsPng(svg, `${name}.png`);
  };
  const handleExportJson = async () => {
    if (!project) throw new Error("Нет активного проекта");
    downloadProjectJson(project, `${project.name || "project"}.plana.json`);
  };
  const handleExportDxfModal = async () => {
    if (!result) throw new Error("Сначала сгенерируй план");
    setExportBusy("dxf");
    try {
      const { blob, filename } = await exportFloorplanDxf(result.inputs);
      downloadBlob(blob, filename);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportDxf = async () => {
    if (!result || exportBusy) return;
    setExportBusy("dxf");
    try {
      const { blob, filename } = await exportFloorplanDxf(result.inputs);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(`DXF: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportIfc = async () => {
    if (!result || exportBusy) return;
    setExportBusy("ifc");
    try {
      // Передаём текущий layout (с правками редактора), чтобы получить
      // богатый IFC с реальными IfcSpace на каждую комнату, а не
      // параметрическую коробку из marketing_to_project.
      const layoutToExport = currentLayout ?? result.layout;
      const { blob, filename } = await exportFloorplanIfc(result.inputs, layoutToExport);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(`IFC: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  // Лениво грузит IFC байты для встроенного 3D-вьюера. Та же логика что и
  // handleExportIfc, но без download — модель идёт прямо в web-ifc-парсер.
  const fetchIfcBytes = useCallback(async (): Promise<Uint8Array> => {
    if (!result) throw new Error("Нет сгенерированного плана");
    const layoutToExport = currentLayout ?? result.layout;
    const { blob } = await exportFloorplanIfc(result.inputs, layoutToExport);
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }, [result, currentLayout]);

  const handleAiViz = async () => {
    if (!result || exportBusy) return;
    setExportBusy("viz");
    try {
      // Используем уже существующий /visualize/sheet режим A на типе "floor_plan".
      // Этого достаточно для этапа 1: красивый рендер «по теме».
      // На этапе 3 можно будет передавать сам SVG как референс (mode B).
      const res = await visualizeSheet({
        sheet_type: "floor_plan",
        mode: "A",
        hint: `Building footprint ${result.layout.width_m.toFixed(1)}×${result.layout.depth_m.toFixed(1)} m, ${result.layout.sections.length} section(s).`,
      });
      const url = URL.createObjectURL(res.blob);
      if (vizImageUrl) URL.revokeObjectURL(vizImageUrl);
      setVizImageUrl(url);
      if (onAutoSave) {
        onAutoSave({
          variantKey: `arch_${Date.now()}`,
          imageUrl: url,
          modelUsed: res.modelUsed ?? undefined,
        });
      }
    } catch (e) {
      setError(`AI Виз: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <>
      {/* Шапка */}
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0 flex-wrap">
        <FileText size={13} className="text-sky-300" />
        <span className="text-[13px] font-medium text-white/85">
          Архитектурные чертежи
        </span>
        {result && currentLayout && (
          <>
            <div className="h-4 w-px bg-white/[0.07]" />
            <span className="text-[11.5px] text-white/55">
              {currentLayout.width_m.toFixed(1)} × {currentLayout.depth_m.toFixed(1)} м · {currentLayout.sections.length} секц. · {totalApartments(currentLayout)} кв.
            </span>
            {result.used_defaults.length > 0 && (
              <span
                className="text-[10.5px] text-amber-300/80"
                title={`Дефолты подставлены для: ${result.used_defaults.join(", ")}`}
              >
                · {result.used_defaults.length} полей по дефолту
              </span>
            )}
          </>
        )}

        {result && (
          <>
            <div className="flex-1" />
            {project && project.floors.length > 0 && (
              <FloorSelector
                project={project}
                variant="dark"
                onSelect={(idx) => dispatch({ type: "SET_ACTIVE_FLOOR", idx })}
                onAddFloor={() => dispatch({ type: "ADD_FLOOR" })}
                onDuplicateActive={() => dispatch({ type: "DUPLICATE_ACTIVE_FLOOR" })}
                onDeleteActive={() => dispatch({ type: "DELETE_ACTIVE_FLOOR" })}
              />
            )}
            {editMode && (
              <SnapControls
                step={editorState.snap.step}
                onChange={(step) => dispatch({ type: "SET_SNAP", snap: { step } })}
                variant="dark"
              />
            )}
            {/* Edit mode toggle */}
            <button
              onClick={() => dispatch({ type: "SET_EDIT_MODE", on: !editMode })}
              title={editMode ? "Выйти из редактора" : "Включить редактор: можно двигать комнаты"}
              className={[
                "h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 transition",
                editMode
                  ? "bg-emerald-500/30 border border-emerald-400/50 text-emerald-50"
                  : "border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-500/15",
              ].join(" ")}
            >
              <Pencil size={11} /> {editMode ? "Редактор вкл." : "Редактор"}
            </button>
            {editMode && (
              <>
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  title="Отменить (Ctrl+Z)"
                  className="h-7 w-7 rounded text-[11.5px] flex items-center justify-center border border-white/15 text-white/75 hover:bg-white/[0.06] transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Undo2 size={12} />
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  title="Повторить (Ctrl+Y / Ctrl+Shift+Z)"
                  className="h-7 w-7 rounded text-[11.5px] flex items-center justify-center border border-white/15 text-white/75 hover:bg-white/[0.06] transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Redo2 size={12} />
                </button>
                {canUndo && result && (
                  <button
                    onClick={handleResetEdits}
                    title="Откатить все ручные изменения к исходному AI-плану"
                    className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-white/15 text-white/65 hover:bg-white/[0.06] transition"
                  >
                    <RefreshCw size={11} /> Сброс
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => setExportOpen(true)}
              disabled={!project || exportBusy !== null}
              title="Экспорт: PDF / DXF / PNG / JSON / Share"
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-500/15 transition disabled:opacity-40"
            >
              <Download size={11} /> Экспорт
            </button>
            <button
              onClick={handleExportDxf}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-violet-400/30 text-violet-200/90 hover:bg-violet-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "dxf" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} DXF
            </button>
            <button
              onClick={handleExportIfc}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-cyan-400/30 text-cyan-200/90 hover:bg-cyan-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "ifc" ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />} IFC
            </button>
            <button
              onClick={() => setViewerOpen(true)}
              disabled={!result}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-500/15 transition disabled:opacity-40"
              title="Открыть 3D-просмотр IFC прямо в браузере"
            >
              <Box size={11} /> 3D
            </button>
            <button
              onClick={handleAiViz}
              disabled={exportBusy !== null}
              className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-rose-400/30 text-rose-200/90 hover:bg-rose-500/15 transition disabled:opacity-40"
            >
              {exportBusy === "viz" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} AI Виз
            </button>
          </>
        )}
      </div>

      {/* Контент: 3-колоночный layout (Maket-style) */}
      {/* [LeftToolbar 44px] [ТЗ + chat 320px] [Canvas 1fr] */}
      {/* Sprint 2 v1.0 plan: AI chat пока остаётся в центральной колонке,
          в Sprint 5 он переедет в RightPanel. */}
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "auto 320px minmax(0, 1fr)" }}>
        {/* LEFT — Toolbar инструментов (Sprint 2: UI без реальной логики, S3 оживит) */}
        <div className="border-r border-white/[0.04] py-2 px-2 flex flex-col gap-2 items-center">
          <LeftToolbar
            tool={editorState.tool}
            onChange={(t) => dispatch({ type: "SET_TOOL", tool: t })}
            variant="dark"
            disabled={["wall", "door", "window", "stair", "room", "furniture", "measure", "dimension", "eraser"]}
          />
        </div>

        {/* CENTER — структурированная форма параметров (как в табе «AI Чертежи») */}
        <div className="border-r border-white/[0.04] p-3 flex flex-col gap-3 min-h-0">
          {/* Селектор типологии этажа — отдельно от PromptForm, временно
              пока не вынесем в общую форму. См. docs/TYPOLOGIES_HANDOFF.md */}
          <label className="flex flex-col gap-1 text-[11px] text-white/60">
            <span className="uppercase tracking-wide">Типология этажа</span>
            <select
              value={floorTypology}
              onChange={(e) => setFloorTypology(e.target.value)}
              className="h-8 px-2 rounded bg-white/[0.04] border border-white/[0.06] text-white/85 text-[12.5px] focus:outline-none focus:border-white/[0.18]"
            >
              <option value="symmetric">Симметричная (default)</option>
              <option value="t_shape">T-shape (2 крупных + 3 стандартных)</option>
              <option value="asymmetric_depth">Asymmetric depth (юг глубже севера)</option>
              <option value="double_core">Double core (длинная секция, 2 ядра)</option>
              <option value="tower">Tower (4 угловые вокруг ядра)</option>
              <option value="core_shifted">Core shifted (ядро у торца)</option>
              <option value="corner_apt">Corner apt (SW угловая премиум)</option>
              <option value="l_shape">L-shape (Г-образный контур)</option>
              <option value="gallery_offset">Gallery offset (галерея с карманом)</option>
              <option value="u_shape">U-shape (П-секция с двориком)</option>
              <option value="duplex_top">Duplex top (верх дюплекс-пентхаусов)</option>
              <option value="commercial_ground">Commercial ground (нежилой 1 эт.)</option>
            </select>
          </label>
          <PromptForm
            value={form}
            onChange={setForm}
            onGenerate={handleGenerate}
            generating={status === "loading"}
          />
        </div>

        {/* RIGHT — canvas + ModeTabs + LayersPanel (плавающая) */}
        <div className="relative overflow-hidden">
          {/* ModeTabs над canvas — показываем только когда есть план */}
          {status === "ready" && currentLayout && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
              <ModeTabs
                mode={editorState.mode}
                onChange={(m) => dispatch({ type: "SET_MODE", mode: m })}
                variant="dark"
                disabled={["build", "finishes", "visualize"]}
              />
            </div>
          )}

          {/* LayersPanel плавающая в правом углу — только при наличии плана */}
          {status === "ready" && currentLayout && (
            <div className="absolute top-2 right-2 z-10 w-40">
              <LayersPanel
                layers={editorState.layers}
                onToggleVisible={(id) => dispatch({ type: "TOGGLE_LAYER", id })}
                onToggleLocked={(id) =>
                  dispatch({
                    type: "SET_LAYER_LOCKED",
                    id,
                    locked: !editorState.layers[id].locked,
                  })
                }
                variant="dark"
              />
            </div>
          )}

          {/* Help button — discoverability hotkeys */}
          {status === "ready" && currentLayout && (
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              title="Горячие клавиши (?)"
              aria-label="Горячие клавиши"
              className="absolute bottom-3 right-3 z-10 grid h-7 w-7 place-items-center rounded-full border border-white/15 bg-black/40 text-[12px] font-bold text-white/70 backdrop-blur hover:bg-black/60 hover:text-white"
            >
              ?
            </button>
          )}
          {status === "idle" && !result && (
            <div className="absolute inset-0 grid place-items-center text-center p-8">
              <div className="max-w-md">
                <div className="mx-auto w-12 h-12 rounded-full bg-sky-500/15 grid place-items-center mb-4">
                  <Sparkles size={20} className="text-sky-300" />
                </div>
                <div className="text-[15px] font-semibold tracking-display mb-1.5">
                  Задай параметры здания
                </div>
                <div className="text-[12.5px] text-white/55 leading-relaxed">
                  Заполни форму слева — габариты, этажи, микс квартир.
                  Нажми «Сгенерировать», получишь технический план этажа.
                  Дальше экспорт в DXF/IFC или 3D-просмотр.
                </div>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 text-white/60">
                <Loader2 size={20} className="animate-spin text-sky-300" />
                <span className="text-[12.5px]">Строим план…</span>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="flex flex-col items-center gap-2 text-rose-300 text-center max-w-md">
                <AlertCircle size={20} />
                <span className="text-[12.5px]">{error}</span>
                <button
                  onClick={handleGenerate}
                  className="mt-2 h-7 px-3 rounded text-[11px] text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] transition"
                >
                  Повторить
                </button>
              </div>
            </div>
          )}

          {status === "ready" && currentLayout && (
            <div className="absolute inset-0 flex flex-col">
              {/* Скроллируемая область — пускаем вертикальный скролл */}
              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {vizImageUrl ? (
                  <div className="flex flex-col gap-2">
                    {/* План — фиксированная пропорция, чтобы не схлопывался */}
                    <div className="relative bg-white rounded-lg overflow-hidden">
                      <div className="absolute top-2 left-2 z-10 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                        План {editMode && "· редактор"}
                      </div>
                      <div style={{ aspectRatio: `${currentLayout.width_m + 10}/${currentLayout.depth_m + 10}` }}>
                        <FloorPlanSvg
                          layout={currentLayout}
                          editMode={editMode}
                          selected={selected}
                          selection={editorState.selection}
                          lockedRefs={editorState.lockedRefs}
                          layers={editorState.layers}
                          onSelectRoom={handleRoomSelect}
                          onMoveRoom={handleRoomMove}
                          onMoveCommit={handleRoomMoveCommit}
                        />
                      </div>
                    </div>
                    {/* AI визуализация — natural-height */}
                    <div className="relative bg-black/30 rounded-lg overflow-hidden">
                      <div className="absolute top-2 left-2 z-10 h-5 px-1.5 rounded bg-black/55 text-[10px] text-white/85 grid place-items-center">
                        AI Визуализация
                      </div>
                      <img
                        src={vizImageUrl}
                        alt="AI визуализация"
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg" style={{ aspectRatio: `${currentLayout.width_m + 10}/${currentLayout.depth_m + 10}` }}>
                    <FloorPlanSvg
                      layout={currentLayout}
                      editMode={editMode}
                      selected={selected}
                      selection={editorState.selection}
                      lockedRefs={editorState.lockedRefs}
                      layers={editorState.layers}
                      onSelectRoom={handleRoomSelect}
                      onMoveRoom={handleRoomMove}
                      onMoveCommit={handleRoomMoveCommit}
                    />
                  </div>
                )}
              </div>
              {error && (
                <div className="px-4 py-2 text-[11px] text-rose-300/85 bg-rose-900/15 border-t border-rose-500/20 flex items-center gap-1.5">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <HotkeysHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onPdf={handleExportPdf}
        onPng={handleExportPng}
        onJson={handleExportJson}
        onDxf={handleExportDxfModal}
      />
      <IfcViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        onDownload={handleExportIfc}
        getIfcBytes={fetchIfcBytes}
        modelName="plana-floorplan"
      />
    </>
  );
}


// ---------------------------------------------------------------------------
// FloorPlanSvg — рендерер LayoutFloor в SVG
//
// Стиль вдохновлён maket.ai: тяжёлые чёрные внешние стены, бежевый фон комнат
// без цветовых различий, толстые перегородки между комнатами (визуально
// симулируют реальную толщину стен), UPPERCASE-подписи. Технический эстетик.
// ---------------------------------------------------------------------------

// Бежевая палитра (тон листа архитектурного чертежа)
const CANVAS_BG    = "#F5F4EE";   // фон всего SVG — светлый бумажный
// Стиль S1+S2 (приближение к Maket): чисто-белый фон комнат, тонкие
// архитектурные линии стен. Раньше использовался тёплый бежевый — здесь
// строгий чертёжный.
const ROOM_FILL    = "#FAFAF6";   // почти белый
const CORRIDOR_FILL = "#F0EEE8";  // светлый бежево-серый
const BALCONY_FILL  = "#E6EDE2";  // лоджия — мягкий зелёный (наружное)
// S-lifts: cores раньше рисовались как чёрные блоки — доминировали в плане.
// Теперь — светло-серый фон как другие служебные помещения (санузел, прихожая).
const CORE_FILL    = "#E8E6DD";   // светлый серо-бежевый
const CORE_TEXT    = "#2d2d2d";   // тёмный текст на светлом фоне
const WALL_COLOR   = "#0a0a0a";   // основной цвет стен — почти чёрный
const LABEL_COLOR  = "#2d2d2d";   // подписи комнат
const AREA_COLOR   = "#7a6a4a";   // подписи площадей

// Толщины стен в метрах SVG-единиц. S1 (Maket-look): тонкие архитектурные
// линии вместо жирных. Раньше внешние были 0.35 — теперь 0.18 (всё ещё
// читаются как несущие, но не доминируют).
const WALL_EXTERIOR = 0.18;   // внешние стены здания
const WALL_PARTITION = 0.08;  // внутренние перегородки между комнатами
const WALL_CORE     = 0.06;   // ядра — тонкий контур
const WALL_SECTION  = 0.14;   // межсекционная противопожарная стена

// Типографика — фиксированные размеры (в метрах), без зависимости от размера
// комнаты. Если комната слишком мала для подписи — она просто не отрисуется.
const FONT_ROOM_LABEL = 0.42;       // «СПАЛЬНЯ 1», «ГОСТИНАЯ»
const FONT_ROOM_AREA  = 0.30;       // «12.4 m²»
const FONT_APT_NUMBER = 0.36;       // «КВ.1» в углу
const FONT_CORE_LABEL = 0.50;       // «ЛИФТ», «ЛЕСТН.»
const FONT_DIM_TEXT   = 0.55;       // размерные подписи «24.00 М»
const MIN_ROOM_LABEL_W = 1.8;       // меньше — подпись не пишем
const MIN_ROOM_LABEL_D = 1.4;       // меньше — подпись не пишем
const MIN_ROOM_AREA_W = 1.3;        // площадь скрываем независимо от label

const CORE_LABEL_RU: Record<string, string> = {
  lift_passenger: "ЛИФТ",
  lift_freight:   "ГРУЗ",
  stair:          "ЛЕСТН.",
};

// Перевод kind на UPPERCASE-русский для подписи. Если в name_ru уже стоит
// конкретное название («Спальня 1») — используем его, просто в UPPERCASE.
const ROOM_LABEL_FALLBACK_RU: Record<string, string> = {
  living:   "ГОСТИНАЯ",
  bedroom:  "СПАЛЬНЯ",
  kitchen:  "КУХНЯ",
  bathroom: "С/У",
  toilet:   "С/У",
  hallway:  "ПРИХОЖАЯ",
  loggia:   "ЛОДЖИЯ",
  storage:  "КЛАДОВАЯ",
};


type Viewport = { zoom: number; panX: number; panY: number };
const VP_RESET: Viewport = { zoom: 1, panX: 0, panY: 0 };
const VP_ZOOM_MIN = 0.4;
const VP_ZOOM_MAX = 8;

type GridStyle = "grid" | "dots" | "none";
const GRID_STYLES: GridStyle[] = ["grid", "dots", "none"];
const GRID_STYLE_LABEL: Record<GridStyle, string> = {
  grid: "клетка",
  dots: "точки",
  none: "без сетки",
};


type FloorPlanSvgProps = {
  layout: LayoutFloor;
  editMode?: boolean;
  selected?: RoomRef | null;
  /** Полный набор выделений для multi-select. Если не передан — рисуем только primary. */
  selection?: RoomRef[];
  /** Заблокированные комнаты — золотая обводка + drag отключён (Sprint 5). */
  lockedRefs?: RoomRef[];
  layers?: LayersState;
  /** При Shift/Ctrl/Meta+click multi=true → toggle вместо replace. */
  onSelectRoom?: (ref: RoomRef | null, multi?: boolean) => void;
  onMoveRoom?: (ref: RoomRef, newX: number, newY: number) => void;
  onMoveCommit?: () => void;
};


export function FloorPlanSvg({
  layout,
  editMode = false,
  selected = null,
  selection,
  lockedRefs,
  layers,
  onSelectRoom,
  onMoveRoom,
  onMoveCommit,
}: FloorPlanSvgProps) {
  // Helper: видим ли слой? default true для backwards compat.
  const layerVisible = (id: LayerId): boolean =>
    layers ? layers[id].visible : true;
  // Helper: заблокирована ли комната.
  const refLocked = (ref: RoomRef): boolean =>
    !!lockedRefs?.some(
      (r) => r.sectionIdx === ref.sectionIdx
          && r.aptIdx === ref.aptIdx
          && r.roomIdx === ref.roomIdx,
    );
  // Helper: входит ли ref в multi-selection (или равен primary, если selection не задан).
  const refSelected = (ref: RoomRef): boolean => {
    if (selection) {
      return selection.some(
        (r) =>
          r.sectionIdx === ref.sectionIdx
          && r.aptIdx === ref.aptIdx
          && r.roomIdx === ref.roomIdx,
      );
    }
    return (
      selected !== null
      && selected.sectionIdx === ref.sectionIdx
      && selected.aptIdx === ref.aptIdx
      && selected.roomIdx === ref.roomIdx
    );
  };
  // Padding в метрах вокруг здания (для подписей размеров)
  // PAD = 5 для размещения координатных осей А-Ж/1-N за пределами здания
  // (см. layer "axes"). Aspect-ratio родительского контейнера тоже использует +10.
  const PAD = 5;
  const W = layout.width_m;
  const D = layout.depth_m;
  const viewBoxW = W + PAD * 2;
  const viewBoxH = D + PAD * 2;

  // Архитектурные координаты Y: 0 внизу, растут вверх (юг → север).
  // SVG Y: 0 сверху, растёт вниз. Инвертируем на месте.
  const ry = (archY: number, h: number = 0) => D - archY - h;

  const fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  // Уникальный id для точечной сетки на фоне
  const gridId = `dot-grid-${Math.random().toString(36).slice(2, 8)}`;

  // ── Viewport: zoom + pan через CSS transform на SVG ─────────────────
  const [vp, setVp] = useState<Viewport>(VP_RESET);
  const [dragging, setDragging] = useState(false);
  const [gridStyle, setGridStyle] = useState<GridStyle>("grid");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const cycleGridStyle = () => {
    setGridStyle((prev) => {
      const i = GRID_STYLES.indexOf(prev);
      return GRID_STYLES[(i + 1) % GRID_STYLES.length];
    });
  };

  // Drag комнаты в edit-mode
  const startRoomDrag = (e: React.MouseEvent, ref: RoomRef, room: { x: number; y: number }) => {
    if (!editMode || !onMoveRoom) return;
    if (refLocked(ref)) return;          // Sprint 5: locked не двигаются
    e.stopPropagation();
    onSelectRoom?.(ref);

    // px/metre считаем один раз в момент начала drag через bounding rect SVG
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    // preserveAspectRatio meet → SVG-юнит = min(w/vbW, h/vbH) пикселей
    const pxPerMeter = Math.min(rect.width / viewBoxW, rect.height / viewBoxH);
    if (pxPerMeter <= 0) return;

    const start = { cx: e.clientX, cy: e.clientY, rx: room.x, ry: room.y };
    const onMove = (ev: MouseEvent) => {
      const dxPx = ev.clientX - start.cx;
      const dyPx = ev.clientY - start.cy;
      const dxM = dxPx / pxPerMeter;
      // SVG Y растёт вниз, но архитектурные координаты Y растут вверх:
      // tянуть мышь вниз по экрану → arch Y уменьшается.
      const dyM = -dyPx / pxPerMeter;
      onMoveRoom(ref, start.rx + dxM, start.ry + dyM);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onMoveCommit?.();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onBgClick = () => {
    // Клик по фону снимает выделение
    if (editMode) onSelectRoom?.(null);
  };

  // При смене layout — сбрасываем viewport
  useEffect(() => {
    setVp(VP_RESET);
  }, [layout]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setVp((prev) => {
      const newZoom = Math.min(VP_ZOOM_MAX, Math.max(VP_ZOOM_MIN, prev.zoom * factor));
      const k = newZoom / prev.zoom;
      return {
        zoom: newZoom,
        panX: cx - (cx - prev.panX) * k,
        panY: cy - (cy - prev.panY) * k,
      };
    });
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: vp.panX, py: vp.panY };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setVp((prev) => ({ ...prev, panX: dragRef.current!.px + dx, panY: dragRef.current!.py + dy }));
  };
  const stopDrag = () => { dragRef.current = null; setDragging(false); };

  const zoomBtn = (factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setVp((prev) => {
      const newZoom = Math.min(VP_ZOOM_MAX, Math.max(VP_ZOOM_MIN, prev.zoom * factor));
      const k = newZoom / prev.zoom;
      return { zoom: newZoom, panX: cx - (cx - prev.panX) * k, panY: cy - (cy - prev.panY) * k };
    });
  };
  const resetVp = () => setVp(VP_RESET);

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onDoubleClick={resetVp}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: CANVAS_BG,
        cursor: dragging ? "grabbing" : "grab",
        userSelect: "none",
      }}
    >
    <svg
      ref={svgRef}
      data-plana-canvas={editMode || !!onMoveRoom ? "main" : "thumb"}
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        background: CANVAS_BG,
        width: "100%",
        height: "100%",
        transform: `translate(${vp.panX}px, ${vp.panY}px) scale(${vp.zoom})`,
        transformOrigin: "0 0",
      }}
      fontFamily={fontFamily}
      onClick={onBgClick}
    >
      {/* ── Фоновая сетка: 3 режима (клетка / точки / без) ──────────── */}
      <defs>
        <pattern id={`${gridId}-dots`} width={1} height={1} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={0.025} fill="#b8a878" opacity={0.5} />
        </pattern>
        <pattern id={`${gridId}-fine`} width={0.5} height={0.5} patternUnits="userSpaceOnUse">
          <path d="M 0.5 0 L 0 0 0 0.5" fill="none" stroke="#cbb88a" strokeWidth={0.008} />
        </pattern>
        <pattern id={`${gridId}-major`} width={5} height={5} patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#9c8554" strokeWidth={0.025} />
        </pattern>
      </defs>
      {layerVisible("grid") && gridStyle === "dots" && (
        <rect x={0} y={0} width={viewBoxW} height={viewBoxH} fill={`url(#${gridId}-dots)`} />
      )}
      {layerVisible("grid") && gridStyle === "grid" && (
        <>
          <rect x={0} y={0} width={viewBoxW} height={viewBoxH} fill={`url(#${gridId}-fine)`} />
          <rect x={0} y={0} width={viewBoxW} height={viewBoxH} fill={`url(#${gridId}-major)`} />
        </>
      )}

      <g transform={`translate(${PAD}, ${PAD})`}>
        {/* ── Заливка всех комнат и коридора единым бежевым ────────────── */}
        {/* Сначала рисуем заливку всего внутреннего пространства,
            потом сверху — стены толстыми чёрными линиями. */}

        {layout.sections.map((section) => (
          <g key={`fill-${section.index}`}>
            {/* Коридор — чуть темнее общего бежевого */}
            <rect
              x={section.x_start}
              y={ry(section.corridor_y, section.corridor_d)}
              width={section.width} height={section.corridor_d}
              fill={CORRIDOR_FILL}
            />

            {/* Квартиры — заливаем по комнатам единым тоном */}
            {section.apartments.map((apt, aIdx) => (
              <g key={`apt-fill-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  const ref: RoomRef = {
                    sectionIdx: section.index,
                    aptIdx: aIdx,
                    roomIdx: rIdx,
                  };
                  const isSelected = refSelected(ref);
                  const isLockedRoom = refLocked(ref);
                  const roomFill =
                    room.kind === "balcony" ? BALCONY_FILL : ROOM_FILL;
                  return (
                    <rect
                      key={rIdx}
                      x={rx} y={ry(archY, room.d)}
                      width={room.w} height={room.d}
                      fill={roomFill}
                      onMouseDown={editMode
                        ? (e) => startRoomDrag(e, ref, { x: room.x, y: room.y })
                        : undefined}
                      onClick={editMode ? (e) => {
                        e.stopPropagation();
                        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
                        onSelectRoom?.(ref, multi);
                      } : undefined}
                      style={editMode
                        ? { cursor: isLockedRoom ? "not-allowed" : "move" }
                        : undefined}
                      // outline для выделенной комнаты — добавим overlay в отдельной группе ниже
                      data-selected={isSelected || undefined}
                      data-locked={isLockedRoom || undefined}
                    />
                  );
                })}
              </g>
            ))}
          </g>
        ))}

        {/* ── Внутренние перегородки между комнатами ───────────────────── */}
        {/* Рисуем серединные линии внутри здания — это даст «толщину» стен
            визуально, без фактического вычитания их из геометрии комнат. */}
        {layout.sections.map((section) => (
          <g key={`partitions-${section.index}`} stroke={WALL_COLOR} strokeLinecap="square">
            {/* Перегородки между комнатами внутри квартир */}
            {section.apartments.map((apt) => (
              <g key={`apt-walls-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  return (
                    <rect
                      key={rIdx}
                      x={rx} y={ry(archY, room.d)}
                      width={room.w} height={room.d}
                      fill="none"
                      stroke={WALL_COLOR}
                      strokeWidth={WALL_PARTITION}
                    />
                  );
                })}
                {/* Контур квартиры — чуть толще для разделения соседних */}
                <rect
                  x={apt.x} y={ry(apt.y, apt.d)}
                  width={apt.w} height={apt.d}
                  fill="none"
                  stroke={WALL_COLOR}
                  strokeWidth={WALL_PARTITION + 0.05}
                />
              </g>
            ))}

            {/* Контур коридора */}
            <rect
              x={section.x_start}
              y={ry(section.corridor_y, section.corridor_d)}
              width={section.width} height={section.corridor_d}
              fill="none"
              stroke={WALL_COLOR}
              strokeWidth={WALL_PARTITION}
            />

            {/* Межсекционная стена (если секций > 1) */}
            {layout.sections.length > 1 && section.index > 0 && (
              <line
                x1={section.x_start} y1={0}
                x2={section.x_start} y2={D}
                stroke={WALL_COLOR} strokeWidth={WALL_SECTION}
              />
            )}
          </g>
        ))}

        {/* ── Двери и окна — рисуем поверх стен, до ядер и контура ───── */}
        {layout.sections.map((section) => (
          <g key={`apertures-${section.index}`}>
            {section.apartments.map((apt) =>
              apt.rooms.flatMap((room, rIdx) => {
                const rx = apt.x + room.x;
                const archY = apt.y + room.y;
                const childKey = `${apt.number}-${rIdx}`;
                return [
                  ...(room.windows ?? []).map((win, wi) => (
                    <WindowSymbol
                      key={`w-${childKey}-${wi}`}
                      rx={rx} archY={archY} rw={room.w} rd={room.d}
                      win={win} ry={ry}
                    />
                  )),
                  ...(room.doors ?? []).map((door, di) => (
                    <DoorSymbol
                      key={`d-${childKey}-${di}`}
                      rx={rx} archY={archY} rw={room.w} rd={room.d}
                      door={door} ry={ry}
                    />
                  )),
                ];
              })
            )}
          </g>
        ))}

        {/* ── Мебель — мелкие иконки внутри комнат ────────────────────── */}
        {layerVisible("furniture") && layout.sections.map((section) => (
          <g key={`furniture-${section.index}`}>
            {section.apartments.map((apt) =>
              apt.rooms.map((room, rIdx) =>
                (room.furniture ?? []).map((furn, fi) => {
                  const fx = apt.x + room.x + furn.x;
                  const fArchY = apt.y + room.y + furn.y;
                  return (
                    <FurnitureItem
                      key={`f-${apt.number}-${rIdx}-${fi}`}
                      furn={furn}
                      svgX={fx}
                      svgY={ry(fArchY, furn.d)}
                    />
                  );
                })
              )
            )}
          </g>
        ))}

        {/* ── Ядра: лифты и лестницы ──────────────────────────────────── */}
        {/* Подпись пишем только на ПЕРВОМ ядре каждого вида (lift_passenger,
            lift_freight, stair) — иначе при двух пассажирских лифтах подряд
            подписи накладываются как «ЛИФТЛИФТ». */}
        {layout.sections.map((section) => {
          const labeledKinds = new Set<string>();
          return (
            <g key={`cores-${section.index}`}>
              {section.cores.map((core, ci) => {
                const canShowLabel = core.w >= 1.2 && core.d >= 1.0;
                const isFirstOfKind = !labeledKinds.has(core.kind);
                if (canShowLabel && isFirstOfKind) labeledKinds.add(core.kind);
                return (
                  <g key={ci}>
                    <rect
                      x={core.x} y={ry(core.y, core.d)}
                      width={core.w} height={core.d}
                      fill={CORE_FILL}
                      stroke={WALL_COLOR}
                      strokeWidth={WALL_CORE}
                    />
                    {canShowLabel && isFirstOfKind && (
                      <text
                        x={core.x + core.w / 2}
                        y={ry(core.y + core.d / 2)}
                        textAnchor="middle" dominantBaseline="central"
                        fill={CORE_TEXT}
                        fontSize={FONT_CORE_LABEL}
                        fontWeight={700}
                        letterSpacing={0.04}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {CORE_LABEL_RU[core.kind] ?? "?"}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* ── Внешний контур здания — самый толстый ───────────────────── */}
        {/* Если layout.outline задан (T-/L-/U-форма) — рисуем polygon,
            иначе прямоугольник width × depth. ry() инвертирует Y. */}
        {layout.outline && layout.outline.length >= 3 ? (
          <polygon
            points={layout.outline
              .map(([x, y]) => `${x},${ry(y, 0)}`)
              .join(" ")}
            fill="none"
            stroke={WALL_COLOR}
            strokeWidth={WALL_EXTERIOR}
            strokeLinejoin="miter"
          />
        ) : (
          <rect
            x={0} y={0} width={W} height={D}
            fill="none"
            stroke={WALL_COLOR}
            strokeWidth={WALL_EXTERIOR}
            strokeLinejoin="miter"
          />
        )}

        {/* ── Подписи комнат и номера квартир ─────────────────────────── */}
        {layerVisible("texts") && layout.sections.map((section) => (
          <g key={`labels-${section.index}`}>
            {section.apartments.map((apt) => (
              <g key={`apt-label-${apt.number}`}>
                {apt.rooms.map((room, rIdx) => {
                  const rx = apt.x + room.x;
                  const archY = apt.y + room.y;
                  const cx = rx + room.w / 2;
                  const cy = archY + room.d / 2;
                  const canShowLabel = room.w >= MIN_ROOM_LABEL_W && room.d >= MIN_ROOM_LABEL_D;
                  const canShowArea  = room.w >= MIN_ROOM_AREA_W && room.d >= 0.9;
                  if (!canShowLabel && !canShowArea) return null;
                  const label = upperCaseRoom(room.name_ru, room.kind);
                  // «12.4 м.кв.» — однозначная LTR-кириллица без superscript-
                  // символов. Chrome bidi-алгоритм путается с «²» + цифрами в
                  // SVG-тексте, рендерит порядок задом наперёд («²м 2.21»).
                  const areaText = `${(room.w * room.d).toFixed(1)} м.кв.`;
                  return (
                    <g key={rIdx}>
                      {canShowLabel && (
                        <text
                          x={cx}
                          y={ry(cy + 0.18)}
                          textAnchor="middle" dominantBaseline="central"
                          fill={LABEL_COLOR}
                          fontSize={FONT_ROOM_LABEL}
                          fontWeight={700}
                          letterSpacing={0.04}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {label}
                        </text>
                      )}
                      {canShowArea && (
                        <text
                          x={cx}
                          y={ry(canShowLabel ? cy - 0.32 : cy)}
                          textAnchor="middle" dominantBaseline="central"
                          fill={AREA_COLOR}
                          fontSize={FONT_ROOM_AREA}
                          fontWeight={500}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {areaText}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Номер квартиры — в углу */}
                <text
                  x={apt.x + 0.25}
                  y={ry(apt.y + apt.d - 0.25)}
                  textAnchor="start" dominantBaseline="central"
                  fill={AREA_COLOR}
                  fontSize={FONT_APT_NUMBER}
                  fontWeight={700}
                  letterSpacing={0.05}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  КВ.{apt.number}
                </text>
              </g>
            ))}
          </g>
        ))}

        {/* ── Outline выделенных комнат в edit-mode (multi-select) ────── */}
        {editMode && (selection ?? (selected ? [selected] : [])).map((ref, i) => {
          const section = layout.sections[ref.sectionIdx];
          const apt = section?.apartments[ref.aptIdx];
          const room = apt?.rooms[ref.roomIdx];
          if (!room || !apt) return null;
          const rx = apt.x + room.x;
          const archY = apt.y + room.y;
          // Primary (первый в selection) — синий; остальные — голубее.
          const isPrimary = i === 0;
          return (
            <rect
              key={`sel-${ref.sectionIdx}-${ref.aptIdx}-${ref.roomIdx}`}
              x={rx} y={ry(archY, room.d)}
              width={room.w} height={room.d}
              fill="none"
              stroke={isPrimary ? "#0ea5e9" : "#38bdf8"}
              strokeWidth={isPrimary ? 0.12 : 0.09}
              strokeDasharray="0.25 0.15"
              pointerEvents="none"
            />
          );
        })}

        {/* ── Lock overlay: золотая обводка + замочек (Sprint 5) ────── */}
        {(lockedRefs ?? []).map((ref) => {
          const section = layout.sections[ref.sectionIdx];
          const apt = section?.apartments[ref.aptIdx];
          const room = apt?.rooms[ref.roomIdx];
          if (!room || !apt) return null;
          const rx = apt.x + room.x;
          const archY = apt.y + room.y;
          // Замочек рисуется в правом верхнем углу комнаты (если хватает места)
          const showIcon = room.w >= 0.8 && room.d >= 0.8;
          return (
            <g key={`lock-${ref.sectionIdx}-${ref.aptIdx}-${ref.roomIdx}`} pointerEvents="none">
              <rect
                x={rx} y={ry(archY, room.d)}
                width={room.w} height={room.d}
                fill="none"
                stroke="#d4a017"
                strokeWidth={0.13}
                strokeDasharray="0.4 0.2"
              />
              {showIcon && (
                <g transform={`translate(${rx + room.w - 0.55} ${ry(archY + room.d - 0.55)})`}>
                  <circle cx={0.2} cy={0.2} r={0.27} fill="#d4a017" />
                  {/* Замочек — упрощённо как пометка */}
                  <text
                    x={0.2} y={0.21}
                    textAnchor="middle" dominantBaseline="central"
                    fill="#fff"
                    fontSize={0.32}
                    fontWeight={900}
                  >
                    ⚿
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Размерные линии в CAD-стиле (засечки 45° на концах) ─────── */}
        {layerVisible("dimensions") && (
          <>
            <DimensionLine
              orientation="horizontal"
              x1={0} x2={W} pos={ry(D + 1.5)}
              label={`${W.toFixed(2)} М`}
              color={LABEL_COLOR}
            />
            <DimensionLine
              orientation="vertical"
              y1={ry(D)} y2={ry(0)} pos={-1.5}
              label={`${D.toFixed(2)} М`}
              color={LABEL_COLOR}
            />
          </>
        )}

        {/* ── Scale bar (под зданием слева) ───────────────────────────── */}
        {layerVisible("scaleBar") && <ScaleBar y={ry(0) + 0.8} color={LABEL_COLOR} />}

        {/* ── Координатные оси А-Ж / 1-N (СПДС) ──────────────────────── */}
        {layerVisible("axes") && (
          <AxisGrid layout={layout} ry={ry} W={W} D={D} color={LABEL_COLOR} />
        )}
      </g>
    </svg>

    {/* Overlay: zoom controls */}
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "rgba(255,255,255,0.95)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        borderRadius: 8,
        padding: 3,
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={() => zoomBtn(1.25)}
        title="Приблизить"
        style={zoomBtnStyle}
      >+</button>
      <button
        type="button"
        onClick={() => zoomBtn(0.8)}
        title="Отдалить"
        style={zoomBtnStyle}
      >−</button>
      <button
        type="button"
        onClick={resetVp}
        title="Сбросить (двойной клик по фону)"
        style={{ ...zoomBtnStyle, fontSize: 12 }}
      >⌖</button>
      <button
        type="button"
        onClick={cycleGridStyle}
        title={`Сетка: ${GRID_STYLE_LABEL[gridStyle]} (клик — следующий режим)`}
        style={{
          ...zoomBtnStyle,
          background: gridStyle === "none" ? "#f3f4f6" : "#fff",
          color: gridStyle === "none" ? "#9ca3af" : "#374151",
        }}
      >
        <Grid3x3 size={14} />
      </button>
      <div style={{
        fontSize: 10,
        textAlign: "center",
        color: "#666",
        padding: "2px 0",
        fontVariantNumeric: "tabular-nums",
      }}>
        {Math.round(vp.zoom * 100)}%
      </div>
    </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 4,
  fontSize: 16,
  fontWeight: 600,
  color: "#374151",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};


// ---------------------------------------------------------------------------
// AxisGrid — координатные оси А-Ж / 1-N в стиле СПДС
//
// Вертикальные оси (буквы А-Ж...) — по началу каждой секции и по концу здания.
// Горизонтальные оси (1, 2, 3, 4) — по южной стене / стенам коридора / северной.
// Каждая ось = штрих-пунктирная линия от стены до кружка-маркера с подписью.
// ---------------------------------------------------------------------------

function AxisGrid({
  layout, ry, W, D, color,
}: {
  layout: LayoutFloor;
  ry: (archY: number, h?: number) => number;
  W: number;
  D: number;
  color: string;
}) {
  // ── Позиции осей ──────────────────────────────────────────────────
  // Буквенные (вертикальные оси здания, X-координаты):
  // А = левая стена (x=0), затем границы секций, последняя = правая стена.
  const letterPositions: number[] = [0];
  for (const section of layout.sections) {
    if (section.x_start > 0.01) letterPositions.push(section.x_start);
  }
  if (W - letterPositions[letterPositions.length - 1] > 0.01) {
    letterPositions.push(W);
  }
  const letters = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л", "М"];

  // Цифровые (горизонтальные оси, Y-координаты в архитектурной системе):
  // 1 = южная стена (y=0), 2 = южная стена коридора, 3 = северная стена
  // коридора, 4 = северная стена. Дубликаты подавляем.
  const seenY = new Set<number>();
  const numberPositions: number[] = [];
  const pushY = (y: number) => {
    const rounded = Math.round(y * 100) / 100;
    if (!seenY.has(rounded) && y >= -0.01 && y <= D + 0.01) {
      seenY.add(rounded);
      numberPositions.push(rounded);
    }
  };
  pushY(0);
  for (const section of layout.sections) {
    pushY(section.corridor_y);
    pushY(section.corridor_y + section.corridor_d);
  }
  pushY(D);
  numberPositions.sort((a, b) => a - b);

  // ── Геометрия маркеров ─────────────────────────────────────────────
  const CIRCLE_R = 0.5;        // радиус кружка
  const OFFSET = 3.5;          // насколько круг отстоит от здания (м)
  const DASH = "0.25 0.18";    // штрих-пунктир для оси
  const lineSw = 0.04;
  const circleSw = 0.05;

  // Y-координата SVG для буквенных кружков (выше здания)
  const letterCY = ry(D + OFFSET);
  // X-координата SVG для цифровых кружков (левее здания)
  const numberCX = -OFFSET;

  return (
    <g>
      {/* ── Буквенные оси (вертикальные) ────────────────────────────── */}
      {letterPositions.map((x, i) => (
        <g key={`letter-${i}`}>
          <line
            x1={x} y1={ry(D)}
            x2={x} y2={letterCY + CIRCLE_R}
            stroke={color} strokeWidth={lineSw}
            strokeDasharray={DASH}
          />
          <circle
            cx={x} cy={letterCY}
            r={CIRCLE_R}
            fill="#fff" stroke={color} strokeWidth={circleSw}
          />
          <text
            x={x} y={letterCY}
            textAnchor="middle" dominantBaseline="central"
            fill={color}
            fontSize={0.55}
            fontWeight={700}
            letterSpacing={0.02}
          >
            {letters[i] ?? `?`}
          </text>
        </g>
      ))}

      {/* ── Цифровые оси (горизонтальные) ───────────────────────────── */}
      {numberPositions.map((archY, i) => {
        const y = ry(archY);
        return (
          <g key={`num-${i}`}>
            <line
              x1={0} y1={y}
              x2={numberCX + CIRCLE_R} y2={y}
              stroke={color} strokeWidth={lineSw}
              strokeDasharray={DASH}
            />
            <circle
              cx={numberCX} cy={y}
              r={CIRCLE_R}
              fill="#fff" stroke={color} strokeWidth={circleSw}
            />
            <text
              x={numberCX} y={y}
              textAnchor="middle" dominantBaseline="central"
              fill={color}
              fontSize={0.55}
              fontWeight={700}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}


// ---------------------------------------------------------------------------
// Scale bar — чёрно-белые секции по 1 м, как в архитектурных альбомах
// ---------------------------------------------------------------------------

function ScaleBar({ y, color }: { y: number; color: string }) {
  const SEGMENTS = 5;            // 0..5 м
  const H = 0.25;
  const stroke = 0.025;
  return (
    <g>
      {[...Array(SEGMENTS)].map((_, i) => (
        <rect
          key={i}
          x={i} y={y - H / 2} width={1} height={H}
          fill={i % 2 === 0 ? color : "#fff"}
          stroke={color}
          strokeWidth={stroke}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <text
          key={i}
          x={i} y={y + H / 2 + 0.45}
          textAnchor="middle" dominantBaseline="central"
          fill={color}
          fontSize={0.32}
          fontWeight={600}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {i}
        </text>
      ))}
      <text
        x={SEGMENTS + 0.5} y={y}
        textAnchor="start" dominantBaseline="central"
        fill={color}
        fontSize={0.36}
        fontWeight={600}
        letterSpacing={0.04}
      >
        М
      </text>
    </g>
  );
}


// ---------------------------------------------------------------------------
// CAD-стиль размерная линия с засечками 45° и центрированной подписью.
// ---------------------------------------------------------------------------

function DimensionLine(props:
  | {
      orientation: "horizontal";
      x1: number; x2: number; pos: number;
      label: string; color: string;
    }
  | {
      orientation: "vertical";
      y1: number; y2: number; pos: number;
      label: string; color: string;
    }
) {
  const tick = 0.22;           // длина засечки 45°
  const dt = tick / Math.SQRT2;
  const sw = 0.045;

  if (props.orientation === "horizontal") {
    const { x1, x2, pos, label, color } = props;
    return (
      <g stroke={color} strokeWidth={sw} fill="none">
        <line x1={x1} y1={pos} x2={x2} y2={pos} />
        {/* засечки 45° на концах */}
        <line x1={x1 - dt} y1={pos - dt} x2={x1 + dt} y2={pos + dt} />
        <line x1={x2 - dt} y1={pos - dt} x2={x2 + dt} y2={pos + dt} />
        {/* подсечки-extension в сторону объекта */}
        <line x1={x1} y1={pos + 0.25} x2={x1} y2={pos - 0.25} strokeWidth={sw * 0.6} />
        <line x1={x2} y1={pos + 0.25} x2={x2} y2={pos - 0.25} strokeWidth={sw * 0.6} />
        <text
          x={(x1 + x2) / 2}
          y={pos - 0.5}
          textAnchor="middle" dominantBaseline="central"
          fill={color}
          fontSize={FONT_DIM_TEXT}
          fontWeight={600}
          letterSpacing={0.04}
          stroke="none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {label}
        </text>
      </g>
    );
  }

  const { y1, y2, pos, label, color } = props;
  return (
    <g stroke={color} strokeWidth={sw} fill="none">
      <line x1={pos} y1={y1} x2={pos} y2={y2} />
      <line x1={pos - dt} y1={y1 - dt} x2={pos + dt} y2={y1 + dt} />
      <line x1={pos - dt} y1={y2 - dt} x2={pos + dt} y2={y2 + dt} />
      <line x1={pos - 0.25} y1={y1} x2={pos + 0.25} y2={y1} strokeWidth={sw * 0.6} />
      <line x1={pos - 0.25} y1={y2} x2={pos + 0.25} y2={y2} strokeWidth={sw * 0.6} />
      <text
        x={pos - 0.55}
        y={(y1 + y2) / 2}
        textAnchor="middle" dominantBaseline="central"
        fill={color}
        fontSize={FONT_DIM_TEXT}
        fontWeight={600}
        letterSpacing={0.04}
        stroke="none"
        style={{ fontVariantNumeric: "tabular-nums" }}
        transform={`rotate(-90, ${pos - 0.55}, ${(y1 + y2) / 2})`}
      >
        {label}
      </text>
    </g>
  );
}


// ---------------------------------------------------------------------------
// FurnitureItem — стилизованная иконка мебели/сантехники
// ---------------------------------------------------------------------------

const FURN_STROKE = "#5a5a5a";
const FURN_FILL   = "#E5DBC0";
const FURN_WATER  = "#cfd8dc";
const FURN_SCREEN = "#1f2937";


function FurnitureItem({
  furn, svgX, svgY,
}: {
  furn: LayoutFurniture;
  svgX: number;       // left-X в SVG
  svgY: number;       // top-Y в SVG (после ry-инверсии)
}) {
  const { w, d, kind } = furn;
  const sw = 0.02;    // тонкие линии деталей

  const baseRect = (
    <rect
      x={svgX} y={svgY} width={w} height={d}
      fill={FURN_FILL}
      stroke={FURN_STROKE}
      strokeWidth={sw}
    />
  );

  switch (kind) {
    case "bed": {
      // S5: Кровать в Maket-стиле — две подушки + одеяло как явный блок +
      // линия валика под подушками. Голова кровати наверху (svg-Y маленький =
      // у «back» стены комнаты).
      const headerD = d * 0.22;          // зона подушек+валика (head of bed)
      const blanketY = svgY + headerD;
      const blanketD = d - headerD;

      const pillowGap = 0.06;
      const pillowW = (w * 0.85 - pillowGap) / 2;
      const pillowD = headerD * 0.65;
      const py = svgY + 0.05;
      const px1 = svgX + (w - pillowW * 2 - pillowGap) / 2;
      const px2 = px1 + pillowW + pillowGap;

      return (
        <g>
          {/* Каркас кровати */}
          {baseRect}
          {/* Одеяло — светлый прямоугольник, занимает большую часть */}
          <rect
            x={svgX + 0.04} y={blanketY}
            width={w - 0.08} height={blanketD - 0.04}
            fill="#fbfaf6"
            stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.04}
          />
          {/* Валик / складка под подушками */}
          <line
            x1={svgX + 0.06} y1={blanketY + 0.03}
            x2={svgX + w - 0.06} y2={blanketY + 0.03}
            stroke={FURN_STROKE} strokeWidth={sw * 0.7}
          />
          {/* Две подушки */}
          <rect
            x={px1} y={py} width={pillowW} height={pillowD}
            fill="#fff" stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
          <rect
            x={px2} y={py} width={pillowW} height={pillowD}
            fill="#fff" stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
        </g>
      );
    }

    case "wardrobe":
      return (
        <g>
          {baseRect}
          {/* Две створки */}
          <line
            x1={svgX + w / 2} y1={svgY}
            x2={svgX + w / 2} y2={svgY + d}
            stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "nightstand":
      return baseRect;

    case "sofa": {
      // S6: Диван в Maket-стиле — явные 3 подушки сиденья + подлокотники
      // как отдельные блоки + спинка с тенью. Спинка сверху (svg-Y маленький).
      const backD = d * 0.30;          // спинка
      const seatD = d - backD;          // сиденье
      const armW = w * 0.10;            // подлокотники
      const seatY = svgY + backD;
      const pillowGap = 0.03;
      const pillowsTotalW = w - armW * 2 - pillowGap * 4;
      const pillowW = pillowsTotalW / 3;
      const pillowD = seatD - 0.08;
      const pillowY = seatY + 0.04;
      const px1 = svgX + armW + pillowGap;
      return (
        <g>
          {/* Спинка диван */}
          <rect
            x={svgX} y={svgY} width={w} height={backD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.07}
          />
          {/* Левый подлокотник */}
          <rect
            x={svgX} y={seatY} width={armW} height={seatD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.07}
          />
          {/* Правый подлокотник */}
          <rect
            x={svgX + w - armW} y={seatY} width={armW} height={seatD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.07}
          />
          {/* 3 подушки сиденья */}
          <rect
            x={px1} y={pillowY}
            width={pillowW} height={pillowD}
            fill="#fbfaf6" stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.06}
          />
          <rect
            x={px1 + pillowW + pillowGap} y={pillowY}
            width={pillowW} height={pillowD}
            fill="#fbfaf6" stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.06}
          />
          <rect
            x={px1 + (pillowW + pillowGap) * 2} y={pillowY}
            width={pillowW} height={pillowD}
            fill="#fbfaf6" stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.06}
          />
        </g>
      );
    }

    case "coffee_table": {
      // S6: журнальный столик — закруглённый rect + 4 декоративных угла
      // (видно как detalia сверху).
      return (
        <g>
          <rect
            x={svgX} y={svgY} width={w} height={d}
            fill={FURN_FILL}
            stroke={FURN_STROKE}
            strokeWidth={sw}
            rx={0.10}
          />
          {/* Внутренняя рамка-намёк на стеклянную столешницу */}
          <rect
            x={svgX + 0.06} y={svgY + 0.06}
            width={w - 0.12} height={d - 0.12}
            fill="none"
            stroke={FURN_STROKE}
            strokeWidth={sw * 0.6}
            rx={0.07}
          />
        </g>
      );
    }

    case "armchair": {
      // S6: Кресло — упрощённый диван-моно (1 подушка + подлокотники + спинка).
      const backD = d * 0.32;
      const seatD = d - backD;
      const armW = w * 0.15;
      const seatY = svgY + backD;
      const pillowD = seatD - 0.06;
      return (
        <g>
          {/* Спинка */}
          <rect
            x={svgX} y={svgY} width={w} height={backD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw} rx={0.06}
          />
          {/* Подлокотники */}
          <rect
            x={svgX} y={seatY} width={armW} height={seatD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
          <rect
            x={svgX + w - armW} y={seatY} width={armW} height={seatD}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
          {/* Подушка сиденья */}
          <rect
            x={svgX + armW + 0.02} y={seatY + 0.03}
            width={w - armW * 2 - 0.04} height={pillowD}
            fill="#fbfaf6" stroke={FURN_STROKE} strokeWidth={sw} rx={0.05}
          />
        </g>
      );
    }

    case "tv":
      return (
        <rect
          x={svgX} y={svgY} width={w} height={d}
          fill={FURN_SCREEN}
          stroke={FURN_STROKE}
          strokeWidth={sw}
        />
      );

    case "kitchen_counter": {
      // S7: Непрерывная кухонная столешница. Холодильник/плита/мойка
      // отрисуются поверх (они идут после в массиве items).
      // Светлая заливка под цвет столешницы + тонкая обводка фасада.
      return (
        <g>
          <rect
            x={svgX} y={svgY} width={w} height={d}
            fill="#EFE7D2"
            stroke={FURN_STROKE}
            strokeWidth={sw}
          />
        </g>
      );
    }

    case "stove": {
      // Конфорки — 4 круга по углам
      const cr = Math.min(w, d) * 0.13;
      const ox = w * 0.27;
      const oy = d * 0.27;
      return (
        <g>
          {baseRect}
          <circle cx={svgX + ox} cy={svgY + oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + w - ox} cy={svgY + oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + ox} cy={svgY + d - oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
          <circle cx={svgX + w - ox} cy={svgY + d - oy} r={cr} fill="none" stroke={FURN_STROKE} strokeWidth={sw} />
        </g>
      );
    }

    case "sink": {
      const insetW = w * 0.78;
      const insetD = d * 0.65;
      const ix = svgX + (w - insetW) / 2;
      const iy = svgY + (d - insetD) / 2;
      return (
        <g>
          {baseRect}
          <rect
            x={ix} y={iy} width={insetW} height={insetD}
            fill={FURN_WATER}
            stroke={FURN_STROKE} strokeWidth={sw}
            rx={0.08} ry={0.08}
          />
        </g>
      );
    }

    case "fridge":
      return (
        <g>
          {baseRect}
          {/* Дверь морозильника отделена линией наверху */}
          <line
            x1={svgX} y1={svgY + d * 0.3}
            x2={svgX + w} y2={svgY + d * 0.3}
            stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "dining_table":
      return (
        <rect
          x={svgX} y={svgY} width={w} height={d}
          fill="none"
          stroke={FURN_STROKE} strokeWidth={sw}
          rx={0.05} ry={0.05}
        />
      );

    case "bathtub":
      return (
        <g>
          <rect
            x={svgX} y={svgY} width={w} height={d}
            fill={FURN_WATER}
            stroke={FURN_STROKE} strokeWidth={sw}
            rx={d * 0.35} ry={d * 0.35}
          />
          {/* Слив — кружок */}
          <circle
            cx={svgX + w * 0.85} cy={svgY + d * 0.5}
            r={d * 0.08}
            fill="none" stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );

    case "toilet": {
      // Бачок наверху + чаша унитаза снизу
      const tankH = d * 0.32;
      const bowlH = d - tankH;
      return (
        <g>
          {/* Бачок */}
          <rect
            x={svgX} y={svgY} width={w} height={tankH}
            fill={FURN_FILL} stroke={FURN_STROKE} strokeWidth={sw}
          />
          {/* Чаша */}
          <ellipse
            cx={svgX + w / 2} cy={svgY + tankH + bowlH / 2}
            rx={w / 2 - sw} ry={bowlH / 2 - sw}
            fill={FURN_WATER} stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );
    }

    case "washbasin": {
      // Тумба + чаша внутри
      const bowlW = w * 0.72;
      const bowlD = d * 0.65;
      const bx = svgX + (w - bowlW) / 2;
      const by = svgY + (d - bowlD) / 2;
      return (
        <g>
          {baseRect}
          <ellipse
            cx={bx + bowlW / 2} cy={by + bowlD / 2}
            rx={bowlW / 2} ry={bowlD / 2}
            fill={FURN_WATER} stroke={FURN_STROKE} strokeWidth={sw}
          />
        </g>
      );
    }

    case "armchair":
      return (
        <g>
          {baseRect}
          {/* Спинка */}
          <line x1={svgX} y1={svgY + d * 0.25}
                x2={svgX + w} y2={svgY + d * 0.25}
                stroke={FURN_STROKE} strokeWidth={sw} />
        </g>
      );

    default:
      return baseRect;
  }
}


function upperCaseRoom(nameRu: string, kind: string): string {
  const trimmed = (nameRu || "").trim();
  if (trimmed) return trimmed.toUpperCase();
  return ROOM_LABEL_FALLBACK_RU[kind] ?? kind.toUpperCase();
}


// ---------------------------------------------------------------------------
// WindowSymbol — окно как разрыв стены + двойная линия по центру (стеклопакет)
// ---------------------------------------------------------------------------

type SymbolProps = {
  rx: number;          // абсолютный X левой кромки комнаты в системе здания (м)
  archY: number;       // абсолютный архитектурный Y нижней кромки комнаты
  rw: number;          // ширина комнаты по X (м)
  rd: number;          // глубина комнаты по Y (м)
  ry: (archY: number, h?: number) => number;
};


function WindowSymbol({
  rx, archY, rw, rd, win, ry,
}: SymbolProps & { win: LayoutWindow }) {
  const { p1, p2, horizontal } = wallSegment(win.side, win.offset, win.width, rx, archY, rw, rd, ry);
  // Окна архитектурно ставятся на ВНЕШНЮЮ стену — используем её реальную
  // толщину для визуальной читаемости стеклопакета, а не тонкую перегородку.
  const wallT = WALL_EXTERIOR;
  // Окно: белый «вырез» в стене + две параллельные линии (символ стеклопакета)
  // gap ~70% толщины стены чтобы две линии явно читались как окно.
  const gap = wallT * 0.7;
  const stroke = 0.05;                 // толще чем перегородка — окно «звенит»
  if (horizontal) {
    const wy = (p1.y + p2.y) / 2;
    return (
      <g>
        <rect
          x={Math.min(p1.x, p2.x)} y={wy - wallT / 2}
          width={Math.abs(p2.x - p1.x)} height={wallT}
          fill={CANVAS_BG} stroke="none"
        />
        <line x1={p1.x} y1={wy - gap / 2} x2={p2.x} y2={wy - gap / 2} stroke={WALL_COLOR} strokeWidth={stroke} />
        <line x1={p1.x} y1={wy + gap / 2} x2={p2.x} y2={wy + gap / 2} stroke={WALL_COLOR} strokeWidth={stroke} />
      </g>
    );
  }
  const wx = (p1.x + p2.x) / 2;
  return (
    <g>
      <rect
        x={wx - wallT / 2} y={Math.min(p1.y, p2.y)}
        width={wallT} height={Math.abs(p2.y - p1.y)}
        fill={CANVAS_BG} stroke="none"
      />
      <line x1={wx - gap / 2} y1={p1.y} x2={wx - gap / 2} y2={p2.y} stroke={WALL_COLOR} strokeWidth={stroke} />
      <line x1={wx + gap / 2} y1={p1.y} x2={wx + gap / 2} y2={p2.y} stroke={WALL_COLOR} strokeWidth={stroke} />
    </g>
  );
}


// ---------------------------------------------------------------------------
// DoorSymbol — дверь как разрыв стены + дуга 90° (траектория открывания)
// ---------------------------------------------------------------------------

function DoorSymbol({
  rx, archY, rw, rd, door, ry,
}: SymbolProps & { door: LayoutDoor }) {
  const { p1, p2, horizontal, inward } = wallSegment(
    door.side, door.offset, door.width, rx, archY, rw, rd, ry,
  );
  const wallT = WALL_PARTITION;

  // Петля и противоположный конец проёма.
  // door.hinge = "left" → петля на той точке, которая ближе к началу offset'а.
  // wallSegment возвращает p1 как «начальный конец» (соответствует offset),
  // p2 — как «дальний конец» (offset + width).
  const hinge = door.hinge === "left" ? p1 : p2;
  const opposite = door.hinge === "left" ? p2 : p1;
  const doorLen = door.width;

  // Открытое положение полотна: на 90° от стены вглубь комнаты.
  // inward.dx/dy — единичный вектор «внутрь комнаты» относительно стены.
  const open = {
    x: hinge.x + inward.dx * doorLen,
    y: hinge.y + inward.dy * doorLen,
  };

  // Дуга от opposite (closed) до open (open). Радиус = doorLen, центр в hinge.
  const arcLargeFlag = 0;     // 90° — малая дуга
  const arcSweepFlag = computeSweep(hinge, opposite, open);

  // Вырез в стене (белый прямоугольник в проёме)
  let cutout: ReactElement;
  if (horizontal) {
    const wy = (p1.y + p2.y) / 2;
    cutout = (
      <rect
        x={Math.min(p1.x, p2.x)} y={wy - wallT / 2}
        width={Math.abs(p2.x - p1.x)} height={wallT}
        fill={CANVAS_BG} stroke="none"
      />
    );
  } else {
    const wx = (p1.x + p2.x) / 2;
    cutout = (
      <rect
        x={wx - wallT / 2} y={Math.min(p1.y, p2.y)}
        width={wallT} height={Math.abs(p2.y - p1.y)}
        fill={CANVAS_BG} stroke="none"
      />
    );
  }

  return (
    <g stroke={WALL_COLOR} strokeWidth={0.06} fill="none" strokeLinecap="round">
      {cutout}
      {/* S4: Дуга открывания — сплошная и чёткая (как в Maket) */}
      <path
        d={`M ${opposite.x} ${opposite.y} A ${doorLen} ${doorLen} 0 ${arcLargeFlag} ${arcSweepFlag} ${open.x} ${open.y}`}
        strokeWidth={0.045}
      />
      {/* Полотно двери в открытом положении — жирнее, читается издалека */}
      <line x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} strokeWidth={0.085} />
    </g>
  );
}


// ---------------------------------------------------------------------------
// wallSegment — выдаёт 2 точки SVG-сегмента стены + ориентацию +
// единичный вектор «внутрь комнаты» (для дуги двери).
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

function wallSegment(
  side: LayoutSide,
  offset: number,
  width: number,
  rx: number,
  archY: number,
  rw: number,
  rd: number,
  ry: (archY: number, h?: number) => number,
): { p1: Pt; p2: Pt; horizontal: boolean; inward: { dx: number; dy: number } } {
  switch (side) {
    case "S":
      return {
        p1: { x: rx + offset,         y: ry(archY) },
        p2: { x: rx + offset + width, y: ry(archY) },
        horizontal: true,
        inward: { dx: 0, dy: -1 },   // внутрь комнаты вверх в SVG = -1 по Y
      };
    case "N":
      return {
        p1: { x: rx + offset,         y: ry(archY + rd) },
        p2: { x: rx + offset + width, y: ry(archY + rd) },
        horizontal: true,
        inward: { dx: 0, dy: +1 },
      };
    case "W":
      return {
        p1: { x: rx, y: ry(archY + offset) },
        p2: { x: rx, y: ry(archY + offset + width) },
        horizontal: false,
        inward: { dx: +1, dy: 0 },
      };
    case "E":
      return {
        p1: { x: rx + rw, y: ry(archY + offset) },
        p2: { x: rx + rw, y: ry(archY + offset + width) },
        horizontal: false,
        inward: { dx: -1, dy: 0 },
      };
  }
}


/** SVG arc sweep-flag — 1 если идём по часовой стрелке от p1 до p2 при
 *  взгляде из центра, иначе 0. Для двери: дуга от closed к open. */
function computeSweep(center: Pt, from: Pt, to: Pt): number {
  // Cross product (from-center) × (to-center). В SVG Y растёт вниз,
  // поэтому положительный cross = против часовой → sweepFlag=0.
  const cross = (from.x - center.x) * (to.y - center.y)
              - (from.y - center.y) * (to.x - center.x);
  return cross > 0 ? 0 : 1;
}


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function totalApartments(layout: LayoutFloor): number {
  return layout.sections.reduce((s, sec) => s + sec.apartments.length, 0);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
