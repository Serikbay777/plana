"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Layers, Zap, BarChart3, FileDown, Sparkles, ChevronRight } from "lucide-react";
import { FloorPlan } from "@/components/FloorPlan";
import { generatePlans } from "@/lib/generator";

const HERO_PLAN = generatePlans({
  siteW: 60, siteH: 40,
  setbackFront: 5, setbackSide: 4, setbackRear: 5,
  floors: 9,
  mix: { studio: 25, k1: 35, k2: 30, k3: 10 },
})[0];

const FEATURES = [
  {
    icon: Zap,
    title: "Live-генерация",
    body: "Меняйте параметры участка — план перестраивается мгновенно. Никаких ожиданий.",
  },
  {
    icon: BarChart3,
    title: "Метрики этажа",
    body: "Эффективность, продаваемая площадь, средняя кв.метр — всё в реальном времени.",
  },
  {
    icon: Sparkles,
    title: "AI-консультант",
    body: "Контекстные комментарии по каждому варианту: где плюсы, где риски, что дожать.",
  },
  {
    icon: FileDown,
    title: "Экспорт в PDF",
    body: "Презентационный документ с планом и метриками — одним кликом.",
  },
];

const STEPS = [
  { n: "01", title: "Задайте параметры", body: "Размеры участка, отступы по ГПЗУ, этажность, желаемая квартирография." },
  { n: "02", title: "Получите 3 варианта", body: "Секционная плита, галерейная, башенная — каждая со своими метриками." },
  { n: "03", title: "Сравните и экспортируйте", body: "Выберите оптимум, отправьте архитектору или клиенту в PDF." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-950 selection:bg-blue-200">
      <Nav />

      <Hero />

      <Trust />

      <Features />

      <ProductShot />

      <How />

      <CTA />

      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#fafafa]/75 border-b border-neutral-200/60">
      <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-neutral-950 grid place-items-center">
            <Layers size={13} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[14px] font-semibold tracking-display">Plana</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-[13px] text-neutral-700">
          <a href="#features" className="hover:text-neutral-950 transition">Возможности</a>
          <a href="#how" className="hover:text-neutral-950 transition">Как работает</a>
          <a href="#cta" className="hover:text-neutral-950 transition">Цены</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="h-9 px-4 rounded-full text-[13px] font-medium text-neutral-800 hover:bg-neutral-200/60 transition flex items-center"
          >
            Войти
          </Link>
          <Link
            href="/login"
            className="h-9 px-4 btn-apple text-[13px] flex items-center gap-1.5"
          >
            Попробовать
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative pt-24 pb-20 overflow-hidden">
      <div className="max-w-[1200px] mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-neutral-200/80 text-[12px] text-neutral-700 mb-7 shadow-sm">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Beta · открыта запись
          </div>

          <h1 className="text-[64px] md:text-[88px] font-semibold leading-[0.95] tracking-display max-w-[900px] mx-auto">
            Архитектура,<br />
            <span className="text-neutral-400">за секунды.</span>
          </h1>

          <p className="text-[20px] md:text-[22px] text-neutral-500 mt-7 max-w-[640px] mx-auto leading-relaxed">
            AI-платформа для концептуального проектирования. Загрузите параметры
            участка — получите готовые планировки с метриками и обоснованием.
          </p>

          <div className="flex items-center justify-center gap-3 mt-10">
            <Link
              href="/login"
              className="btn-apple h-12 px-7 flex items-center gap-2 text-[15px]"
            >
              Начать бесплатно
              <ArrowRight size={16} />
            </Link>
            <a
              href="#how"
              className="btn-apple-secondary h-12 px-6 flex items-center gap-1.5 text-[15px]"
            >
              Как это работает
              <ChevronRight size={15} />
            </a>
          </div>

          <div className="text-[13px] text-neutral-400 mt-5">
            Без карты · Без установки · Demo-доступ
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="py-6 border-y border-neutral-200/60">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="text-center text-[11px] uppercase tracking-[0.2em] text-neutral-400 mb-4">
          Используется командами
        </div>
        <div className="flex items-center justify-center gap-10 flex-wrap text-neutral-300 text-[18px] font-semibold tracking-tight">
          <span>ATELIER</span>
          <span>·</span>
          <span>DISTRA</span>
          <span>·</span>
          <span>ARCHIVAULT</span>
          <span>·</span>
          <span>METRIKA</span>
          <span>·</span>
          <span>NORDSTROY</span>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="py-28">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="max-w-[720px] mb-16">
          <div className="text-[12px] uppercase tracking-[0.16em] text-neutral-400 font-medium mb-4">
            Возможности
          </div>
          <h2 className="text-[44px] md:text-[56px] font-semibold tracking-display leading-[1.05]">
            Всё, что нужно для<br />концепта на ранней стадии.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl border border-neutral-200/70 p-8 hover:border-neutral-300 transition"
            >
              <f.icon size={20} className="text-neutral-900 mb-5" strokeWidth={2} />
              <div className="text-[20px] font-semibold tracking-display mb-2">{f.title}</div>
              <div className="text-[15px] text-neutral-500 leading-relaxed">{f.body}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductShot() {
  return (
    <section className="py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="max-w-[720px] mb-12">
          <div className="text-[12px] uppercase tracking-[0.16em] text-neutral-400 font-medium mb-4">
            Студия
          </div>
          <h2 className="text-[44px] md:text-[56px] font-semibold tracking-display leading-[1.05]">
            Концептуальный план<br />
            <span className="text-neutral-400">в один экран.</span>
          </h2>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-3xl overflow-hidden border border-neutral-200 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.18)]"
        >
          <div className="bg-neutral-50 border-b border-neutral-200/70 px-5 py-3 flex items-center gap-2">
            <span className="size-3 rounded-full bg-neutral-300" />
            <span className="size-3 rounded-full bg-neutral-300" />
            <span className="size-3 rounded-full bg-neutral-300" />
            <span className="ml-3 text-[12px] text-neutral-500">plana.app/studio</span>
          </div>
          <div data-theme="dark" className="bg-[#0a0a0c] aspect-[16/9] grid place-items-center p-8">
            <div className="w-full h-full">
              <FloorPlan plan={HERO_PLAN} />
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <Stat value="725" suffix="м²" label="Жилая площадь этажа" />
          <Stat value="78" suffix="%" label="Эффективность плана" />
          <Stat value="3" suffix="сек" label="Среднее время генерации" />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, suffix, label }: { value: string; suffix: string; label: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200/70 p-6">
      <div className="flex items-baseline gap-1">
        <span className="text-[42px] font-semibold tabular tracking-display leading-none">{value}</span>
        <span className="text-[18px] text-neutral-400">{suffix}</span>
      </div>
      <div className="text-[13px] text-neutral-500 mt-2">{label}</div>
    </div>
  );
}

