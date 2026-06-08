"""Server-side OpenAI runtime for text, chat, and vision LLM calls.

The API key is always read from OPENAI_API_KEY. The default model can be
overridden with OPENAI_MODEL in the environment.
"""

from __future__ import annotations

import logging
import os
from typing import Any


DEFAULT_OPENAI_MODEL = "gpt-5.5"

logger = logging.getLogger("plana.openai")


class OpenAIConfigError(RuntimeError):
    """OpenAI is not configured correctly."""


class OpenAIRuntimeError(RuntimeError):
    """OpenAI request failed."""


class OpenAIEmptyResponseError(OpenAIRuntimeError):
    """OpenAI returned no usable content."""


def resolve_openai_model(model: str | None = None) -> str:
    resolved = (model or os.environ.get("OPENAI_MODEL") or os.environ.get("LLM_MODEL") or DEFAULT_OPENAI_MODEL).strip()
    if not resolved:
        raise OpenAIConfigError("OPENAI_MODEL is empty")
    return resolved


def has_openai_api_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY", "").strip())


def has_openai_model() -> bool:
    try:
        return bool(resolve_openai_model())
    except OpenAIConfigError:
        return False


def resolve_reasoning_effort(model: str) -> str | None:
    configured = os.environ.get("OPENAI_REASONING_EFFORT")
    if configured is not None:
        value = configured.strip()
        return value or None
    if model.startswith("gpt-5"):
        return "none"
    return None


def openai_client():
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise OpenAIConfigError("OPENAI_API_KEY is not set")

    try:
        from openai import OpenAI
    except ImportError as e:
        raise OpenAIConfigError("openai SDK is not installed") from e

    return OpenAI(api_key=api_key)


def _safe_error_message(error: Exception) -> str:
    status = getattr(error, "status_code", None)
    code = getattr(error, "code", None)
    message = str(error)
    lowered = message.lower()

    if status == 429 or "rate limit" in lowered:
        return "OpenAI API rate limit or token limit exceeded"
    if "maximum context" in lowered or "context_length" in lowered or "too many tokens" in lowered:
        return "OpenAI token/context limit exceeded"
    if status == 401:
        return "OpenAI API authentication failed"
    if status == 403:
        return "OpenAI API access denied for this key or model"
    if status == 404 or "model_not_found" in lowered or "model not found" in lowered:
        return "OpenAI model is not available for this key"
    if code:
        return f"OpenAI API error ({code})"
    return f"OpenAI API error: {message}"


def chat_completion(
    *,
    operation: str,
    messages: list[dict[str, Any]],
    model: str | None = None,
    response_format: dict[str, Any] | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
):
    """Run a Chat Completions request with safe logging and env-driven model."""
    resolved_model = resolve_openai_model(model)
    client = openai_client()
    kwargs: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
    }
    if response_format is not None:
        kwargs["response_format"] = response_format
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_output_tokens is not None:
        kwargs["max_completion_tokens"] = max_output_tokens
    reasoning_effort = resolve_reasoning_effort(resolved_model)
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort

    logger.info("OpenAI request started operation=%s model=%s", operation, resolved_model)

    try:
        response = client.chat.completions.create(**kwargs)
    except Exception as first_error:  # noqa: BLE001
        message = str(first_error).lower()
        retry_kwargs = dict(kwargs)
        retry_reason: str | None = None

        if "max_completion_tokens" in message and "unsupported" in message:
            retry_kwargs.pop("max_completion_tokens", None)
            if max_output_tokens is not None:
                retry_kwargs["max_tokens"] = max_output_tokens
            retry_reason = "max_tokens_compat"
        elif "reasoning_effort" in message and "unsupported" in message:
            retry_kwargs.pop("reasoning_effort", None)
            retry_reason = "reasoning_effort_compat"
        elif "temperature" in message and ("unsupported" in message or "default" in message):
            retry_kwargs.pop("temperature", None)
            retry_reason = "temperature_default_compat"

        if retry_reason:
            logger.info(
                "OpenAI request retry operation=%s model=%s reason=%s",
                operation,
                resolved_model,
                retry_reason,
            )
            try:
                response = client.chat.completions.create(**retry_kwargs)
            except Exception as retry_error:  # noqa: BLE001
                safe_message = _safe_error_message(retry_error)
                logger.warning(
                    "OpenAI request failed operation=%s model=%s error=%s",
                    operation,
                    resolved_model,
                    safe_message,
                )
                raise OpenAIRuntimeError(safe_message) from retry_error
        else:
            safe_message = _safe_error_message(first_error)
            logger.warning(
                "OpenAI request failed operation=%s model=%s error=%s",
                operation,
                resolved_model,
                safe_message,
            )
            raise OpenAIRuntimeError(safe_message) from first_error

    if not getattr(response, "choices", None):
        logger.warning("OpenAI returned no choices operation=%s model=%s", operation, resolved_model)
        raise OpenAIEmptyResponseError("OpenAI returned no choices")

    request_id = getattr(response, "_request_id", None) or getattr(response, "id", None)
    logger.info(
        "OpenAI request succeeded operation=%s model=%s response_id=%s",
        operation,
        resolved_model,
        request_id or "n/a",
    )
    return response
