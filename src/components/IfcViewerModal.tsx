"use client";

// Полноэкранный модал с 3D-просмотром IFC + UX (Phase 4):
//   - клик по объекту → sidebar с типом/именем элемента
//   - кнопка / hotkey `T` — мгновенный вид сверху (как 2D-план)
//   - кнопка / hotkey `F` — fit camera на bbox (вернуть начальный ракурс)
//   - hotkey `X` — toggle полупрозрачные стены (видеть планировку насквозь)
//   - hotkey `?` — overlay со списком клавиш
//
// Под капотом: bare three.js + web-ifc (см. Phase 2). IfcSpace рендерятся
// с opacity=0 (невидимы, но raycastable) — клик в пустую комнату ловит
// её IfcSpace и показывает имя «Спальня (кв.3 1К)».

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Download, Loader2, Eye, EyeOff, ArrowDown, Maximize2, HelpCircle,
} from "lucide-react";

export type IfcViewerModalProps = {
  open: boolean;
  onClose: () => void;
  onDownload?: () => void;
  getIfcBytes: () => Promise<Uint8Array>;
  modelName?: string;
};

type SelectedElement = {
  type: string;
  name: string;
  expressID: number;
};

const PICKABLE_TYPES = ["IfcSpace", "IfcDoor", "IfcWindow", "IfcStair", "IfcWall", "IfcSlab"];