function How() {
  return (
    <section id="how" className="py-28 bg-white border-y border-neutral-200/60">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="max-w-[720px] mb-16">
          <div className="text-[12px] uppercase tracking-[0.16em] text-neutral-400 font-medium mb-4">
            Процесс
          </div>
          <h2 className="text-[44px] md:text-[56px] font-semibold tracking-display leading-[1.05]">
            Три шага<br />
            <span className="text-neutral-400">от участка до плана.</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border border-neutral-200/70 p-8 bg-[#fafafa]"
            >
              <div className="text-[12px] tabular text-neutral-400 mb-6">{s.n}</div>
              <div className="text-[22px] font-semibold tracking-display mb-3">{s.title}</div>
              <div className="text-[15px] text-neutral-500 leading-relaxed">{s.body}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="cta" className="py-32">
      <div className="max-w-[900px] mx-auto px-6 text-center">
        <h2 className="text-[56px] md:text-[80px] font-semibold tracking-display leading-[0.95]">
          Начните<br />
          <span className="text-neutral-400">сейчас.</span>
        </h2>
        <p className="text-[20px] text-neutral-500 mt-7 max-w-[520px] mx-auto leading-relaxed">
          Demo-доступ открыт. Никаких карт, никаких подписок.
        </p>
        <div className="flex items-center justify-center gap-3 mt-10">
          <Link
            href="/login"
            className="btn-apple h-12 px-7 flex items-center gap-2 text-[15px]"
          >
            Начать бесплатно
            <ArrowRight size={16} />
          </Link>
          <a href="mailto:hello@plana.app" className="btn-apple-secondary h-12 px-6 flex items-center text-[15px]">
            Связаться
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-10 border-t border-neutral-200/60">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[12px] text-neutral-400">
        <div className="flex items-center gap-2">
          <div className="size-5 rounded-md bg-neutral-950 grid place-items-center">
            <Layers size={9} className="text-white" strokeWidth={2.5} />
          </div>
          <span>© 2026 Plana</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="mailto:hello@plana.app" className="hover:text-neutral-700 transition">hello@plana.app</a>
          <Link href="/login" className="hover:text-neutral-700 transition">Войти</Link>
        </div>
      </div>
    </footer>
  );
}
