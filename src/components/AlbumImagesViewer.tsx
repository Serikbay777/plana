"use client";

// AlbumImagesViewer — рендерит полный gpt-image альбом (15-30 PNG-листов).
// Каждый лист — изображение в A1-landscape рамке с минимальным wrapper'ом
// (нашим штампом и подписью). PNG приходят уже в формате чертежа от
// gpt-image-1, мы только обрамляем для презентации.

import { useState } from "react";
import { Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { AlbumImagesResponse, AlbumImage } from "@/lib/engine";


export function AlbumImagesViewer({
  album, onClose,
}: {
  album: AlbumImagesResponse;
  onClose?: () => void;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const downloadAll = () => {
    album.images.forEach((img, i) => {
      const a = document.createElement("a");
      a.href = `data:image/png;base64,${img.image_b64}`;
      a.download = `${String(i + 1).padStart(2, "0")}_${img.kind}.png`;
      a.click();
    });
  };

  return (
    <>
      {/* Шапка списка */}
      <div className="px-5 py-3 border-b border-white/[0.04] flex items-center gap-3 flex-wrap bg-[#0a0a12]/85 backdrop-blur sticky top-0 z-10">
        <span className="text-[12px] text-white/70">
          {album.project_name}
        </span>
        <span className="text-[11px] text-white/40">
          {album.images.length} лист{plural(album.images.length)}
          {album.failed_count > 0 && (
            <span className="text-amber-300/85 ml-1.5">
              · {album.failed_count} не сгенерирован{album.failed_count === 1 ? "" : "о"}
            </span>
          )}
          · {(album.elapsed_ms / 1000).toFixed(0)} сек
        </span>
        <div className="flex-1" />
        <button
          onClick={downloadAll}
          className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-500/15 transition"
        >
          <Download size={11} /> Скачать все ({album.images.length})
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="h-7 px-3 rounded-full text-[11.5px] flex items-center gap-1.5 border border-white/15 text-white/70 hover:bg-white/[0.06] transition"
          >
            <X size={12} /> Закрыть
          </button>
        )}
      </div>

      {/* Список листов как вертикальный grid */}
      <div
        className="p-5 grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}
      >
        {album.images.map((img, i) => (
          <SheetCard
            key={i}
            img={img}
            index={i + 1}
            total={album.images.length}
            onClick={() => setLightboxIdx(i)}
          />
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox
          images={album.images}
          startIdx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}


function SheetCard({
  img, index, total, onClick,
}: {
  img: AlbumImage;
  index: number;
  total: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg overflow-hidden cursor-zoom-in border border-white/[0.08] hover:border-white/20 transition group"
    >
      <div className="relative aspect-[1.414/1] bg-white">
        <img
          src={`data:image/png;base64,${img.image_b64}`}
          alt={img.title}
          className="absolute inset-0 w-full h-full object-contain"
        />
        {/* Бейдж в углу с номером листа */}
        <div className="absolute top-2 left-2 h-5 px-1.5 rounded bg-black/55 text-[10.5px] text-white/85 font-medium grid place-items-center">
          {index}/{total}
        </div>
      </div>
      <div className="px-3 py-2 bg-[#0e0e16] border-t border-white/[0.05]">
        <div className="text-[12px] text-white/85 font-medium truncate">{img.title}</div>
        <div className="text-[10px] text-white/35 uppercase tracking-wider mt-0.5">
          {img.label}
        </div>
      </div>
    </div>
  );
}


function Lightbox({
  images, startIdx, onClose,
}: {
  images: AlbumImage[];
  startIdx: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIdx);
  const img = images[idx];
  const next = () => setIdx((i) => (i + 1) % images.length);
  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${img.image_b64}`;
    a.download = `${String(idx + 1).padStart(2, "0")}_${img.kind}.png`;
    a.click();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col"
    >
      {/* Header */}
      <div className="px-5 py-3 flex items-center gap-3 text-white/85" onClick={(e) => e.stopPropagation()}>
        <button onClick={prev} className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/[0.15] grid place-items-center transition">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium">{img.title}</span>
        <span className="text-[11px] text-white/50">{idx + 1} / {images.length}</span>
        <div className="flex-1" />
        <button onClick={download} className="h-9 px-3 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center gap-1.5 text-[12px] transition">
          <Download size={12} /> PNG
        </button>
        <button onClick={next} className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/[0.15] grid place-items-center transition">
          <ChevronRight size={16} />
        </button>
        <button onClick={onClose} className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/[0.15] grid place-items-center transition">
          <X size={16} />
        </button>
      </div>
      {/* Image */}
      <div className="flex-1 grid place-items-center p-6" onClick={(e) => e.stopPropagation()}>
        <img
          src={`data:image/png;base64,${img.image_b64}`}
          alt={img.title}
          className="max-w-full max-h-full object-contain bg-white rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
}


function plural(n: number): string {
  const m = n % 10;
  if (n >= 11 && n <= 14) return "ов";
  if (m === 1) return "";
  if (m >= 2 && m <= 4) return "а";
  return "ов";
}
