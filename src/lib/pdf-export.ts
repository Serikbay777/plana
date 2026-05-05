/**
 * PDF export для Plana.
 *
 * Два режима:
 *   exportAiPlansPdf(...)       — только AI-чертежи (1+ варианта на странице A4 ландшафт)
 *   exportFullReportPdf(...)    — полный отчёт по проекту: обложка с параметрами
 *                                 + ГПЗУ + анализ контура + AI-чертежи + посадка
 *                                 + экстерьер + интерьеры
 */

import jsPDF from "jspdf";
import type { PromptFormState } from "@/components/PromptForm";
import type {
  ContourAnalysis,
  GpzuExtraction,
  InteriorGalleryItem,
  PlacementVariant,
} from "./engine";

type AiPlanVariant = {
  key: string;
  label: string;
  imageUrl: string;   // data:image/png;base64,...
  modelUsed: string;
  enhancerUsed: string;
};

type RGB = [number, number, number];
const DARK: RGB = [10, 10, 14];

const PURPOSE_RU: Record<string, string> = {
  residential: "Жилой",
  commercial:  "Коммерческий",
  mixed_use:   "Смешанный",
  hotel:       "Гостиница",
};

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imgToDataUrl(img: HTMLImageElement, maxW: number, maxH: number): string {
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// ---------------------------------------------------------------------------
// AI Plans PDF (legacy: только чертежи)
// ---------------------------------------------------------------------------

export async function exportAiPlansPdf(
  variants: AiPlanVariant[],
  filename?: string,
): Promise<void> {
  if (variants.length === 0) return;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297;
  const PH = 210;
  const PAD = 12;
  const HEADER_H = 16;
  const FOOTER_H = 9;
  const IMG_AREA_W = PW - PAD * 2;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (i > 0) doc.addPage("a4", "landscape");

    drawHeader(doc, PW, HEADER_H, PAD, "AI Чертежи планировки", v.label, `${i + 1} / ${variants.length}`);

    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    const imgW = IMG_AREA_W;

    await drawImageInBox(doc, v.imageUrl, PAD, imgY, imgW, imgH);

    drawFooter(doc, PW, PH, PAD, FOOTER_H, [
      v.modelUsed && `Модель: ${v.modelUsed}`,
      v.enhancerUsed && v.enhancerUsed !== "fallback" && `Промпт: ${v.enhancerUsed}`,
    ]);
  }

  const safeName = filename ?? `plana-ai-plans-${Date.now()}`;
  doc.save(`${safeName}.pdf`);
}

// ---------------------------------------------------------------------------
// Полный отчёт по проекту (Этап 5 ТЗ — «Экспорт готового решения»)
// ---------------------------------------------------------------------------

export type FullReportInput = {
  form: PromptFormState;
  gpzu?: GpzuExtraction | null;
  contour?: ContourAnalysis | null;
  aiPlans: AiPlanVariant[];
  placement: PlacementVariant[];          // base64 в `image_b64`
  exteriorUrl?: string | null;            // object URL или data URL
  floorplanFurnitureUrl?: string | null;
  interiors: InteriorGalleryItem[];       // base64 в `image_b64`
  filename?: string;
};

