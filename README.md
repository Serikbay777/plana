# Plana

AI-платформа для генерации концептуальных архитектурных планировок этажа.

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

## Стек по ТЗ §4

**Frontend:** React + Next.js, SVG для 2D-канваса, framer-motion, lucide.
В планах: Konva.js для интерактива (отложено), Three.js для 2.5D, dxf-parser
на клиенте, pdf.js.

**Backend:** Python 3.11, FastAPI, Shapely, Pydantic, ezdxf, PyYAML.
В планах: DEAP (генетический оптимизатор) или OR-Tools (constraint solver) —
этап 2 ТЗ.

**Хранилища:** локальная файловая система (этап 1). PostgreSQL + S3 — этап 3.

**Инфра:** Docker, docker-compose, Nginx как reverse proxy.

## Что готово (этап 1 ТЗ)

- ✅ 12 параметрических тайлов с допусками ±10%
- ✅ `norms.yaml` с базовыми СП РК
- ✅ 5 целевых функций
- ✅ 6-шаговый пайплайн алгоритма
- ✅ Нормоконтроль с отчётом
- ✅ FastAPI + CLI
- ✅ Веб-фронт с DXF-загрузкой, сравнительной таблицей, метриками, PDF-экспортом

## Что в работе (этапы 2–5)

- ⏳ Расширенный каталог регрессионных тестов (5–10 контуров)
- ⏳ DEAP-оптимизатор (вместо greedy в `algo/pipeline.py`)
- ⏳ DXF-экспорт через `ezdxf`
- ⏳ Three.js 2.5D-просмотр
- ⏳ PostgreSQL + S3 для хранения проектов

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
