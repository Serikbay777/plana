# Таб «Архитектурные чертежи» — финальная спецификация (Maket-mapping)

> **Дата:** 2026-05-21
> **Контекст:** plana уже имеет работающий таб arch-drawings (см. [arch_drawings_current_state.md](../plana_current/arch_drawings_current_state.md)). Этот документ — спека того, как **дополнить** его фичами Maket.ai (см. [05_open_questions.md](../maket/05_open_questions.md), [02_editor_stages.md](../maket/02_editor_stages.md), [03_ux_screens.md](../maket/03_ux_screens.md)), и закрыть три выявленных конкурентных окна.

---

## 0. Цель таба

Полноценный AI-редактор архитектурного плана для **жилья и небольшого commercial**, который покрывает путь от ТЗ до экспортируемого комплекта чертежей.

Целевой пользователь — архитектор небольшого бюро, девелопер, или собственник участка в СНГ/Казахстане. Сценарий — feasibility и схематика, **не permit-ready CDs**.

Конкурентное позиционирование против Maket: то же ядро (AI-генерация плана + чат-правка + рендеры), плюс **три окна**:
1. Профессиональный canvas-редактор (snap / layers / multi-select / hotkeys / measurement / multi-floor)
2. Lock / version history / branches
3. Teams / multi-user / API / экспорт в больше форматов

---

## 1. User flow — 9 этапов (по Maket-канве, адаптировано под plana)

```
┌─────────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐
│ 1. Старт    │ → │ 2. Параметры │ → │ 3. AI    │ → │ 4. Редак-│ → │ 5. AI-чат  │
│  проекта    │   │  / Wizard    │   │   ген.   │   │  тор     │   │  правка    │
└─────────────┘   └──────────────┘   └──────────┘   └──────────┘   └────────────┘
                                                                          ↓
┌─────────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐
│ 9. Экспорт  │ ← │ 8. Cost      │ ← │ 7. Нормы │ ← │ 6. Виз.  │ ← │   (loop)   │
│             │   │   estimation │   │ check    │   │  3D/ренд │   │            │
└─────────────┘   └──────────────┘   └──────────┘   └──────────┘   └────────────┘
```

### Этап 1 — Старт проекта (Dashboard)
**Источник Maket:** `/dashboard/projects`, grid карточек, top-bar с кредитами, левый sidebar.

**Что в plana уже есть:** в `app/page.tsx` есть переключатель табов и базовый список (нужно проверить — Explore не углублялся сюда).

**Что добавить:**
- Carousel/Grid карточек проектов с thumbnail плана 1-го этажа
- CTA «Create ▾» с тремя вариантами: **«Из ТЗ»** / **«По параметрам»** / **«С чистого листа»** (Maket has: Plan / Image / Draw from Scratch)
- Top-bar: счётчик кредитов / квот, name space, profile
- Sidebar: «Проекты», «Драфты», «Библиотека стилей», «Community» (опционально), «Помощник по нормам»

### Этап 2 — Wizard
**Источник Maket:** **conversational wizard** (4 вопроса последовательно: этажи → площадь → footprint → комнаты), не классический степпер. Чат-помощник в стиле «Привет, какой ты дом строишь?».

**Что в plana уже есть:** свободный текстовый бриф + enhanceBrief (AI-архитектор уточняет).

**Что добавить — гибрид:**
- **Tab 1: «По параметрам» (conversational wizard)** — 4 шага:
  1. **Тип проекта** — Жилой / Commercial / Mixed-use / Реконструкция. По умолчанию жилой.
  2. **Этажи + площадь** — слайдер 1–6 этажей, поле «общая площадь м²» (отличие от Maket — у нас потолок 6, не 4, плюс мы поддерживаем подвал).
  3. **Контур здания (footprint)** — Rect / L / T / U / Custom polygon (drag vertices). Разный footprint на разные этажи (как у Maket).
  4. **Комнаты** — чек-листы (Спальни, Ванные, Кухня, Гостиная, Гараж, Подсобка) с количеством и адъяценцией. Drag для перестановки приоритета.
- **Tab 2: «Из ТЗ» (свободный текст)** — то что уже есть, `generateLayoutFromBrief`. Кнопка «Улучшить ТЗ через AI» (existing `enhanceBrief`).
- **Tab 3: «С чистого листа»** — пропустить wizard, открыть пустой canvas с включённым tool «Draw Wall».

