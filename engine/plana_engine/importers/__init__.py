"""Импортеры внешних документов (ГПЗУ-PDF и др.) — преобразуют в наши типы."""

from .gpzu import GpzuExtraction, GpzuParseError, extract_gpzu

__all__ = ["GpzuExtraction", "GpzuParseError", "extract_gpzu"]
