"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Layers, ArrowRight } from "lucide-react";
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setTimeout(() => {
      signIn(email);
      router.push("/app");
    }, 350);
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-950 flex flex-col">
      <header className="px-8 py-6">
        <Link href="/" className="inline-flex items-center gap-2 text-neutral-900">
          <div className="size-8 rounded-lg bg-neutral-950 grid place-items-center">
            <Layers size={14} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-display">Plana</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px]"
        >
          <div className="text-center mb-10">
            <h1 className="text-[40px] font-semibold tracking-display leading-tight">
              С возвращением
            </h1>
            <p className="text-[15px] text-neutral-500 mt-2.5 leading-relaxed">
              Войдите, чтобы начать проектировать.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@company.com"
              autoFocus
            />
            <Field
              label="Пароль"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
            />

            <button
              type="submit"
              disabled={submitting || !email}
              className="btn-apple h-12 mt-3 flex items-center justify-center gap-2 text-[15px] disabled:opacity-50"
            >
              {submitting ? "Входим…" : (
                <>
                  Продолжить
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            <div className="text-center text-[13px] text-neutral-500 mt-4">
              Demo-доступ. Введите любой email и пароль.
            </div>
          </form>

          <div className="mt-10 pt-8 border-t border-neutral-200/80 text-center">
            <p className="text-[13px] text-neutral-500">
              Ещё нет аккаунта?{" "}
              <button
                type="button"
                onClick={() => {
                  if (!email) setEmail("demo@plana.app");
                  setTimeout(() => submit(new Event("submit") as unknown as React.FormEvent), 0);
                }}
                className="text-[#0a84ff] hover:underline font-medium"
              >
                Войти как гость
              </button>
            </p>
          </div>
        </motion.div>
      </main>

      <footer className="px-8 py-6 text-[12px] text-neutral-400 flex items-center justify-between">
        <span>© 2026 Plana</span>
        <div className="flex items-center gap-5">
          <Link href="/" className="hover:text-neutral-700 transition">На главную</Link>
        </div>
      </footer>
    </div>
  );
}

function Field({
  label, type, value, onChange, placeholder, autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-neutral-500 font-medium pl-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-12 rounded-xl bg-white border border-neutral-200 px-4 text-[15px] placeholder:text-neutral-400 focus:outline-none focus:border-neutral-950 focus:ring-4 focus:ring-neutral-950/5 transition"
      />
    </label>
  );
}
