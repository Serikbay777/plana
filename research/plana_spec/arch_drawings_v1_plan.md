# Implementation Plan — Arch Drawings v1.0 (Must-блок)

> **Связанные документы:** [Спецификация](arch_drawings_spec.md), [текущее состояние кода](../plana_current/arch_drawings_current_state.md)
> **Цель:** закрыть 12 Must-фич из v1.0 за **6 спринтов × 2 недели = 3 месяца**

---

## Граф зависимостей (читать сверху вниз)

```
            ┌─────────────────────────────────────────┐
            │ SPRINT 1: FOUNDATION                    │
            │ • Модель LayoutProject { floors[] }    │
            │ • useReducer (заменяет useRef)         │
            │ • Floor selector UI (read-only)        │
            └────────────────┬────────────────────────┘
                             │
            ┌────────────────▼────────────────────────┐
            │ SPRINT 2: EDITOR SHELL                  │
            │ • LeftToolbar (инструменты + заглушки) │
            │ • RightPanel (chat / properties)       │
            │ • Mode Tabs (Edit/Build/Finish/Obj/Viz)│
            │ • Layers (видимость + lock)            │
            └─────┬───────────────────────────┬───────┘
                  │                           │
        ┌─────────▼──────────┐    ┌──────────▼─────────────┐
        │ SPRINT 3: CANVAS   │    │ SPRINT 4: MULTI-FLOOR   │
        │ PRO                │    │ + WIZARD                │
        │ • snap-to-*        │    │ • Floor duplicate       │
        │ • Multi-select     │    │ • Conv. wizard (4 шага) │
        │ • Measure/Dim      │    │ • Footprint editor      │
        │ • Hotkeys + ? help │    │                         │
        └─────────┬──────────┘    └──────────┬──────────────┘
                  │                           │
                  └─────────────┬─────────────┘
                                │
            ┌───────────────────▼─────────────────────┐
            │ SPRINT 5: AI ПРАВКИ + LOCK + VARIANTS   │
            │ • AI Chat в правой колонке + slash      │
            │ • Lock комнат от AI                     │
            │ • Multi-variant generation (4 в grid)   │
            │ • Group / Copy-Paste                    │
            └────────────────┬────────────────────────┘
                             │
            ┌────────────────▼────────────────────────┐
            │ SPRINT 6: EXPORT + POLISH               │
            │ • PDF комплект листов                   │
            │ • DXF export                            │
            │ • PNG / JSON-snapshot / share-link      │
            │ • Bug fixing + UX полировка             │
            └─────────────────────────────────────────┘
```

---

## Pre-work (перед спринтом 1)

Решить **до старта**, иначе блокируется проектирование модели данных:

1. **Биллинг-модель** — кредиты или подписка? (от этого зависит, нужен ли `credits_balance` в `LayoutProject`)
2. **Permit-ready или дисклеймер** — влияет на dimension precision и export forms.
3. **Single tenant или multi-tenant** уже сейчас? (от этого зависит, тащить ли в схему `user_id` / `workspace_id` сразу)

Эти вопросы есть в [спеке, раздел 7](arch_drawings_spec.md). До старта спринта 1 нужны ответы хотя бы на №1 и №3.

---

## Sprint 1 — Foundation (нед 1–2)

### Цель
Подготовить почву: расширить модель данных под multi-floor, перевести state на reducer, добавить базовый floor selector в UI (read-only — пока без duplicate).