export async function exportFullReportPdf(opts: FullReportInput): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297;
  const PH = 210;
  const PAD = 12;
  const HEADER_H = 16;
  const FOOTER_H = 9;

  // ─── Cover ───────────────────────────────────────────────────────────────
  drawHeader(doc, PW, HEADER_H, PAD, "Plana · Отчёт по проекту", "Сводка параметров и AI-материалов", new Date().toLocaleDateString("ru-RU"));
  drawCoverBody(doc, opts, PAD, HEADER_H + 8, PW - PAD * 2, PH - HEADER_H - FOOTER_H - 16);
  drawFooter(doc, PW, PH, PAD, FOOTER_H, ["Plana AI · plana.kz"]);

  // ─── AI Чертежи ──────────────────────────────────────────────────────────
  for (let i = 0; i < opts.aiPlans.length; i++) {
    const v = opts.aiPlans[i];
    doc.addPage("a4", "landscape");
    drawHeader(doc, PW, HEADER_H, PAD, "AI Чертежи планировки", v.label, `${i + 1} / ${opts.aiPlans.length}`);
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    await drawImageInBox(doc, v.imageUrl, PAD, imgY, PW - PAD * 2, imgH);
    drawFooter(doc, PW, PH, PAD, FOOTER_H, [
      v.modelUsed && `Модель: ${v.modelUsed}`,
      v.enhancerUsed && v.enhancerUsed !== "fallback" && `Промпт: ${v.enhancerUsed}`,
    ]);
  }

  // ─── Размещение ЖК на участке ────────────────────────────────────────────
  for (let i = 0; i < opts.placement.length; i++) {
    const p = opts.placement[i];
    doc.addPage("a4", "landscape");
    drawHeader(doc, PW, HEADER_H, PAD, "Посадка ЖК на участок", p.label, `${i + 1} / ${opts.placement.length}`);
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    await drawImageInBox(doc, `data:image/png;base64,${p.image_b64}`, PAD, imgY, PW - PAD * 2, imgH);
    drawFooter(doc, PW, PH, PAD, FOOTER_H, [p.model_used && `Модель: ${p.model_used}`]);
  }

  // ─── Экстерьер ───────────────────────────────────────────────────────────
  if (opts.exteriorUrl) {
    doc.addPage("a4", "landscape");
    drawHeader(doc, PW, HEADER_H, PAD, "Визуализация экстерьера", "3/4 перспектива здания в окружении", "");
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    await drawImageInBox(doc, opts.exteriorUrl, PAD, imgY, PW - PAD * 2, imgH);
    drawFooter(doc, PW, PH, PAD, FOOTER_H, ["gpt-image-1"]);
  }

  // ─── Floorplan с мебелью ─────────────────────────────────────────────────
  if (opts.floorplanFurnitureUrl) {
    doc.addPage("a4", "landscape");
    drawHeader(doc, PW, HEADER_H, PAD, "План с мебелью", "Pinterest-grade top-down", "");
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    await drawImageInBox(doc, opts.floorplanFurnitureUrl, PAD, imgY, PW - PAD * 2, imgH);
    drawFooter(doc, PW, PH, PAD, FOOTER_H, ["gpt-image-1"]);
  }

  // ─── Интерьеры по типам ──────────────────────────────────────────────────
  for (let i = 0; i < opts.interiors.length; i++) {
    const it = opts.interiors[i];
    doc.addPage("a4", "landscape");
    drawHeader(doc, PW, HEADER_H, PAD,
      "Интерьер квартиры",
      `${it.label} · ~${it.area.toFixed(0)} м² · ${it.count} шт. на этаже`,
      `${i + 1} / ${opts.interiors.length}`,
    );
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    await drawImageInBox(doc, `data:image/png;base64,${it.image_b64}`, PAD, imgY, PW - PAD * 2, imgH);
    drawFooter(doc, PW, PH, PAD, FOOTER_H, [
      it.model_used && `Модель: ${it.model_used}`,
      it.enhancer_used && it.enhancer_used !== "fallback" && `Промпт: ${it.enhancer_used}`,
    ]);
  }

  const safeName = opts.filename ?? `plana-report-${Date.now()}`;
  doc.save(`${safeName}.pdf`);
}

// ---------------------------------------------------------------------------
// Низкоуровневые рендереры
// ---------------------------------------------------------------------------

function drawHeader(
  doc: jsPDF, PW: number, HEADER_H: number, PAD: number,
  section: string, subtitle: string, rightLabel: string,
): void {
  doc.setFillColor(...DARK);
  doc.rect(0, 0, PW, HEADER_H, "F");

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("plana", PAD, 11);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(140, 140, 180);
  doc.text(section, PAD + 24, 11);

  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 220, 240);
    doc.text(subtitle, PW / 2, 10.5, { align: "center" });
  }

  if (rightLabel) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 160);
    doc.text(rightLabel, PW - PAD, 11, { align: "right" });
  }
}

function drawFooter(
  doc: jsPDF, PW: number, PH: number, PAD: number, FOOTER_H: number,
  metaParts: Array<string | false | null | undefined>,
): void {
  doc.setFillColor(...DARK);
  doc.rect(0, PH - FOOTER_H, PW, FOOTER_H, "F");

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 140);
  const metaStr = metaParts.filter(Boolean).join("  ·  ");
  doc.text(metaStr, PAD, PH - 3.5);
  doc.text("Plana AI · plana.kz", PW - PAD, PH - 3.5, { align: "right" });
}

