# Архитектурные чертежи (arch-drawings) — текущее состояние plana

> Снэпшот на 2026-05-21. Source: Explore-агент по коду в `d:\Work\OZEN\plana`.

## 1. Файловая структура

| Файл | Назначение |
|---|---|
| [src/components/ArchitecturalDrawingsTab.tsx](../../src/components/ArchitecturalDrawingsTab.tsx) | Главный компонент таба, 1851 строка. Содержит FloorPlanSvg (703–1263), FurnitureItem (1414–1647), DoorSymbol, WindowSymbol |
| [src/lib/engine.ts](../../src/lib/engine.ts) | API-клиент к бэку (строки 1003–1044) — generate / enhance / edit / visualize |
| [src/app/app/page.tsx](../../src/app/app/page.tsx) | Интеграция таба в основную страницу (строки 949–955) |

Бэкенд: `D:\Work\OZEN\k0bi\services\generator` (FastAPI на Render).

## 2. Стек

- **Next.js 16.2.4 + React 19.2.4**
- **Canvas:** чистый SVG (без Konva / Fabric / three.js)
- **Zoom/pan:** CSS transform
- **State:** React hooks + `useRef` (без Redux / Zustand)
- **UI:** Tailwind + lucide-react
- **Хранение:** только в state, без localStorage / БД

## 3. Модель данных

`LayoutFloor` → `LayoutSection` → `LayoutApartment` → `LayoutRoom` → (`LayoutDoor`, `LayoutWindow`, `LayoutFurniture`, `LayoutCore`).

Ядро `LayoutCore` уже различает лифт / лестницу / грузовой лифт (fix «ЛИФТЛИФТ» в недавних коммитах).

## 4. Что уже работает (этапы D-1 … E)

| Этап | Что |
|---|---|
| D-1 | Zoom колесом (0.4×–8×), pan drag, reset double-click |
| D-2 | Edit-mode, selection, drag комнат с snap 0.1 м |
| D-3 | Undo/Redo (Ctrl+Z/Y), history stack |
| E | Chat-итерация — текстовая инструкция → JSON-патч плана |
| — | SVG-визуал в стиле maket.ai, **3 режима сетки**, scale-bar, размерные линии CAD-стиль, 13 типов мебели, двери с дугами открывания |

## 5. AI-функции (через engine.ts)

| Функция | Что делает |
|---|---|
| `generateLayoutFromBrief` | Свободный бриф → JSON-граф плана (Claude на бэке) |
| `enhanceBrief` | AI-архитектор уточняет бриф |
| `editLayoutWithChat` | Текстовая правка → JSON-патч |
| `visualizeSheet` | Stable Diffusion рендер листа (mode A) |

## 6. Зоны расширения (где есть «дырки»)

- ❌ Нет персистентного хранения (только память)
- ❌ Только **один этаж** (многоэтажность отсутствует)
- ❌ Редактируются **только комнаты**, не стены напрямую
- ❌ Нет слоёв (hide/show)
- ❌ Нет импорта/экспорта в собственный формат (JSON snapshot)
- ❌ Нет печати с правильным масштабом
- ❌ Нет lock комнат от regenerate
- ❌ Нет version history (только linear undo/redo)
- ❌ Нет multi-select
- ❌ Нет measurement tool (линейка)
- ❌ Нет copy/paste

Эти «дырки» **идеально совпадают** с тремя окнами, выявленными в ресерче Maket.
