"use client";

// RightPanel — фиксированная правая колонка редактора (Maket-style).
// Содержит две вкладки: AI Chat и Properties.
// Sprint 2 v1.0 plan: контейнер + tab-переключатель. Содержимое
// (chat, properties) пробрасывается через props.children — конкретные
// панельки реализуются отдельно (AIChatPanel в Sprint 5, Properties — в
// том же спринте, когда добавим multi-select).

import { type ReactNode, useState } from "react";
import { MessageSquare, Settings2 } from "lucide-react";

export type RightPanelTab = "chat" | "properties";

export type RightPanelProps = {
  chat?: ReactNode;
  properties?: ReactNode;
  /** Контролируемая активная вкладка. Если не задана — компонент сам управляет. */
  activeTab?: RightPanelTab;
  onTabChange?: (tab: RightPanelTab) => void;
  variant?: "light" | "dark";
  className?: string;
};

const THEMES = {
  light: {
    container: "border-l border-zinc-200 bg-white",
    tabBar: "border-b border-zinc-200 bg-zinc-50/50",
    tabActive: "bg-white text-zinc-900 border-b-2 border-zinc-900",
    tabIdle: "text-zinc-500 hover:text-zinc-900 hover:bg-white",
    empty: "text-zinc-400",
  },
  dark: {
    container: "border-l border-white/10 bg-zinc-950/40",
    tabBar: "border-b border-white/10 bg-white/[0.02]",
    tabActive: "bg-white/[0.05] text-white border-b-2 border-white/60",
    tabIdle: "text-white/55 hover:text-white hover:bg-white/[0.04]",
    empty: "text-white/40",
  },
} as const;

export function RightPanel({
  chat,
  properties,
  activeTab: activeTabProp,
  onTabChange,
  variant = "light",
  className,
}: RightPanelProps) {
  const [internalTab, setInternalTab] = useState<RightPanelTab>("chat");
  const active = activeTabProp ?? internalTab;
  const setActive = (t: RightPanelTab) => {
    if (activeTabProp === undefined) setInternalTab(t);
    onTabChange?.(t);
  };

  const theme = THEMES[variant];

  return (
    <aside
      className={
        "flex h-full flex-col " + theme.container + " " + (className ?? "")
      }
      aria-label="Правая панель"
    >
      <div
        className={"flex items-stretch " + theme.tabBar}
        role="tablist"
        aria-label="Правая панель — вкладки"
      >
        <button
          type="button"
          role="tab"
          aria-selected={active === "chat"}
          onClick={() => setActive("chat")}
          className={
            "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium transition " +
            (active === "chat" ? theme.tabActive : theme.tabIdle)
          }
        >
          <MessageSquare className="h-3.5 w-3.5" />
          AI Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "properties"}
          onClick={() => setActive("properties")}
          className={
            "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium transition " +
            (active === "properties" ? theme.tabActive : theme.tabIdle)
          }
        >
          <Settings2 className="h-3.5 w-3.5" />
          Свойства
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {active === "chat" ? (
          chat ?? (
            <div className={"flex h-full items-center justify-center px-4 text-center text-[12px] " + theme.empty}>
              Сгенерируй план, чтобы открыть AI-чат
            </div>
          )
        ) : (
          properties ?? (
            <div className={"flex h-full items-center justify-center px-4 text-center text-[12px] " + theme.empty}>
              Выбери комнату или объект, чтобы редактировать свойства
            </div>
          )
        )}
      </div>
    </aside>
  );
}
