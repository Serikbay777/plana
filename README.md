# Plana

AI-платформа для архитектурного и планировочного проектирования: импорт исходных
данных (DXF/DWG/IFC/PDF/ГПЗУ) → доменная модель проекта → AI-генерация вариантов
планировок с проверкой нормативов → интерактивная правка → экспорт в DXF/PDF/IFC/DWG.

> Текущий рабочий контур (этап 1) — генерация концептуальной планировки этажа по
> параметрам. Более широкая целевая архитектура (доменная модель, AI-генерация,
> мульти-формат I/O) описана ниже в разделах «Доменная модель» и «Дорожная карта».
> Полный ресёрч по инструментам и решениям — в [docs/readmeforgpt.md](docs/readmeforgpt.md).

```
.
├── src/                   ← Next.js фронт (app router)
│   ├── app/               ← маршруты: /, /login, /app
│   ├── components/        ← PlanCanvas, PresetControls, AppMetrics, ComparisonTable
│   └── lib/engine.ts      ← клиент Plana Engine API
└── engine/                ← Python ядро (FastAPI)
    ├── plana_engine/      ← модули алгоритма
    └── data/              ← norms.yaml, catalog.yaml
```

## Быстрый старт (локально)

В одном терминале — движок:

```bash
cd engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn plana_engine.api.main:app --reload --port 8001
```

В другом — фронт:

```bash
npm install
npm run dev
```

Открыть http://localhost:3000 → войти с любым email → попасть в студию.

## Через Docker

```bash
docker compose up --build
```

Получить доступ:
- http://localhost — приложение через nginx
- http://localhost/api/health — API напрямую

## Архитектура

```
                                 ┌─────────────────────┐
                                 │  norms.yaml         │
                                 │  catalog.yaml       │
                                 │  (правит заказчик)  │
                                 └──────────┬──────────┘
                                            │
                  ┌────────────┐    ┌───────▼────────┐
   Браузер ─────▶ │  Next.js   │───▶│  FastAPI       │
                  │  /app      │    │  /generate/*   │
                  └────────────┘    │                │
                                    │  ┌──────────┐  │
                                    │  │  ядро →  │  │
                                    │  │  коридор │  │
                                    │  │  → слоты │  │
                                    │  │  → тайлы │  │
                                    │  └──────────┘  │
                                    │      ↓         │
                                    │  validator     │
                                    │  (5 пресетов)  │
                                    └────────────────┘
```

## Доменная модель (источник истины)

ТЗ работает в терминах «квартиры, лифтовые зоны, лестницы, инженерные блоки», а не
«линии и полилинии». Все слои — импортёры, AI-генератор, валидаторы, рендереры —
читают и пишут одну Pydantic-схему `Project` (планируется в
`engine/plana_engine/domain/model.py`):

```
Project
└── Site            ← ГПЗУ, граница участка, отступы, красные линии
    └── Building    ← footprint, высота, число этажей, назначение
        └── Floor   ← уровень, z-offset, коридоры, шахты
            ├── Apartment → Room  (living / kitchen / bath / wc / hall / loggia …)
            └── Core              (lift / stair / fire-stair)
```

Геометрия здесь декларативная, а не процедурная: модель — то, во что AI,
пользователь и импортёры пишут одно и то же. Без неё AI не сгенерирует осмысленные
варианты, а валидаторы нормативов не смогут отличить «жилую комнату» от полилинии.

## Целевая архитектура (4 слоя)

```
UI (Next.js): Site-редактор · Floor-редактор · 3D-preview · Export-панель
        │  Domain Model (JSON / Pydantic) — источник истины
        ▼
Input adapters → DOMAIN MODEL ← AI generators
                    │              (LLM-planner → CP-SAT → scorer)
                    ▼
              Validators (KZ-нормы) → Output adapters (DXF/PDF/IFC/DWG/SVG/glTF)
```

## Стек (зафиксирован по итогам ресёрча)

**Backend (Python 3.11, FastAPI engine):**

