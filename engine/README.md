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
│   ├── enhancer.py         — опциональный enhancer через Gemma 4 (LLM_API_KEY)
│   ├── grok_client.py      — generate_image (text→image) через xAI Grok
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
XAI_API_KEY=xai-...        # text→image листов альбома (grok-imagine-image, $0.02/img)
OPENAI_API_KEY=sk-...      # image-edit (посадка), inpainting (MaskCanvas), Vision (ГПЗУ)
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
