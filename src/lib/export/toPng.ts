// Sprint 6 v1.0 plan — SVG → PNG экспорт через нативный canvas.
// Никаких зависимостей (html2canvas / html-to-image).
//
// Алгоритм:
// 1. Сериализуем outerHTML SVG-узла, вшиваем явные width/height и
//    background-color, чтобы Image корректно его отрендерил.
// 2. Превращаем в data: URL.
// 3. Image → Canvas drawImage → canvas.toBlob → download.
//
// dpi: целевой DPI; SVG-юнит здесь — метр. Чтобы получить читаемые PNG
// при 100 DPI печатном масштабе 1:100, при viewBox 30м×20м нужно
// 30 * (100 dpi / 100 scale * 39.37 in/m) ≈ 1181 px ширина. Дефолт
// scaleFactor=120 даёт ≈ 4K для типовых планов.

export type PngExportOptions = {
  /** Множитель размера: 1 SVG-юнит × scaleFactor = пиксели в PNG. Default 120. */
  scaleFactor?: number;
  /** Фон. Default "#FAF5E6" (бежевый — как в FloorPlanSvg). */
  background?: string;
};

function readSvgViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  }
  // fallback на width/height из DOM
  const rect = svg.getBoundingClientRect();
  return { x: 0, y: 0, w: rect.width || 100, h: rect.height || 100 };
}

/** Превратить SVG-узел в PNG Blob. */
export async function svgToPngBlob(
  svg: SVGSVGElement,
  options: PngExportOptions = {},
): Promise<Blob> {
  const { scaleFactor = 120, background = "#FAF5E6" } = options;

  const vb = readSvgViewBox(svg);
  const pxW = Math.max(1, Math.round(vb.w * scaleFactor));
  const pxH = Math.max(1, Math.round(vb.h * scaleFactor));

  // Клонируем — чтобы не модифицировать живой DOM
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  cloned.setAttribute("width", String(pxW));
  cloned.setAttribute("height", String(pxH));
  // background — отдельный <rect> в начало defs, чтобы PNG не был прозрачным
  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("x", String(vb.x));
  bgRect.setAttribute("y", String(vb.y));
  bgRect.setAttribute("width", String(vb.w));
  bgRect.setAttribute("height", String(vb.h));
  bgRect.setAttribute("fill", background);
  cloned.insertBefore(bgRect, cloned.firstChild);

  const xml = new XMLSerializer().serializeToString(cloned);
  // Используем data URL вместо Blob URL — обходит CORS issue с Image
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Не удалось загрузить SVG как изображение"));
    img.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D-context недоступен");
  ctx.drawImage(img, 0, 0, pxW, pxH);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob вернул null"))),
      "image/png",
      0.95,
    );
  });
}

/** Скачать SVG-узел как PNG. */
export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename = "plan.png",
  options?: PngExportOptions,
): Promise<void> {
  const blob = await svgToPngBlob(svg, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
