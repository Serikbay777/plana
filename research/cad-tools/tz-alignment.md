# Alignment с ТЗ — "AI-платформа для архитектурного и планировочного проектирования"

> Этот документ — ре-оценка ресерча CAD-тулов в свете полного ТЗ (см. `AI_architectural_platform_structure.docx.pdf`, май 2026).
> Если вы пришли сюда первым — сначала [README.md](README.md) → [recommendation.md](recommendation.md).

## TL;DR

**CAD-инструменты — это ~30% продукта по ТЗ.** Они закрывают I/O (импорт/экспорт DXF/DWG/IFC/PDF) и часть интерактивного редактора. Но ТЗ требует ещё:

1. **AI-генерация планировок** (Этап 3) — отдельный движок, не CAD
2. **Доменная модель** (Site/Building/Floor/Apartment/Room/Core/Stair/Lift/Shaft) — не raw DXF entities
3. **Проверка нормативов** (Этап 2, "архитектурные ограничения") — у нас уже есть [`research/kz-norms/`](../kz-norms/)
4. **Посадка здания на участок** (Этап 3) — site-уровень, ГПЗУ + отступы, **не floor plan editor**
5. **3D-визуализация для презентации** (Раздел 5)
6. **Экспорт PDF/CAD/BIM** — три разных рендерера на один model

**Рекомендация Phase-1 для CAD ([recommendation.md](recommendation.md)) валидна, но недостаточна.** Нужно расширить стек по слоям.

---

## Что ТЗ добавляет к чисто CAD-задаче

| Требование ТЗ | Покрыто CAD-ресерчем? | Что добавить |
|---|---|---|
| Загрузка CAD-файлов как input | ✓ (mlightcad / ezdxf / ODA bridge) | — |
| Загрузка PDF (ГПЗУ, существующие планы) | ✗ | **pymupdf** — уже в стеке; для парсинга вектора см. ниже |
| Загрузка BIM (IFC) | ✗ в Phase-1 | **`web-ifc`** (клиент) + **`ifcopenshell`** (сервер) |
| Доменная модель (квартиры/комнаты/стены/ядра) | ✗ — у нас сейчас только `BuildingPurpose` enum | **Pydantic-схема Site/Building/Floor/Apartment/...** (наш код) |
| AI-генерация вариантов планировок | ✗ — это **отдельная** ветка | LLM + constraint solver + наш domain model |
| Проверка нормативов (пожарка, инсоляция, лифты, отступы) | ✗ в CAD-ресерче | Свой Python-движок поверх `research/kz-norms/` |
| Интерактивная корректировка | ✓ частично (mlightcad даёт edit на entity-level) | Нужен **semantic editor** на доменной модели |
| Site placement (посадка на участок) | ✗ — это site-scale, не floor scale | Отдельный site-canvas (Konva + GIS-проекции) |
| 3D-визуализация для презентации | ✓ (three.js уже в стеке) | Mesh-генератор: walls/rooms → extruded geometry → glTF |
| Экспорт DXF | ✓ (ezdxf или клиентский dxf-writer) | — |
| Экспорт PDF | ✗ в CAD-ресерче (упомянут) | **`ezdxf.addons.drawing` → matplotlib → PDF** + `jspdf` (уже в зависимостях) для compose |
| Экспорт CAD (DWG) | ✓ (DXF → DWG через ODA) | — |
| Экспорт BIM (IFC) | ✗ в Phase-1 | `ifcopenshell` |

---

## Архитектура продукта по ТЗ (4 слоя)

```
┌───────────────────────────────────────────────────────────────────┐
│                       UI LAYER (Next.js)                          │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │ Site     │ │ Floor      │ │ 3D       │ │ Export panel     │    │
│  │ editor   │ │ editor     │ │ preview  │ │ (PDF/DXF/BIM)    │    │
│  │ (Konva)  │ │ (Konva +   │ │ (three)  │ │                  │    │
│  │          │ │  mlightcad │ │          │ │                  │    │
│  │          │ │  как ref)  │ │          │ │                  │    │
│  └──────────┘ └────────────┘ └──────────┘ └──────────────────┘    │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ Domain Model (JSON, Pydantic)
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                   DOMAIN MODEL (источник истины)                  │
│  Site → Buildings → Floors → Apartments → Rooms → Walls/Doors     │
│         + Cores (lift/stair) + Shafts + Site constraints (ГПЗУ)   │
└─────────┬─────────────────────┬─────────────────────┬─────────────┘
          │                     │                     │
          ▼                     ▼                     ▼
┌──────────────────┐  ┌────────────────────┐  ┌──────────────────┐
│ INPUT ADAPTERS   │  │ VALIDATORS         │  │ AI GENERATORS    │
│ • DXF (ezdxf)    │  │ • Insolation       │  │ • LLM (prompts + │
│ • DWG (ODA→DXF)  │  │ • Fire safety      │  │   tools)         │
│ • IFC (web-ifc/  │  │ • Accessibility    │  │ • Constraint     │
│   ifcopenshell)  │  │ • Parking          │  │   solver         │
│ • PDF (pymupdf+  │  │ • Stairs/lifts     │  │ • Variant scorer │
│   GPT-Vision)    │  │ → research/kz-norms│  │                  │
│ • ГПЗУ (есть)    │  │                    │  │                  │
└──────────────────┘  └────────────────────┘  └──────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                       OUTPUT ADAPTERS                              │
│  • DXF (ezdxf)             • PDF (ezdxf.addons.drawing + jspdf)   │
│  • DWG (ezdxf → ODA)       • IFC (ifcopenshell on server)         │
│  • SVG (ezdxf or makerjs)  • glTF for 3D (three.js exporter)      │
└───────────────────────────────────────────────────────────────────┘
```

