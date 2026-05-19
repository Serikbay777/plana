"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface MaskCanvasHandle {
  /** Returns a PNG data-URL where painted areas are transparent, rest opaque white. */
  exportMask(): string | null;
  clear(): void;
}

interface Props {
  /** Natural width of the underlying image (px). Used to size the export canvas. */
  imageWidth: number;
  /** Natural height of the underlying image (px). */
  imageHeight: number;
  /** Display width of the canvas overlay (CSS px). */
  displayWidth: number;
  /** Display height of the canvas overlay (CSS px). */
  displayHeight: number;
}

const MaskCanvas = forwardRef<MaskCanvasHandle, Props>(
  ({ imageWidth, imageHeight, displayWidth, displayHeight }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const painting = useRef(false);
    const [brushSize, setBrushSize] = useState(24);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, [displayWidth, displayHeight]);

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    function paint(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!painting.current) return;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const { x, y } = getPos(e);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(220, 38, 38, 0.55)";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    useImperativeHandle(ref, () => ({
      exportMask() {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        // Build full-res mask: painted → transparent, unpainted → opaque white
        const offscreen = document.createElement("canvas");
        offscreen.width = imageWidth;
        offscreen.height = imageHeight;
        const ctx = offscreen.getContext("2d")!;

        // Scale factor from display to natural image size
        const scaleX = imageWidth / displayWidth;
        const scaleY = imageHeight / displayHeight;

        // Fill white (keep areas)
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, imageWidth, imageHeight);

        // Draw the user's painted mask scaled up
        ctx.save();
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();

        // Make painted (red-ish) pixels transparent
        const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          // Painted areas: red channel dominant (from rgba(220,38,38,...))
          if (r > 160 && g < 120 && b < 120) {
            d[i] = d[i + 1] = d[i + 2] = 0;
            d[i + 3] = 0; // transparent → OpenAI will repaint
          } else {
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = 255; // opaque white → keep
          }
        }
        ctx.putImageData(imageData, 0, 0);

        return offscreen.toDataURL("image/png");
      },

      clear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
    }));

    return (
      <div className="flex flex-col gap-2">
        <canvas
          ref={canvasRef}
          width={displayWidth}
          height={displayHeight}
          style={{ width: displayWidth, height: displayHeight, cursor: "crosshair", touchAction: "none" }}
          className="absolute inset-0 rounded"
          onPointerDown={(e) => {
            painting.current = true;
            canvasRef.current?.setPointerCapture(e.pointerId);
            paint(e);
          }}
          onPointerMove={paint}
          onPointerUp={() => { painting.current = false; }}
          onPointerCancel={() => { painting.current = false; }}
        />
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur px-3 py-1.5 rounded-full text-white text-xs"
          style={{ pointerEvents: "auto" }}
        >
          <span>Кисть</span>
          <input
            type="range"
            min={8}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24 accent-red-500"
          />
          <span>{brushSize}px</span>
        </div>
      </div>
    );
  },
);

MaskCanvas.displayName = "MaskCanvas";
export default MaskCanvas;
