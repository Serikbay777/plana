/**
 * PDF export for Plana floor plan reports.
 * Uses jspdf (already installed) + native SVG→Canvas conversion.
 *
 * Layout (A4 portrait):
 *   ┌──────────────────────────────────────────────┐
 *   │  ◉ plana                          дата/время │  ← dark header
 *   ├──────────────────────────────────────────────┤
 *   │  Участок · Этажи · Тип · Вариант · Отступы  │  ← info row
 *   ├──────────────────────────────────────────────┤
 *   │  [SVG план 120mm]    │ [4 KPI + состав]      │
 *   ├──────────────────────────────────────────────┤
 *   │  Норм-контроль                               │
 *   ├──────────────────────────────────────────────┤
 *   │  Экспликация квартир (таблица)               │
 *   ├──────────────────────────────────────────────┤
 *   │  footer                                      │
 *   └──────────────────────────────────────────────┘
 */

import jsPDF from "jspdf";
import type { Plan } from "./engine";
import type { PromptFormState } from "@/components/PromptForm";

// ---- AiPlanVariant type (mirrors page.tsx) ---------------------------------
type AiPlanVariant = {
  key: string;
  label: string;
  imageUrl: string;   // data:image/png;base64,...
  modelUsed: string;
  enhancerUsed: string;
};

// ---- helpers ---------------------------------------------------------------

const PURPOSE_RU: Record<string, string> = {
  residential: "Жилой",
  commercial: "Коммерческий",
  mixed_use: "Смешанный",
  hotel: "Гостиница",
};

type RGB = [number, number, number];
const DARK: RGB = [10, 10, 14];
const GRAY_MED: RGB = [120, 120, 140];
const GRAY_LIGHT: RGB = [200, 200, 215];
const TEXT_DARK: RGB = [20, 20, 30];
const TEXT_MID: RGB = [60, 60, 80];

// SVG → PNG data URL using native browser canvas
async function svgToPng(
  svgEl: SVGSVGElement,
  width = 900,
  height = 900
): Promise<string> {
  return new Promise((resolve, reject) => {
    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svgEl);

    // Substitute CSS font variables with safe fallbacks for embedded canvas rendering
    svgStr = svgStr.replace(
      /var\(--font-geist-(?:sans|mono)[^)]*\)/g,
      "Arial, Helvetica, sans-serif"
    );
    svgStr = svgStr.replace(/var\([^)]+\)/g, "inherit");

    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      // dark background matching the app theme
      ctx.fillStyle = "#0f0f14";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// ---- main export function --------------------------------------------------

