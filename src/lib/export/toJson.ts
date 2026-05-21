// Sprint 6 v1.0 plan — JSON snapshot экспорт/импорт проекта.
// Формат .plana.json — наш собственный для шеринга через файл и
// возможности continue-editing в любой сессии.

import { type LayoutProject } from "@/lib/engine";

export type PlanaSnapshot = {
  format: "plana.snapshot";
  version: 1;
  exportedAt: string;
  project: LayoutProject;
};

/** Сериализовать проект в JSON-строку. */
export function serializeProject(project: LayoutProject): string {
  const snapshot: PlanaSnapshot = {
    format: "plana.snapshot",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
  };
  return JSON.stringify(snapshot, null, 2);
}

/** Скачать проект как .plana.json файл. */
export function downloadProjectJson(project: LayoutProject, filename = "project.plana.json"): void {
  const json = serializeProject(project);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Распарсить .plana.json. Кидает Error если файл невалидный. */
export function parseSnapshot(text: string): LayoutProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл не является валидным JSON");
  }
  if (
    !parsed || typeof parsed !== "object"
    || (parsed as PlanaSnapshot).format !== "plana.snapshot"
  ) {
    throw new Error("Файл не похож на .plana.json snapshot");
  }
  const snap = parsed as PlanaSnapshot;
  if (snap.version !== 1) {
    throw new Error(`Версия snapshot ${snap.version} не поддерживается этой версией plana`);
  }
  if (!snap.project) {
    throw new Error("В snapshot'е нет project");
  }
  return snap.project;
}
