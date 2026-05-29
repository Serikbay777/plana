"""Тонкая обёртка над OpenAI Images API — **только** image-edit и inpainting.

Text→image (генерация листов альбома) переехала в [grok_client.py][] на
xAI `grok-imagine-image`. Здесь остались операции, которых у xAI либо
нет, либо мы их не используем:

* `generate_image_edit_with_meta` — image-to-image («Посадка на участок»):
  скармливаем аэрофото + промпт «впишите сюда здание...»
* `generate_image_inpaint_with_meta` — inpainting с маской из MaskCanvas:
  прозрачные пиксели маски перерисовываются, белые остаются.

Ключ — `OPENAI_API_KEY`. Если нет — `MissingAPIKey` (UI ловит и говорит
«настройте ключ»). Общие типы (`GenerationOptions`, `GenerationResult`,
`MissingAPIKey`, `OpenAIError`) переиспользует [grok_client.py][].
"""

from __future__ import annotations

import base64
import hashlib
import os
from dataclasses import dataclass
from typing import Literal


class MissingAPIKey(RuntimeError):
    """Нет API ключа в окружении (OPENAI_API_KEY или XAI_API_KEY)."""


class OpenAIError(RuntimeError):
    """Ошибка от провайдера (rate limit, content policy, network, и т.д.)."""


Quality = Literal["low", "medium", "high"]
Size = Literal["1024x1024", "1024x1536", "1536x1024", "1792x1024"]


@dataclass(frozen=True)
class GenerationOptions:
    """Параметры генерации с auto-fallback цепочкой моделей.

    Используется обоими провайдерами: для edits/inpaint (OpenAI gpt-image)
    `fallback_models` реально работают; для text-gen (Grok) поля
    `quality`/`size`/`fallback_models` игнорируются.

    По умолчанию для edits: gpt-image-2 → gpt-image-1.5 → gpt-image-1.
    """
    model: str = "gpt-image-2"
    fallback_models: tuple[str, ...] = ("gpt-image-1.5", "gpt-image-1")
    size: Size = "1536x1024"          # горизонтальный — для поэтажного плана подходит
    quality: Quality = "medium"
    n: int = 1


@dataclass(frozen=True)
class GenerationResult:
    """Результат генерации: PNG + какая модель сработала."""
    png: bytes
    model_used: str


# In-memory cache для edits/inpaint. Text-gen имеет свой кэш в grok_client.
_IMAGE_CACHE: dict[str, bytes] = {}
_CACHE_LIMIT = 32


# Ошибки, при которых имеет смысл фоллбэкать на следующую модель в цепочке
_FALLBACKABLE_PATTERNS = (
    "must be verified",          # 403: верификация орги ещё не пропалась
    "does not exist",            # 404: модель удалена / переименована
    "model not found",
    "you do not have access",
    "model_not_found",
)


def _is_fallbackable(err: Exception) -> bool:
    s = str(err).lower()
    return any(p in s for p in _FALLBACKABLE_PATTERNS)


def _try_one_model_edit(
    client, model: str, prompt: str, image_bytes: bytes, opts: GenerationOptions,
) -> bytes:
    """Image-to-image: модель смотрит на референс-картинку и перерисовывает по промпту.

    Используется для «Посадки на участок» — кидаем аэрофото, моделька «вписывает» здание.
    """
    import io
    image_file = io.BytesIO(image_bytes)
    image_file.name = "reference.png"
    response = client.images.edit(
        model=model,
        image=image_file,
        prompt=prompt,
        size=opts.size,
        n=opts.n,
    )
    if not response.data:
        raise OpenAIError("OpenAI returned empty data")
    item = response.data[0]
    if hasattr(item, "b64_json") and item.b64_json:
        return base64.b64decode(item.b64_json)
    if hasattr(item, "url") and item.url:
        import urllib.request
        with urllib.request.urlopen(item.url, timeout=30) as resp:
            return resp.read()
    raise OpenAIError("OpenAI response had neither b64_json nor url")


