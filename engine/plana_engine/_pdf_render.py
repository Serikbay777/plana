"""PDF → PNG render через pypdfium2 (Apache-2.0 / BSD-3).

Заменяет прежний pymupdf (AGPL-3.0). Используется importers/gpzu.py и
importers/contour.py для подготовки изображений ГПЗУ / контура участка
к отправке в OpenAI Vision API.

API совместим с предыдущей версией: same `pdf_to_png(bytes, dpi=, max_pages=)`.

Почему ушли с pymupdf: Artifex (вендор pymupdf) явно запрещает SaaS-деплой
под AGPL, коммерческая лицензия — договорная (от $1.5k). pypdfium2 — обёртка
над Google PDFium, по скорости ≈ pymupdf, Apache-2.0, без юридических рисков.
"""

from __future__ import annotations

import io


class PdfRenderError(RuntimeError):
    """PDF не удалось распарсить / отрендерить."""


def pdf_to_png(
    pdf_bytes: bytes,
    *,
    dpi: int = 150,
    max_pages: int = 4,
) -> list[bytes]:
    """Отрендерить до `max_pages` страниц PDF в PNG-байты."""
    try:
        import pypdfium2 as pdfium  # type: ignore[import-untyped]
    except ImportError as e:
        raise PdfRenderError(
            "pypdfium2 не установлен — добавь его в pyproject.toml"
        ) from e

    scale = dpi / 72.0  # PDFium принимает scale так же, как pymupdf — zoom
    pages: list[bytes] = []

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        n = min(len(pdf), max_pages)
        for i in range(n):
            page = pdf[i]
            try:
                bitmap = page.render(scale=scale, rotation=0)
                try:
                    pil = bitmap.to_pil()
                    buf = io.BytesIO()
                    pil.save(buf, format="PNG")
                    pages.append(buf.getvalue())
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        pdf.close()

    return pages