Внизу всегда: «Surprise me» (рандомизация всех полей с разумными defaults).

### Этап 3 — AI-генерация
**Источник Maket:** генерирует **~4 варианта** плана за ~45 сек, 20 кредитов/этаж. Стены правильных толщин, двери, окна, метки, базовая мебель.

**Что в plana уже есть:** `generateLayoutFromBrief` → один план.

**Что добавить:**
- **Multi-variant generation** — выдавать сразу **4 варианта** (или N по выбору пользователя 1/4/8). Это сильный UX-ход Maket.
- Loading screen с прогресс-баром + забавный тип («Подбираем естественный свет…», «Расставляем мебель…»).
- Galleries view — 4 варианта в 2×2 grid, каждый кликабелен. Hover показывает ключевые метрики (m² жилой, m² подсобной, эффективность планировки %).
- Кнопки на варианте: «Выбрать», «Просто посмотреть», «Variations of this» (re-roll близких).

### Этап 4 — Редактор (главный экран)

**Источник Maket — 3-колоночный layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  TOP-BAR: project name · credits · profile · save · export      │
├──────────┬──────────────────────────────────────┬───────────────┤
│ LEFT     │  CENTER CANVAS                       │ RIGHT         │
│ TOOLBAR  │  (SVG, zoom/pan)                     │ AI CHAT       │
│          │                                      │ + PROPERTIES  │
│ - Select │  [план 1-го этажа]                   │               │
│ - Move   │                                      │ (toggle:      │
│ - Wall   │                                      │  chat /       │
│ - Door   │                                      │  properties)  │
│ - Window │                                      │               │
│ - Stair  │                                      │               │
│ - Room   │                                      │               │
│ - Furn.  │                                      │               │
│ - Dim.   │                                      │               │
│ - Erase  │                                      │               │
│          │                                      │               │
│ Layers:  │                                      │               │
│ □ walls  │                                      │               │
│ □ furn   │                                      │               │
│ □ dims   │                                      │               │
│ □ grid   │                                      │               │
├──────────┴──────────────────────────────────────┴───────────────┤
│ MODE TABS: [Edit] [Build] [Finishes] [Objects] [Visualize]      │
│ FLOOR SELECTOR: [-1] [1] [2] [3]+    Zoom: [-][100%][+]  ↶ ↷   │
└─────────────────────────────────────────────────────────────────┘
```

**Что в plana уже есть:** canvas с zoom/pan, edit-mode, drag комнат, undo/redo, scale-bar, сетка (3 режима), 13 типов мебели, двери с дугами, окна.

**Что добавить:**

#### 4.1. Left Toolbar
| Инструмент | Источник | Hotkey |
|---|---|---|
| Select | новый | `V` |
| Move/Pan | есть | `H` или Space hold |
| Wall draw | новый | `W` |
| Door | есть (но как объект, не как tool) | `D` |
| Window | есть | `N` |
| Stair | есть | `S` |
| Room (rect/polygon) | новый | `R` |
| Furniture (открывает каталог) | есть | `F` |
| Dimension / Measurement | **новый — окно vs Maket** | `M` |
| Eraser | новый | `E` |

#### 4.2. Mode Tabs (по Maket)
- **Edit** — текущий режим (geometry, walls, rooms)
- **Build** — конструкция (несущие/перегородки, толщины, материал стен)
- **Finishes** — отделка (полы, обои, потолки)
- **Objects** — мебель + сантехника + кухня
- **Visualize** — переход в 3D / рендер (этап 6)

#### 4.3. Floor Selector
- Тёплые кнопки этажей `[-1][1][2][3]+`
- Подвал/цоколь обозначаем `-1`, `0`
- Можно копировать план этажа на следующий (как Maket — «duplicate floor»)
- Каждый этаж имеет свой footprint, но связан с одним участком/проектом

#### 4.4. Layers (наше окно vs Maket)
- Чек-боксы видимости: стены / двери / окна / мебель / размеры / сетка / scale-bar / тексты / номера комнат
- Lock-иконка рядом — слой нельзя редактировать (но видно)

#### 4.5. Snap & Measurement (наше окно)
- **Snap-to-grid** (toggle, шаг 0.1 / 0.5 / 1.0 м)
- **Snap-to-wall** (привязка к существующим стенам, end-points, midpoints)
- **Snap-to-angle** (0° / 45° / 90°)
- **Measurement tool** — клик-клик показывает расстояние, угол, площадь полигона
- **Dimension tool** — рисует постоянную размерную линию с числом

#### 4.6. Selection & manipulation (наше окно)
- **Multi-select** (Shift+click, lasso-select rectangle)
- **Group / Ungroup** (`Ctrl+G` / `Ctrl+Shift+G`)
- **Copy / Paste** (`Ctrl+C` / `Ctrl+V`) внутри проекта и между проектами
- **Rotate** drag handle + numeric input (15° snap при Shift)
- **Align/distribute** (центрировать, выровнять по краю, распределить)

#### 4.7. Hotkeys (новое окно vs Maket)
Полная схема в [hotkeys таблице](#приложение-hotkeys) в приложении.

### Этап 5 — AI-чат правка

**Источник Maket:** **фиксированная правая колонка**, не overlay. Plain language («Make the kitchen 30% bigger», «Swap kitchen and dining», «Flip 180°»). Объясняет trade-offs, рекомендует **одну правку за раз**.

**Что в plana уже есть:** `editLayoutWithChat` (текст → JSON-патч). Шаг E в git log.

**Что добавить / усилить:**
- **Толстая правая колонка ~360px**, toggle между «AI Chat» и «Properties».
- Сообщения с **diff-картинками** — «До / После» миниатюры плана.
- **Объяснение trade-offs** — после правки бот пишет: «Кухня выросла на 4 м², но коридор уменьшился до 1.1 м — проверь нормы».
- **Slash-команды** для быстрых действий: `/swap room1 room2`, `/scale +20% kitchen`, `/flip horizontal`, `/copy floor 1 to 2`.
- **Reference plans** — при чате можно прикрепить картинку «как должно быть» (как Maket для рендеров).

#### 5.1. Lock от AI (наше окно — Maket НЕТ)
- Любую комнату / стену можно «залочить» — AI не трогает её при `editLayoutWithChat` и при regenerate.
- Визуальный индикатор: золотая обводка + значок замка в углу.
- Hotkey `L` на выделенном объекте.
- В чате AI явно подтверждает: «Не трогаю Спальню 1 (заблокирована)».

### Этап 6 — Визуализация (3D / рендеры)

**Источник Maket:** Visualize mode, камеры на 2D плане + first-person walkthrough + AI-рендер (Interior/Exterior/Elevation) с text prompt + reference image, ~60–90 с, 10 кредитов.

**Что в plana уже есть:** `visualizeSheet` — Stable Diffusion рендер листа (mode A).

**Что добавить:**
- **Vue mode tab «Visualize»** — переключение в специальный режим (как у Maket).
- **Камеры на 2D-плане** — drag-and-drop иконки камеры, поворот стрелкой направления взгляда.
- **Live preview** в углу — что увидит камера.
- **Render queue** — 3 кнопки рендера:
  - Interior (выбранная комната)
  - Exterior (фасад с угла)
  - Elevation (ортогональный фасад)
- **Style library** — preset стили (modern / classic / minimalism / loft / scandi) + **загрузка reference image** (как Maket).
- **First-person walkthrough** — WASD движение по дому с low-poly preview (опционально, M-приоритет, не первый release).
- **Кредитная стоимость явно показывается** перед кликом «Render» (10 кр) — главная боль Maket users по Trustpilot.

### Этап 7 — Compliance / проверка норм

**Источник Maket:** Regulatory Assistant — отдельная страница, загрузка zoning PDF, Q&A. **Авто-валидация плана против кода обещают в v2.0, но пока нет.** Главное — chat-only, нет визуальной разметки нарушений на canvas.

**Наше окно vs Maket:** **визуализация нарушений прямо на плане**.

**Что сделать:**
- **Тулза «Загрузить нормы»** — PDF загрузка СНиП, городских регламентов, противопожарных норм РК. RAG-индекс.
- **«Проверить план»** кнопка → AI проходит по объектам и подсвечивает нарушения **на canvas**:
  - Красная зона: коридор < 1.2 м
  - Жёлтая зона: спальня < 9 м²
  - Красный крестик: дверь спальни выходит в кухню напрямую
- **Sidebar list** нарушений с jump-to-violation по клику.
- **Q&A чат** — спросить «какая минимальная высота потолка в Алматы для жилого здания» — RAG-ответ со ссылкой на пункт документа.

Минимальный пакет норм для бета — РК (Алматы, Астана), плюс пользовательская загрузка.

### Этап 8 — Cost estimation (наше окно — у Maket нет публично, обещают v2)

**Что сделать (минималка для v1):**
- Калькулятор по квадратам × $/m² по типу помещения (жилое/санузел/кухня/коммерция).
- Региональные справочники (Казахстан, Россия, СНГ) с возможностью переключения.
- Разбивка: фундамент / каркас / инженерия / отделка / мебель.
- Экспорт сметы в Excel/PDF.

**v2 (М-приоритет):**
- Material takeoff (количество материалов).
- Подключение к каталогам поставщиков (опционально).
- HVAC, электрика, сантехника как отдельные слои сметы.

### Этап 9 — Экспорт

**Источник Maket:** DXF, PDF, JPEG. DWG «coming soon». IFC/OBJ/RVT нет.

**Наше окно vs Maket:** больше форматов и **share-link уже в free tier** (Maket даёт только в $20).

**Форматы экспорта v1:**
- ✅ **PDF** — комплект листов (план каждого этажа + общий разрез + фасады + размерные чертежи + спецификация комнат)
- ✅ **PNG / JPEG** — single sheet, hi-res 4K
- ✅ **DXF** — векторный CAD (обязательно — это главный вход в дальнейший workflow)
- ✅ **JSON snapshot** — наш собственный формат для шеринга и повторной загрузки
- ✅ **Share-link** — публичная ссылка viewer (free tier!)
- 🔮 **DWG** — v2 (нужна библиотека / лицензия)
- 🔮 **IFC** — v2 (для BIM-интеграции, наше преимущество над Maket)

---

## 2. Mapping Maket → plana (что внедряем)

| Фича Maket | Что в plana уже есть | Что добавить | Приоритет |
|---|---|---|---|
| Conversational wizard (4 вопроса) | свободный бриф | Step-by-step wizard tab + footprint editor | **Must** |
| Multi-variant generation (4 варианта) | один план | 4 в 2×2 grid | **Must** |
| 3-колоночный editor layout | базовый canvas | LeftToolbar + RightChat panel | **Must** |
| Mode tabs Edit/Build/Finishes/Objects/Visualize | нет | 5 табов сверху canvas | **Must** |
| Multi-floor (1–4 этажа) | один этаж | Floor selector + duplicate floor | **Must** |
| AI-чат как фиксированная правая колонка | есть `editLayoutWithChat` | UI-перевод в правую колонку с diff-картинками + slash-команды | **Must** |
| AI render (Interior/Exterior/Elevation) | `visualizeSheet` (Stable Diffusion) | Камеры на плане, render queue, style library | **Should** |
| Style library + reference image | нет | Каталог стилей + upload | **Should** |
| Regulatory Assistant (Q&A над PDF) | нет | Загрузка zoning + RAG чат | **Should** |
| Credits & top-bar | нет | Кредитная экономика | **Must (продуктово)** |
| Export DXF/PDF/JPEG | нет | Все форматы из этапа 9 | **Must** |

## 3. Наши окна (фичи Maket НЕТ, но мы делаем)

| Фича plana (наше окно) | Источник | Приоритет |
|---|---|---|
| Lock комнат от AI/regenerate | пробел Maket | **Must** |
| Version history + branches | пробел Maket | **Should** |
| Snap-to-grid / wall / angle | пробел Maket | **Must** |
| Multi-select / group / copy-paste | пробел Maket | **Must** |
| Keyboard shortcuts (полная схема) | пробел Maket | **Must** |
| Measurement tool (линейка) + dimension | пробел Maket | **Must** |
| Layer system (видимость + lock) | пробел Maket | **Must** |
| Визуализация нарушений на canvas | пробел Maket (у них только chat) | **Should** |
| Cost estimation v1 (квадраты × $/m²) | пробел Maket | **Should** |
| IFC export | пробел Maket | **Could (v2)** |
| Multi-user / teams / SSO | пробел Maket | **Could (v2)** |
| Public API | пробел Maket | **Could (v2)** |
| Mobile/iPad viewer (не editor) | пробел Maket | **Could (v2)** |

## 4. Что из Maket мы СОЗНАТЕЛЬНО НЕ берём

| Антипаттерн Maket | Почему не берём |
|---|---|
| Кредиты сгорают каждый месяц | Главная жалоба Trustpilot. Делаем накопительные или roll-over до 3 мес. |
| Only residential, 4 этажа max | Поднимаем потолок до 6 этажей + поддерживаем подвал и cmt. mixed-use. |
| Output не permit-ready (явно дисклеймят) | Стремимся к permit-ready в РК. |
| RAG-only Regulatory (без overlay) | Делаем визуальный overlay нарушений. |
| Spatial reasoning issues (машины в доме) | Жёсткие константы — мебель ТОЛЬКО внутри комнат, валидация на этапе генерации. |
| Сложная отписка / спам-маркетинг | Внятный selfsserve cancel в 2 клика. |

---

## 5. Приоритизация для v1 (Must / Should / Could)

### v1.0 (Must) — закрыть основу + 1-е окно
**3 месяца:**
1. Conversational wizard + footprint editor (Rect/L/T/U)
2. Multi-floor (selector + duplicate)
3. 3-колоночный editor layout с mode tabs
4. **Snap-to-grid / wall / angle**
5. **Multi-select, group, copy-paste**
6. **Hotkeys полная схема**
7. **Measurement & dimension tools**
8. **Layers система**
9. Multi-variant generation (4 в grid)
10. AI-чат в правой колонке с slash-командами
11. **Lock комнат**
12. Export PDF / DXF / PNG / JSON-snapshot / share-link

### v1.5 (Should) — закрыть 2-е и 3-е окно
**+2 месяца:**
13. **Version history + branches**
14. Visualize mode (камеры + render queue + style library)
15. Reference image для рендеров
16. **Regulatory Assistant** (Q&A + overlay нарушений на canvas) с базой норм РК
17. **Cost estimation v1**
18. Кредитная экономика + биллинг

### v2.0 (Could) — стратегические окна
**+квартал:**
19. **IFC export** (BIM-мост — крупное конкурентное преимущество)
20. **Public API** (Maket нет — мы делаем)
21. **Teams / Multi-user workspaces / SSO**
22. Walkthrough first-person 3D
23. Material takeoff + HVAC слои
24. **Mobile/iPad viewer**

---

## 6. Влияние на текущий код

| Изменение | Файл / зона | Сложность |
|---|---|---|
| Добавить multi-floor в LayoutFloor | `engine.ts` + типы | Средне — модель становится `LayoutProject { floors: LayoutFloor[] }` |
| Mode tabs | `ArchitecturalDrawingsTab.tsx` | Средне — добавить state mode + рендер по нему |
| Left Toolbar как отдельный компонент | новый `LeftToolbar.tsx` | Низко |
| Right AI Chat panel | новый `RightPanel.tsx` + перенос текущего chat | Средне |
| Snap / measurement | `FloorPlanSvg` + `useSnap` hook | Средне-высоко |
| Multi-select | `FloorPlanSvg` + selection state в reducer | Высоко (state переходит от useRef к reducer) |
| Lock | LayoutRoom + UI индикатор + backend prompt-injection | Низко-средне |
| Version history | новый history store + UI sidebar | Средне |
| Layer system | новый layers state + видимость в FloorPlanSvg | Средне |
| Regulatory overlay | новый `ComplianceOverlay` + RAG backend | Высоко |
| Cost estimation | новый `CostPanel` + калькулятор | Низко-средне |
| Export | новый `ExportModal` + сервер-функции для PDF/DXF | Высоко (DXF особенно) |
| Visualize mode + камеры | новый `VisualizeMode` + расширение `visualizeSheet` | Высоко |

---

## 7. Открытые вопросы (нужны ответы от пользователя/продукта)

1. **Биллинг:** какая модель — кредиты как у Maket, или единая подписка с лимитами? Какие цены для CIS-рынка?
2. **География норм:** РК / РФ / Узбекистан? Какие города в v1 Regulatory?
3. **Целевая аудитория v1:** архитекторы-фрилансеры? Девелоперы? Homeowners? Это влияет на UX-сложность тулбара.
4. **Mobile/iPad:** входит в v1 как viewer или совсем v2?
5. **Backend AI:** Claude (анализ норм) + Stable Diffusion (рендер) — расширяемся до OpenAI / Gemini для редандэнси? Кто платит за GPU?
6. **Permit-ready output:** реально ли это для v1 в РК или явно дисклеймим как Maket?
7. **Pricing:** Free tier? $/мес? Кредитный пакет?

---

## Приложение: Hotkeys

| Hotkey | Действие |
|---|---|
| `V` | Selection tool |
| `H` или Space (hold) | Pan |
| `W` | Draw Wall |
| `D` | Door |
| `N` | Window |
| `S` | Stair |
| `R` | Room (rect) |
| `F` | Furniture catalog |
| `M` | Measurement |
| `E` | Eraser |
| `L` | Lock/unlock selected |
| `G` | Toggle grid |
| `Tab` | Switch chat ↔ properties |
| `1`/`2`/`3`/`4` | Switch mode tab (Edit/Build/Finishes/Objects/Visualize) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo (есть) |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+X` | Copy / Paste / Cut |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
| `Ctrl+A` | Select all on layer |
| `Delete` | Delete selected |
| `Shift+drag` | Constrain to angle 45°/90° |
| `Alt+drag` | Duplicate while dragging |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in/out/reset |
| `[` / `]` | Previous / next floor |
| `Cmd/Ctrl+S` | Save snapshot |
| `Cmd/Ctrl+P` | Print / Export |
| `?` | Hotkey overlay |