## Доменная модель — must-have для ТЗ

ТЗ работает в терминах "квартиры, лифтовые зоны, лестницы, инженерные блоки" — а не "линии и полилинии". Без доменной модели:
- AI не сможет генерировать осмысленные варианты ("3-комнатные квартиры с двусторонней ориентацией")
- Валидаторы нормативов не смогут работать ("инсоляция жилых комнат" — нужно знать, что такое "жилая комната")
- Интерактивный редактор будет на уровне линий — пользователю-архитектору это неудобно

**Эскиз модели (Pydantic):**

```python
# engine/plana_engine/domain/model.py — НОВЫЙ файл по ТЗ
from pydantic import BaseModel, Field
from typing import Literal

class Polygon(BaseModel):
    points: list[tuple[float, float]]  # в мм, локальные координаты

class Site(BaseModel):
    gpzu: GpzuExtraction               # уже есть в importers/gpzu.py
    boundary: Polygon
    setbacks: dict[str, float]
    red_lines: list[Polygon] = []

class Building(BaseModel):
    footprint: Polygon
    height_m: float
    floors_count: int
    purpose: BuildingPurpose           # уже есть

class Apartment(BaseModel):
    rooms: list["Room"]
    type_code: str                     # "1B", "2B+К", "3E"...
    area_total_m2: float
    area_living_m2: float

class Room(BaseModel):
    kind: Literal["living", "kitchen", "bath", "wc", "hall",
                  "loggia", "storage", "kitchen-living"]
    polygon: Polygon
    insolation_required: bool
    natural_light_required: bool

class Core(BaseModel):
    kind: Literal["lift", "stair", "stair-lift", "fire-stair"]
    polygon: Polygon
    capacity: int = 0  # для лифтов

class Floor(BaseModel):
    level: int
    z_offset_m: float
    apartments: list[Apartment]
    cores: list[Core]
    shafts: list[Polygon] = []
    corridors: list[Polygon] = []

class Project(BaseModel):
    site: Site
    buildings: list[Building]
    floors_by_building: dict[int, list[Floor]]
```

Это **источник истины**. AI пишет в него, валидаторы читают, рендереры проецируют в DXF/PDF/IFC.

> Примечание: вы намеренно удалили геометрические типы в `types.py` после реверта alg-pipeline (`6edf301`). Эта модель — про **другое**: не "движок строит план", а "модель, в которую и AI, и пользователь, и импортёры пишут одно и то же". Геометрия здесь декларативная, не процедурная.

---

## Пересмотренный стек по слоям

### Input adapters (Python, в `engine/plana_engine/importers/`)

| Источник | Библиотека | Лицензия | Заметки |
|---|---|---|---|
| DXF | `ezdxf` | MIT | уже есть |
| DWG | ODA sidecar → `ezdxf` | proprietary free + MIT | через [integration-sketch.md](integration-sketch.md) |
| IFC | **`ifcopenshell`** | **LGPL-3.0** | сервер-сайд; для клиента `web-ifc` (MIT) |
| PDF (вектор) | `pymupdf` | AGPL-3.0 *или* commercial | ⚠ AGPL заразный — проверить use case или брать pdfplumber/pypdfium2 |
| PDF (раст) | `pymupdf` (render) + Vision LLM | как выше | у вас уже так делает `importers/gpzu.py` |
| ГПЗУ | свой `importers/gpzu.py` через OpenAI Vision | — | уже есть |

⚠ **Внимание по `pymupdf`**: AGPL — для SaaS заразен. Артемис: либо коммерческая лицензия Artifex, либо переключиться на `pypdfium2` (Apache-2.0/BSD) или `pdfplumber` (MIT, ограниченный).

### Frontend editor

