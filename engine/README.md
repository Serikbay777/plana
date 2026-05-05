# Plana Engine

Prompt-driven визуализатор планировок. Параметры формы → промпт → `gpt-image-1`.
Никакой алгоритмической геометрии — все картинки выдаёт OpenAI.

## Архитектура

```
plana_engine/
├── types.py            — BuildingPurpose enum (residential / commercial / mixed_use / hotel)
├── visualizer/
│   ├── marketing_prompt.py — base prompt builder из MarketingInputs
│   ├── extra_prompts.py    — exterior / floorplan-furniture / interior / site-placement
│   ├── enhancer.py         — опциональный enhancer через Gemma 4 (LLM_API_KEY)
│   └── openai_client.py    — generate_image / generate_image_edit + кэш
├── importers/
│   └── gpzu.py         — ГПЗУ-PDF → JSON-параметры через OpenAI Vision
└── api/main.py         — FastAPI: /visualize/*, /import/gpzu, /health
```

## Установка

```bash
cd engine
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## ENV

```
OPENAI_API_KEY=sk-...      # для gpt-image-1 + Vision (ГПЗУ)
LLM_API_KEY=...            # опционально, для Gemma 4 enhancer
```

## API

- `GET  /health` — статус
- `POST /visualize/exterior` — экстерьер ЖК
- `POST /visualize/floorplan-furniture` — план с мебелью
- `POST /visualize/interior` — интерьер одной комнаты
- `POST /visualize/site-placement` — посадка на участок (image-edit)
- `POST /visualize/site-placement-variants` — 3 стратегии посадки
- `POST /visualize/floor-variants` — 5 AI-чертежей параллельно
- `POST /visualize/interior-gallery` — интерьер по типам квартир
- `POST /import/gpzu` — ГПЗУ-PDF → JSON

## Запуск

```bash
uvicorn plana_engine.api.main:app --reload --port 8001
```
