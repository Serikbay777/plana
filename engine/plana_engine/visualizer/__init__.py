"""Marketing-grade визуализация плана через OpenAI gpt-image-1.

Pipeline:
    Plan → prompt.build_prompt() → openai_client.generate_image() → PNG bytes

Это **не основной артефакт сдачи** — для приёмки по ТЗ §3.6 используется DXF.
GPT-image нужен для презентаций инвесторам, маркетинговых материалов и
красивого demo заказчику.

Стоимость по состоянию на 2026:
    gpt-image-1 standard 1024×1024: ~$0.04
    gpt-image-1 high     1024×1024: ~$0.17
    1792×1024:                       ~$0.08–0.32

Ключ ожидается в `OPENAI_API_KEY` env var (см. `.env.example`).
"""

from .enhancer import enhance_prompt, has_llm_key
from .extra_prompts import (
    build_exterior_prompt, build_floorplan_furniture_prompt,
    build_interior_prompt, build_site_placement_prompt,
)
from .marketing_prompt import MarketingInputs, build_marketing_prompt
from .openai_client import generate_image, GenerationOptions
from .prompt import build_prompt

__all__ = [
    "build_prompt", "build_marketing_prompt",
    "build_site_placement_prompt", "build_exterior_prompt",
    "build_floorplan_furniture_prompt", "build_interior_prompt",
    "MarketingInputs",
    "generate_image", "GenerationOptions",
    "enhance_prompt", "has_llm_key",
]