export async function exportPlanPdf(opts: {
  plan: Plan;
  floors: number;
  form: PromptFormState;
  presetLabel: string;
  planContainerEl: HTMLDivElement | null;
}) {
  const { plan, floors, form, presetLabel, planContainerEl } = opts;
  const m = plan.metrics;

  // A4 portrait, mm
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210;
  const PH = 297;
  const PAD = 13;
  const CONTENT_W = PW - PAD * 2;

  // ============================================================
  // HEADER BAR
  // ============================================================
  doc.setFillColor(...DARK);
  doc.rect(0, 0, PW, 20, "F");

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("plana", PAD, 13);

  // subtitle
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 160);
  doc.text("AI Floor Plan Report", PAD + 28, 13);

  // date + time
  const now = new Date();
  const dateStr =
    now.toLocaleDateString("ru-RU") +
    " " +
    now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 160);
  doc.text(dateStr, PW - PAD, 13, { align: "right" });

  let y = 26;

  // ============================================================
  // INFO ROW — 5 chips
  // ============================================================
  const infoItems: [string, string][] = [
    ["Участок", `${form.site_width_m} × ${form.site_depth_m} м`],
    ["Этажи", String(floors)],
    ["Тип объекта", PURPOSE_RU[form.purpose] ?? form.purpose],
    ["Вариант", presetLabel],
    [
      "Отступы",
      `${form.setback_front_m} / ${form.setback_side_m} / ${form.setback_rear_m} м`,
    ],
  ];

  const chipW = CONTENT_W / infoItems.length;
  infoItems.forEach(([label, value], i) => {
    const x = PAD + i * chipW;
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY_MED);
    doc.text(label.toUpperCase(), x, y);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT_DARK);
    doc.text(value, x, y + 5);
  });

  y += 13;

  // thin separator
  doc.setDrawColor(...GRAY_LIGHT);
  doc.setLineWidth(0.25);
  doc.line(PAD, y, PW - PAD, y);
  y += 5;

  // ============================================================
  // PLAN IMAGE  (left) + METRICS (right)
  // ============================================================
  const PLAN_W = 118;
  const PLAN_H = 100;
  const METRICS_X = PAD + PLAN_W + 6;
  const METRICS_W = PW - METRICS_X - PAD;

  // --- try to capture SVG
  let planPng: string | null = null;
  if (planContainerEl) {
    const svgEl = planContainerEl.querySelector("svg");
    if (svgEl) {
      try {
        planPng = await svgToPng(svgEl as SVGSVGElement, 900, 750);
      } catch (e) {
        console.warn("[pdf] SVG render failed:", e);
      }
    }
  }

  if (planPng) {
    // slight dark background rect first
    doc.setFillColor(15, 15, 20);
    doc.roundedRect(PAD, y, PLAN_W, PLAN_H, 2, 2, "F");
    doc.addImage(planPng, "PNG", PAD, y, PLAN_W, PLAN_H, "", "FAST");
    // border
    doc.setDrawColor(50, 50, 70);
    doc.setLineWidth(0.3);
    doc.roundedRect(PAD, y, PLAN_W, PLAN_H, 2, 2, "S");
  } else {
    // placeholder
    doc.setFillColor(20, 20, 30);
    doc.roundedRect(PAD, y, PLAN_W, PLAN_H, 2, 2, "F");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 100);
    doc.text("[ план ]", PAD + PLAN_W / 2, y + PLAN_H / 2, { align: "center" });
  }

  // ---- KPI cards (right column) -----------------------------------------
  const totalSaleable = Math.round(m.saleable_area * floors);
  const kpiItems = [
    {
      label: "Жилая S (1 эт.)",
      value: `${m.saleable_area.toFixed(0)} м²`,
      sub: `× ${floors} эт. = ${totalSaleable.toLocaleString("ru-RU")} м²`,
    },
    { label: "КИТ", value: `${(m.saleable_ratio * 100).toFixed(0)}%` },
    { label: "Квартир", value: String(m.apt_count) },
    {
      label: "Ориентация юг",
      value: `${(m.south_oriented_share * 100).toFixed(0)}%`,
    },
  ];

  let ky = y;
  kpiItems.forEach((item) => {
    const cardH = item.sub ? 18 : 14;
    doc.setFillColor(242, 242, 248);
    doc.roundedRect(METRICS_X, ky, METRICS_W, cardH, 2, 2, "F");

    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY_MED);
    doc.text(item.label.toUpperCase(), METRICS_X + 3.5, ky + 4.5);

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT_DARK);
    doc.text(item.value, METRICS_X + 3.5, ky + 11);

    if (item.sub) {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY_MED);
      doc.text(item.sub, METRICS_X + 3.5, ky + 15.5);
    }

    ky += cardH + 2.5;
  });

  // ---- Apt mix (below KPI cards) ----------------------------------------
  ky += 2;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_MID);
  doc.text("Состав квартир", METRICS_X, ky);
  ky += 5;

  type AptGroup = { label: string; color: RGB; types: string[] };
  const aptGroups: AptGroup[] = [
    { label: "Студии", color: [34, 211, 238], types: ["studio"] },
    { label: "1К / Евро-1", color: [167, 139, 250], types: ["k1", "euro1"] },
    { label: "2К / Евро-2", color: [245, 158, 11], types: ["k2", "euro2"] },
    { label: "3К+", color: [244, 114, 182], types: ["k3", "euro3", "k4"] },
  ];

  aptGroups.forEach((grp) => {
    const count = grp.types.reduce(
      (s, t) => s + ((m.apt_by_type as Record<string, number>)[t] ?? 0),
      0
    );
    if (count === 0) return;
    const pct =
      m.apt_count > 0 ? Math.round((count / m.apt_count) * 100) : 0;

    doc.setFillColor(...grp.color);
    doc.circle(METRICS_X + 2, ky - 0.8, 1.5, "F");

    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_MID);
    doc.text(`${grp.label}: ${count} (${pct}%)`, METRICS_X + 7, ky + 0.2);
    ky += 5.5;
  });

  // advance y past both columns
  y += Math.max(PLAN_H, ky - y) + 7;

  // ============================================================
  // SEPARATOR + NORM CONTROL
  // ============================================================
  doc.setDrawColor(...GRAY_LIGHT);
  doc.setLineWidth(0.25);
  doc.line(PAD, y, PW - PAD, y);
  y += 5;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_MID);
  doc.text("Норм-контроль", PAD, y);
  y += 5;

  if (plan.norms.violations.length === 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(22, 163, 74);
    doc.text("✓  Нарушений нет — план соответствует нормам СНиП/СП", PAD, y);
    y += 7;
  } else {
    plan.norms.violations.forEach((v) => {
      const isError = v.severity === "error";
      const icon = isError ? "✗" : "!";
      const color: RGB = isError ? [220, 38, 38] : [217, 119, 6];
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...color);
      // wrap long messages
      const lines = doc.splitTextToSize(
        `${icon}  ${v.message}`,
        CONTENT_W - 6
      ) as string[];
      doc.text(lines, PAD + 3, y);
      y += lines.length * 4.5 + 1;
    });
    y += 2;
  }

  // ============================================================
  // SEPARATOR + APARTMENT TABLE
  // ============================================================
  if (y < PH - 50) {
    doc.setDrawColor(...GRAY_LIGHT);
    doc.setLineWidth(0.25);
    doc.line(PAD, y, PW - PAD, y);
    y += 5;

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT_MID);
    doc.text("Экспликация квартир", PAD, y);
    y += 5;

    // header row
    const cols = ["№", "Тип", "S общ., м²", "S жил., м²", "Ширина, м", "Глубина, м"];
    const colW = [10, 22, 26, 26, 22, 22];

    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 110);
    let tx = PAD;
    cols.forEach((c, i) => {
      doc.text(c, tx, y);
      tx += colW[i];
    });
    y += 1.5;
    doc.setDrawColor(190, 190, 210);
    doc.setLineWidth(0.2);
    doc.line(PAD, y, PW - PAD, y);
    y += 3;

    // rows — as many as fit on the page
    const ROW_H = 4.8;
    const availH = PH - y - 18; // leave room for footer
    const maxRows = Math.min(plan.tiles.length, Math.floor(availH / ROW_H));

    plan.tiles.slice(0, maxRows).forEach((tile, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(246, 246, 252);
        doc.rect(PAD - 1, y - 3.2, CONTENT_W + 2, ROW_H, "F");
      }
      tx = PAD;
      const vals = [
        String(tile.apt_number),
        tile.apt_type,
        tile.area.toFixed(1),
        tile.living_area.toFixed(1),
        tile.width.toFixed(1),
        tile.depth.toFixed(1),
      ];
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_DARK);
      vals.forEach((v, i) => {
        doc.text(v, tx, y);
        tx += colW[i];
      });
      y += ROW_H;
    });

    if (plan.tiles.length > maxRows) {
      doc.setFontSize(7);
      doc.setTextColor(...GRAY_MED);
      doc.text(
        `... и ещё ${plan.tiles.length - maxRows} квартир`,
        PAD,
        y + 2
      );
    }
  }

  // ============================================================
  // FOOTER
  // ============================================================
  doc.setFillColor(...DARK);
  doc.rect(0, PH - 9, PW, 9, "F");

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 130);
  doc.text("Сгенерировано Plana AI · plana.kz", PAD, PH - 3.5);
  doc.text("Стр. 1", PW - PAD, PH - 3.5, { align: "right" });

  // ============================================================
  // SAVE
  // ============================================================
  const safeName = presetLabel.replace(/[^а-яёa-z0-9]/gi, "_").toLowerCase();
  doc.save(`plana_${safeName}_${Date.now()}.pdf`);
}

