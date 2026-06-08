# Plana Engine

Prompt-driven визуализатор планировок. Параметры формы → промпт → image API.
Никакой алгоритмической геометрии — все картинки выдаёт LLM-провайдер
(xAI Grok для листов альбома, OpenAI gpt-image для edit/inpaint).

## Архитектура

```
plana_engine/
├── types.py            — BuildingPurpose enum (residential / commercial / mixed_use / hotel)
├── visualizer/
│   ├── marketing_prompt.py — base prompt builder из MarketingInputs
│   ├── extra_prompts.py    — exterior / floorplan-furniture / interior / site-placement
│   ├── enhancer.py         — optional prompt enhancer through OpenAI ChatGPT API
│   ├── grok_client.py      — generate_image (text→image) through OpenAI Images API
│   ├── ai/openai_runtime.py — shared OpenAI chat/text/vision runtime
│   └── openai_client.py    — generate_image_edit / inpaint (OpenAI gpt-image) + кэш
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
OPENAI_API_KEY=sk-...      # server-side OpenAI key for ChatGPT, Vision, Images edit/generation
OPENAI_MODEL=gpt-5.5       # default text+vision model; change without code edits
OPENAI_REASONING_EFFORT=none
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
