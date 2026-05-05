/**
 * PDF export for Plana AI plan variants.
 * Each variant — separate landscape A4 page with the rendered chart on it.
 */

import jsPDF from "jspdf";

type AiPlanVariant = {
  key: string;
  label: string;
  imageUrl: string;   // data:image/png;base64,...
  modelUsed: string;
  enhancerUsed: string;
};

type RGB = [number, number, number];
const DARK: RGB = [10, 10, 14];

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

/**
 * Экспортирует AI-варианты планировки в PDF.
 * Каждый вариант — отдельная страница, A4 ландшафт.
 *
 * @param variants  — один вариант (PDF одной страницы) или массив (все варианты)
 * @param filename  — имя файла без расширения (опционально)
 */
export async function exportAiPlansPdf(
  variants: AiPlanVariant[],
  filename?: string,
): Promise<void> {
  if (variants.length === 0) return;

  // A4 landscape: 297 × 210 mm
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

    // ---- HEADER BAR ----
    doc.setFillColor(...DARK);
    doc.rect(0, 0, PW, HEADER_H, "F");

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("plana", PAD, 11);

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(140, 140, 180);
    doc.text("AI Чертежи планировки", PAD + 24, 11);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 220, 240);
    doc.text(v.label, PW / 2, 10.5, { align: "center" });

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
      const scale = Math.min(imgW / imgEl.naturalWidth, imgH / imgEl.naturalHeight);
      const drawW = imgEl.naturalWidth * scale;
      const drawH = imgEl.naturalHeight * scale;
      const drawX = PAD + (imgW - drawW) / 2;
      const drawY = imgY + (imgH - drawH) / 2;

      doc.setFillColor(15, 15, 22);
      doc.roundedRect(PAD, imgY, imgW, imgH, 2, 2, "F");

      const jpegUrl = imgToDataUrl(imgEl, 2400, 1600);
      doc.addImage(jpegUrl, "JPEG", drawX, drawY, drawW, drawH, "", "FAST");
    } catch {
      doc.setFillColor(20, 20, 30);
      doc.roundedRect(PAD, imgY, imgW, imgH, 2, 2, "F");
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 100);
      doc.text("[ изображение недоступно ]", PW / 2, PH / 2, { align: "center" });
    }

    // ---- FOOTER ----
    doc.setFillColor(...DARK);
    doc.rect(0, PH - FOOTER_H, PW, FOOTER_H, "F");

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
