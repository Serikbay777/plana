"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Layers, Plus, Trash2, LogOut, FolderOpen, Clock } from "lucide-react";
import { getSession, signOut } from "@/lib/auth";
import { listProjects, deleteProject, type Project } from "@/lib/projects";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/login"); return; }
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить проект?")) return;
    setDeletingId(id);
    await deleteProject(id).catch(() => {});
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    } catch { return iso; }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header */}
      <header className="px-8 py-4 flex items-center justify-between border-b border-white/[0.06]">
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

      <main className="flex-1 px-8 py-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-[28px] font-semibold tracking-tight">Мои проекты</h1>
          <span className="text-[13px] text-white/40">{projects.length} проект{projects.length === 1 ? "" : projects.length < 5 ? "а" : "ов"}</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-52 rounded-2xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-white/30">
            <FolderOpen size={40} strokeWidth={1.2} />
            <p className="text-[15px]">Пока нет проектов</p>
            <Link
              href="/app"
              className="mt-2 h-9 px-4 rounded-full bg-white text-black text-[13px] font-medium flex items-center gap-1.5 hover:bg-white/90 transition"
            >
              <Plus size={13} />
              Создать первый
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group relative rounded-2xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05] overflow-hidden transition cursor-pointer"
              >
                <Link href={`/app?project=${project.id}`} className="block">
                  {/* Превью */}
                  <div className="h-36 bg-white/[0.04] flex items-center justify-center overflow-hidden">
                    {project.thumbnail_url ? (
                      <img
                        src={project.thumbnail_url}
                        alt={project.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Layers size={32} className="text-white/10" strokeWidth={1} />
                    )}
                  </div>

                  {/* Инфо */}
                  <div className="px-4 py-3">
                    <p className="text-[14px] font-medium text-white/90 truncate">{project.name}</p>
                    <div className="flex items-center gap-1 mt-1 text-[12px] text-white/35">
                      <Clock size={10} />
                      {formatDate(project.updated_at)}
                    </div>
                  </div>
                </Link>

                {/* Удалить */}
                <button
                  onClick={(e) => { e.preventDefault(); handleDelete(project.id); }}
                  disabled={deletingId === project.id}
                  className="absolute top-3 right-3 size-7 rounded-full bg-black/60 border border-white/10 grid place-items-center text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition disabled:opacity-30"
                >
                  <Trash2 size={11} />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
