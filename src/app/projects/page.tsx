"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, Plus, Trash2, LogOut, FolderOpen, Clock,
  Search, LayoutGrid, List, SortAsc, Image as ImageIcon,
  Zap, ChevronRight,
} from "lucide-react";
import { getSession, signOut } from "@/lib/auth";
import { listProjects, deleteProject, type Project } from "@/lib/projects";

const PURPOSE_LABEL: Record<string, string> = {
  residential: "Жилой",
  commercial: "Коммерческий",
  mixed_use: "Смешанный",
  hotel: "Гостиница",
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + "Z");
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "только что";
    if (diffH < 24) return `${diffH} ч назад`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return "вчера";
    if (diffD < 7) return `${diffD} дня назад`;
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const params = project.params as Record<string, unknown>;
  const floors = params.floors as number | undefined;
  const purpose = params.purpose as string | undefined;
  const thumbs = project.thumbnails ?? (project.thumbnail_url ? [project.thumbnail_url] : []);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="group relative rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.04] overflow-hidden transition cursor-pointer"
    >
      <Link href={`/app?project=${project.id}`} className="block">
        {/* Thumbnail grid */}
        <div className="h-40 bg-black/20 overflow-hidden">
          {thumbs.length === 0 ? (
            <div className="w-full h-full grid place-items-center">
              <Layers size={32} className="text-white/[0.07]" strokeWidth={1} />
            </div>
          ) : thumbs.length === 1 ? (
            <img src={thumbs[0]} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full grid gap-0.5 ${thumbs.length >= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-2"}`}>
              {thumbs.slice(0, 4).map((url, i) => (
                <div key={i} className="overflow-hidden bg-white/[0.03]">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="px-4 py-3">
          <p className="text-[14px] font-medium text-white/90 truncate mb-1">{project.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {purpose && (
              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">
                {PURPOSE_LABEL[purpose] ?? purpose}
              </span>
            )}
            {floors && (
              <span className="text-[10.5px] text-white/35">{floors} эт.</span>
            )}
            <span className="text-[10.5px] text-white/25 ml-auto flex items-center gap-1">
              <Clock size={9} /> {formatDate(project.updated_at)}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-4 pb-3 flex items-center gap-3">
          {(project.run_count ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10.5px] text-white/30">
              <Zap size={9} className="text-violet-400/60" />
              {project.run_count} генерац{project.run_count === 1 ? "ия" : project.run_count < 5 ? "ии" : "ий"}
            </div>
          )}
          {(project.asset_count ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10.5px] text-white/30">
              <ImageIcon size={9} />
              {project.asset_count} изображ{project.asset_count === 1 ? "ение" : project.asset_count < 5 ? "ения" : "ений"}
            </div>
          )}
        </div>
      </Link>

      {/* Open button overlay */}
      <div className="absolute inset-0 flex items-end justify-end p-3 opacity-0 group-hover:opacity-100 transition pointer-events-none">
        <div className="h-8 px-3 rounded-full bg-white text-black text-[12px] font-medium flex items-center gap-1.5 shadow-lg pointer-events-none">
          Открыть <ChevronRight size={12} />
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={(e) => { e.preventDefault(); onDelete(project.id); }}
        className="absolute top-3 right-3 size-7 rounded-full bg-black/70 border border-white/10 grid place-items-center text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
        title="Удалить проект"
      >
        <Trash2 size={11} />
      </button>
    </motion.div>
  );
}

type SortKey = "updated" | "created" | "name" | "runs";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/login"); return; }
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить проект и все его изображения?")) return;
    setDeletingId(id);
    await deleteProject(id).catch(() => {});
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  const filtered = projects
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ru");
      if (sortKey === "runs") return (b.run_count ?? 0) - (a.run_count ?? 0);
      if (sortKey === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header */}
      <header className="px-8 py-4 flex items-center justify-between border-b border-white/[0.06] flex-shrink-0">
        <Link href="/app" className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-white grid place-items-center">
            <Layers size={13} className="text-black" strokeWidth={2.5} />
          </div>
          <span className="text-[14px] font-semibold tracking-display">Plana</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="h-8 px-3 rounded-full border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90 transition"
          >
            <Plus size={12} />
            Новый проект
          </Link>
          <button
            onClick={() => { signOut(); router.replace("/"); }}
            className="size-8 rounded-full border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] grid place-items-center text-white/60 hover:text-white/90 transition"
          >
            <LogOut size={12} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-8 py-8 max-w-6xl mx-auto w-full">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Мои проекты</h1>
            {!loading && (
              <p className="text-[13px] text-white/35 mt-0.5">
                {projects.length} проект{projects.length === 1 ? "" : projects.length < 5 ? "а" : "ов"}
              </p>
            )}
          </div>
          <Link
            href="/app"
            className="h-9 px-4 rounded-full bg-white text-black text-[13px] font-medium flex items-center gap-1.5 hover:bg-white/90 transition"
          >
            <Plus size={13} /> Создать
          </Link>
        </div>

        {/* Toolbar */}
        {!loading && projects.length > 0 && (
          <div className="flex items-center gap-3 mb-6">
            {/* Search */}
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию…"
                className="w-full h-9 pl-8 pr-3 rounded-xl bg-white/[0.04] border border-white/[0.07] text-[13px] text-white/80 placeholder:text-white/25 outline-none focus:border-white/20 transition"
              />
            </div>
            {/* Sort */}
            <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.07] rounded-xl p-1">
              <SortAsc size={11} className="text-white/30 ml-1" />
              {(["updated", "created", "name", "runs"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  className={[
                    "h-7 px-2.5 rounded-lg text-[11.5px] transition",
                    sortKey === k ? "bg-white/15 text-white" : "text-white/45 hover:text-white/70",
                  ].join(" ")}
                >
                  {{ updated: "Изменён", created: "Создан", name: "Имя", runs: "Генерации" }[k]}
                </button>
              ))}
            </div>
            {/* View mode */}
            <div className="flex items-center bg-white/[0.04] border border-white/[0.07] rounded-xl p-1 gap-0.5">
              {(["grid", "list"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={[
                    "size-7 rounded-lg grid place-items-center transition",
                    viewMode === m ? "bg-white/15 text-white" : "text-white/35 hover:text-white/70",
                  ].join(" ")}
                >
                  {m === "grid" ? <LayoutGrid size={12} /> : <List size={12} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-52 rounded-2xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-white/30">
            <Search size={32} strokeWidth={1.2} />
            <p className="text-[14px]">Ничего не найдено по запросу «{search}»</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-white/30">
            <FolderOpen size={40} strokeWidth={1.2} />
            <p className="text-[15px]">Пока нет проектов</p>
            <Link
              href="/app"
              className="mt-2 h-9 px-4 rounded-full bg-white text-black text-[13px] font-medium flex items-center gap-1.5 hover:bg-white/90 transition"
            >
              <Plus size={13} /> Создать первый
            </Link>
          </div>
        ) : viewMode === "grid" ? (
          <AnimatePresence>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={handleDelete} />
              ))}
            </div>
          </AnimatePresence>
        ) : (
          <AnimatePresence>
            <div className="flex flex-col gap-2">
              {filtered.map((project) => (
                <motion.div
                  key={project.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="group flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] transition px-4 py-3"
                >
                  <div className="size-12 rounded-lg overflow-hidden bg-white/[0.04] flex-shrink-0">
                    {project.thumbnail_url ? (
                      <img src={project.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center">
                        <Layers size={16} className="text-white/15" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/85 truncate">{project.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {(project.run_count ?? 0) > 0 && (
                        <span className="text-[11px] text-white/30 flex items-center gap-1">
                          <Zap size={9} className="text-violet-400/50" />
                          {project.run_count} ген.
                        </span>
                      )}
                      <span className="text-[11px] text-white/25 flex items-center gap-1">
                        <Clock size={9} /> {formatDate(project.updated_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                    <Link
                      href={`/app?project=${project.id}`}
                      className="h-7 px-3 rounded-full bg-white/[0.08] border border-white/[0.1] text-[11.5px] text-white/70 hover:text-white hover:bg-white/[0.12] transition flex items-center gap-1"
                    >
                      Открыть <ChevronRight size={10} />
                    </Link>
                    <button
                      onClick={() => handleDelete(project.id)}
                      disabled={deletingId === project.id}
                      className="size-7 rounded-full bg-white/[0.05] border border-white/[0.08] grid place-items-center text-white/30 hover:text-red-400 transition disabled:opacity-30"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
