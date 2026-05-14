# Phase-2 Research — beyond CAD-tools

> Это вторая волна ресерча, инициированная после [`../tz-alignment.md`](../tz-alignment.md).
> Полное ТЗ AI-платформы требует слоёв, которые CAD-тулы сами по себе не покрывают.
> Здесь — пять связанных подсистем, каждая в отдельном файле.
> Дата: 2026-05-14.

---

## Что внутри

| Файл | Тема | Ключевая рекомендация |
|---|---|---|
| [`pdf-parsers.md`](pdf-parsers.md) | PDF read/render без AGPL-блокера | **`pypdfium2`** (Apache-2) для рендера + **`pdfplumber`** (MIT) для вектора. `pymupdf` (AGPL) — убрать, Artifex §13 явно запрещает SaaS-деплой |
| [`ifc-server.md`](ifc-server.md) | IFC server-side для BIM-импорта/экспорта | **`ifcopenshell` 0.8.5** (LGPL-3) на сервере. `web-ifc` (**MPL-2.0**, не MIT) — только клиентский preview. Docker: `python:3.11-slim`, не alpine |
| [`geometry-shapely.md`](geometry-shapely.md) | 2D geometry kernel для domain model | **Shapely 2.1.2** (BSD-3, vectorized via numpy). Свой ~40-строчный Pydantic-адаптер. `pydantic-shapely` отвергнут (alpha) |
| [`constraint-solvers.md`](constraint-solvers.md) | Размещение квартир через MIP/CSP | **OR-Tools CP-SAT** (Apache-2) ядро + Shapely + NetworkX + scipy.optimize. `AddNoOverlap2D` через `IntervalVar`. `cvxpy` только для continuous resize |
| [`ai-floorplan.md`](ai-floorplan.md) | AI-генерация планировок | **Гибрид: LLM-planner → CP-SAT на 0.3м сетке → KZ-norms validators → scorer → top-K**. Адаптация Co-Layout (Nov 2025). End-to-end LLM **доказанно не работает** (FloorplanQA 2025, 7-31% accuracy) |

---

## TL;DR второй волны

### 1. Стек локков на следующие 6-12 недель

**Сервер (Python, FastAPI engine):**
```
ifcopenshell    LGPL-3   IFC read/write
ezdxf           MIT      DXF read/write  (уже есть)
pypdfium2       Apache-2 PDF render (заменяет pymupdf)
pdfplumber      MIT      PDF vector extract (новое)
shapely         BSD-3    2D geometry (новое)
networkx        BSD-3    Graph for connectivity / fire paths
ortools         Apache-2 CP-SAT constraint solver
scipy           BSD-3    Continuous refinement
pyvisgraph      MIT      Visibility graph (insolation rays)
```

**Клиент (Next.js):**
```
@mlightcad/cad-viewer  MIT      DXF/DWG viewer (background layer)
@tarikjabiri/dxf       MIT      Client-side DXF export
konva + react-konva    MIT      Semantic floor editor canvas
@thatopen/components   MIT      IFC preview (использует web-ifc MPL-2)
three.js               MIT      3D extrusion preview  (уже есть)
```

**Sidecar (Docker):**
```
ODA File Converter     proprietary-free  DWG ↔ DXF мост
```

### 2. Что **изменилось** по итогам второй волны

| Было в [`../recommendation.md`](../recommendation.md) | Стало после next/ |
|---|---|
| `pymupdf` для PDF (просто упоминалось) | ⚠ `pymupdf` AGPL — **убрать**. `pypdfium2` + `pdfplumber` |
| IFC "отложено / TBD" | `ifcopenshell` на сервере, `@thatopen/components` (web-ifc MPL-2) на клиенте — конкретные ETA и интеграция расписаны |
| Geometry — "что-то на numpy" | Shapely 2.1.2 — единый kernel с Pydantic-обвязкой |
| AI-генерация — "отдельный концерн" | Конкретный пайплайн: LLM-planner → CP-SAT-grid → validators → scorer. Не end-to-end |
| Constraint solving — "OR-Tools или cvxpy" | Чётко: CP-SAT для combinatorial, cvxpy только для continuous, MIP fallback |

### 3. Что **подтвердилось**

- Closed-source SaaS совместим с LGPL-3 ifcopenshell через `pip install` (dynamic linking). Юристам — стандартная сверка, не блокер.
- Shapely 2.x достаточно быстр для нашего масштаба (~100 полигонов на этаж). pyclipper не нужен.
- CP-SAT решает 50-100 квартир за секунды-минуты с coarse-to-fine стратегией.
- Конкуренты (TestFit, Forma/Spacemaker, Finch3D, Hypar, Archistar) — **все** rule-based / parametric / graph-core, **никто не делает end-to-end ML** для архитектурной геометрии. Подтверждает гибридное направление.

### 4. Что **новое выяснилось** (важное)

- **`FloorplanQA` (arXiv 2507.07644, 2025)**: GPT-4 / Claude / Gemini дают 7-31% на свободно-пространственных задачах. End-to-end LLM-генерация геометрии **не работает надёжно** — обязательно гибрид с solver.
- **`Co-Layout` (arXiv 2511.12474, Nov 2025)**: ближайший к нашей задаче opensource-пайплайн. LLM multi-agent → IP-модель с coarse-to-fine grid. Scope = одна квартира; мы расширяем на этаж. Прямой template для нас.
- **Wortmann CSP** (Automation in Construction 2023): доказывает что constraint-only решает multi-apartment (8 этажей × 8 квартир за 5 мин). Можно использовать как fallback если LLM-слой проваливается.
- **Российских / казахстанских / советских датасетов планировок не существует** в открытом доступе. RPLAN, Tell2Design — китайская single-apartment. MSD — европейская multi-apartment. House-GAN++, HouseDiffusion **не подходят** для KZ-типологии. Если AI-fine-tune понадобится — собирать свой dataset.

