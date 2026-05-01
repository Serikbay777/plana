"use client";

import { useEffect, useRef } from "react";
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

// ── component ─────────────────────────────────────────────────────────────────

export type PlanCanvas3DProps = {
  plan: Plan;
  floors: number;
  aiPlanImageUrl?: string;
};

export function PlanCanvas3D({ plan, floors, aiPlanImageUrl }: PlanCanvas3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

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

    // ── renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.setClearColor(0x060914);
    mount.appendChild(renderer.domElement);

    // ── scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060914);
    scene.fog = new THREE.FogExp2(0x060914, 0.004);

    // ── camera ────────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 800);
    const camDist = diag * 1.15 + TOTAL * 0.85;
    camera.position.set(cx + camDist * 0.6, cy - camDist * 1.0, TOTAL * 1.55);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, cy, TOTAL * 0.40);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 10;
    controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI / 2.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    camera.lookAt(controls.target);
    controls.update();

    // ── lights ────────────────────────────────────────────────────────────────
    // Тёмное ночное небо
    scene.add(new THREE.HemisphereLight(0x1a2a4a, 0x080810, 0.5));

    // Луна — холодный синий свет слева-сверху
    const moon = new THREE.DirectionalLight(0x7090d0, 1.4);
    moon.position.set(cx - 120, cy + 80, 200);
    moon.castShadow = true;
    moon.shadow.mapSize.set(4096, 4096);
    const sc = moon.shadow.camera as THREE.OrthographicCamera;
    const r = diag + 40;
    sc.left = sc.bottom = -r; sc.right = sc.top = r;
    sc.near = 1; sc.far = 800;
    scene.add(moon);

    // Тёплый акцент справа (закатный отблеск)
    const warm = new THREE.DirectionalLight(0xff8844, 0.55);
    warm.position.set(cx + 80, cy - 60, 60);
    scene.add(warm);

    // Точечные огни на земле у основания здания
    const groundGlow1 = new THREE.PointLight(0x4466ff, 3.5, 35);
    groundGlow1.position.set(bb.minX - 3, bb.minY - 3, 1);
    scene.add(groundGlow1);
    const groundGlow2 = new THREE.PointLight(0x3355ee, 2.5, 30);
    groundGlow2.position.set(bb.maxX + 3, bb.maxY + 3, 1);
    scene.add(groundGlow2);

    // Тёплые огни этажей (каждые 3 этажа)
    for (let f = 0; f < floors; f += 3) {
      const fl = new THREE.PointLight(0xffcc88, 1.8, 20);
      fl.position.set(cx, cy, f * FH + FH * 0.5);
      scene.add(fl);
    }

    // ── звёздное небо ──────────────────────────────────────────────────────────
    const starCount = 2200;
    const starPos = new Float32Array(starCount * 3);
    const starSphere = 450;
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPos[i * 3]     = starSphere * Math.sin(phi) * Math.cos(theta) + cx;
      starPos[i * 3 + 1] = starSphere * Math.sin(phi) * Math.sin(theta) + cy;
      starPos[i * 3 + 2] = Math.abs(starSphere * Math.cos(phi)); // только верхняя полусфера
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));

    // ── земля — тёмная отражающая ─────────────────────────────────────────────
    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 700, 1, 1),
      stdMat(0x090c16, 0.18, 0.35),  // полуотражающий тёмный
    );
    gnd.position.set(cx, cy, -0.02);
    gnd.receiveShadow = true;
    scene.add(gnd);

    // Небольшое синее свечение от земли у основания
    const glowRing = new THREE.Mesh(
      new THREE.PlaneGeometry(bb.w + 12, bb.d + 12, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x1a2860,
        transparent: true,
        opacity: 0.18,
      }),
    );
    glowRing.position.set(cx, cy, 0.01);
    scene.add(glowRing);

    // Контур здания на земле — неоновый
    const footPts = [
      ...plan.floor_polygon.exterior.map((p) => new THREE.Vector3(p.x, p.y, 0.08)),
    ];
    footPts.push(footPts[0]);
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(footPts),
      new THREE.LineBasicMaterial({ color: 0x4455ff }),
    ));

    // Тонкая сетка
    const grid = new THREE.GridHelper(500, 60, 0x151828, 0x101522);
    grid.position.set(cx, cy, 0.03);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // ── здание — тёмный стеклянный фасад ──────────────────────────────────────
    const bldShape = polygonToShape(plan.floor_polygon);

    // Основной корпус — тёмно-серое стекло/бетон
    scene.add(extrude(bldShape, TOTAL, stdMat(0x1c2030, 0.65, 0.15)));

    // Стеклянная "обёртка" — полупрозрачная синеватая плёнка поверх
    scene.add(extrude(bldShape, TOTAL, stdMat(0x2244aa, 0.05, 0.6, 0.12)));

    // ── перекрытия (тёмные горизонтальные полосы между этажами) ───────────────
    const slabMat = stdMat(0x0e111e, 0.85, 0.2);
    for (let f = 1; f <= floors; f++) {
      const s = extrude(bldShape, 0.28, slabMat, f * FH - 0.28, false);
      s.receiveShadow = true;
      scene.add(s);
    }

    // ── вертикальные угловые акценты ──────────────────────────────────────────
    const edgeMat = stdMat(0x2233aa, 0.1, 0.8, 1, 0x112299, 0.4);
    const edgeW = 0.35;
    const corners = [
      { x: bb.minX, y: bb.minY },
      { x: bb.maxX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY },
      { x: bb.minX, y: bb.maxY },
    ];
    for (const c of corners) {
      const edgeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(edgeW, edgeW, TOTAL + 1.2),
        edgeMat,
      );
      edgeMesh.position.set(c.x, c.y, TOTAL / 2);
      scene.add(edgeMesh);
    }

    // ── окна — СВЕТЯЩИЕСЯ изнутри ─────────────────────────────────────────────
    const WIN_W = 1.3, WIN_H = 1.6, WIN_D = 0.06, WIN_Z = 0.55;
    const WIN_SPACING = 3.0;

    // Разные "состояния" окон: горят / тускло / совсем тёмные
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

    // Стёкла: тёмное стекло + внутренний свет (эмиссия)
    const glassDark = stdMat(0x0a1020, 0.05, 0.7, 0.9, 0x000000, 0);

    type FaceSide = { axis: "x" | "y"; val: number; dir: 1 | -1; len: number; start: number; fi: number };
    const faces: FaceSide[] = [
      { axis: "y", val: bb.minY, dir: -1, len: bb.w, start: bb.minX, fi: 0 },
      { axis: "y", val: bb.maxY, dir:  1, len: bb.w, start: bb.minX, fi: 1 },
      { axis: "x", val: bb.minX, dir: -1, len: bb.d, start: bb.minY, fi: 2 },
      { axis: "x", val: bb.maxX, dir:  1, len: bb.d, start: bb.minY, fi: 3 },
    ];

    for (const face of faces) {
      const cols = Math.max(1, Math.floor(face.len / WIN_SPACING));
      const spacing = face.len / cols;

      for (let f = 0; f < floors; f++) {
        const zBase = f * FH + WIN_Z;

        for (let c = 0; c < cols; c++) {
          const t = face.start + spacing * (c + 0.5);
          const state = winState(f, c, face.fi);

          // Внутренний свет (эмиссивная плашка чуть позади стекла)
          if (state !== "off") {
            const intensity = state === "bright" ? 0.9 : 0.35;
            // Тёплый жёлто-оранжевый или холодный синий (разнообразие)
            const warmCold = rng(f * 53 + c * 31 + face.fi * 11) > 0.25;
            const emColor = warmCold ? 0xffcc66 : 0x99bbff;
            const innerMat = stdMat(emColor, 0.5, 0, 1, emColor, intensity);

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
            scene.add(inner);
          }

          // Само стекло поверх
          const wGeo = face.axis === "y"
            ? new THREE.BoxGeometry(WIN_W, WIN_D, WIN_H)
            : new THREE.BoxGeometry(WIN_D, WIN_W, WIN_H);
          const glass = new THREE.Mesh(wGeo, glassDark.clone());
          const offset = WIN_D * 0.5 * face.dir;
          if (face.axis === "y") {
            glass.position.set(t, face.val + offset, zBase + WIN_H / 2);
          } else {
            glass.position.set(face.val + offset, t, zBase + WIN_H / 2);
          }
          scene.add(glass);
        }
      }
    }

    // ── балконы ───────────────────────────────────────────────────────────────
    const balcMat = stdMat(0x1a2038, 0.6, 0.4);
    const railMat = stdMat(0x3355aa, 0.2, 0.8, 0.7, 0x1133aa, 0.25);

    for (let f = 2; f < floors; f += 3) {
      const bW = bb.w * 0.52, bD = 1.0, bT = 0.15;
      const bZ = f * FH + 0.9;

      const balc = new THREE.Mesh(new THREE.BoxGeometry(bW, bD, bT), balcMat);
      balc.position.set(cx, bb.minY - bD / 2, bZ);
      balc.castShadow = true;
      balc.receiveShadow = true;
      scene.add(balc);

      // Стеклянные перила
      const rail = new THREE.Mesh(new THREE.BoxGeometry(bW, 0.06, 1.1), railMat);
      rail.position.set(cx, bb.minY - bD + 0.03, bZ + 0.58);
      scene.add(rail);

      for (let i = 0; i < 6; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1.1), railMat);
        post.position.set(
          cx - bW / 2 + (i + 0.5) * (bW / 6),
          bb.minY - bD + 0.03,
          bZ + 0.58,
        );
        scene.add(post);
      }
    }

    // ── лобби (первый этаж — стеклянный) ──────────────────────────────────────
    const lobbyGlassMat = stdMat(0x1a3060, 0.04, 0.7, 0.55, 0x4488ff, 0.15);
    scene.add(extrude(bldShape, FH * 0.95, lobbyGlassMat));

    // ── лифтовое ядро ─────────────────────────────────────────────────────────
    const coreShape = polygonToShape(plan.core.polygon);
    scene.add(extrude(coreShape, TOTAL + 5, stdMat(0x0a0c14, 0.6, 0.25)));

    // Машинное отделение
    const cbb = bbox(plan.core.polygon);
    const mrMesh = new THREE.Mesh(
      new THREE.BoxGeometry(cbb.w + 0.6, cbb.d + 0.6, 3.4),
      stdMat(0x0d1020, 0.5, 0.3),
    );
    mrMesh.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 1.7);
    mrMesh.castShadow = true;
    scene.add(mrMesh);

    // Антенна
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.12, 8, 6),
      stdMat(0x223366, 0.4, 0.6, 1, 0x3355aa, 0.3),
    );
    ant.rotation.x = Math.PI / 2;
    ant.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 3.4 + 4);
    scene.add(ant);

    // Мигающий огонёк антенны
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      stdMat(0xff2222, 0.1, 0.2, 1, 0xff0000, 1.5),
    );
    beacon.position.set(cbb.cx, cbb.cy, TOTAL + 5 + 3.4 + 8.1);
    scene.add(beacon);

    // ── парапет крыши с подсветкой ────────────────────────────────────────────
    const parapetMat = stdMat(0x141826, 0.7, 0.2, 1, 0x2233aa, 0.12);
    scene.add(extrude(bldShape, 1.15, parapetMat, TOTAL));

    // Полоса LED подсветки по периметру крыши
    const ledPts = plan.floor_polygon.exterior.map(
      (p) => new THREE.Vector3(p.x, p.y, TOTAL + 1.18),
    );
    ledPts.push(ledPts[0]);
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ledPts),
      new THREE.LineBasicMaterial({ color: 0x4466ff }),
    ));

    // ── КРЫША: AI-чертёж как текстура ─────────────────────────────────────────
    if (aiPlanImageUrl) {
      const loader = new THREE.TextureLoader();
      loader.load(aiPlanImageUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);

        const roofGeo = new THREE.PlaneGeometry(bb.w, bb.d);
        const roofMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.92,
        });
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.set(cx, cy, TOTAL + 1.16);
        scene.add(roofMesh);

        // Неоновая рамка вокруг чертежа
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
      // Фолбэк: цветные квартирные патчи
      plan.tiles.forEach((tile) => {
        scene.add(extrude(
          polygonToShape(tile.polygon), 0.22,
          stdMat(APT_COLORS[tile.apt_type] ?? "#a78bfa", 0.4, 0.1, 0.88, APT_COLORS[tile.apt_type] ?? "#a78bfa", 0.15),
          TOTAL + 1.16, false,
        ));
      });
      plan.corridors.forEach((c) => {
        scene.add(extrude(polygonToShape(c.polygon), 0.1, stdMat(0x141825, 0.9), TOTAL + 1.16, false));
      });
    }

    // ── анимация ──────────────────────────────────────────────────────────────
    let animId: number;
    let t = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.016;

      // Мигание антенны
      beacon.material.emissiveIntensity = 0.6 + Math.sin(t * 2.5) * 0.6;

      // Пульсация наземного свечения
      groundGlow1.intensity = 3.0 + Math.sin(t * 0.7) * 0.5;
      groundGlow2.intensity = 2.2 + Math.cos(t * 0.5) * 0.4;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── resize ────────────────────────────────────────────────────────────────
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
    };
  }, [plan, floors, aiPlanImageUrl]);

  return <div ref={mountRef} className="w-full h-full" />;
}
