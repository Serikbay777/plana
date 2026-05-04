"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Plan, Polygon } from "@/lib/engine";
import { APT_COLORS } from "@/lib/engine";

// ── helpers ──────────────────────────────────────────────────────────────────

function polygonToShape(poly: Polygon): THREE.Shape {
  const shape = new THREE.Shape();
  const pts = poly.exterior;
  if (!pts.length) return shape;
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
  shape.closePath();
  return shape;
}

function bbox(poly: Polygon) {
  const xs = poly.exterior.map((p) => p.x);
  const ys = poly.exterior.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    minX, maxX, minY, maxY,
    w: maxX - minX,
    d: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function stdMat(
  color: number | string,
  roughness = 0.8,
  metalness = 0.05,
  opacity = 1,
  emissive: number | string = 0x000000,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness, metalness,
    transparent: opacity < 1, opacity,
    emissive: new THREE.Color(emissive),
    emissiveIntensity,
  });
}

function extrude(
  shape: THREE.Shape,
  depth: number,
  material: THREE.Material,
  zOffset = 0,
  castShadow = true,
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.z = zOffset;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

// ── public API ───────────────────────────────────────────────────────────────

export type SceneMode = "day" | "night";
export type CameraPreset = "iso" | "top" | "front" | "side";
export type ViewMode = "exterior" | "lobby";

export type PlanCanvas3DHandle = {
  setMode: (mode: SceneMode) => void;
  setAutoRotate: (on: boolean) => void;
  /** 1..floors — сколько этажей показывать (срез сверху) */
  setVisibleFloors: (n: number) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  /** PNG dataURL текущего кадра */
  screenshot: () => string;
  /** Переход между уровнями (наружный вид / лобби / ...) */
  setView: (view: ViewMode) => void;
  /** Текущий уровень. Полезно для UI после анимации переходов. */
  getView: () => ViewMode;
};

export type PlanCanvas3DProps = {
  plan: Plan;
  floors: number;
  aiPlanImageUrl?: string;
  initialMode?: SceneMode;
  initialAutoRotate?: boolean;
  /** Сколько этажей показать сразу после сборки (по умолчанию все). */
  initialVisibleFloors?: number;
};

// ── component ────────────────────────────────────────────────────────────────

export const PlanCanvas3D = forwardRef<PlanCanvas3DHandle, PlanCanvas3DProps>(
  function PlanCanvas3D(
    {
      plan, floors, aiPlanImageUrl,
      initialMode = "night",
      initialAutoRotate = true,
      initialVisibleFloors,
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<PlanCanvas3DHandle | null>(null);

    useImperativeHandle(ref, () => ({
      setMode: (m) => apiRef.current?.setMode(m),
      setAutoRotate: (on) => apiRef.current?.setAutoRotate(on),
      setVisibleFloors: (n) => apiRef.current?.setVisibleFloors(n),
      setCameraPreset: (p) => apiRef.current?.setCameraPreset(p),
      screenshot: () => apiRef.current?.screenshot() ?? "",
      setView: (v) => apiRef.current?.setView(v),
      getView: () => apiRef.current?.getView() ?? "exterior",
    }), []);

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const W = mount.clientWidth || 900;
      const H = mount.clientHeight || 620;
      const FH = 3.15;
      const TOTAL = floors * FH;
      const bb = bbox(plan.floor_polygon);
      const { cx, cy } = bb;
      const diag = Math.sqrt(bb.w ** 2 + bb.d ** 2);

      // ── renderer ──────────────────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true, // нужно для screenshot()
      });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;
      renderer.localClippingEnabled = true;
      mount.appendChild(renderer.domElement);

      // Плоскость отсечения для среза этажей. Нормаль вниз, всё что ниже плоскости — видимо.
      // plane: dot(n, p) + c >= 0 → видимо. n=(0,0,-1), c = h → -z + h >= 0 → z <= h.
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), TOTAL + 100);

      // ── scene ─────────────────────────────────────────────────────────────
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x060914);
      scene.fog = new THREE.FogExp2(0x060914, 0.004);

      // Группы под уровни walkthrough'а. Лайты остаются в scene (общие).
      const exteriorGroup = new THREE.Group();
      const lobbyGroup = new THREE.Group();
      scene.add(exteriorGroup);
      scene.add(lobbyGroup);
      lobbyGroup.visible = false;

      // ── camera ────────────────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 800);
      const camDist = diag * 1.15 + TOTAL * 0.85;
      const isoPos: [number, number, number] = [
        cx + camDist * 0.6, cy - camDist * 1.0, TOTAL * 1.55,
      ];
      camera.position.set(...isoPos);
      camera.up.set(0, 0, 1);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(cx, cy, TOTAL * 0.40);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 10;
      controls.maxDistance = 600;
      controls.maxPolarAngle = Math.PI / 2.06;
      controls.autoRotate = initialAutoRotate;
      controls.autoRotateSpeed = 0.4;
      camera.lookAt(controls.target);
      controls.update();

      // ── lights (создаём ОБА набора, потом включаем нужный) ────────────────
      // Ночные источники
      const hemiNight = new THREE.HemisphereLight(0x1a2a4a, 0x080810, 0.5);
      const moon = new THREE.DirectionalLight(0x7090d0, 1.4);
      moon.position.set(cx - 120, cy + 80, 200);
      moon.castShadow = true;
      moon.shadow.mapSize.set(2048, 2048);
      const moonSc = moon.shadow.camera as THREE.OrthographicCamera;
      const r = diag + 40;
      moonSc.left = moonSc.bottom = -r; moonSc.right = moonSc.top = r;
      moonSc.near = 1; moonSc.far = 800;
      const warmAccent = new THREE.DirectionalLight(0xff8844, 0.55);
      warmAccent.position.set(cx + 80, cy - 60, 60);

      // Дневные источники
      const hemiDay = new THREE.HemisphereLight(0xbfd9ff, 0x6b6b5c, 1.0);
      const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
      sun.position.set(cx + 60, cy + 80, 220);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sunSc = sun.shadow.camera as THREE.OrthographicCamera;
      sunSc.left = sunSc.bottom = -r; sunSc.right = sunSc.top = r;
      sunSc.near = 1; sunSc.far = 800;

      scene.add(hemiNight, moon, warmAccent, hemiDay, sun);

      // Точечные «земляные» огни — только ночь
      const groundGlow1 = new THREE.PointLight(0x4466ff, 3.5, 35);
      groundGlow1.position.set(bb.minX - 3, bb.minY - 3, 1);
      const groundGlow2 = new THREE.PointLight(0x3355ee, 2.5, 30);
      groundGlow2.position.set(bb.maxX + 3, bb.maxY + 3, 1);
      scene.add(groundGlow1, groundGlow2);

      const floorLights: THREE.PointLight[] = [];
      for (let f = 0; f < floors; f += 3) {
        const fl = new THREE.PointLight(0xffcc88, 1.8, 20);
        fl.position.set(cx, cy, f * FH + FH * 0.5);
        scene.add(fl);
        floorLights.push(fl);
      }

      // ── звёзды (только ночь) ──────────────────────────────────────────────
      const starCount = 2200;
      const starPos = new Float32Array(starCount * 3);
      const starSphere = 450;
      for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPos[i * 3]     = starSphere * Math.sin(phi) * Math.cos(theta) + cx;
        starPos[i * 3 + 1] = starSphere * Math.sin(phi) * Math.sin(theta) + cy;
        starPos[i * 3 + 2] = Math.abs(starSphere * Math.cos(phi));
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true });
      const stars = new THREE.Points(starGeo, starMat);
      scene.add(stars);

      // ── земля ─────────────────────────────────────────────────────────────
      const gndMat = stdMat(0x090c16, 0.18, 0.35);
      const gnd = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), gndMat);
      gnd.position.set(cx, cy, -0.02);
      gnd.receiveShadow = true;
      scene.add(gnd);

      // Свечение от земли (ночное)
      const glowRing = new THREE.Mesh(
        new THREE.PlaneGeometry(bb.w + 12, bb.d + 12, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x1a2860, transparent: true, opacity: 0.18 }),
      );
      glowRing.position.set(cx, cy, 0.01);
      scene.add(glowRing);

      // Контур здания на земле (неоновая обводка, только ночь)
      const footPts = [
        ...plan.floor_polygon.exterior.map((p) => new THREE.Vector3(p.x, p.y, 0.08)),
      ];
      footPts.push(footPts[0]);
      const footLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(footPts),
        new THREE.LineBasicMaterial({ color: 0x4455ff }),
      );
      scene.add(footLine);

      // Сетка
      const grid = new THREE.GridHelper(500, 60, 0x151828, 0x101522);
      grid.position.set(cx, cy, 0.03);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);

      // ── материалы здания (с клиппингом для среза) ─────────────────────────
      const clipPlanes = [clipPlane];
      const bodyMat = stdMat(0x1c2030, 0.65, 0.15);
      bodyMat.clippingPlanes = clipPlanes;
      const wrapMat = stdMat(0x2244aa, 0.05, 0.6, 0.12);
      wrapMat.clippingPlanes = clipPlanes;
      const slabMat = stdMat(0x0e111e, 0.85, 0.2);
      slabMat.clippingPlanes = clipPlanes;
      const edgeMat = stdMat(0x2233aa, 0.1, 0.8, 1, 0x112299, 0.4);
      edgeMat.clippingPlanes = clipPlanes;
      const lobbyGlassMat = stdMat(0x1a3060, 0.04, 0.7, 0.55, 0x4488ff, 0.15);
      lobbyGlassMat.clippingPlanes = clipPlanes;
      const coreMat = stdMat(0x0a0c14, 0.6, 0.25);
      coreMat.clippingPlanes = clipPlanes;
      const parapetMat = stdMat(0x141826, 0.7, 0.2, 1, 0x2233aa, 0.12);
      parapetMat.clippingPlanes = clipPlanes;

      const bldShape = polygonToShape(plan.floor_polygon);

      // Корпус и стеклянная плёнка
      scene.add(extrude(bldShape, TOTAL, bodyMat));
      scene.add(extrude(bldShape, TOTAL, wrapMat));

      // Перекрытия — отслеживаем по этажу
      const slabMeshes: THREE.Mesh[] = [];
      for (let f = 1; f <= floors; f++) {
        const s = extrude(bldShape, 0.28, slabMat, f * FH - 0.28, false);
        s.receiveShadow = true;
        s.userData.floor = f;
        scene.add(s);
        slabMeshes.push(s);
      }

      // Угловые акценты
      const corners = [
        { x: bb.minX, y: bb.minY },
        { x: bb.maxX, y: bb.minY },
        { x: bb.maxX, y: bb.maxY },
        { x: bb.minX, y: bb.maxY },
      ];
      const edgeW = 0.35;
      for (const c of corners) {
        const edgeMesh = new THREE.Mesh(
          new THREE.BoxGeometry(edgeW, edgeW, TOTAL + 1.2),
          edgeMat,
        );
        edgeMesh.position.set(c.x, c.y, TOTAL / 2);
        scene.add(edgeMesh);
      }

      // ── окна — InstancedMesh для производительности ───────────────────────
      const WIN_W = 1.3, WIN_H = 1.6, WIN_D = 0.06, WIN_Z = 0.55;
      const WIN_SPACING = 3.0;

      type WinState = "bright" | "dim" | "off";
      const rng = (seed: number) => {
        const x = Math.sin(seed) * 43758.5453;
        return x - Math.floor(x);
      };
      const winState = (f: number, c: number, face: number): WinState => {
        const v = rng(f * 131 + c * 17 + face * 7);
        if (v < 0.55) return "bright";
        if (v < 0.75) return "dim";
        return "off";
      };

      type FaceSide = { axis: "x" | "y"; val: number; dir: 1 | -1; len: number; start: number; fi: number };
      const faces: FaceSide[] = [
        { axis: "y", val: bb.minY, dir: -1, len: bb.w, start: bb.minX, fi: 0 },
        { axis: "y", val: bb.maxY, dir:  1, len: bb.w, start: bb.minX, fi: 1 },
        { axis: "x", val: bb.minX, dir: -1, len: bb.d, start: bb.minY, fi: 2 },
        { axis: "x", val: bb.maxX, dir:  1, len: bb.d, start: bb.minY, fi: 3 },
      ];

      const glassDarkMat = stdMat(0x0a1020, 0.05, 0.7, 0.9, 0x000000, 0);
      glassDarkMat.clippingPlanes = clipPlanes;

      // Светящиеся плашки за стеклом — храним по этажу для среза.
      type WindowGroup = { floor: number; meshes: THREE.Mesh[] };
      const windowGroups: WindowGroup[] = [];
      for (let f = 0; f < floors; f++) windowGroups.push({ floor: f + 1, meshes: [] });

      // Эмиссивные плашки (ночь) и стёкла. Используем shared materials по «состоянию×цвету».
      const innerMatWarmBright = stdMat(0xffcc66, 0.5, 0, 1, 0xffcc66, 0.9);
      const innerMatWarmDim    = stdMat(0xffcc66, 0.5, 0, 1, 0xffcc66, 0.35);
      const innerMatColdBright = stdMat(0x99bbff, 0.5, 0, 1, 0x99bbff, 0.9);
      const innerMatColdDim    = stdMat(0x99bbff, 0.5, 0, 1, 0x99bbff, 0.35);
      [innerMatWarmBright, innerMatWarmDim, innerMatColdBright, innerMatColdDim].forEach((m) => {
        m.clippingPlanes = clipPlanes;
      });

      for (const face of faces) {
        const cols = Math.max(1, Math.floor(face.len / WIN_SPACING));
        const spacing = face.len / cols;

        for (let f = 0; f < floors; f++) {
          const zBase = f * FH + WIN_Z;

          for (let c = 0; c < cols; c++) {
            const t = face.start + spacing * (c + 0.5);
            const state = winState(f, c, face.fi);

            if (state !== "off") {
              const warmCold = rng(f * 53 + c * 31 + face.fi * 11) > 0.25;
              const innerMat =
                state === "bright"
                  ? (warmCold ? innerMatWarmBright : innerMatColdBright)
                  : (warmCold ? innerMatWarmDim : innerMatColdDim);

              const innerGeo = face.axis === "y"
                ? new THREE.BoxGeometry(WIN_W * 0.85, 0.02, WIN_H * 0.85)
                : new THREE.BoxGeometry(0.02, WIN_W * 0.85, WIN_H * 0.85);
              const inner = new THREE.Mesh(innerGeo, innerMat);
              const offset = 0.15 * face.dir;
              if (face.axis === "y") {
                inner.position.set(t, face.val + offset, zBase + WIN_H / 2);
              } else {
                inner.position.set(face.val + offset, t, zBase + WIN_H / 2);
              }
              inner.userData.floor = f + 1;
              scene.add(inner);
              windowGroups[f].meshes.push(inner);
            }

            const wGeo = face.axis === "y"
              ? new THREE.BoxGeometry(WIN_W, WIN_D, WIN_H)
              : new THREE.BoxGeometry(WIN_D, WIN_W, WIN_H);
            const glass = new THREE.Mesh(wGeo, glassDarkMat);
            const offset = WIN_D * 0.5 * face.dir;
            if (face.axis === "y") {
              glass.position.set(t, face.val + offset, zBase + WIN_H / 2);
            } else {
              glass.position.set(face.val + offset, t, zBase + WIN_H / 2);
            }
            glass.userData.floor = f + 1;
            scene.add(glass);
          }
        }
      }

      // ── балконы ───────────────────────────────────────────────────────────
      const balcMat = stdMat(0x1a2038, 0.6, 0.4);
      balcMat.clippingPlanes = clipPlanes;
      const railMat = stdMat(0x3355aa, 0.2, 0.8, 0.7, 0x1133aa, 0.25);
      railMat.clippingPlanes = clipPlanes;

      const balconyMeshes: THREE.Mesh[] = [];
      for (let f = 2; f < floors; f += 3) {
        const bW = bb.w * 0.52, bD = 1.0, bT = 0.15;
        const bZ = f * FH + 0.9;

        const balc = new THREE.Mesh(new THREE.BoxGeometry(bW, bD, bT), balcMat);
        balc.position.set(cx, bb.minY - bD / 2, bZ);
        balc.castShadow = true;
        balc.receiveShadow = true;
        balc.userData.floor = f + 1;
        scene.add(balc);
        balconyMeshes.push(balc);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(bW, 0.06, 1.1), railMat);
        rail.position.set(cx, bb.minY - bD + 0.03, bZ + 0.58);
        rail.userData.floor = f + 1;
        scene.add(rail);
        balconyMeshes.push(rail);

        for (let i = 0; i < 6; i++) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1.1), railMat);
          post.position.set(
            cx - bW / 2 + (i + 0.5) * (bW / 6),
            bb.minY - bD + 0.03,
            bZ + 0.58,
          );
          post.userData.floor = f + 1;
          scene.add(post);
          balconyMeshes.push(post);
        }
      }

      // ── лобби (стеклянный первый этаж) ────────────────────────────────────
      scene.add(extrude(bldShape, FH * 0.95, lobbyGlassMat));

      // ── лифтовое ядро ─────────────────────────────────────────────────────
      const coreShape = polygonToShape(plan.core.polygon);
      scene.add(extrude(coreShape, TOTAL + 5, coreMat));

      const cbb = bbox(plan.core.polygon);
      const mrMat = stdMat(0x0d1020, 0.5, 0.3);
      mrMat.clippingPlanes = clipPlanes;
      const mrMesh = new THREE.Mesh(
        new THREE.BoxGeometry(cbb.w + 0.6, cbb.d + 0.6, 3.4),
        mrMat,
      );
      mrMesh.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 1.7);
      mrMesh.castShadow = true;
      scene.add(mrMesh);

      // Антенна
      const antMat = stdMat(0x223366, 0.4, 0.6, 1, 0x3355aa, 0.3);
      antMat.clippingPlanes = clipPlanes;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 8, 6), antMat);
      ant.rotation.x = Math.PI / 2;
      ant.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 3.4 + 4);
      scene.add(ant);

      // Маячок
      const beaconMat = stdMat(0xff2222, 0.1, 0.2, 1, 0xff0000, 1.5);
      beaconMat.clippingPlanes = clipPlanes;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), beaconMat);
      beacon.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 3.4 + 8.1);
      scene.add(beacon);

      // Парапет
      scene.add(extrude(bldShape, 1.15, parapetMat, TOTAL));

      // LED по периметру крыши (ночь)
      const ledPts = plan.floor_polygon.exterior.map(
        (p) => new THREE.Vector3(p.x, p.y, TOTAL + 1.18),
      );
      ledPts.push(ledPts[0]);
      const ledLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ledPts),
        new THREE.LineBasicMaterial({ color: 0x4466ff }),
      );
      scene.add(ledLine);

      // ── AI-чертёж на крыше ────────────────────────────────────────────────
      let roofMesh: THREE.Mesh | null = null;
      if (aiPlanImageUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(aiPlanImageUrl, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);

          const roofMat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: 0.92,
          });
          roofMat.clippingPlanes = clipPlanes;
          roofMesh = new THREE.Mesh(new THREE.PlaneGeometry(bb.w, bb.d), roofMat);
          roofMesh.position.set(cx, cy, TOTAL + 1.16);
          scene.add(roofMesh);

          const bPts = [
            new THREE.Vector3(bb.minX - 0.3, bb.minY - 0.3, TOTAL + 1.18),
            new THREE.Vector3(bb.maxX + 0.3, bb.minY - 0.3, TOTAL + 1.18),
            new THREE.Vector3(bb.maxX + 0.3, bb.maxY + 0.3, TOTAL + 1.18),
            new THREE.Vector3(bb.minX - 0.3, bb.maxY + 0.3, TOTAL + 1.18),
            new THREE.Vector3(bb.minX - 0.3, bb.minY - 0.3, TOTAL + 1.18),
          ];
          scene.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(bPts),
            new THREE.LineBasicMaterial({ color: 0x6688ff }),
          ));
        });
      } else {
        plan.tiles.forEach((tile) => {
          const m = stdMat(APT_COLORS[tile.apt_type] ?? "#a78bfa", 0.4, 0.1, 0.88, APT_COLORS[tile.apt_type] ?? "#a78bfa", 0.15);
          m.clippingPlanes = clipPlanes;
          scene.add(extrude(polygonToShape(tile.polygon), 0.22, m, TOTAL + 1.16, false));
        });
        plan.corridors.forEach((c) => {
          const m = stdMat(0x141825, 0.9);
          m.clippingPlanes = clipPlanes;
          scene.add(extrude(polygonToShape(c.polygon), 0.1, m, TOTAL + 1.16, false));
        });
      }

      // ── режим день/ночь ───────────────────────────────────────────────────
      let mode: SceneMode = initialMode;

      const applyMode = (m: SceneMode) => {
        mode = m;
        // Внутри лобби визуальные настройки экстерьера не применяем —
        // mode сохраняется и восстановится при возврате наружу.
        if (lobbyGroup.visible) return;
        const isNight = m === "night";

        // Фон + туман + экспозиция
        scene.background = new THREE.Color(isNight ? 0x060914 : 0xb8d4f0);
        scene.fog = isNight
          ? new THREE.FogExp2(0x060914, 0.004)
          : new THREE.FogExp2(0xc8dcf2, 0.0025);
        renderer.toneMappingExposure = isNight ? 1.35 : 1.0;

        // Источники
        hemiNight.visible = isNight;
        moon.visible = isNight;
        warmAccent.visible = isNight;
        groundGlow1.visible = isNight;
        groundGlow2.visible = isNight;
        floorLights.forEach((fl) => (fl.visible = isNight));
        hemiDay.visible = !isNight;
        sun.visible = !isNight;

        // Звёзды и неоновая декорация
        stars.visible = isNight;
        glowRing.visible = isNight;
        footLine.visible = isNight;
        ledLine.visible = isNight;

        // Окна — днём гасим эмиссию
        const e = isNight ? 1 : 0;
        innerMatWarmBright.emissiveIntensity = 0.9 * e;
        innerMatWarmDim.emissiveIntensity = 0.35 * e;
        innerMatColdBright.emissiveIntensity = 0.9 * e;
        innerMatColdDim.emissiveIntensity = 0.35 * e;
        // Маячок и подсветка торцов
        beaconMat.emissiveIntensity = isNight ? 1.5 : 0;
        edgeMat.emissiveIntensity = isNight ? 0.4 : 0;
        parapetMat.emissiveIntensity = isNight ? 0.12 : 0;
        lobbyGlassMat.emissiveIntensity = isNight ? 0.15 : 0.05;
        railMat.emissiveIntensity = isNight ? 0.25 : 0;

        // Земля светлее днём
        gndMat.color = new THREE.Color(isNight ? 0x090c16 : 0x4a5468);
      };
      applyMode(initialMode);

      // ── перемещаем все экстерьер-объекты из scene в exteriorGroup ─────────
      // (лайты, exteriorGroup и lobbyGroup оставляем в scene)
      const movables = scene.children.filter(
        (o) => !(o instanceof THREE.Light) && o !== exteriorGroup && o !== lobbyGroup,
      );
      movables.forEach((o) => exteriorGroup.add(o));

      // ── lobby: пол, потолок, стены, ядро, свет ────────────────────────────
      const floorShape = polygonToShape(plan.floor_polygon);

      // Пол лобби — текстура AI-чертежа сверху, если есть
      const lobbyFloorMat = new THREE.MeshStandardMaterial({
        color: 0x2a2e3a,
        roughness: 0.7,
        metalness: 0.05,
      });
      if (aiPlanImageUrl) {
        new THREE.TextureLoader().load(aiPlanImageUrl, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
          lobbyFloorMat.map = tex;
          lobbyFloorMat.color.set(0xffffff);
          lobbyFloorMat.needsUpdate = true;
        });
      }
      const lobbyFloor = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), lobbyFloorMat);
      lobbyFloor.position.z = 0.06;
      lobbyFloor.receiveShadow = true;
      lobbyGroup.add(lobbyFloor);

      // Потолок (плоскость, направленная вниз)
      const lobbyCeilMat = new THREE.MeshStandardMaterial({
        color: 0x14171f, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
      });
      const lobbyCeil = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), lobbyCeilMat);
      lobbyCeil.position.z = FH;
      lobbyGroup.add(lobbyCeil);

      // Стены — extrude с BackSide, чтобы видеть изнутри
      const lobbyWallMat = new THREE.MeshStandardMaterial({
        color: 0x252b3c, roughness: 0.9, metalness: 0.05, side: THREE.BackSide,
      });
      const lobbyWalls = new THREE.Mesh(
        new THREE.ExtrudeGeometry(floorShape, { depth: FH, bevelEnabled: false }),
        lobbyWallMat,
      );
      lobbyWalls.receiveShadow = true;
      lobbyGroup.add(lobbyWalls);

      // Лифтовое ядро — стенка комнаты с лифтами
      const lobbyCoreMat = new THREE.MeshStandardMaterial({
        color: 0x3a4256, roughness: 0.55, metalness: 0.35,
      });
      const lobbyCoreShape = polygonToShape(plan.core.polygon);
      const lobbyCore = new THREE.Mesh(
        new THREE.ExtrudeGeometry(lobbyCoreShape, { depth: FH, bevelEnabled: false }),
        lobbyCoreMat,
      );
      lobbyCore.castShadow = true;
      lobbyCore.receiveShadow = true;
      lobbyGroup.add(lobbyCore);

      // Имитация лифтовых дверей — тонкие панели на грани ядра, обращённой к лобби
      const liftDoorMat = new THREE.MeshStandardMaterial({
        color: 0xc8b87a, roughness: 0.35, metalness: 0.85,
        emissive: 0x6a5a30, emissiveIntensity: 0.18,
      });
      const lDoorH = FH * 0.78, lDoorW = 0.85, lDoorT = 0.05;
      const liftDoorY = cbb.cy < cy ? cbb.maxY + lDoorT * 0.5 : cbb.minY - lDoorT * 0.5;
      for (let i = 0; i < 2; i++) {
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(lDoorW, lDoorT, lDoorH),
          liftDoorMat,
        );
        door.position.set(
          cbb.cx + (i === 0 ? -lDoorW * 0.6 : lDoorW * 0.6),
          liftDoorY,
          lDoorH / 2 + 0.05,
        );
        lobbyGroup.add(door);
      }

      // Освещение лобби — тёплый потолочный + амбиент
      const lobbyAmbient = new THREE.AmbientLight(0x404858, 0.45);
      const lobbyCeilLight = new THREE.PointLight(0xffe8c0, 1.6, 60, 1.7);
      lobbyCeilLight.position.set(cx, cy, FH - 0.4);
      lobbyCeilLight.castShadow = true;
      lobbyCeilLight.shadow.mapSize.set(1024, 1024);
      const lobbyEntryLight = new THREE.PointLight(0xa8c8ff, 0.8, 25, 1.6);
      lobbyEntryLight.position.set(cx, bb.minY + 0.6, FH - 0.6);
      lobbyGroup.add(lobbyAmbient, lobbyCeilLight, lobbyEntryLight);

      // ── срез этажей ────────────────────────────────────────────────────────
      // (применяется initialVisibleFloors ниже, после объявления applyVisibleFloors)
      // ──────────────────────────────────────────────────────────────────────
      let visibleFloors = floors;
      const applyVisibleFloors = (n: number) => {
        visibleFloors = Math.max(1, Math.min(floors, Math.round(n)));
        // Плоскость отсечения = верх верхнего видимого этажа.
        // При полном здании отодвигаем плоскость вверх, чтобы парапет/антенна не клипались.
        clipPlane.constant = visibleFloors >= floors
          ? TOTAL + 100
          : visibleFloors * FH + 0.05;

        // Перекрытия / окна / балконы — отдельные меши с userData.floor
        slabMeshes.forEach((m) => (m.visible = (m.userData.floor as number) <= visibleFloors));
        windowGroups.forEach((g) => {
          const on = g.floor <= visibleFloors;
          g.meshes.forEach((m) => (m.visible = on));
        });
        balconyMeshes.forEach((m) => (m.visible = (m.userData.floor as number) <= visibleFloors));

        // Стёкла — общий material, но мы их не складывали в группы для производительности.
        // Они клиппятся плоскостью сверху — этого достаточно (срезаются в верхней части).
      };

      // ── камера: пресеты ───────────────────────────────────────────────────
      const applyPreset = (p: CameraPreset) => {
        controls.autoRotate = false;
        const target = new THREE.Vector3(cx, cy, TOTAL * 0.4);
        const D = diag * 1.4 + TOTAL * 0.6;
        switch (p) {
          case "iso":
            camera.position.set(cx + D * 0.6, cy - D * 1.0, TOTAL * 1.55);
            break;
          case "top":
            camera.position.set(cx, cy + 0.001, TOTAL + diag * 1.6);
            target.set(cx, cy, TOTAL * 0.5);
            break;
          case "front":
            camera.position.set(cx, cy - D * 1.4, TOTAL * 0.55);
            break;
          case "side":
            camera.position.set(cx + D * 1.4, cy, TOTAL * 0.55);
            break;
        }
        controls.target.copy(target);
        camera.lookAt(target);
        controls.update();
      };

      // Применяем стартовый срез, если задан
      if (typeof initialVisibleFloors === "number" && initialVisibleFloors < floors) {
        applyVisibleFloors(initialVisibleFloors);
      }

      // ── walkthrough: переходы между уровнями ──────────────────────────────
      let view: ViewMode = "exterior";

      // Камера-якоря под каждый уровень
      const exteriorAnchorPos = new THREE.Vector3().copy(camera.position);
      const exteriorAnchorTarget = new THREE.Vector3().copy(controls.target);
      const lobbyAnchorPos = new THREE.Vector3(cx, bb.minY + 1.6, FH * 0.55);
      const lobbyAnchorTarget = new THREE.Vector3(cx, cy, FH * 0.5);

      // Простой tween камеры (easeInOutQuad по позиции и таргету).
      let tweenActive = false;
      let tweenT = 0;
      const tweenDur = 1.0;
      const tweenFrom = new THREE.Vector3();
      const tweenTo = new THREE.Vector3();
      const tweenTargetFrom = new THREE.Vector3();
      const tweenTargetTo = new THREE.Vector3();
      const tweenCamera = (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
        tweenFrom.copy(camera.position);
        tweenTo.copy(toPos);
        tweenTargetFrom.copy(controls.target);
        tweenTargetTo.copy(toTarget);
        tweenT = 0;
        tweenActive = true;
      };

      const applyView = (v: ViewMode) => {
        if (v === view) return;
        // Запоминаем последнюю позицию в exterior, чтобы вернуться к ней.
        if (view === "exterior") {
          exteriorAnchorPos.copy(camera.position);
          exteriorAnchorTarget.copy(controls.target);
        }
        view = v;

        if (v === "exterior") {
          exteriorGroup.visible = true;
          lobbyGroup.visible = false;
          // Восстанавливаем экстерьер-освещение в зависимости от режима
          applyMode(mode);
          controls.autoRotate = false; // не включаем сам по себе после перехода
          controls.minDistance = 10;
          controls.maxDistance = 600;
          controls.maxPolarAngle = Math.PI / 2.06;
          tweenCamera(exteriorAnchorPos, exteriorAnchorTarget);
        } else if (v === "lobby") {
          exteriorGroup.visible = false;
          lobbyGroup.visible = true;
          // Гасим всё уличное освещение — внутри светят только лобби-лайты
          hemiNight.visible = false;
          hemiDay.visible = false;
          moon.visible = false;
          sun.visible = false;
          warmAccent.visible = false;
          groundGlow1.visible = false;
          groundGlow2.visible = false;
          floorLights.forEach((fl) => (fl.visible = false));
          // Тёмный интерьерный фон без тумана
          scene.background = new THREE.Color(0x06080c);
          scene.fog = null;
          renderer.toneMappingExposure = 1.0;
          controls.autoRotate = false;
          controls.minDistance = 0.5;
          // Orbit-радиус ≤ половины короткой стороны, чтобы камера осталась внутри стен.
          controls.maxDistance = Math.min(bb.w, bb.d) * 0.45;
          controls.maxPolarAngle = Math.PI - 0.05; // позволяем смотреть выше горизонта
          tweenCamera(lobbyAnchorPos, lobbyAnchorTarget);
        }
      };

      // ── публикуем API ─────────────────────────────────────────────────────
      apiRef.current = {
        setMode: applyMode,
        setAutoRotate: (on) => { controls.autoRotate = on; },
        setVisibleFloors: applyVisibleFloors,
        setCameraPreset: applyPreset,
        screenshot: () => {
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL("image/png");
        },
        setView: applyView,
        getView: () => view,
      };

      // ── анимация ──────────────────────────────────────────────────────────
      let animId = 0;
      let t = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        t += 0.016;

        if (view === "exterior" && mode === "night") {
          beaconMat.emissiveIntensity = 0.6 + Math.sin(t * 2.5) * 0.6;
          groundGlow1.intensity = 3.0 + Math.sin(t * 0.7) * 0.5;
          groundGlow2.intensity = 2.2 + Math.cos(t * 0.5) * 0.4;
        }

        if (tweenActive) {
          tweenT = Math.min(1, tweenT + 0.016 / tweenDur);
          // easeInOutQuad
          const e = tweenT < 0.5
            ? 2 * tweenT * tweenT
            : 1 - Math.pow(-2 * tweenT + 2, 2) / 2;
          camera.position.lerpVectors(tweenFrom, tweenTo, e);
          controls.target.lerpVectors(tweenTargetFrom, tweenTargetTo, e);
          if (tweenT >= 1) tweenActive = false;
        }

        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      // ── resize ────────────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      ro.observe(mount);

      return () => {
        cancelAnimationFrame(animId);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
        apiRef.current = null;
      };
    }, [plan, floors, aiPlanImageUrl, initialMode, initialAutoRotate]);

    return <div ref={mountRef} className="w-full h-full" />;
  },
);
