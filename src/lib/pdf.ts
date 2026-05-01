import jsPDF from "jspdf";
import { APT_COLORS, APT_LABELS, type Plan } from "./engine";

export async function exportPlanToPdf(
  plan: Plan,
  floors: number,
  presetLabel: string,
) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();

  pdf.setFillColor(10, 10, 14);
  pdf.rect(0, 0, W, H, "F");

  // Header
  pdf.setTextColor(237, 237, 237);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text("PLANA · AI Generative Layout", 16, 18);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(160, 160, 170);
  pdf.text(presetLabel, 16, 25);
  pdf.text(new Date().toLocaleDateString("ru-RU"), W - 16, 18, { align: "right" });
  pdf.setDrawColor(80, 80, 100);
  pdf.line(16, 30, W - 16, 30);

  // Plan area
  const planX = 16;
  const planY = 36;
  const planW = W * 0.58;
  const planH = H - planY - 20;

  // bbox of floor polygon
  const xs = plan.floor_polygon.exterior.map((p) => p.x);
  const ys = plan.floor_polygon.exterior.map((p) => p.y);
  const minx = Math.min(...xs);
  const miny = Math.min(...ys);
  const maxx = Math.max(...xs);
  const maxy = Math.max(...ys);
  const sw = maxx - minx;
  const sh = maxy - miny;

  const scale = Math.min(planW / sw, planH / sh);
  const offX = planX + (planW - sw * scale) / 2;
  const offY = planY + (planH - sh * scale) / 2;

  // contour
  pdf.setDrawColor(120, 120, 140);
  pdf.setLineDashPattern([1, 1], 0);
  pdf.rect(offX, offY, sw * scale, sh * scale);
  pdf.setLineDashPattern([], 0);

  // corridors
  pdf.setFillColor(25, 25, 35);
  for (const c of plan.corridors) {
    const cb = bbox(c.polygon);
    pdf.rect(
      offX + (cb.minx - minx) * scale,
      offY + (cb.miny - miny) * scale,
      cb.w * scale,
      cb.h * scale,
      "F",
    );
  }

  // core
  pdf.setFillColor(40, 40, 60);
  pdf.setDrawColor(80, 80, 100);
  pdf.setLineWidth(0.2);
  const cb = bbox(plan.core.polygon);
  pdf.rect(
    offX + (cb.minx - minx) * scale,
    offY + (cb.miny - miny) * scale,
    cb.w * scale,
    cb.h * scale,
    "FD",
  );

  // tiles
  for (const t of plan.tiles) {
    const tb = bbox(t.polygon);
    const fill = hexToRgb(APT_COLORS[t.apt_type] ?? "#a78bfa");
    pdf.setFillColor(fill[0], fill[1], fill[2]);
    pdf.setDrawColor(fill[0], fill[1], fill[2]);
    pdf.setLineWidth(0.15);
    pdf.rect(
      offX + (tb.minx - minx) * scale,
      offY + (tb.miny - miny) * scale,
      tb.w * scale,
      tb.h * scale,
      "FD",
    );
    if (tb.w * scale > 12 && tb.h * scale > 8) {
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(7);
      pdf.text(
        APT_LABELS[t.apt_type] ?? t.label,
        offX + (tb.minx - minx + tb.w / 2) * scale,
        offY + (tb.miny - miny + tb.h / 2) * scale,
        { align: "center" },
      );
      pdf.setFontSize(6);
      pdf.setTextColor(220, 220, 230);
      pdf.text(
        `${t.area.toFixed(0)} м²`,
        offX + (tb.minx - minx + tb.w / 2) * scale,
        offY + (tb.miny - miny + tb.h / 2) * scale + 3,
        { align: "center" },
      );
    }
  }

  // Right column
  const colX = planX + planW + 8;
  const colW = W - colX - 16;
  let cy = planY;

  pdf.setTextColor(160, 160, 170);
  pdf.setFontSize(8);
  pdf.text("ВЫБРАННЫЙ ВАРИАНТ", colX, cy);
  cy += 6;
  pdf.setTextColor(237, 237, 237);
  pdf.setFontSize(13);
  pdf.setFont("helvetica", "bold");
  const titleLines = pdf.splitTextToSize(presetLabel, colW);
  pdf.text(titleLines, colX, cy);
  cy += (titleLines as string[]).length * 5 + 4;

  pdf.setDrawColor(60, 60, 80);
  pdf.line(colX, cy, colX + colW, cy);
  cy += 6;

  const m = plan.metrics;
  const stats: [string, string][] = [
    ["Жилая S / этаж", `${m.saleable_area.toFixed(0)} м²`],
    ["КИТ (saleable / floor)", `${(m.saleable_ratio * 100).toFixed(0)}%`],
    ["Квартир / этаж", String(m.apt_count)],
    ["Средняя площадь", `${m.avg_apt_area.toFixed(0)} м²`],
    ["Доля квартир на юг", `${(m.south_oriented_share * 100).toFixed(0)}%`],
    ["Площадь коридоров", `${m.corridor_area.toFixed(0)} м²`],
    ["Площадь ядра", `${m.core_area.toFixed(0)} м²`],
  ];
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  for (const [k, v] of stats) {
    pdf.setTextColor(160, 160, 175);
    pdf.text(k, colX, cy);
    pdf.setTextColor(237, 237, 245);
    pdf.text(v, colX + colW, cy, { align: "right" });
    cy += 5.5;
  }

  cy += 4;
  pdf.setDrawColor(60, 60, 80);
  pdf.line(colX, cy, colX + colW, cy);
  cy += 6;

  pdf.setFontSize(8);
  pdf.setTextColor(160, 160, 175);
  pdf.text(`ИТОГО ПО ОБЪЕКТУ · ${floors} эт.`, colX, cy);
  cy += 6;
  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(167, 139, 250);
  pdf.text(
    `${(m.saleable_area * floors).toLocaleString("ru-RU")} м²`,
    colX,
    cy,
  );
  cy += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(180, 180, 195);
  pdf.text(`${m.apt_count * floors} квартир продаваемой площади`, colX, cy);
  cy += 8;

  // norms section
  pdf.setFontSize(8);
  pdf.setTextColor(160, 160, 175);
  pdf.text("НОРМОКОНТРОЛЬ", colX, cy);
  cy += 5;
  if (plan.norms.passed && plan.norms.violations.length === 0) {
    pdf.setTextColor(140, 200, 140);
    pdf.text("✓ все базовые нормы пройдены", colX, cy);
    cy += 5;
  } else {
    for (const v of plan.norms.violations) {
      pdf.setTextColor(
        v.severity === "error" ? 220 : 220,
        v.severity === "error" ? 90 : 180,
        90,
      );
      const lines = pdf.splitTextToSize(`• [${v.severity}] ${v.message}`, colW);
      pdf.text(lines as string[], colX, cy);
      cy += (lines as string[]).length * 4 + 1.5;
    }
  }

  // Footer
  pdf.setFontSize(7);
  pdf.setTextColor(100, 100, 120);
  pdf.text(
    "Сгенерировано Plana AI · черновое концептуальное решение",
    16,
    H - 8,
  );
  pdf.text("plana.app", W - 16, H - 8, { align: "right" });

  pdf.save(`plana-${plan.preset}-${Date.now()}.pdf`);
}

function bbox(p: { exterior: { x: number; y: number }[] }) {
  const xs = p.exterior.map((pt) => pt.x);
  const ys = p.exterior.map((pt) => pt.y);
  const minx = Math.min(...xs);
  const miny = Math.min(...ys);
  return { minx, miny, w: Math.max(...xs) - minx, h: Math.max(...ys) - miny };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