async function drawImageInBox(
  doc: jsPDF, url: string,
  x: number, y: number, w: number, h: number,
): Promise<void> {
  doc.setFillColor(15, 15, 22);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  try {
    const imgEl = await loadImage(url);
    const scale = Math.min(w / imgEl.naturalWidth, h / imgEl.naturalHeight);
    const drawW = imgEl.naturalWidth * scale;
    const drawH = imgEl.naturalHeight * scale;
    const drawX = x + (w - drawW) / 2;
    const drawY = y + (h - drawH) / 2;
    const jpegUrl = imgToDataUrl(imgEl, 2400, 1600);
    doc.addImage(jpegUrl, "JPEG", drawX, drawY, drawW, drawH, "", "FAST");
  } catch {
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 100);
    doc.text("[ изображение недоступно ]", x + w / 2, y + h / 2, { align: "center" });
  }
}

// ---------------------------------------------------------------------------
// Cover-page renderer (формы / ГПЗУ / анализ контура)
// ---------------------------------------------------------------------------

function drawCoverBody(
  doc: jsPDF, opts: FullReportInput,
  x: number, y: number, w: number, h: number,
): void {
  const f = opts.form;
  const colW = (w - 6) / 2;
  let leftY  = y;
  const leftX  = x;
  let rightY = y;
  const rightX = x + colW + 6;

  // ── Левая колонка: параметры участка + микс ─────────────────────────────
  leftY = drawSectionTitle(doc, "Параметры проекта", leftX, leftY);
  const innerW = (f.site_width_m - 2 * f.setback_side_m).toFixed(0);
  const innerD = (f.site_depth_m - f.setback_front_m - f.setback_rear_m).toFixed(0);
  const params: Array<[string, string]> = [
    ["Назначение",  PURPOSE_RU[f.purpose] ?? f.purpose],
    ["Габариты",    `${f.site_width_m} × ${f.site_depth_m} м`],
    ["Отступы",     `пер. ${f.setback_front_m} · бок ${f.setback_side_m} · зад ${f.setback_rear_m} м`],
    ["Полезный контур", `${innerW} × ${innerD} м`],
    ["Этажность",   `${f.floors} эт.`],
    ["Высота",      `до ${f.max_height_m} м`],
    ["% застройки", `до ${f.max_coverage_pct}%`],
  ];
  leftY = drawKeyValueList(doc, params, leftX, leftY, colW);

  leftY += 4;
  leftY = drawSectionTitle(doc, "Квартирография", leftX, leftY);
  const mix: Array<[string, string]> = [
    ["Студии",     `${f.studio_pct}%`],
    ["1-комн.",    `${f.k1_pct}%`],
    ["2-комн.",    `${f.k2_pct}%`],
    ["3-комн.",    `${f.k3_pct}%`],
  ].filter(([, v]) => parseInt(v, 10) > 0) as Array<[string, string]>;
  leftY = drawKeyValueList(doc, mix, leftX, leftY, colW);

  leftY += 4;
  leftY = drawSectionTitle(doc, "Инженерия и нормы", leftX, leftY);
  const eng: Array<[string, string]> = [
    ["Лифты",          `${f.lifts_passenger} пасс. + ${f.lifts_freight} груз.`],
    ["Эвакуация",      `≤ ${f.fire_evacuation_max_m} м · ${f.fire_evacuation_exits_per_section} вых./секц.`],
    ["Тупик коридора", `≤ ${f.fire_dead_end_corridor_max_m} м`],
    ["Паркинг",        `${f.parking_spaces_per_apt}/кв · ${f.parking_underground_levels} уровень`],
    ["Инсоляция",      f.insolation_priority ? `приоритет, ≥ ${f.insolation_min_hours} ч` : `${f.insolation_min_hours} ч`],
  ];
  leftY = drawKeyValueList(doc, eng, leftX, leftY, colW);

  // ── Правая колонка: ГПЗУ + анализ контура + содержание ──────────────────
  if (opts.gpzu) {
    rightY = drawSectionTitle(doc, "ГПЗУ (распознан)", rightX, rightY);
    const g = opts.gpzu;
    const gp: Array<[string, string]> = [];
    if (g.site_width_m && g.site_depth_m) gp.push(["Габариты", `${g.site_width_m} × ${g.site_depth_m} м`]);
    if (g.site_area_m2) gp.push(["Площадь", `${g.site_area_m2.toFixed(0)} м²`]);
    if (g.max_floors)   gp.push(["Этажность", `до ${g.max_floors}`]);
    if (g.max_height_m) gp.push(["Высота", `до ${g.max_height_m} м`]);
    if (g.max_coverage_pct) gp.push(["% застройки", `${g.max_coverage_pct}%`]);
    if (g.max_far) gp.push(["КИТ", g.max_far.toFixed(2)]);
    if (g.purpose_allowed.length) gp.push(["Назначение", g.purpose_allowed.join(", ")]);
    if (gp.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 140);
      doc.text("Поля не извлечены", rightX, rightY + 5);
      rightY += 8;
    } else {
      rightY = drawKeyValueList(doc, gp, rightX, rightY, colW);
    }
    rightY += 4;
  }

  if (opts.contour) {
    rightY = drawSectionTitle(doc, "AI-анализ контура", rightX, rightY);
    const a = opts.contour;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 55);
    const lines = doc.splitTextToSize(a.shape_summary, colW);
    doc.text(lines, rightX, rightY + 4);
    rightY += 4 + lines.length * 4;

    if (a.context_features.length > 0) {
      rightY += 2;
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 130);
      const ctx = a.context_features.slice(0, 5).map((c) => `· ${c}`);
      const ctxLines = doc.splitTextToSize(ctx.join("   "), colW);
      doc.text(ctxLines, rightX, rightY + 3);
      rightY += 3 + ctxLines.length * 3.5;
    }

    if (a.recommendations.length > 0) {
      rightY += 3;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(70, 70, 100);
      doc.text("Рекомендации:", rightX, rightY + 3);
      rightY += 6;

      doc.setFont("helvetica", "normal");
      for (const r of a.recommendations.slice(0, 4)) {
        doc.setFontSize(8);
        doc.setTextColor(30, 30, 50);
        doc.text(`• ${r.title}`, rightX, rightY);
        rightY += 4;
        doc.setFontSize(7.5);
        doc.setTextColor(110, 110, 130);
        const dt = doc.splitTextToSize(`  ${r.detail}`, colW);
        doc.text(dt, rightX, rightY);
        rightY += dt.length * 3.4 + 1.5;
      }
    }
    rightY += 4;
  }

  // ── Содержание (TOC) — на нижней правой колонке ─────────────────────────
  const tocY = Math.max(rightY, leftY) + 2;
  if (tocY < y + h - 30) {
    drawSectionTitle(doc, "Содержание отчёта", x, tocY);
    let tocCursor = tocY + 6;
    const toc: Array<[string, number]> = [
      ["AI Чертежи планировки", opts.aiPlans.length],
      ["Посадка ЖК на участок", opts.placement.length],
      ["Экстерьер",             opts.exteriorUrl ? 1 : 0],
      ["План с мебелью",        opts.floorplanFurnitureUrl ? 1 : 0],
      ["Интерьеры по типам",    opts.interiors.length],
    ];
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    let pageN = 2; // обложка = 1
    for (const [title, n] of toc) {
      if (n === 0) continue;
      doc.setTextColor(40, 40, 55);
      doc.text(`${title}`, x, tocCursor);
      doc.setTextColor(120, 120, 140);
      doc.text(`${n} ${n === 1 ? "стр." : "стр."} · с. ${pageN}–${pageN + n - 1}`, x + colW, tocCursor, { align: "right" });
      pageN += n;
      tocCursor += 5.5;
    }
  }
}

function drawSectionTitle(doc: jsPDF, title: string, x: number, y: number): number {
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 120, 160);
  doc.text(title.toUpperCase(), x, y);
  doc.setDrawColor(220, 220, 230);
  doc.setLineWidth(0.2);
  doc.line(x, y + 1.5, x + 60, y + 1.5);
  return y + 6;
}

function drawKeyValueList(
  doc: jsPDF, rows: Array<[string, string]>,
  x: number, y: number, colW: number,
): number {
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  let cursor = y;
  for (const [k, v] of rows) {
    doc.setTextColor(120, 120, 140);
    doc.text(k, x, cursor);
    doc.setTextColor(30, 30, 50);
    doc.text(v, x + colW, cursor, { align: "right" });
    cursor += 5;
  }
  return cursor;
}