---

## Приложение: список ASCII схем нужных экранов

(чтобы дизайнер мог сразу нарисовать — пилотные wireframes)

### 7.1. Dashboard
```
┌──────────────────────────────────────────────────────────────┐
│ plana                  🪙 300 кр   🔔  AT                   │
├──────────┬───────────────────────────────────────────────────┤
│ Проекты  │                                                   │
│ Драфты   │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  │
│ Стили    │  │ [план] │  │ [план] │  │ [план] │  │  + New │  │
│ Нормы    │  │ Дом A  │  │ ЖК Б   │  │ Офис   │  │        │  │
│ Помощь   │  │ 240 м² │  │ 1400м² │  │ 80 м²  │  │        │  │
│          │  └────────┘  └────────┘  └────────┘  └────────┘  │
│          │                                                   │
│          │  Шаблоны:                                         │
│          │  [Single-family] [Townhouse] [Двушка] [Студия]   │
└──────────┴───────────────────────────────────────────────────┘
```

### 7.2. Wizard (Conversational)
```
┌──────────────────────────────────────────────────────────────┐
│ Новый проект — шаг 3 из 4                          [×] Close│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🤖 Какой контур здания?                                    │
│                                                              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐      │
│  │  ▭   │  │  ┐   │  │  ┘   │  │  L   │  │  Custom  │      │
│  │ Rect │  │  ┘ L │  │ ┘  T │  │   U  │  │ polygon  │      │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────────┘      │
│                                                              │
│  Размеры: ширина [12] м  глубина [10] м                    │
│                                                              │
│  ☑ Разный footprint на разных этажах                       │
│                                                              │
│         [← Назад]                          [Далее →]        │
└──────────────────────────────────────────────────────────────┘
```