| Слой | Библиотека | Зачем |
|---|---|---|
| Site canvas (посадка на участок) | **`Konva.js`** + `react-konva` | свой semantic-редактор: участок + здания на нём |
| Floor canvas (план этажа) | **`Konva.js`** + слой `@mlightcad/cad-viewer` под ним как **reference background** | пользователь видит свой импортированный DXF/DWG, поверх — наша semantic-модель (комнаты, стены, ядра). Подвинул стену в модели → пересчиталась площадь, проверилась норма |
| 3D-preview | `three.js` (уже есть) + extrusion из polygons | для презентации |
| AI-генератор UI | React-форма + WebSocket стрим | "сгенерируй 3 варианта" → backend стримит варианты |

### Backend renderers/exporters

| Целевой формат | Библиотека | Из чего | Лицензия |
|---|---|---|---|
| DXF | `ezdxf` | Project model → entities | MIT |
| DWG | DXF → ODA sidecar | — | proprietary free |
| PDF | `ezdxf.addons.drawing` → matplotlib → PDF | model → DXF → PDF *или* собственная сборка через `jspdf` (фронт) | MIT |
| IFC | **`ifcopenshell`** | model → IfcWall/IfcSpace/IfcDoor/... | **LGPL-3.0** ⚠ |
| SVG (превью) | `ezdxf.addons.drawing` → SVG | — | MIT |
| glTF (3D-preview) | three.js GLTFExporter | extruded mesh | MIT |

⚠ **`ifcopenshell` LGPL-3.0** — обычно ОК для SaaS (нет статической линковки в клиентский код), но юристам показать.

### Constraint validators (Python)

Все читают `Project` model, возвращают список нарушений `list[Violation]`:

- `validators/insolation.py` — инсоляция жилых комнат (СНиП/СП КЗ — см. `research/kz-norms/insolation.md`)
- `validators/fire.py` — эвакуация, лестницы (`fire-safety.md`)
- `validators/accessibility.py` — доступная среда (`accessibility.md`)
- `validators/parking.py` — паркинг (`parking.md`)
- `validators/setbacks.py` — отступы (ГПЗУ + норма)
- `validators/lifts.py` — лифтовые группы (`stairs-lifts.md`)

Никаких внешних либ — чистая логика над domain model.

### AI generators (Python)

Это **отдельный** слой, к CAD-ресерчу прямо не относится. Скетч:

- `generators/llm_layout.py` — LLM с function-calling, инструменты `place_apartment`, `place_core`, `add_corridor`, выходит готовый `Floor`.
- `generators/scorer.py` — оценивает варианты по: КИТ, выход полезной/жилой, кол-во нарушений, инсоляция.
- `generators/optimizer.py` — простой генетический отбор / beam search поверх LLM.

---

## Что **сейчас точно надо сделать**, чтобы исполнить ТЗ

### Шаг 0. Завести Pydantic-модель `Project`

Пока этого нет, всё остальное висит в воздухе. **Это блокер.**

### Шаг 1. Phase-1 CAD-импорт (по [integration-sketch.md](integration-sketch.md))

- Юзер грузит DXF/DWG → mlightcad показывает → можно подвинуть entity → скачать.
- Это даёт "просмотровщик/мини-редактор" из ТЗ.
- **Но это ещё не semantic.** На этом этапе semantic-конверсия не делается — это видеть-править-выгружать.

### Шаг 2. Semantic overlay над импортированным CAD

- Поверх mlightcad/Konva: пользователь выделяет "это полигон комнаты", "это контур здания", "это лифт".
- ИЛИ автоматический recognizer: ezdxf-парсер + heuristic ("замкнутые полилинии в layer `WALL` → стены") + LLM-классификатор для неоднозначных.
- Результат: импортированный CAD сконвертирован в `Project` model.

### Шаг 3. AI-генератор пишет в `Project`

- Пользователь задаёт параметры (ТЗ Раздел 3 — все inputs) → LLM генерирует N вариантов `Project`.
- Каждый вариант: проходит валидаторы → получает score.
- Юзер выбирает лучший.

### Шаг 4. Интерактивный редактор `Project`

- Konva-канвас рисует комнаты/стены/ядра из model.
- Пользователь двигает стену → пересчёт площадей → перепроверка валидаторов → визуальная подсветка нарушений.

### Шаг 5. Multi-format export

- DXF (ezdxf), PDF (ezdxf+jspdf), IFC (ifcopenshell), DWG (ODA bridge).
- Кнопка "Экспорт" → выбор формата → скачивание.

---

## Тулы, которые в свете ТЗ становятся **важнее**, чем казалось

1. **`web-ifc` / `@thatopen/components` / `ifcopenshell`** — ТЗ явно требует BIM. В Phase-1 [recommendation.md](recommendation.md) я отложил IFC, но по ТЗ это **out-of-scope нельзя**. Phase-2 обязательно.

