"use client";

// NewProjectWizard — модалка с 4-шаговым conversational wizard'ом
// (Sprint 4 v1.0 plan). По UX Maket-style — но шаги структурированные,
// не чат. Финальный шаг → onComplete(WizardInputs) для последующей
// генерации плана (см. generateLayoutFromWizard в engine.ts).

import { useState } from "react";
import {
  ArrowLeft, ArrowRight, X, Building2, Layers, LayoutGrid, Home, Wand2,
} from "lucide-react";
import {
  type WizardInputs,
  type ProjectType,
} from "@/lib/engine";
import { FootprintEditor } from "./FootprintEditor";
import { RoomChecklist, DEFAULT_ROOMS } from "./RoomChecklist";

export type NewProjectWizardProps = {
  open: boolean;
  onClose: () => void;
  onComplete: (inputs: WizardInputs) => void;
};

const PROJECT_TYPES: ReadonlyArray<{ id: ProjectType; label: string; hint: string }> = [
  { id: "residential_sfh",   label: "Частный дом",    hint: "Single-family, 1-3 этажа" },
  { id: "residential_multi", label: "Малоэтажка",     hint: "Таунхаус, секционка до 6 этажей" },
  { id: "commercial",        label: "Коммерция",      hint: "Офис, ритейл, общественное" },
  { id: "mixed",             label: "Mixed-use",      hint: "Жильё + коммерция в одном здании" },
];

const DEFAULT_INPUTS: WizardInputs = {
  projectType: "residential_sfh",
  floors: 2,
  totalAreaM2: 180,
  footprint: "rect",
  buildingWidth: 12,
  buildingDepth: 10,
  rooms: DEFAULT_ROOMS,
  city: "",
  notes: "",
};

export function NewProjectWizard({ open, onClose, onComplete }: NewProjectWizardProps) {
  const [step, setStep] = useState(0);
  const [inputs, setInputs] = useState<WizardInputs>(DEFAULT_INPUTS);

  if (!open) return null;

  const reset = () => {
    setStep(0);
    setInputs(DEFAULT_INPUTS);
  };

  const close = () => {
    reset();
    onClose();
  };

  const complete = () => {
    onComplete(inputs);
    reset();
  };

  const STEPS = [
    {
      icon: Building2,
      title: "Тип проекта",
      subtitle: "Какое здание ты проектируешь?",
    },
    {
      icon: Layers,
      title: "Этажи и площадь",
      subtitle: "Сколько этажей и какая общая площадь?",
    },
    {
      icon: LayoutGrid,
      title: "Контур здания",
      subtitle: "Какой формы и размера будет в плане?",
    },
    {
      icon: Home,
      title: "Состав помещений",
      subtitle: "Какие комнаты и сколько?",
    },
  ] as const;

  const StepIcon = STEPS[step]!.icon;
  const isLast = step === STEPS.length - 1;

  // Простая валидация для кнопки «Далее»
  const canProceed = (() => {
    switch (step) {
      case 0: return !!inputs.projectType;
      case 1: return inputs.floors >= 1 && inputs.totalAreaM2 > 0;
      case 2: return inputs.buildingWidth > 0 && inputs.buildingDepth > 0;
      case 3: return inputs.rooms.some((r) => r.count > 0);
      default: return false;
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900 text-white">
              <StepIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-zinc-500">
                Новый проект · шаг {step + 1} из {STEPS.length}
              </div>
              <h2 id="wizard-title" className="text-[14px] font-semibold text-zinc-900">
                {STEPS[step]!.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-zinc-100">
          <div
            className="h-full bg-zinc-900 transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <p className="mb-4 text-[12.5px] text-zinc-600">
            {STEPS[step]!.subtitle}
          </p>

          {step === 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROJECT_TYPES.map((pt) => {
                const isActive = inputs.projectType === pt.id;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => setInputs({ ...inputs, projectType: pt.id })}
                    className={
                      "flex flex-col items-start rounded-lg border p-3 text-left transition " +
                      (isActive
                        ? "border-zinc-900 bg-zinc-50 shadow-sm"
                        : "border-zinc-200 bg-white hover:border-zinc-400")
                    }
                  >
                    <span className="text-[13px] font-semibold text-zinc-900">
                      {pt.label}
                    </span>
                    <span className="text-[11px] text-zinc-500 mt-0.5">
                      {pt.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">
                  Этажность: <b className="text-zinc-900">{inputs.floors}</b>
                </label>
                <input
                  type="range"
                  min={1} max={6} step={1}
                  value={inputs.floors}
                  onChange={(e) => setInputs({ ...inputs, floors: Number(e.target.value) })}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
                  <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">
                  Общая площадь (м²)
                </label>
                <input
                  type="number"
                  min={30} max={5000} step={10}
                  value={inputs.totalAreaM2}
                  onChange={(e) => setInputs({ ...inputs, totalAreaM2: Number(e.target.value) })}
                  className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-zinc-400"
                />
                <div className="mt-1 text-[10.5px] text-zinc-500">
                  ≈ {(inputs.totalAreaM2 / inputs.floors).toFixed(0)} м² на этаж
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <FootprintEditor
              shape={inputs.footprint}
              width={inputs.buildingWidth}
              depth={inputs.buildingDepth}
              onChange={({ shape, width, depth }) =>
                setInputs({ ...inputs, footprint: shape, buildingWidth: width, buildingDepth: depth })
              }
            />
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <RoomChecklist
                rooms={inputs.rooms}
                onChange={(rooms) => setInputs({ ...inputs, rooms })}
              />
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">
                  Дополнительные пожелания (необязательно)
                </label>
                <textarea
                  rows={3}
                  value={inputs.notes ?? ""}
                  onChange={(e) => setInputs({ ...inputs, notes: e.target.value })}
                  placeholder="Например: гардеробная при спальне, террасу с южной стороны, кухня-гостиная единым пространством."
                  className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-[12.5px] resize-none focus:outline-none focus:border-zinc-400"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={complete}
              disabled={!canProceed}
              className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-[12.5px] font-medium text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Wand2 className="h-3.5 w-3.5" /> Сгенерировать план
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!canProceed}
              className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Далее <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