// ===========================================================================
// AI Plans PDF — несколько вариантов в одном PDF (ландшафт A4, 1 вариант/стр.)
// ===========================================================================

/**
 * Загружает data:URL изображения в HTMLImageElement и возвращает промис.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Масштабирует изображение в canvas с нужными размерами (в пикселях).
 */
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

/**
 * Экспортирует AI-варианты планировки в PDF.
 * Каждый вариант — отдельная страница, A4 ландшафт.
 *
 * @param variants  — один вариант (PDF одной страницы) или массив (все варианты)
 * @param filename  — имя файла без расширения (опционально)
 */
export async function exportAiPlansPdf(
  variants: AiPlanVariant[],
  filename?: string
): Promise<void> {
  if (variants.length === 0) return;

  // A4 landscape: 297 × 210 mm
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297;
  const PH = 210;
  const PAD = 12;
  const HEADER_H = 16;
  const FOOTER_H = 9;
  const IMG_AREA_H = PH - HEADER_H - FOOTER_H - PAD * 2 + PAD; // ~172 mm
  const IMG_AREA_W = PW - PAD * 2;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (i > 0) doc.addPage("a4", "landscape");

    // ---- HEADER BAR ----
    doc.setFillColor(...DARK);
    doc.rect(0, 0, PW, HEADER_H, "F");

    // Logo
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("plana", PAD, 11);

    // Subtitle
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(140, 140, 180);
    doc.text("AI Чертежи планировки", PAD + 24, 11);

    // Variant label (centre)
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 220, 240);
    doc.text(v.label, PW / 2, 10.5, { align: "center" });

    // Page counter (right)
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 160);
    doc.text(`${i + 1} / ${variants.length}`, PW - PAD, 11, { align: "right" });

    // ---- IMAGE ----
    const imgY = HEADER_H + 3;
    const imgH = PH - HEADER_H - FOOTER_H - 6;
    const imgW = IMG_AREA_W;

    try {
      const imgEl = await loadImage(v.imageUrl);
      // fit proportionally inside imgW × imgH
      const scale = Math.min(imgW / imgEl.naturalWidth, imgH / imgEl.naturalHeight);
      const drawW = imgEl.naturalWidth * scale;
      const drawH = imgEl.naturalHeight * scale;
      const drawX = PAD + (imgW - drawW) / 2;
      const drawY = imgY + (imgH - drawH) / 2;

      // Dark background behind image
      doc.setFillColor(15, 15, 22);
      doc.roundedRect(PAD, imgY, imgW, imgH, 2, 2, "F");

      // Encode image for jsPDF (convert data URL to proper size)
      const jpegUrl = imgToDataUrl(imgEl, 2400, 1600);
      doc.addImage(jpegUrl, "JPEG", drawX, drawY, drawW, drawH, "", "FAST");
    } catch {
      // fallback placeholder if image fails
      doc.setFillColor(20, 20, 30);
      doc.roundedRect(PAD, imgY, imgW, imgH, 2, 2, "F");
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 100);
      doc.text("[ изображение недоступно ]", PW / 2, PH / 2, { align: "center" });
    }

    // ---- FOOTER ----
    doc.setFillColor(...DARK);
    doc.rect(0, PH - FOOTER_H, PW, FOOTER_H, "F");

    // Model + enhancer info
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 140);
    const metaStr = [
      v.modelUsed && `Модель: ${v.modelUsed}`,
      v.enhancerUsed && v.enhancerUsed !== "fallback" && `Промпт: ${v.enhancerUsed}`,
    ]
      .filter(Boolean)
      .join("  ·  ");
    doc.text(metaStr, PAD, PH - 3.5);
    doc.text("Plana AI · plana.kz", PW - PAD, PH - 3.5, { align: "right" });
  }

  const safeName = filename ?? `plana-ai-plans-${Date.now()}`;
  doc.save(`${safeName}.pdf`);
}
