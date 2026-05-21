"use client";

// ExportModal — Sprint 6 v1.0 plan.
// Табы PDF / DXF / PNG / JSON / Share. Каждый таб даёт одну кнопку
// «Скачать» с описанием формата.

import { useState } from "react";
import {
  X, FileText, FileCode2, ImageIcon, Database, Share2, Download, Loader2,
  Check, AlertCircle,
} from "lucide-react";

export type ExportTab = "pdf" | "dxf" | "png" | "json" | "share";

export type ExportModalProps = {
  open: boolean;
  onClose: () => void;
  onPdf: () => Promise<void> | void;
  onDxf: () => Promise<void> | void;
  onPng: () => Promise<void> | void;
  onJson: () => Promise<void> | void;
  /** Возвращает share-URL или null если не реализовано. */
  onShare?: () => Promise<string | null>;
  /** Если уже есть share-URL, передать сюда — отобразится как ready. */
  shareUrl?: string | null;
};

type Status = "idle" | "loading" | "done" | "error";

type TabDef = {
  id: ExportTab;
  label: string;
  icon: typeof FileText;
  description: string;
  comingSoon?: boolean;
};

const TABS: ReadonlyArray<TabDef> = [
  { id: "pdf",   label: "PDF",   icon: FileText,
    description: "A4 landscape, заголовок и один план — для распечатки. Многостраничный комплект (по этажу) — в v1.5." },
  { id: "dxf",   label: "DXF",   icon: FileCode2,
    description: "Векторный CAD-формат. Открывается в AutoCAD, QCAD, ArchiCAD, Revit. Со слоями (стены/двери/окна/мебель)." },
  { id: "png",   label: "PNG",   icon: ImageIcon,
    description: "Растровое изображение. По умолчанию ~4K, бежевый фон листа архитектурного чертежа." },
  { id: "json",  label: "JSON",  icon: Database,
    description: ".plana.json — наш формат снэпшота. Можно прислать коллеге и продолжить редактирование. Backwards-compatible." },
  { id: "share", label: "Share", icon: Share2,
    description: "Публичная view-only ссылка. Открывается без авторизации.",
    comingSoon: true },
];

export function ExportModal({
  open, onClose, onPdf, onDxf, onPng, onJson, onShare, shareUrl: shareUrlProp,
}: ExportModalProps) {
  const [active, setActive] = useState<ExportTab>("pdf");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(shareUrlProp ?? null);

  if (!open) return null;

  const handle = async () => {
    setStatus("loading");
    setError(null);
    try {
      switch (active) {
        case "pdf":  await onPdf();  break;
        case "dxf":  await onDxf();  break;
        case "png":  await onPng();  break;
        case "json": await onJson(); break;
        case "share":
          if (onShare) {
            const url = await onShare();
            setShareUrl(url);
          }
          break;
      }
      setStatus("done");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  };

  const activeTab = TABS.find((t) => t.id === active)!;
  const ActiveIcon = activeTab.icon;
  const isShare = active === "share";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 id="export-title" className="text-[14px] font-semibold text-zinc-900">
            Экспорт проекта
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-200 px-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setActive(t.id); setStatus("idle"); setError(null); }}
                className={
                  "relative flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition " +
                  (isActive
                    ? "text-zinc-900 border-b-2 border-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-100 text-zinc-700">
              <ActiveIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-zinc-900">
                {activeTab.label}
                {activeTab.comingSoon && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-700">
                    скоро
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-relaxed">
                {activeTab.description}
              </p>
            </div>
          </div>

          {isShare && shareUrl && (
            <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[12px] text-zinc-700 font-mono break-all">
              {shareUrl}
            </div>
          )}

          {error && (
            <div className="mb-3 flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-[11.5px] text-rose-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handle}
            disabled={status === "loading" || activeTab.comingSoon}
            className={
              "w-full flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-medium transition " +
              (activeTab.comingSoon
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                : "bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50")
            }
          >
            {status === "loading" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Готовим…</>
            ) : status === "done" ? (
              <><Check className="h-4 w-4" /> Готово</>
            ) : isShare ? (
              <><Share2 className="h-4 w-4" /> {shareUrl ? "Создать ещё одну ссылку" : "Создать ссылку"}</>
            ) : (
              <><Download className="h-4 w-4" /> Скачать {activeTab.label}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