### Фичи
- (#2 частично) Multi-floor: модель данных и selector

### Файлы

**Меняем:**
- `src/lib/engine.ts` — ввести `LayoutProject` как корневую сущность, `LayoutFloor[]` внутри. Все API-функции (`generateLayoutFromBrief`, `editLayoutWithChat`, `enhanceBrief`, `visualizeSheet`) принимают/возвращают `LayoutProject`. Бэкенд-контракт обновить, держать обратную совместимость через `floors: [singleFloor]`.
- `src/components/ArchitecturalDrawingsTab.tsx` — заменить `useRef<LayoutFloor>` на `useReducer<LayoutProject, ProjectAction>`. Описать `projectReducer` со всеми текущими действиями (move room, add door, undo/redo и т.д.).

**Новые:**
- `src/lib/projectReducer.ts` — central reducer. Action types: `MOVE_ROOM`, `ADD_DOOR`, `RESIZE_ROOM`, `SET_FLOOR`, `ADD_FLOOR`, `DUPLICATE_FLOOR`, `UNDO`, `REDO`, `APPLY_AI_PATCH`.
- `src/components/editor/FloorSelector.tsx` — кнопки `[-1][1][2][3]+`. Active state + click switches `state.activeFloorIdx`.

### Модель данных

```ts
// engine.ts (new)
export type LayoutProject = {
  id: string
  name: string
  units: 'meters' | 'feet'
  site?: SiteContext       // лот, ориентация — для будущего compliance
  floors: LayoutFloor[]    // 1..N
  activeFloorIdx: number   // что показывается на canvas
  meta: {
    createdAt: string
    updatedAt: string
    schemaVersion: 1
  }
}

// LayoutFloor (existing) — оставляем как было, добавим
export type LayoutFloor = {
  // ...existing fields
  level: number           // -1 (подвал), 0 (цоколь), 1, 2, 3...
  label?: string          // "1 этаж", "Мансарда" и т.д.
  footprint?: PolygonShape // см. Sprint 4
}
```

### Backend
- `services/generator` (FastAPI) — обновить контракт `/generate`, `/edit`, `/enhance` под `LayoutProject`. Шим: если фронт прислал старую модель, оборачиваем в `{ floors: [legacy], activeFloorIdx: 0 }`.
- Никаких изменений в Stable Diffusion / Claude промптах — на этом этапе только структура wrapper-а.

### Definition of Done
- Существующие тесты проходят
- На canvas всё ещё рисуется ровно тот же 1-этажный план
- Floor selector рендерится снизу canvas (`[1]` активная, других пока нет)
- Все правки идут через `dispatch(action)`, нет прямых мутаций
- Undo/redo по-прежнему работает (через reducer)

### Риски
- **Refactor одного большого компонента (1851 строка) на reducer** — высокий риск регрессий. Делать сначала тесты-снэпшоты текущих сценариев, потом рефакторить.
- Backend-контракт может зацепить другие табы plana — проверить, что `engine.ts` импортируется только из arch-drawings.

---

## Sprint 2 — Editor Shell + Mode Tabs + Layers (нед 3–4)

### Цель
Перевести вёрстку с одной колонки в 3-колоночный layout с верхними mode tabs и системой слоёв. Инструменты на toolbar пока заглушки (Sprint 3 их оживит).

### Фичи
- (#3) 3-колоночный layout + mode tabs
- (#8) Layers система

### Файлы

**Новые:**
- `src/components/editor/EditorShell.tsx` — корневая разметка, grid: `auto 1fr auto`.
- `src/components/editor/TopBar.tsx` — название проекта, кредиты, save/export buttons.
- `src/components/editor/LeftToolbar.tsx` — вертикальная панель: V/H/W/D/N/S/R/F/M/E. Каждая кнопка диспатчит `SET_TOOL` (но сам tool пока no-op для большинства).
- `src/components/editor/RightPanel.tsx` — контейнер с табами `[AI Chat] [Properties]`. AI Chat — перенос текущего chat-итерация UI. Properties — пусто (Sprint 5).
- `src/components/editor/ModeTabs.tsx` — `Edit / Build / Finishes / Objects / Visualize` как сегментированный контрол. State `state.mode`.
- `src/components/editor/LayersPanel.tsx` — компактная панель внутри LeftToolbar (раскрывающаяся): чекбоксы видимости walls / doors / windows / furniture / dimensions / grid / texts.

**Меняем:**
- `src/components/ArchitecturalDrawingsTab.tsx` — становится тонким wrapper-ом, рендерит `<EditorShell />`. Бо́льшая часть логики переезжает в `EditorShell` + children.
- `src/components/FloorPlanSvg` — принимает `layersVisibility` prop, рендерит слои условно.
- `projectReducer.ts` — добавить actions `SET_TOOL`, `SET_MODE`, `TOGGLE_LAYER`, `LOCK_LAYER`.

### Definition of Done
- Открываешь /app — видишь новый layout (TopBar, Left, Canvas, Right, ModeTabs внизу canvas, FloorSelector рядом).
- Mode tabs кликабельны и меняют `state.mode`, но визуально каждый mode пока работает одинаково (т.е. логика mode-specific приходит позже).
- Layers — выключаешь мебель / размеры — они исчезают с canvas.
- AI Chat в правой колонке работает как раньше.

### Риски
- Mobile/tablet responsive — на этом этапе осознанно НЕ делаем, фокусируемся на desktop ≥ 1280px.

---

## Sprint 3 — Canvas Pro (нед 5–6)

### Цель
Превратить canvas из «двигаем коробочки» в полноценный CAD-инструмент.

### Фичи
- (#4) Snap-to-grid / wall / angle
- (#5 частично) Multi-select (lasso + Shift)
- (#7) Measurement & Dimension tools
- (#6) Hotkeys + overlay `?`

### Файлы

**Новые:**
- `src/lib/canvas/useSnap.ts` — hook принимает точку (x,y) и `state.snapMode`, возвращает snapped + indicator (где «зацепилось»).
- `src/lib/canvas/useSelection.ts` — multi-select state + lasso math.
- `src/components/editor/MeasureOverlay.tsx` — отображение измерений (клик-клик-линия с подписью).
- `src/components/editor/HotkeysHelp.tsx` — модалка по `?`, таблица hotkeys из спеки (приложение).
- `src/lib/hotkeys.ts` — глобальная регистрация (например через `react-hotkeys-hook`).

**Меняем:**
- `FloorPlanSvg` — все клики и drag проходят через `useSnap`, индикатор snap рендерится.
- `LeftToolbar` — инструменты V / Move / Wall / Door / Window / Stair / Room / Measure / Dimension теперь функциональны.
- `projectReducer.ts` — добавить `SELECT`, `MULTI_SELECT`, `LASSO_SELECT`, `ADD_DIMENSION`.

### Definition of Done
- Удерживаешь Shift при движении стены — снапится на 0.1м (или текущий шаг grid).
- Lasso: drag в пустом месте canvas рисует прямоугольник выделения, при отпускании выделяются попавшие в него комнаты/мебель.
- Shift+click добавляет к выделению.
- Tool `M` — клик-клик показывает живое расстояние.
- Tool Dimension — клик-клик-смещение создаёт постоянную размерную линию, рендерится как часть `LayoutFloor.dimensions[]` (новое поле).
- `?` открывает overlay с ~30 hotkeys.
- Все hotkeys из приложения спеки работают.

### Риски
- Snap-to-wall — нужно эффективно находить ближайшую стену из N. Сделать пространственный индекс (kd-tree или grid-bucket) если планов больше ~50 объектов; для v1 — линейный поиск ок.
- Multi-select rotate/move — переезжать всю группу как одно целое. Может вылезти проблема, что drag-handle комнаты сейчас локально хранит origin. Перевести на абсолютные координаты в reducer.

---

## Sprint 4 — Multi-floor + Wizard (нед 7–8)

### Цель
Дать пользователю несколько этажей и красивый онбординг для нового проекта.

### Фичи
- (#2 полностью) Multi-floor: duplicate floor + UI
- (#1) Conversational wizard + footprint editor

### Файлы

**Новые:**
- `src/components/wizard/NewProjectWizard.tsx` — модалка с 4 шагами (тип / этажи+площадь / footprint / комнаты).
- `src/components/wizard/FootprintEditor.tsx` — Rect / L / T / U / Custom polygon. Drag вершин для Custom. Размеры w/h в input. Galery presets вверху.
- `src/components/wizard/RoomChecklist.tsx` — список комнат с +/- и drag-перестановкой.
- `src/lib/footprint.ts` — утилиты для шаблонных footprint'ов (генерация полигона по форме + размерам).

**Меняем:**
- `FloorSelector` — теперь `[-1][1][2][3] [+ Добавить]`, кнопка copy floor → `DUPLICATE_FLOOR` action.
- `projectReducer.ts` — actions `ADD_FLOOR`, `DELETE_FLOOR`, `DUPLICATE_FLOOR`, `SET_FOOTPRINT`.
- `engine.ts/generateLayoutFromBrief` — принимает `floors_count` и опциональный `footprint_per_floor`. Бэкенд должен генерировать координаты комнат внутри footprint-а.

### Definition of Done
- Кликаешь «New Project» из Dashboard → открывается wizard.
- 4 шага, можно пропустить, можно вернуться назад.
- Финальный шаг → `dispatch(CREATE_PROJECT)` с параметрами, бэк генерит план.
- В редакторе можно добавить этаж, скопировать предыдущий, удалить.
- Footprint редактор: можно выбрать L-форму, изменить размеры, посмотреть превью.

### Риски
- AI-генерация плана внутри произвольного polygon footprint (особенно L и U) — может «уехать». Возможно потребуется итерация на бэке. Если плохо работает — fallback на Rect-only в v1.

---

## Sprint 5 — AI правки + Lock + Variants (нед 9–10)

### Цель
Сделать AI-правки полноценными: фиксированная правая колонка, diff-картинки, slash-команды, lock комнат + multi-variant generation.

### Фичи
- (#10) AI-чат в правой колонке + slash-команды
- (#11) Lock комнат
- (#9) Multi-variant generation (4 в grid)
- (#5 завершить) Group / Copy-Paste

### Файлы

**Новые:**
- `src/components/editor/AIChatPanel.tsx` — переезжает в RightPanel (уже создан в S2). Сообщения с inline-диффами: для каждого AI-ответа делается мини-снэпшот плана до/после.
- `src/lib/chat/slashCommands.ts` — парсер: `/swap r1 r2`, `/scale +20% kitchen`, `/lock`, `/unlock`, `/copy-floor 1 to 2`, `/flip horizontal`, `/check norms` (заглушка до S5.5+).
- `src/components/editor/VariantsGrid.tsx` — 2×2 thumbnail grid, hover показывает метрики (площадь жилой, эффективность).
- `src/lib/render/planThumbnail.ts` — рендер SVG-плана в маленькую PNG для thumbnail.

**Меняем:**
- `engine.ts/generateLayoutFromBrief` — параметр `n_variants: 1 | 4 | 8`, возвращает массив `LayoutProject[]`.
- `engine.ts/editLayoutWithChat` — в промпт добавляется список locked rooms ID, AI инструктируется их не трогать.
- `projectReducer.ts` — actions `LOCK_OBJECT`, `UNLOCK_OBJECT`, `GROUP`, `UNGROUP`, `COPY`, `PASTE`. История для undo/redo для всех.
- `LayoutRoom` (и LayoutWall, LayoutDoor) — добавить поле `locked: boolean`.
- `FloorPlanSvg` — locked объекты обводятся золотым контуром с замочком.

### Backend
- Update prompt template в `services/generator/prompts/edit_layout.txt` (примерно):
  ```
  IMPORTANT: The user has locked the following objects. Do NOT modify them.
  Locked rooms: {{locked_room_ids}}
  Locked walls: {{locked_wall_ids}}
  If the requested change would require touching a locked object, explain why
  and propose an alternative.
  ```

### Definition of Done
- AI Chat показывает миниатюру плана до/после в каждом сообщении.
- `/swap kitchen dining` работает.
- Клик `L` или Lock-кнопка на выделенной комнате → золотой контур + замок.
- Re-generate с заблокированной комнатой — комната остаётся на месте.
- В чате AI explicitly пишет «Спальня 1 заблокирована, не трогаю».
- Кликаешь «Сгенерировать 4 варианта» → 4 thumbnail в Right Panel, клик выбирает один и копирует в основной canvas.
- Ctrl+G / Ctrl+Shift+G работают.

### Риски
- Diff-картинки в чате тяжёлые (2 PNG на каждое сообщение). На v1 — генерим только на сервере по запросу «развернуть diff», иначе долгая история раздувает память.
- AI часто игнорирует «не трогай X» в промпте. Возможно понадобится post-processing: после ответа сравниваем `before.lockedRooms` и `after.lockedRooms`, если что-то поменялось — откатываем эти изменения программно.

---

## Sprint 6 — Export + Polish (нед 11–12)

### Цель
Дать пользователю выгрузить плод трудов и закрыть очевидный tech debt.

### Фичи
- (#12) Export PDF / DXF / PNG / JSON-snapshot / share-link
- Bug fixing, UX polish, performance

### Файлы

**Новые:**
- `src/components/export/ExportModal.tsx` — модалка с 5 вкладками (PDF / DXF / PNG / JSON / Share).
- `src/lib/export/toPdf.ts` — клиентский рендер через `react-pdf` или `pdf-lib`. Шаблон листа: header с проектом, sheet (план/фасад/разрез), titleblock внизу. Многостраничный: по листу на этаж + общий.
- `src/lib/export/toDxf.ts` — векторный экспорт. Использовать `dxf-writer` или собственный writer. Слои: WALLS / DOORS / WINDOWS / FURNITURE / DIMENSIONS / TEXT.
- `src/lib/export/toPng.ts` — `html-to-image` + dpi scaling. 4K hi-res.
- `src/lib/export/toJsonSnapshot.ts` — сериализация `LayoutProject` в файл `.plana.json`. Reverse: drag-and-drop файла → импорт.
- `src/app/share/[id]/page.tsx` — публичный viewer (read-only, без RightPanel, без toolbar).

**Меняем:**
- Backend: `POST /share` — сохраняет snapshot в Postgres (на Render) с UUID, возвращает URL.
- `TopBar` — кнопка Export открывает ExportModal.

### Definition of Done
- Из ExportModal можно вытащить:
  - PDF комплект (один файл, многостраничный)
  - DXF (открывается в AutoCAD/QCAD корректно, слои на месте)
  - PNG (4K, виден весь план + размерные линии)
  - `.plana.json` (можно открыть обратно через drag-and-drop)
  - Share-link (открывается в инкогнито без авторизации, виден view-only план)
- Performance: open editor → first paint < 2s на M1; AI generate 4 variants < 60s.
- Все hotkeys из спеки реально работают.
- Mobile breakpoint: показывается заглушка «Откройте на desktop» (полноценный mobile в v2).

### Риски
- **DXF** — самый рискованный. Если `dxf-writer` не справляется с дугами дверей и сложными полигонами — fallback на простой DXF только со стенами и подписями.
- PDF многостраничный с правильным масштабом 1:50 / 1:100 — кропотливая работа. Можно начать с 1:100 fit-to-page и улучшить позже.

---

## Сводка по новым файлам (быстрый чек-лист)

```
src/components/editor/
├── EditorShell.tsx          [S2]
├── TopBar.tsx               [S2]
├── LeftToolbar.tsx          [S2]
├── RightPanel.tsx           [S2]
├── ModeTabs.tsx             [S2]
├── LayersPanel.tsx          [S2]
├── FloorSelector.tsx        [S1]
├── MeasureOverlay.tsx       [S3]
├── HotkeysHelp.tsx          [S3]
├── AIChatPanel.tsx          [S5]
└── VariantsGrid.tsx         [S5]

src/components/wizard/
├── NewProjectWizard.tsx     [S4]
├── FootprintEditor.tsx      [S4]
└── RoomChecklist.tsx        [S4]

src/components/export/
└── ExportModal.tsx          [S6]

src/lib/
├── projectReducer.ts        [S1]
├── hotkeys.ts               [S3]
├── footprint.ts             [S4]
├── canvas/
│   ├── useSnap.ts           [S3]
│   └── useSelection.ts      [S3]
├── chat/
│   └── slashCommands.ts     [S5]
├── render/
│   └── planThumbnail.ts     [S5]
└── export/
    ├── toPdf.ts             [S6]
    ├── toDxf.ts             [S6]
    ├── toPng.ts             [S6]
    └── toJsonSnapshot.ts    [S6]

src/app/share/[id]/page.tsx  [S6]
```

## Сводка по изменяемым файлам

```
src/lib/engine.ts                              [S1, S4, S5]
  → расширить модель до LayoutProject, n_variants, locked фланг

src/components/ArchitecturalDrawingsTab.tsx    [S1, S2]
  → тонкий wrapper, вся логика переехала в EditorShell

src/components/FloorPlanSvg (внутри ArchTab)   [S2, S3, S5]
  → layers visibility, snap indicators, locked overlay

services/generator/                            [S1, S4, S5]
  → новый контракт API, n_variants, locked-aware prompts
```

---

## Ключевые метрики успеха v1.0

1. **Время от ТЗ до первого варианта плана** — ≤ 60 с (4 варианта)
2. **Время от клика «Make kitchen bigger» до результата** — ≤ 15 с
3. **Open editor → first paint** — ≤ 2 с
4. **Export PDF многостраничный** — ≤ 5 с
5. **DXF корректно открывается** в AutoCAD 2020+ и QCAD
6. **Share-link** — открывается публично без auth, никаких 404 / CORS
7. **Hotkeys: ~30 шорткатов** — все работают
8. **Multi-floor: 4 этажа в одном проекте** — производительность не падает (60 FPS на pan/zoom)
9. **Lock от AI** — на 10 запросах подряд locked комната не меняется ни разу

## Параллелизм работы

Спринты 1 → 2 строго последовательно (фундамент).
Спринты 3 и 4 — **параллельно** (после S2): canvas-инструменты и multi-floor/wizard.
Спринты 5 и 6 — **последовательно**, но в S5 export-работу (S6) можно начать prep'нуть.

При команде из **2 фронтов + 1 фуллстек + 1 дизайнера** — реалистично 3 месяца.
При **1 фронт + 1 фуллстек** — растянется до 4–4.5 месяцев.

---

## Что НЕ входит в v1.0 (явно — чтобы не было соблазна добавить)

- ❌ Visualize mode + камеры + AI-рендер (S7+, v1.5)
- ❌ Regulatory Assistant + overlay нарушений (v1.5)
- ❌ Cost estimation (v1.5)
- ❌ Version history + branches (v1.5)
- ❌ IFC / DWG export (v2.0)
- ❌ Teams / multi-user / SSO (v2.0)
- ❌ Public API (v2.0)
- ❌ Mobile/iPad (v2.0)
- ❌ Walkthrough first-person (v2.0)

Если по ходу выясняется, что какая-то v1.5/v2.0 фича обязательна — это **меняет сроки**, не добавляется «по дороге».