| Библиотека | Лицензия | Назначение |
|---|---|---|
| `ezdxf` | MIT | DXF read/write/render (есть) |
| `shapely` | BSD-3 | 2D-геометрия: area, buffer, intersect |
| `pydantic` | MIT | доменная модель `Project` (есть) |
| `ifcopenshell` | LGPL-3 ⚠ | IFC read/write (юристам на сверку) |
| `pypdfium2` / `pdfplumber` | Apache-2 / MIT | PDF render + vector extract (замена `pymupdf` — AGPL) |
| `ortools` (CP-SAT) | Apache-2 | констрейнт-решатель для размещения квартир |
| `networkx`, `scipy` | BSD-3 | связность / эвакуация, доводка |

**Frontend (Next.js 16 + React 19):**

| Библиотека | Лицензия | Назначение |
|---|---|---|
| `@mlightcad/cad-viewer` | MIT | DXF/DWG viewer как фоновый слой |
| `konva` + `react-konva` | MIT | semantic-редактор плана этажа и посадки на участок |
| `@tarikjabiri/dxf` | MIT | клиентский экспорт в DXF |
| `three.js` | MIT | 3D-preview через extrusion из 2D-полигонов (есть) |
| `@thatopen/components` | MIT (web-ifc MPL-2) | IFC-preview в браузере |

**Sidecar (Docker):** ODA File Converter (бесплатный, проприетарный) — мост DWG ↔ DXF.

**Хранилища:** локальная ФС (этап 1). PostgreSQL + S3 — этап 3.
**Инфра:** Docker, docker-compose, Nginx как reverse proxy.

> ⚠ Лицензии: `pymupdf` (AGPL) для SaaS заразен — заменён на `pypdfium2`/`pdfplumber`.
> `ifcopenshell` (LGPL-3) обычно ОК через `pip install` (динамическая линковка), но
> требует юридической сверки. `xeokit-sdk` (AGPL) исключён полностью.

## Что готово (этап 1 ТЗ)

- ✅ 12 параметрических тайлов с допусками ±10%
- ✅ `norms.yaml` с базовыми СП РК
- ✅ 5 целевых функций
- ✅ 6-шаговый пайплайн алгоритма
- ✅ Нормоконтроль с отчётом
- ✅ FastAPI + CLI
- ✅ Веб-фронт с DXF-загрузкой, сравнительной таблицей, метриками, PDF-экспортом

## Дорожная карта (CAD I/O + AI)

**Шаг 0 (блокер).** Pydantic-модель `Project` в `engine/plana_engine/domain/model.py` —
источник истины, от которого зависит всё остальное.

**Фаза 1 (1–2 нед.) — импорт/просмотр/экспорт.**
- ⏳ Загрузка DXF/DWG (`@mlightcad/cad-viewer`, DWG через ODA-sidecar) → просмотр →
  правка entity → выгрузка обратно.
- ⏳ Экспорт DXF (`ezdxf`) и PDF (`ezdxf.addons.drawing` + `jspdf`).

**Фаза 2 (4–8 нед.) — semantic + AI.** Строятся одновременно вокруг `Project`:
- ⏳ Semantic-overlay: распознавание импортированного CAD в доменную модель
  (heuristic по слоям + LLM-классификатор неоднозначных).
- ⏳ AI-генератор: LLM-planner → CP-SAT (OR-Tools) → scorer → N вариантов `Project`.
- ⏳ Интерактивный редактор на Konva: двигаешь стену → пересчёт площадей →
  перепроверка валидаторов → подсветка нарушений.

**Фаза 3 (4–8 нед.) — нормы, BIM, презентация.**
- ⏳ Валидаторы KZ-норм (`research/kz-norms/`): инсоляция, пожарка, доступность,
  паркинг, отступы, лифты.
- ⏳ IFC import/export (`ifcopenshell` / `web-ifc`).
- ⏳ 3D-preview presentation mode (three.js extrusion → glTF).
- ⏳ PostgreSQL + S3 для хранения проектов.

## Открытые вопросы (нужны от заказчика)

См. ТЗ §13 — критичные блоки до приёмки этапа 2:

1. Актуальные СП РК для калибровки `norms.yaml`
2. 5–10 тестовых DXF-контуров реальных проектов
3. Ревью базового каталога 12 тайлов архитектором
4. Брендинг (текущее имя `Plana` — рабочее)
5. Хостинг: VPS заказчика или арендуемый
6. Архитектор-консультант на 5–10 ч (главный риск ТЗ §12)

## Лицензия

Проприетарное ПО. Plana, 2026.
