"""Marketing-grade визуализация — гибрид xAI Grok + OpenAI gpt-image.

Пайплайн чисто prompt-driven:
    параметры формы → MarketingInputs → build_marketing_prompt
    → enhance_prompt (опционально, через Gemma 4)
    → grok_client.generate_image() → PNG bytes

Провайдеры:
    * Text→image (листы альбома)     — xAI `grok-imagine-image` ($0.02/img)
    * Image-edit («Посадка на участок») — OpenAI `gpt-image-2`
    * Inpainting (MaskCanvas)         — OpenAI `gpt-image-2`

Ключи: `XAI_API_KEY` (для Grok) + `OPENAI_API_KEY` (для edits/inpaint
и vision-задач) — см. `.env.example`.
"""

from .agent_enhancer import (
    Critique, DesignRecommendation, EnhancementResult,
    NumericalConstraint, Risk, enhance_with_kz_norms,
)
from .enhancer import enhance_prompt, has_llm_key
from .extra_prompts import (
    DEFAULT_EXTERIOR_VIEWS, EXTERIOR_VIEWS,
    build_exterior_prompt, build_floorplan_furniture_prompt,
    build_floorplan_furniture_edit_prompt,
    build_interior_prompt, build_site_placement_prompt,
)
from .kz_norms import (
    KZ_NORMS_CATALOG, NormSection, build_norms_context,
    list_available_sections, select_relevant_norms,
)
from .marketing_prompt import MarketingInputs, build_marketing_prompt
from .openai_client import GenerationOptions
from .grok_client import generate_image

__all__ = [
    # промпт-билдеры
    "build_marketing_prompt",
    "build_site_placement_prompt", "build_exterior_prompt",
    "build_floorplan_furniture_prompt", "build_floorplan_furniture_edit_prompt",
    "build_interior_prompt",
    "EXTERIOR_VIEWS", "DEFAULT_EXTERIOR_VIEWS",
    "MarketingInputs",
    # генерация
    "generate_image", "GenerationOptions",
    # старый enhancer (атмосферный)
    "enhance_prompt", "has_llm_key",
    # агентный enhancer с базой норм РК
    "enhance_with_kz_norms", "EnhancementResult",
    "Critique", "NumericalConstraint", "DesignRecommendation", "Risk",
    "KZ_NORMS_CATALOG", "NormSection",
    "select_relevant_norms", "build_norms_context", "list_available_sections",
]