2. **`Konva.js` (или эквивалент)** — становится центральным для semantic-редактора. mlightcad — только viewer/background-layer.

3. **`ezdxf.addons.drawing`** — единственный простой путь к PDF из ваших чертежей. В Phase-1 это **обязательно**.

4. **PDF-парсер (не `pymupdf` если AGPL критичен)** — для импорта существующих чертежей в PDF. Альтернативы: **`pypdfium2`** (Apache-2.0), **`pdfminer.six`** (MIT). Если PDF — растровая копия скана → переход на Vision LLM + ezdxf для пересборки (то, что вы уже делаете с ГПЗУ).

## Тулы, которые в свете ТЗ становятся **менее важными**

1. **`react-planner`** — он "редактор", но со **своей** моделью. Адаптировать под наш Project model — почти столько же кода, сколько написать свой Konva-editor. Польза только как референс UX.

2. **OpenCascade.js / Replicad / JSCAD** — это **3D-инженерные кернелы**, ТЗ — это **архитектурный концепт**. Для 3D-preview достаточно extrusion из 2D-полигонов в three.js (1-2 дня кода). OCC.js — overkill.

3. **xeokit-sdk** — AGPL остаётся блокером. Полностью пропускаем.

## Тулы, которых **не хватает в текущем CAD-ресерче** для ТЗ

| Что нужно | Кандидаты для отдельного ресерча |
|---|---|
| **PDF-парсер вектора (для не-ГПЗУ чертежей)** | `pypdfium2` (Apache-2), `pdfplumber` (MIT), `pdfminer.six` (MIT) |
| **IFC server-side** | `ifcopenshell` (LGPL-3) — стандарт де-факто для Python BIM |
| **Constraint solver для AI-генерации** | `OR-Tools` (Apache-2, Google), `cvxpy` (Apache-2), своя реализация |
| **Geometry kernel для 2D-полигональных операций** (intersect, buffer, area) | `Shapely` (BSD-3) — must-have для site placement и validators |
| **Site map / GIS для посадки здания** | `Leaflet` / `MapLibre GL` (BSD/MIT), но скорее всего overkill — у нас локальные координаты ГПЗУ |
| **Symbol library (двери/окна/мебель)** | свои DXF-блоки + библиотека SVG-иконок |

См. план следующих ресерчей в [next-research.md](next-research.md) (создаётся отдельно — пока скетч ниже).

---

## Что я бы исследовал следующим

✅ **Пункты 1-5 завершены во второй волне** — см. [`next/`](next/) и его [`next/README.md`](next/README.md):

1. ✅ PDF parsing → [`next/pdf-parsers.md`](next/pdf-parsers.md) — `pypdfium2` + `pdfplumber`, `pymupdf` AGPL не работает для SaaS
2. ✅ IFC server-side → [`next/ifc-server.md`](next/ifc-server.md) — `ifcopenshell` 0.8.5
3. ✅ Shapely → [`next/geometry-shapely.md`](next/geometry-shapely.md) — Shapely 2.1.2 + Pydantic-адаптер
4. ✅ LLM floor plan generation → [`next/ai-floorplan.md`](next/ai-floorplan.md) — гибрид LLM + CP-SAT, end-to-end LLM не работает
5. ✅ Constraint solvers → [`next/constraint-solvers.md`](next/constraint-solvers.md) — OR-Tools CP-SAT

⏳ **Осталось (третья волна, если понадобится):**

6. **`@thatopen/components` детально** — может ли заменить связку Konva + 3D-preview одной библиотекой
7. **Symbol library** — DXF-блоки + SVG-иконки для дверей/окон/мебели под KZ-стиль
8. **Server rendering для PDF** — `ezdxf.addons.drawing` vs Cairo vs ReportLab vs WeasyPrint
9. **3D mesh generation** — extrusion в three.js (вероятно, тривиально, ресерч не нужен)

---

## Резюме

**Phase 1 (1-2 нед.):** "viewer DXF/DWG + сохранение обратно" — [recommendation.md](recommendation.md) валиден as-is. Закрывает раздел 2 ТЗ пункт "Экспорт PDF/CAD/BIM" частично (только DXF/PDF), Этап 4 "Интерактивная корректировка" частично (entity-level).

**Phase 2 (4-8 нед.):** Доменная модель + semantic editor + AI generator. Эти три должны строиться одновременно вокруг одной Pydantic-схемы. Без этого ТЗ не закроется.

**Phase 3 (4-8 нед.):** IFC import/export + полноценные validators по KZ-нормам + multi-variant generation + 3D-preview presentation mode.

Если есть выбор — **порядок приоритетов по ТЗ:** Domain Model > Validators > AI Generator > Semantic Editor > Site Placement > BIM Export. CAD-ресерч закрывает только последние две точки в инфраструктурном смысле.