export function IfcViewerModal({
  open, onClose, onDownload, getIfcBytes, modelName,
}: IfcViewerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // three.js handles (хранятся вне React-рендера)
  const handlesRef = useRef<{
    THREE: typeof import("three");
    scene: import("three").Scene;
    camera: import("three").PerspectiveCamera;
    renderer: import("three").WebGLRenderer;
    controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
    root: import("three").Group;
    bbox: import("three").Box3;
  } | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<{ size: [number, number, number]; meshes: number } | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // ── camera presets ───────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const h = handlesRef.current;
    if (!h) return;
    const center = h.bbox.getCenter(new h.THREE.Vector3());
    const size = h.bbox.getSize(new h.THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.4;
    h.camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
    h.camera.up.set(0, 1, 0);
    h.controls.target.copy(center);
    h.controls.update();
  }, []);

  const topDownView = useCallback(() => {
    const h = handlesRef.current;
    if (!h) return;
    const center = h.bbox.getCenter(new h.THREE.Vector3());
    const size = h.bbox.getSize(new h.THREE.Vector3());
    // top-down: камера прямо сверху (Y+), смотрит вниз
    const dist = Math.max(size.x, size.z) * 0.9;
    h.camera.position.set(center.x, center.y + dist, center.z + 0.001); // tiny z offset чтобы избежать gimbal lock
    h.camera.up.set(0, 0, -1);
    h.controls.target.copy(center);
    h.controls.update();
  }, []);

  // ── transparency toggle (стены полупрозрачные) ───────────────────────
  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    h.root.traverse((obj) => {
      const mesh = obj as import("three").Mesh;
      if (!mesh.isMesh) return;
      const t = mesh.userData.ifcType as string | undefined;
      if (t !== "IfcWall" && t !== "IfcSlab") return;
      const mat = mesh.material as import("three").MeshLambertMaterial;
      mat.transparent = transparent;
      mat.opacity = transparent ? 0.25 : 1.0;
      mat.depthWrite = !transparent;
      mat.needsUpdate = true;
    });
  }, [transparent, status]);

  // ── hotkeys ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Игнорируем когда фокус в input/textarea (на всякий)
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (selected) setSelected(null);
        else onClose();
      } else if (e.key === "f" || e.key === "F") fitView();
      else if (e.key === "t" || e.key === "T") topDownView();
      else if (e.key === "x" || e.key === "X") setTransparent(t => !t);
      else if (e.key === "?") setHelpOpen(h => !h);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, fitView, topDownView, helpOpen, selected]);

  // ── основная инициализация three.js + web-ifc ────────────────────────
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const container = containerRef.current;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    async function init() {
      setStatus("loading");
      setErrorMsg(null);
      setStats(null);
      setSelected(null);

      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const WebIFC = await import("web-ifc");
        if (cancelled) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x14181f);

        const w = container.clientWidth;
        const h = container.clientHeight;
        const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 5000);
        camera.position.set(40, 40, 40);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(w, h);
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dir = new THREE.DirectionalLight(0xffffff, 0.85);
        dir.position.set(50, 80, 30);
        scene.add(dir);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
        dir2.position.set(-40, 30, -40);
        scene.add(dir2);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        const onResize = () => {
          const W = container.clientWidth;
          const H = container.clientHeight;
          renderer.setSize(W, H);
          camera.aspect = W / H;
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(container);

        let stop = false;
        const tick = () => {
          if (stop) return;
          controls.update();
          renderer.render(scene, camera);
          requestAnimationFrame(tick);
        };
        tick();

        // ── Парсим IFC ────────────────────────────────────────────────
        const api = new WebIFC.IfcAPI();
        api.SetWasmPath("/wasm/", true);
        await api.Init();
        if (cancelled) return;

        const bytes = await getIfcBytes();
        if (cancelled) return;

        const modelID = api.OpenModel(bytes);

        const colorByType: Record<string, number> = {
          IfcSlab:    0xb0b8c5,
          IfcWall:    0xdadde3,
          IfcWindow:  0x6cb6f5,
          IfcDoor:    0xb88a55,
          IfcStair:   0x9aa3b3,
          IfcSpace:   0x4a90e2, // невидимый, цвет неважен
        };

        // Соберём type и Name по expressID
        const meta = new Map<number, { type: string; name: string }>();
        for (const typeName of Object.keys(colorByType)) {
          const ifcType = (WebIFC as unknown as Record<string, number>)[typeName.toUpperCase()];
          if (ifcType === undefined) continue;
          const ids = api.GetLineIDsWithType(modelID, ifcType);
          for (let k = 0; k < ids.size(); k++) {
            const id = ids.get(k);
            let name = "";
            try {
              const line = api.GetLine(modelID, id) as { Name?: { value?: string } };
              name = line.Name?.value ?? "";
            } catch { /* ignore */ }
            meta.set(id, { type: typeName, name });
          }
        }

        const root = new THREE.Group();
        let meshCount = 0;

        const flatMeshes = api.LoadAllGeometry(modelID);
        for (let i = 0; i < flatMeshes.size(); i++) {
          if (cancelled) break;
          const flatMesh = flatMeshes.get(i);
          const exprID = flatMesh.expressID;
          const info = meta.get(exprID) ?? { type: "?", name: "" };
          const color = colorByType[info.type] ?? 0xcccccc;
          const isSpace = info.type === "IfcSpace";

          const placedGeoms = flatMesh.geometries;
          for (let j = 0; j < placedGeoms.size(); j++) {
            const placed = placedGeoms.get(j);
            const geom = api.GetGeometry(modelID, placed.geometryExpressID);
            const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()) as Float32Array;
            const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize()) as Uint32Array;

            const vCount = verts.length / 6;
            const positions = new Float32Array(vCount * 3);
            const normals = new Float32Array(vCount * 3);
            for (let v = 0; v < vCount; v++) {
              positions[v * 3]     = verts[v * 6];
              positions[v * 3 + 1] = verts[v * 6 + 1];
              positions[v * 3 + 2] = verts[v * 6 + 2];
              normals[v * 3]     = verts[v * 6 + 3];
              normals[v * 3 + 1] = verts[v * 6 + 4];
              normals[v * 3 + 2] = verts[v * 6 + 5];
            }
            const bufGeom = new THREE.BufferGeometry();
            bufGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            bufGeom.setAttribute("normal",   new THREE.BufferAttribute(normals, 3));
            bufGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

            const matrix = new THREE.Matrix4();
            matrix.fromArray(placed.flatTransformation);

            // IfcSpace: невидимый, но raycastable (opacity=0 transparent)
            const material = new THREE.MeshLambertMaterial({
              color,
              transparent: isSpace,
              opacity: isSpace ? 0 : 1,
              depthWrite: !isSpace,
            });
            const mesh = new THREE.Mesh(bufGeom, material);
            mesh.applyMatrix4(matrix);
            mesh.userData.expressID = exprID;
            mesh.userData.ifcType = info.type;
            mesh.userData.name = info.name;
            root.add(mesh);
            meshCount += 1;

            (geom as { delete?: () => void }).delete?.();
          }
        }
        api.CloseModel(modelID);
        (flatMeshes as { delete?: () => void }).delete?.();

        if (cancelled) return;

        root.rotation.x = -Math.PI / 2;
        scene.add(root);

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        const dist = maxDim * 1.4;
        camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
        controls.target.copy(center);
        controls.update();

        // ── picking: click → раскастер ────────────────────────────────
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let dragStart: { x: number; y: number } | null = null;
        const onPointerDown = (e: PointerEvent) => {
          dragStart = { x: e.clientX, y: e.clientY };
        };
        const onPointerUp = (e: PointerEvent) => {
          if (!dragStart) return;
          const dx = Math.abs(e.clientX - dragStart.x);
          const dy = Math.abs(e.clientY - dragStart.y);
          dragStart = null;
          if (dx > 4 || dy > 4) return; // это был drag, не клик
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const hits = raycaster.intersectObjects(root.children, false);
          if (hits.length === 0) {
            setSelected(null);
            return;
          }
          // Берём ближайший hit среди pickable-типов
          const picked = hits.find(h =>
            PICKABLE_TYPES.includes(h.object.userData.ifcType as string)
          ) ?? hits[0];
          setSelected({
            type: picked.object.userData.ifcType ?? "?",
            name: picked.object.userData.name ?? "(без имени)",
            expressID: picked.object.userData.expressID ?? 0,
          });
        };
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointerup", onPointerUp);

        // Сохраняем handles для callback'ов
        handlesRef.current = { THREE, scene, camera, renderer, controls, root, bbox: box };

        setStats({ size: [size.x, size.y, size.z], meshes: meshCount });
        setStatus("ready");

        cleanup = () => {
          stop = true;
          ro.disconnect();
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          controls.dispose();
          renderer.dispose();
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement);
          }
          root.traverse((obj) => {
            const mesh = obj as import("three").Mesh;
            if (mesh.isMesh) {
              mesh.geometry.dispose();
              if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
              else (mesh.material as import("three").Material).dispose();
            }
          });
          handlesRef.current = null;
        };
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [open, getIfcBytes, modelName]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col">
      <header className="h-12 px-4 flex items-center justify-between border-b border-white/[0.08] bg-black/40">
        <div className="flex items-center gap-3 text-white/85 text-[13px]">
          <span className="font-medium">3D-просмотр IFC</span>
          {modelName && <span className="text-white/40">· {modelName}</span>}
          {stats && (
            <span className="text-white/40 text-[11.5px]">
              · {stats.size[0].toFixed(1)} × {stats.size[1].toFixed(1)} × {stats.size[2].toFixed(1)} м · {stats.meshes} объектов
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={topDownView}
            disabled={status !== "ready"}
            className="h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-white/15 text-white/80 hover:bg-white/[0.08] hover:text-white disabled:opacity-40 transition"
            title="Вид сверху (T)"
          >
            <ArrowDown size={11} /> Top
          </button>
          <button
            onClick={fitView}
            disabled={status !== "ready"}
            className="h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-white/15 text-white/80 hover:bg-white/[0.08] hover:text-white disabled:opacity-40 transition"
            title="Вписать в кадр (F)"
          >
            <Maximize2 size={11} /> Fit
          </button>
          <button
            onClick={() => setTransparent(t => !t)}
            disabled={status !== "ready"}
            className={[
              "h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border transition disabled:opacity-40",
              transparent
                ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                : "border-white/15 text-white/80 hover:bg-white/[0.08] hover:text-white",
            ].join(" ")}
            title="Прозрачные стены (X)"
          >
            {transparent ? <EyeOff size={11} /> : <Eye size={11} />}
            {transparent ? "Сквозь" : "Стены"}
          </button>
          <button
            onClick={() => setHelpOpen(h => !h)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition"
            title="Горячие клавиши (?)"
          >
            <HelpCircle size={14} />
          </button>
          {onDownload && (
            <button
              onClick={onDownload}
              disabled={status !== "ready"}
              className="h-8 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-cyan-400/30 text-cyan-200/90 hover:bg-cyan-500/15 hover:text-white disabled:opacity-40 transition"
            >
              <Download size={11} /> Скачать .ifc
            </button>
          )}
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition"
            title="Закрыть (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="relative flex-1 flex">
        <div ref={containerRef} className="flex-1 relative">
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-[13px] gap-2 pointer-events-none">
              <Loader2 size={16} className="animate-spin" /> Загружаем 3D-модель…
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12.5px] text-red-200">
                <div className="font-medium mb-1">Не удалось загрузить IFC</div>
                <div className="text-red-200/80">{errorMsg}</div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar с информацией о выбранном элементе */}
        {selected && (
          <aside className="w-72 border-l border-white/[0.08] bg-black/40 backdrop-blur-sm flex flex-col">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-[12px] uppercase tracking-wider text-white/40">Элемент</span>
              <button
                onClick={() => setSelected(null)}
                className="h-6 w-6 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition"
                title="Снять выделение (Esc)"
              >
                <X size={12} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-3 text-[12.5px]">
              <div>
                <div className="text-white/40 text-[10.5px] uppercase tracking-wider mb-1">Тип</div>
                <div className="text-white/90 font-mono">{selected.type}</div>
              </div>
              <div>
                <div className="text-white/40 text-[10.5px] uppercase tracking-wider mb-1">Название</div>
                <div className="text-white/90">{selected.name || <span className="text-white/40 italic">(без имени)</span>}</div>
              </div>
              <div>
                <div className="text-white/40 text-[10.5px] uppercase tracking-wider mb-1">Express ID</div>
                <div className="text-white/60 font-mono text-[11px]">#{selected.expressID}</div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Hotkey overlay */}
      {helpOpen && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="rounded-xl border border-white/[0.1] bg-zinc-900/95 px-6 py-5 max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-medium text-white/90 mb-3">Горячие клавиши</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">T</kbd>
              <span className="text-white/70">Вид сверху</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">F</kbd>
              <span className="text-white/70">Вписать в кадр</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">X</kbd>
              <span className="text-white/70">Прозрачные стены</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">?</kbd>
              <span className="text-white/70">Это меню</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">Esc</kbd>
              <span className="text-white/70">Закрыть (выделение → меню → вьюер)</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">Click</kbd>
              <span className="text-white/70">Инфо об объекте</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">Wheel</kbd>
              <span className="text-white/70">Зум</span>
              <kbd className="px-2 py-0.5 rounded bg-white/[0.08] text-white/80 font-mono text-[11px] text-center">Drag</kbd>
              <span className="text-white/70">Вращение / pan</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
