"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Layers, ArrowRight, AlertCircle } from "lucide-react";
import { register } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register(email, password);
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
      setSubmitting(false);
    }
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
              Создать аккаунт
            </h1>
            <p className="text-[15px] text-neutral-500 mt-2.5 leading-relaxed">
              Начните проектировать прямо сейчас.
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
              placeholder="Не менее 8 символов"
            />
            <Field
              label="Подтвердите пароль"
              type="password"
              value={password2}
              onChange={setPassword2}
              placeholder="••••••••"
            />

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password || !password2}
              className="btn-apple h-12 mt-3 flex items-center justify-center gap-2 text-[15px] disabled:opacity-50"
            >
              {submitting ? "Создаём аккаунт…" : (
                <>
                  Зарегистрироваться
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-neutral-200/80 text-center">
            <p className="text-[13px] text-neutral-500">
              Уже есть аккаунт?{" "}
              <Link href="/login" className="text-[#0a84ff] hover:underline font-medium">
                Войти
              </Link>
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
