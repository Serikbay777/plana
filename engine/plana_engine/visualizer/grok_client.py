"""Text→image генерация листов альбома через OpenAI gpt-image-1.

Ранее здесь был xAI/Grok клиент. Переключились обратно на OpenAI:
- лимит промпта 32 000 символов (vs 8 000 у xAI)
- знакомый API, уже проверен в edits/inpaint
- ключ: OPENAI_API_KEY (тот же что и в openai_client.py)
"""

from __future__ import annotations

import base64
import hashlib
import os

from .openai_client import (
    GenerationOptions, GenerationResult,
    MissingAPIKey, OpenAIError,
)

_DEFAULT_MODEL = "gpt-image-2"

_IMAGE_CACHE: dict[str, bytes] = {}
_CACHE_LIMIT = 32


def _cache_key(prompt: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(prompt.encode("utf-8"))
    h.update(f"|{model}".encode("utf-8"))
    return h.hexdigest()[:32]


def _api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise MissingAPIKey(
            "OPENAI_API_KEY не задан. Добавьте его в .env перед запуском движка."
        )
    return key


def _call_openai(prompt: str, model: str) -> bytes:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise RuntimeError(
            "Пакет openai не установлен. `pip install openai>=1.40` в engine/.venv"
        ) from e

    client = OpenAI(api_key=_api_key())
    try:
        response = client.images.generate(
            model=model,
            prompt=prompt,
            response_format="b64_json",
            size="1536x1024",
            quality="medium",
            n=1,
        )
    except Exception as e:
        raise OpenAIError(f"OpenAI image API error: {e}") from e

    if not response.data:
        raise OpenAIError("OpenAI returned empty data")
    item = response.data[0]
    if hasattr(item, "b64_json") and item.b64_json:
        return base64.b64decode(item.b64_json)
    raise OpenAIError("OpenAI response had no b64_json")


def generate_image_with_meta(
    prompt: str,
    opts: GenerationOptions | None = None,  # noqa: ARG001
    *,
    use_cache: bool = True,
) -> GenerationResult:
    model = _DEFAULT_MODEL

    key = _cache_key(prompt, model)
    if use_cache and key in _IMAGE_CACHE:
        return GenerationResult(png=_IMAGE_CACHE[key], model_used="cache")

    png = _call_openai(prompt, model)

    if use_cache:
        if len(_IMAGE_CACHE) >= _CACHE_LIMIT:
            _IMAGE_CACHE.pop(next(iter(_IMAGE_CACHE)))
        _IMAGE_CACHE[key] = png

    return GenerationResult(png=png, model_used=model)


def generate_image(
    prompt: str,
    opts: GenerationOptions | None = None,  # noqa: ARG001
    *,
    use_cache: bool = True,
) -> bytes:
    return generate_image_with_meta(prompt, opts, use_cache=use_cache).png


def has_api_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))
