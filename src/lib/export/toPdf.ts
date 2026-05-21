// Sprint 6 v1.0 plan — PDF экспорт через jspdf.
// Минимально: одна страница A4 landscape, в центре — PNG плана с заголовком.
// Многостраничный комплект (по этажу на лист + спецификация) — в v1.5.

import { jsPDF } from "jspdf";
import { svgToPngBlob } from "./toPng";
import { type LayoutFloor } from "@/lib/engine";

export type PdfMeta = {
  projectName?: string;
  floorLabel?: string;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Сделать PDF: A4 landscape, заголовок сверху, на странице — PNG плана
 * с aspect-fit. Возвращает Blob.
 */
export async function planSvgToPdfBlob(
  svg: SVGSVGElement,
  meta: PdfMeta = {},
): Promise<Blob> {
  const pngBlob = await svgToPngBlob(svg, { scaleFactor: 120 });
  const pngDataUrl = await blobToDataUrl(pngBlob);

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();   // 297
  const pageH = pdf.internal.pageSize.getHeight();  // 210

  // Header
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "bold");
  pdf.text(meta.projectName || "План этажа", 14, 14);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  if (meta.floorLabel) pdf.text(meta.floorLabel, 14, 19);
  pdf.text(new Date().toLocaleString("ru-RU"), pageW - 14, 14, { align: "right" });
  pdf.setTextColor(0);

  // Image area: занимает всё под header'ом с отступами
  const top = 24;
  const margin = 14;
  const areaW = pageW - margin * 2;
  const areaH = pageH - top - margin;

  // PNG aspect-fit
  const img = new Image();
  img.src = pngDataUrl;
  await new Promise<void>((res) => { img.onload = () => res(); });
  const ratio = img.width / img.height;
  let drawW = areaW;
  let drawH = areaW / ratio;
  if (drawH > areaH) {
    drawH = areaH;
    drawW = areaH * ratio;
  }
  const x = margin + (areaW - drawW) / 2;
  const y = top + (areaH - drawH) / 2;
  pdf.addImage(pngDataUrl, "PNG", x, y, drawW, drawH);

  // Footer
  pdf.setFontSize(8);
  pdf.setTextColor(140);
  pdf.text("plana — generated", margin, pageH - 6);

  return pdf.output("blob");
}

/** Скачать SVG плана как PDF. */
export async function downloadSvgAsPdf(
  svg: SVGSVGElement,
  filename = "plan.pdf",
  meta: PdfMeta = {},
): Promise<void> {
  const blob = await planSvgToPdfBlob(svg, meta);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Тип LayoutFloor зарезервирован для будущей multi-floor PDF-пачки
// (v1.5: по странице на каждый этаж проекта).
export type _LayoutFloorReserved = LayoutFloor;