### 7.3. Editor (главный экран)
```
┌──────────────────────────────────────────────────────────────────┐
│ Дом A · 240 м² · 2 этажа        🪙 280  💾 Save  📤 Export      │
├──────┬───────────────────────────────────────────┬───────────────┤
│ ▣ V  │ [Edit][Build][Finishes][Objects][Visual]  │ 🤖 AI Chat ▼ │
│ ✋ H  │                                            │               │
│ ╱ W  │                                            │ > Make kit-   │
│ 🚪D  │      ┌─────────────────────────────┐      │ chen bigger   │
│ ▢ N  │      │ Спальня1  │ Спальня2        │      │                │
│ ⇈ S  │      │  12 м²    │  10 м²          │      │ ✓ Done. Kit-  │
│ ▭ R  │      │           ├─────┬───────────┤      │ chen +4m², но │
│ 🛋 F  │      │           │ С/у │  Кухня   │      │ коридор -0.2м │
│ 📏 M │      │           │ 4м² │   16м²  ←│←─── │ Проверь:      │
│ 🧹E  │      │ Гостиная  ├─────┘          │      │ "/check norms"│
│      │      │  22 м²    │                │      │                │
│ Lyrs:│      └─────────────────────────────┘      │ ___________   │
│ ☑Wal │                                            │ Type to chat..│
│ ☑Fur │      [1 этаж · 2 этаж +] [-] 100% [+]   │ Slash: /swap, │
│ ☑Dim │       ↶ Undo  ↷ Redo                      │ /scale, /lock │
│ ☐Grd │                                            │               │
└──────┴───────────────────────────────────────────┴───────────────┘
```