### 5. Что осталось "needs verification" / открытые вопросы

(Не блокеры для старта, но нужно проверять по ходу)

- Юридическая консультация по LGPL-3 ifcopenshell в коммерческом SaaS для KZ-юрисдикции (стандартный python use case, но строгая корпоративная сверка).
- Реальный CP-SAT timing на нашей KZ-norms constraint set — нужен бенчмарк.
- Грид-резолюция (0.3м vs 0.5м vs 0.1м) — trade-off скорость / точность.
- LLM tool-use стабильность на длинных диалогах генерации (10+ tool calls подряд) — gpt-4o / claude / gemini.
- DXF round-trip (импорт DXF → domain model → export DXF) без потери данных — нужны test fixtures.
- Цена коммерческой Artifex-лицензии для pymupdf если решим оставить (для сравнения с затратами на миграцию).

---

## Карта зависимостей между подсистемами

```
                  ┌─────────────────────┐
                  │ Domain Model         │
                  │ (Pydantic + Shapely) │ ← geometry-shapely.md
                  └──┬────────┬──────────┘
                     │        │
       ┌─────────────┘        └──────────────┐
       ▼                                     ▼
┌──────────────────┐               ┌──────────────────┐
│ Input adapters   │               │ Output adapters  │
│ • PDF (pypdfium2 │               │ • DXF (ezdxf)    │
│   + pdfplumber)  │               │ • PDF            │
│ • IFC            │               │ • IFC            │← ifc-server.md
│ • DXF (mlightcad │               │ • DWG (ODA)      │
│   + ezdxf)       │               │ • IFC viewer     │
└──────────────────┘               │   (@thatopen)    │
       ▲                           └──────────────────┘
       │                                     ▲
       │ ← pdf-parsers.md                    │
       │   ifc-server.md                     │
       │                                     │
┌──────┴───────────┐                ┌────────┴────────┐
│ Validators       │                │ AI generator    │
│ (Python, custom) │◄───────────────┤ • LLM planner   │
│ • Insolation     │  валидация     │ • CP-SAT solver │← ai-floorplan.md
│ • Fire safety    │  каждого       │ • Scorer        │
│ • Accessibility  │  варианта      │ • Diversity     │
│ • Setbacks       │                │   filter        │
│ • Parking        │                └─────────────────┘
└────────┬─────────┘                         ▲
         │                                   │
         └────────► OR-Tools CP-SAT ◄────────┘
                   ← constraint-solvers.md
```

Каждый файл в этом каталоге детализирует один из блоков. Связи указаны стрелками.

---

## Что я бы прототипировал в первую очередь

В порядке риска (наиболее рискованное → раннее тестирование):

1. **LLM tool-use генератор** ([`ai-floorplan.md`](ai-floorplan.md) Phase A) — 1 нед. Проверить что GPT-4o / Claude действительно стабильно выдают валидные tool-calls для 5-10 шагов размещения. Это блокер #1.
2. **CP-SAT MVP на 8-12 квартирах** ([`constraint-solvers.md`](constraint-solvers.md)) — 1 нед. Проверить что решается за < 60 сек на нашей constraint set.
3. **Domain model + Shapely Pydantic-адаптер** ([`geometry-shapely.md`](geometry-shapely.md)) — 3 дня. Это foundation, без неё всё остальное висит.
4. **`pypdfium2` миграция** ([`pdf-parsers.md`](pdf-parsers.md)) — 0.5 дня. Самое лёгкое, но снимает legal risk.
5. **`ifcopenshell` round-trip** ([`ifc-server.md`](ifc-server.md)) — 3 дня. Простой Project → IFC → Project через `ifcopenshell.api.*`.

---

## Что осталось НЕ исследованным

Не вошло во вторую волну (если понадобится — третья волна):

- **Symbol library** — DXF-блоки + SVG-иконки для дверей/окон/мебели. Готовых opensource-наборов под KZ-стиль не нашли.
- **Server rendering** — `ezdxf.addons.drawing` упомянут, но не глубже. Если PDF-экспорт будет узким местом — отдельный ресерч (Cairo, ReportLab, WeasyPrint).
- **GIS / site placement detail** — для "посадки здания на участок" с подложкой OSM/Google. Возможно, не понадобится в MVP (локальные координаты ГПЗУ).
- **3D mesh generation** — extrusion полигонов в three.js. Тривиально (1-2 дня), отдельный ресерч не нужен.
- **Authentication / user data** — за scope ресерча. Стандартный NextAuth.
- **Pricing model integration** — за scope ресерча.

---

## Что почитать

- [`pdf-parsers.md`](pdf-parsers.md) — снимает AGPL-блокер
- [`ifc-server.md`](ifc-server.md) — закрывает BIM-требование ТЗ
- [`geometry-shapely.md`](geometry-shapely.md) — фундамент domain model
- [`constraint-solvers.md`](constraint-solvers.md) — placement engine
- [`ai-floorplan.md`](ai-floorplan.md) — самая объёмная и стратегическая часть

И возвращаемся в [`../tz-alignment.md`](../tz-alignment.md) — там общая картина проекта по полному ТЗ.