def _try_one_model_edit_mask(
    client, model: str, prompt: str, image_bytes: bytes, mask_bytes: bytes, opts: GenerationOptions,
) -> bytes:
    """Inpainting: image + mask (transparent = repaint, opaque = keep) + prompt."""
    import io
    image_file = io.BytesIO(image_bytes)
    image_file.name = "reference.png"
    mask_file = io.BytesIO(mask_bytes)
    mask_file.name = "mask.png"
    response = client.images.edit(
        model=model,
        image=image_file,
        mask=mask_file,
        prompt=prompt,
        size=opts.size,
        n=opts.n,
    )
    if not response.data:
        raise OpenAIError("OpenAI returned empty data")
    item = response.data[0]
    if hasattr(item, "b64_json") and item.b64_json:
        return base64.b64decode(item.b64_json)
    if hasattr(item, "url") and item.url:
        import urllib.request
        with urllib.request.urlopen(item.url, timeout=30) as resp:
            return resp.read()
    raise OpenAIError("OpenAI response had neither b64_json nor url")


def generate_image_inpaint_with_meta(
    prompt: str,
    image_bytes: bytes,
    mask_bytes: bytes,
    opts: GenerationOptions | None = None,
) -> GenerationResult:
    """Inpainting с маской: прозрачные пиксели маски = перерисовать, белые = оставить.

    mask_bytes — PNG с альфа-каналом (RGBA). Transparent areas → repainted.
    """
    options = opts or GenerationOptions()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise MissingAPIKey("OPENAI_API_KEY не задан")

    try:
        from openai import OpenAI
    except ImportError as e:
        raise RuntimeError("openai SDK не установлен") from e

    client = OpenAI(api_key=api_key)
    chain = (options.model,) + tuple(options.fallback_models)
    last_error: Exception | None = None
    for model in chain:
        try:
            png = _try_one_model_edit_mask(client, model, prompt, image_bytes, mask_bytes, options)
            return GenerationResult(png=png, model_used=model)
        except Exception as e:
            last_error = e
            if _is_fallbackable(e):
                continue
            raise OpenAIError(f"OpenAI API error: {e}") from e

    raise OpenAIError(f"All models failed in inpaint chain. Last: {last_error}")


def generate_image_edit_with_meta(
    prompt: str,
    image_bytes: bytes,
    opts: GenerationOptions | None = None,
    *,
    use_cache: bool = True,
) -> GenerationResult:
    """Image-to-image edit с auto-fallback цепочкой.

    Кидаем картинку (например аэрофото участка) + промпт «впишите сюда здание...».
    Возвращает PNG + имя сработавшей модели.
    """
    options = opts or GenerationOptions()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise MissingAPIKey("OPENAI_API_KEY не задан")

    # кэш по hash промпта + первых байт картинки
    h = hashlib.sha256()
    h.update(prompt.encode("utf-8"))
    h.update(image_bytes[:1024])  # достаточно для дискриминации
    h.update(f"|edit|{options.model}|{options.size}|{options.quality}".encode("utf-8"))
    key = h.hexdigest()[:32]
    if use_cache and key in _IMAGE_CACHE:
        return GenerationResult(png=_IMAGE_CACHE[key], model_used="cache")

    try:
        from openai import OpenAI
    except ImportError as e:
        raise RuntimeError("openai SDK не установлен") from e

    client = OpenAI(api_key=api_key)
    chain = (options.model,) + tuple(options.fallback_models)
    last_error: Exception | None = None
    for model in chain:
        try:
            png = _try_one_model_edit(client, model, prompt, image_bytes, options)
            if use_cache:
                if len(_IMAGE_CACHE) >= _CACHE_LIMIT:
                    _IMAGE_CACHE.pop(next(iter(_IMAGE_CACHE)))
                _IMAGE_CACHE[key] = png
            return GenerationResult(png=png, model_used=model)
        except Exception as e:
            last_error = e
            if _is_fallbackable(e):
                continue
            raise OpenAIError(f"OpenAI API error: {e}") from e

    raise OpenAIError(f"All models failed in edit chain. Last: {last_error}")


def has_api_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))
