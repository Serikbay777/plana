import { getToken } from "./auth";
import type { PromptFormState } from "@/components/PromptForm";

const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ??
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:8001");

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

class ProjectsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const b = await res.json(); detail = b.detail ?? detail; } catch { /* ignore */ }
    throw new ProjectsError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectAsset = {
  id: string;
  project_id: string;
  run_id: string | null;
  tab: string;
  variant_key: string;
  floor: number;
  url: string;
  model_used: string | null;
  created_at: string;
};

export type GenerationRun = {
  id: string;
  project_id: string;
  tab: string;
  floor: number;
  params_snapshot: PromptFormState;
  created_at: string;
  assets: ProjectAsset[];
};

export type Project = {
  id: string;
  name: string;
  params: Record<string, unknown>;
  thumbnail_url: string | null;
  thumbnails: string[];
  asset_count: number;
  run_count: number;
  created_at: string;
  updated_at: string;
  assets?: ProjectAsset[];
};

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

export async function createProject(name: string, params: PromptFormState): Promise<Project> {
  return req("/projects", {
    method: "POST",
    body: JSON.stringify({ name, params }),
  });
}

export async function listProjects(): Promise<Project[]> {
  return req("/projects");
}

export async function getProject(id: string): Promise<Project> {
  return req(`/projects/${id}`);
}

export async function updateProject(id: string, data: { name?: string; params?: PromptFormState }): Promise<Project> {
  return req(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${ENGINE_URL}/projects/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function uploadAsset(
  projectId: string,
  tab: string,
  variantKey: string,
  imageUrl: string,
  modelUsed?: string,
  floor: number = 1,
  runId?: string,
): Promise<ProjectAsset> {
  const blob = await fetch(imageUrl).then((r) => r.blob());
  const fd = new FormData();
  fd.append("tab", tab);
  fd.append("variant_key", variantKey);
  fd.append("floor", String(floor));
  fd.append("model_used", modelUsed ?? "");
  fd.append("run_id", runId ?? "");
  fd.append("image", blob, "asset.png");

  const res = await fetch(`${ENGINE_URL}/projects/${projectId}/assets`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const b = await res.json(); detail = b.detail ?? detail; } catch { /* ignore */ }
    throw new ProjectsError(res.status, detail);
  }
  return res.json() as Promise<ProjectAsset>;
}

// ---------------------------------------------------------------------------
// Generation Runs API
// ---------------------------------------------------------------------------

export async function createRun(
  projectId: string,
  tab: string,
  floor: number,
  paramsSnapshot: PromptFormState,
): Promise<GenerationRun> {
  return req(`/projects/${projectId}/runs`, {
    method: "POST",
    body: JSON.stringify({ tab, floor, params_snapshot: paramsSnapshot }),
  });
}

export async function listRuns(projectId: string): Promise<GenerationRun[]> {
  return req(`/projects/${projectId}/runs`);
}
