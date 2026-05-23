"""Тонкая обёртка над xAI Images API (grok-imagine-image*).

Используется для **text→image листов альбома**. Image-edit и inpainting
по-прежнему живут в [openai_client.py][] — xAI image-edit API мы не
используем по решению (см. историю чата).

Ключ читается из ENV `XAI_API_KEY` (можно также `GROK_API_KEY` для
совместимости). Если ключа нет — `generate_image` бросает `MissingAPIKey`.

API совместим с OpenAI SDK через `base_url="https://api.x.ai/v1"` —
поэтому используем тот же пакет `openai`.

Параметры `size`/`quality`/`n` в публичной документации xAI не описаны —
передаём только `model` + `prompt`. По умолчанию xAI возвращает
квадратное изображение (≈1024×1024) и url-ссылку (не b64).
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import replace

# Переиспользуем общие типы — чтобы вызывающий код не различал провайдеров.
from .openai_client import (
    GenerationOptions, GenerationResult,
    MissingAPIKey, OpenAIError,
)


_DEFAULT_GROK_MODEL = "grok-imagine-image"            # $0.02/img (standard)
_GROK_QUALITY_MODEL = "grok-imagine-image-quality"    # $0.05/img (если standard слабоват)
_XAI_BASE_URL = "https://api.x.ai/v1"


# Свой кэш — отдельный от openai_client, чтобы edits/inpaint не пересекались
# с text-gen по хэшу.
_IMAGE_CACHE: dict[str, bytes] = {}
_CACHE_LIMIT = 32


def _resolve_model(opts: GenerationOptions) -> str:
    """Резолв модели Grok с учётом обратной совместимости.

    Если код где-то ещё передаёт `GenerationOptions(model="gpt-image-...")`,
    мы молча перепишем на дефолтный Grok — иначе xAI вернёт 404.
    """
    override = os.environ.get("GROK_IMAGE_MODEL")
    if override:
        return override
    m = opts.model or ""
    if m.startswith("grok-"):
        return m
    return _DEFAULT_GROK_MODEL


def _cache_key(prompt: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(prompt.encode("utf-8"))
    h.update(f"|{model}".encode("utf-8"))
    return h.hexdigest()[:32]


def _api_key() -> str:
    key = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
    if not key:
        raise MissingAPIKey(
            "XAI_API_KEY не задан. Получите ключ на https://console.x.ai/ "
            "и добавьте в .env перед запуском движка."
        )
    return key


def _fetch_url_png(url: str) -> bytes:
    import urllib.request
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read()


def _call_grok(prompt: str, model: str) -> bytes:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise RuntimeError(
            "Пакет openai не установлен. `pip install openai>=1.40` в engine/.venv"
        ) from e

    client = OpenAI(api_key=_api_key(), base_url=_XAI_BASE_URL)
    try:
        response = client.images.generate(model=model, prompt=prompt)
    except Exception as e:
        raise OpenAIError(f"xAI image API error: {e}") from e

    if not response.data:
        raise OpenAIError("xAI returned empty data")
    item = response.data[0]
    if hasattr(item, "b64_json") and item.b64_json:
        import base64
        return base64.b64decode(item.b64_json)
    if hasattr(item, "url") and item.url:
        return _fetch_url_png(item.url)
    raise OpenAIError("xAI response had neither b64_json nor url")


def generate_image_with_meta(
    prompt: str,
    opts: GenerationOptions | None = None,
    *,
    use_cache: bool = True,
) -> GenerationResult:
    """Сгенерировать лист альбома через Grok.

    `opts.size`/`opts.quality`/`opts.fallback_models` игнорируются — xAI
    их не документирует. Если в `opts.model` указан старый `gpt-image-*`,
    он переписывается на дефолт `grok-imagine-image`.

    При любой ошибке xAI (rate limit, 5xx, content policy) бросает
    `OpenAIError` — UI ловит и показывает пользователю.
    """
    options = opts or GenerationOptions()
    model = _resolve_model(options)

    key = _cache_key(prompt, model)
    if use_cache and key in _IMAGE_CACHE:
        return GenerationResult(png=_IMAGE_CACHE[key], model_used="cache")

    png = _call_grok(prompt, model)

    if use_cache:
        if len(_IMAGE_CACHE) >= _CACHE_LIMIT:
            _IMAGE_CACHE.pop(next(iter(_IMAGE_CACHE)))
        _IMAGE_CACHE[key] = png

    return GenerationResult(png=png, model_used=model)


def generate_image(
    prompt: str,
    opts: GenerationOptions | None = None,
    *,
    use_cache: bool = True,
) -> bytes:
    """Backward-compat wrapper: вернуть только bytes."""
    return generate_image_with_meta(prompt, opts, use_cache=use_cache).png


def has_api_key() -> bool:
    return bool(os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY"))
