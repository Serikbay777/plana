# PDF-парсеры для plana — рендер + векторное извлечение

> Контекст: backend `engine/` (Python 3.11+, FastAPI). Сейчас `pymupdf` рендерит ГПЗУ PDF → PNG для Vision LLM (`importers/gpzu.py`). Планируется второй use-case — импорт векторных архитектурных PDF (линии, полилинии, текст с координатами) в нашу domain-модель.
> Проблема: `pymupdf` под AGPL-3.0. plana — закрытый коммерческий SaaS. Нужен ответ: оставить, заменить, или купить commercial.

## TL;DR

**Рекомендация: убрать `pymupdf`. Заменить на двухслойный стек.**

| Слой | Библиотека | Лицензия | Назначение |
|---|---|---|---|
| Render PDF → PNG/PIL | **`pypdfium2`** | Apache-2.0 / BSD-3 | ГПЗУ → Vision LLM (замена текущему pymupdf) |
| Vector extraction | **`pdfplumber`** (на pdfminer.six) | MIT | Линии/curves/rects + текст с позициями для импорта чертежей |
| Detect scan vs vector | свой хелпер на тех же либах | — | Решение: «парсить геометрию» vs «отдавать Vision LLM» |

**Почему так:**
- AGPL для closed-source SaaS — это **серая зона с реальным риском**. Artifex прямо пишет «server-based application = AGPL applies». Commercial license договорной, обычно $1.5k–$50k+. Дешевле и чище — снести `pymupdf`.
- `pypdfium2` (Google PDFium через ctypes) — ~95% скорости pymupdf на рендере, чуть **выше качество** на text extract (97% vs 96% в py-pdf/benchmarks), Apache-2.0.
- `pdfplumber` уже предоставляет `page.lines`, `page.curves`, `page.rects` с полным `original_path` (включая control-points Bezier), `stroking_color`, `non_stroking_color`. Этого хватает для импорта архитектурного DXF-like чертежа. MIT.
- `pikepdf` (MPL-2.0) — низкоуровневый, не извлекает векторную геометрию в готовом виде, оставляем «в резерве» если нужно низкоуровневое редактирование PDF.
- `pdfminer.six` (MIT) — под капотом у `pdfplumber`, использовать напрямую только если нужна предельная гибкость с `paint_path`. Медленнее.

Если кто-то на проекте уже подсчитал, что коммерческая лицензия Artifex окупается фичами PyMuPDF Pro (Office-форматы, scientific OCR, etc.) — это отдельный разговор, цифры запрашиваются.

---

## License deep-dive: PyMuPDF AGPL-3.0

PyMuPDF — Python-обвязка над MuPDF (Artifex). **Обе** части dual-licensed: AGPL-3.0 OR commercial. AGPL отличается от GPL ровно «сетевой оговоркой»: если пользователь взаимодействует с программой по сети (= SaaS), это приравнивается к distribution, и весь код, **скомбинированный** с AGPL-кодом, должен быть открыт под AGPL для конечного пользователя. Это и есть «закрытие SaaS-loophole» GPLv3.

Аргумент «мы не распространяем бинарь, только держим на сервере» — **не работает для AGPL**. Это в точности то, против чего AGPL и создан. Artifex на своей странице licensing формулирует это явно: *«You cannot deploy our open-source as part of a server-based application or service, without disclosing your own application's full source code under AGPL to any users interacting with it»*. Это позиция автора, и она юридически согласована с текстом AGPLv3 §13.

Есть **слабый встречный аргумент** (см. HN, Lexology), что AGPL §13 буквально требует disclosure только при «modification» — если PyMuPDF используется в первозданном виде как import, и никаких patch'ей мы не вносим, то технически тригер не сработал. Юридически это спорно: значительная часть юристов (FSF, Heather Meeker) трактует «modified» расширительно — линковка/импорт как часть бóльшей программы тоже считается. Кроме того, владельцем кода является именно Artifex, и **их** официальное толкование явно более строгое. Идти против trademark holder'а в спорном вопросе — плохой бизнес-риск для коммерческого SaaS.

Прецедент в комьюнити: **mindee/doctr** (OCR-фреймворк) специально вынес PyMuPDF из core dependencies именно по причине AGPL и блокировки коммерческого использования (issue #486 / PR #829). То же делают многие RAG-сборки.

**Commercial license Artifex.** Цена не публикуется, договорная. Открытые источники (G2, teqnamo) дают вилку: starting ~$1500 для скромных встроек, $20k–$50k+ для consumer-facing продуктов с большим объёмом. Под SaaS отдельный SKU — «PyMuPDF Pro». Получить квоту можно только через sales call.

**Вывод:** для plana, где `pymupdf` использует одну функцию (`get_pixmap → PNG`), коммерческая лицензия — overkill. Дешевле и чище заменить на `pypdfium2`.

---

## Сравнительная матрица

| Библиотека | Лицензия | Render PDF→PNG | Vector paths | Text+coords | Скорость | Размер бандла | Maturity |
|---|---|---|---|---|---|---|---|
| **pymupdf** | AGPL-3.0 / commercial | ★★★ (эталон) | ★★★ (`page.get_drawings()`) | ★★★ | ★★★ (0.1s avg) | ~15-30 MB | ★★★ |
| **pypdfium2** | Apache-2.0 / BSD-3 | ★★★ (≈pymupdf) | ★★ (`page.get_objects()` → bounds + type, путей по сегментам нет из коробки) | ★★★ (97% quality) | ★★★ (0.1s) | ~6 MB | ★★ (active, v4.30+) |
| **pdfplumber** | MIT | ★ (через PIL, медленно) | ★★★ (`page.lines/curves/rects`, `original_path` с control-points) | ★★★ | ★ (9.5s avg) | мал | ★★★ |
| **pdfminer.six** | MIT | ✗ | ★★ (`LTLine/LTRect/LTCurve` + `paint_path`) | ★★ (89% quality) | ★ (5.8s) | мал | ★★★ |
| **pikepdf** | MPL-2.0 | ✗ | ✗ (content streams есть, но `cannot extract vector images` — официально) | ✗ | n/a | средний (QPDF C++) | ★★★ |

**Звёздочки субъективные.** Числа на скорость — из `py-pdf/benchmarks` (text extraction, avg over 14 PDFs). Качество — там же.

### Подробности по каждой:

**pymupdf.** Бесспорный лидер по фичам и скорости. AGPL — единственный, но критический минус. `page.get_drawings()` отдаёт готовый список словарей с `items`-сегментами (lines, curves) и stroke/fill — это лучший API для нашего vector-import use case. Если AGPL когда-нибудь снимется или мы купим commercial — вернуть, но в новой архитектуре уже не делать критической зависимостью.

**pypdfium2.** Обёртка над Google PDFium (тот же движок, что в Chrome). Apache-2.0 — чисто. Render — практически paritет с pymupdf по скорости и качеству. Threading **не** thread-safe (как и pymupdf), это OK — в FastAPI обрабатываем PDF в отдельном process pool. `page.get_objects()` возвращает `PdfObject` с `type`, `get_pos()`, `get_matrix()`, но **детальные сегменты path** (line-to / bezier-to) через стабильный Python API **не экспонированы** — нужно лезть в `pypdfium2_raw` C-bindings и парсить FPDFPath API руками. Это не killer, но для vector-import предпочтительнее `pdfplumber`. Для рендера — идеален.

**pdfplumber.** Тонкая надстройка над `pdfminer.six` с удобной object-моделью. `page.lines`, `page.curves`, `page.rects` отдают dicts с координатами в page-space и `original_path` — list `(cmd, x, y, ...)` с включением control-points для bezier (это исправили в 2021, см. release `20211012`). `stroking_color` / `non_stroking_color` доступны → можем фильтровать по слою-условно через цвет. MIT — чисто. Минус: рендер делает через `to_image()` → внутри Wand+Ghostscript, **не годится** для production-рендера (Ghostscript = AGPL!). Используем `pdfplumber` строго для vector/text, рендер — через `pypdfium2`.

**pdfminer.six.** Pure Python (медленно, но никаких бинарей). API ниже уровнем чем pdfplumber: получаем `LTPage` → итерируем `LTLine`, `LTRect`, `LTCurve`, `LTTextBox`. Если потребуется кастомный `PDFLayoutAnalyzer.paint_path()` (например, маппить PDF clip-paths в наши hatches) — это путь. Иначе оверкилл, проще через pdfplumber.

**pikepdf.** Это **PDF-manipulation** библиотека (split/merge/encrypt/edit metadata). Парсит content streams, но **не интерпретирует** vector commands в готовую геометрию — отдаёт сырой stack PostScript-подобных операторов (`m`, `l`, `c`, `re`, …). Цитата из официальной доки: *«pikepdf also cannot extract vector images»*. Полезна, если будем редактировать PDF на сервере (например, заглаживать персональные данные в ГПЗУ перед отправкой в LLM). Для нашего vector-import не подходит.

---

## Decision tree: что использовать когда

```
Задача
│
├── Рендер PDF → PNG (для Vision LLM, thumbnails, preview)
│   └─► pypdfium2  (PdfDocument → page.render(scale=2).to_pil())
│
├── Импорт векторного архитектурного PDF (линии, размеры) → наша модель
│   ├── PDF содержит vector content?
│   │   ├── ДА  ─► pdfplumber  (page.lines / page.curves / page.rects + page.chars для текста)
│   │   │           Маппим в нашу Wall/Line/Polyline через DXF-импортер.
│   │   └── НЕТ (scan) ─► fallback на Vision LLM (как gpzu.py)
│   │                        Render через pypdfium2 + промпт «extract walls/dimensions».
│   │
│   └── Нужно низкоуровневое редактирование PDF (масс-обработка, anonymize, attach JS)
│       └─► pikepdf
│
├── Просто text extraction (отчёты, спецификации)
│   └─► pypdfium2  (быстрее всех, качество ≥ pymupdf)
│
└── Сложная семантика текста (tables, columns, headers)
    └─► pdfplumber  (медленно, но богатая object-модель)
```

### Detection «scan vs vector»

Эвристика, проверенная сообществом pymupdf / pdfplumber:

```python
def is_scanned_pdf(pdf_bytes: bytes) -> bool:
    """True если PDF — это, по сути, сканы (одна большая картинка на страницу),
    False если есть нормальный векторный content."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(pdf_bytes)
    for i in range(min(3, len(pdf))):  # достаточно посмотреть первые 3 страницы
        page = pdf[i]
        objects = list(page.get_objects())
        n_text = sum(1 for o in objects if o.type == pdfium.raw.FPDF_PAGEOBJ_TEXT)
        n_path = sum(1 for o in objects if o.type == pdfium.raw.FPDF_PAGEOBJ_PATH)
        n_image = sum(1 for o in objects if o.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE)
        # Сканированная страница: ~1 крупный image + 0 нормального текста/путей
        if n_text < 5 and n_path < 5 and n_image >= 1:
            continue  # подозрение на скан
        return False
    return True
```

Альтернативный признак (если есть pdfplumber): `len(page.chars) < 10 and len(page.lines) + len(page.curves) < 5 and page.images`.
Ещё один — если в `page.chars` встречается fontname `GlyphlessFont`, это OCR'енный скан (Tesseract).

---

## Code snippets

### 1. Render PDF → PIL.Image (замена `_pdf_to_png` в `gpzu.py`)

```python
# engine/plana_engine/_pdf_render.py
"""Рендер PDF-страниц в PNG-байты через pypdfium2 (Apache-2.0)."""
from __future__ import annotations
import io


def render_pdf_to_png(pdf_bytes: bytes, *, dpi: int = 150, max_pages: int = 4) -> list[bytes]:
    """Отрендерить до `max_pages` страниц PDF в PNG-байты.

    Замена прежнего pymupdf-варианта. API совместимый.
    """
    import pypdfium2 as pdfium  # импорт ленивый — не тащить либу в холодный старт

    pdf = pdfium.PdfDocument(pdf_bytes)
    n = min(len(pdf), max_pages)
    scale = dpi / 72.0  # PDFium принимает scale, как и pymupdf zoom
    out: list[bytes] = []
    for i in range(n):
        page = pdf[i]
        bitmap = page.render(scale=scale, rotation=0)
        pil = bitmap.to_pil()  # PIL.Image
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        out.append(buf.getvalue())
        page.close()
        bitmap.close()
    pdf.close()
    return out
```

### 2. Vector path extraction (новый `importers/vector_pdf.py`)

```python
# engine/plana_engine/importers/vector_pdf.py
"""Извлечение векторной геометрии из PDF (линии, прямоугольники, кривые,
текст с координатами) для импорта архитектурных чертежей.

Использует pdfplumber (MIT, на pdfminer.six). Координаты в PDF-points
(1pt = 1/72 inch); конвертация в миллиметры — у caller'а, если нужно.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class PdfLine:
    x0: float; y0: float; x1: float; y1: float
    stroke: tuple[float, ...] | None  # RGB(A) 0..1
    width: float


@dataclass
class PdfRect:
    x0: float; y0: float; x1: float; y1: float
    stroke: tuple | None; fill: tuple | None


@dataclass
class PdfCurve:
    # path — list of (cmd, *pts), cmd in {'m','l','c','v','y','h','re'}
    path: list[tuple]
    stroke: tuple | None; fill: tuple | None


@dataclass
class PdfText:
    text: str
    x: float; y: float  # bottom-left in PDF points
    width: float; height: float
    fontname: str


@dataclass
class VectorPage:
    width: float; height: float  # points
    lines: list[PdfLine]
    rects: list[PdfRect]
    curves: list[PdfCurve]
    chars: list[PdfText]  # сгруппированные в words/lines делает caller


def extract_vector(pdf_bytes: bytes, *, page_index: int = 0) -> VectorPage:
    import pdfplumber
    import io

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[page_index]
        lines = [
            PdfLine(
                x0=ln["x0"], y0=ln["y0"], x1=ln["x1"], y1=ln["y1"],
                stroke=ln.get("stroking_color"),
                width=ln.get("linewidth", 0.0),
            )
            for ln in page.lines
        ]
        rects = [
            PdfRect(
                x0=r["x0"], y0=r["y0"], x1=r["x1"], y1=r["y1"],
                stroke=r.get("stroking_color"),
                fill=r.get("non_stroking_color"),
            )
            for r in page.rects
        ]
        curves = [
            PdfCurve(
                path=c.get("path", []),
                stroke=c.get("stroking_color"),
                fill=c.get("non_stroking_color"),
            )
            for c in page.curves
        ]
        # текст — берём через page.extract_words() для сгруппированных слов
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        chars = [
            PdfText(
                text=w["text"],
                x=w["x0"], y=w["bottom"],
                width=w["x1"] - w["x0"],
                height=w["bottom"] - w["top"],
                fontname=w.get("fontname", ""),
            )
            for w in words
        ]
        return VectorPage(
            width=page.width, height=page.height,
            lines=lines, rects=rects, curves=curves, chars=chars,
        )
```

Дальше — отдельный мапер `VectorPage → plana domain model (Wall/Door/Window)`, по аналогии с тем, как `ezdxf` импортер обрабатывает DXF entities. Это уже не задача PDF-парсера.

---

## Migration plan: убрать pymupdf из gpzu.py

**Текущий API** (`engine/plana_engine/importers/gpzu.py:110-127`):

```python
def _pdf_to_png(pdf_bytes: bytes, *, dpi: int = 150, max_pages: int = 4) -> list[bytes]:
    import pymupdf
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        n = min(len(doc), max_pages)
        zoom = dpi / 72.0
        mat = pymupdf.Matrix(zoom, zoom)
        for i in range(n):
            pix = doc[i].get_pixmap(matrix=mat, alpha=False)
            pages.append(pix.tobytes("png"))
    return pages
```

**Шаги миграции:**

1. **Завести модуль `engine/plana_engine/_pdf_render.py`** с публичной функцией `render_pdf_to_png(pdf_bytes, *, dpi, max_pages) -> list[bytes]` на `pypdfium2`. Сигнатура **идентична** `_pdf_to_png` в gpzu.py — это намеренно, чтобы миграция была одной заменой импорта.

2. **В `gpzu.py`** удалить локальный `_pdf_to_png`, заменить на `from .._pdf_render import render_pdf_to_png as _pdf_to_png`. Текст ошибки в `GpzuParseError` поправить с *«pymupdf не установлен»* на *«pypdfium2 не установлен»*.

3. **`pyproject.toml`**: убрать `pymupdf`, добавить `pypdfium2 >= 4.30`. Опционально: добавить `pdfplumber >= 0.11` под extras `vector-import` или в основные deps, если фича пойдёт сразу.

4. **Тесты**: проверить, что на том же тестовом ГПЗУ (`tests/fixtures/*.pdf`?) Vision-LLM пайплайн возвращает совместимый JSON. Скорее всего — да: для LLM 150 dpi PNG от PDFium визуально неотличим от MuPDF.

5. **Документация**: обновить `engine/README.md` (если есть упоминание pymupdf) и любые ADR. Добавить в LICENSE проекта ссылку на pypdfium2 (Apache-2.0 требует attribution).

6. **CI/CD**: pypdfium2 поставляет prebuilt wheels на linux/macos/windows + manylinux + musllinux. Никаких system deps. На Alpine — нужен `musllinux` wheel (есть). Образы Docker лёгкие, ~6 MB vs ~25 MB у pymupdf.

7. **Не торопиться удалять pymupdf глобально**: если на проекте есть скрипты-ноутбуки/CLI вне основного backend (например, для разработческого debug), пометь pymupdf как `dev`-only dependency или удали постепенно. На production-серверной сборке его быть **не должно**.

**Риски миграции:**
- Если ГПЗУ-PDF содержит редкие шрифты, PDFium может рендерить их хуже, чем MuPDF — в практике 99% случаев parity, но проверить на 5-10 реальных файлах.
- Если в проекте есть код, использующий `pymupdf.get_text()` или `page.get_drawings()` — нужно отдельно мигрировать на `pdfplumber` (вектор) или `pypdfium2.get_textpage()` (текст). На момент аудита — только `_pdf_to_png` в `importers/gpzu.py`.

**Эстимейт:** 2-4 часа на код + тесты + PR. Сама замена тривиальна.

---

## Что точно НЕ делать

1. **Не пытаться обойти AGPL «мы только импортируем, не модифицируем»** — позиция Artifex однозначна, аргумент в суде слабый, и trademark holder против. Если коммерчески критично иметь pymupdf — покупаем лицензию официально.
2. **Не использовать pdfplumber.to_image()** в production — он зовёт Ghostscript под капотом (Wand → ImageMagick → GS), а Ghostscript — тоже AGPL.
3. **Не лезть в `pypdfium2_raw` для path-сегментов**, пока есть `pdfplumber`. Низкоуровневые FPDFPath_* вызовы — последняя миля, если pdfplumber вдруг не справится с конкретным PDF.
4. **Не пытаться написать свой PDF-парсер.** Спецификация PDF — 1300 страниц, content streams — PostScript-подобный stack-машинный язык, шрифты — отдельный ад.
5. **Не делать PDF → DXF на стороне сервера через Inkscape sidecar** (как `pyPDFtoDXF`) — Inkscape запускается 5+ секунд на холодную, не масштабируется. Если такой пайплайн понадобится — сделаем нативно через `pdfplumber` → наша domain-модель → `ezdxf.export()`.

---

## Sources

**License & legal:**
- [Artifex Licensing — official page](https://artifex.com/licensing) — *«you cannot deploy our open-source as part of a server-based application»*
- [PyMuPDF Licence Question — GitHub Discussion #971](https://github.com/pymupdf/PyMuPDF/discussions/971) — JorjMcKie (maintainer) clarification
- [PyMuPDF AGPL clarification Issue #4504](https://github.com/pymupdf/PyMuPDF/issues/4504)
- [doctr removed PyMuPDF (Issue #486)](https://github.com/mindee/doctr/issues/486) — precedent of removing AGPL dep for commercial OSS
- [FOSSA — AGPL 101](https://fossa.com/blog/open-source-software-licenses-101-agpl-license/)
- [Mend — SaaS Loophole in GPL](https://www.mend.io/blog/the-saas-loophole-in-gpl-open-source-licenses/)
- [Open Core Ventures — AGPL is a non-starter for most companies](https://www.opencoreventures.com/blog/agpl-license-is-a-non-starter-for-most-companies)
- [Kemp IT Law — AGPL and 'as a Service'](https://kempitlaw.com/insights/open-source-software-the-affero-gpl-the-as-a-service-world-and-the-cal/)
- [PyMuPDF Pro (commercial SKU)](https://artifex.com/products/pymupdf-pro/)
- [Teqnamo — MuPDF pricing (indicative)](https://teqnamo.com/solutions/prices/pdf-software-prices/mupdf/)

**Libraries — official:**
- [pypdfium2 GitHub](https://github.com/pypdfium2-team/pypdfium2)
- [pypdfium2 docs (stable)](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
- [pdfplumber GitHub](https://github.com/jsvine/pdfplumber)
- [pdfminer.six docs — extract_pages](https://pdfminersix.readthedocs.io/en/latest/tutorial/extract_pages.html)
- [pikepdf — Working with content streams](https://pikepdf.readthedocs.io/en/latest/topics/content_streams.html) — *«pikepdf also cannot extract vector images»*

**Benchmarks & comparisons:**
- [py-pdf/benchmarks](https://github.com/py-pdf/benchmarks) — pymupdf 0.1s / pypdfium2 0.1s / pdfplumber 9.5s / pdfminer.six 5.8s, quality 96/97/75/89%
- [PyMuPDF Performance Comparison Methodology](https://pymupdf.readthedocs.io/en/latest/app4.html)
- [Aman Kumar — 7 Python PDF Extractors tested (2025)](https://onlyoneaman.medium.com/i-tested-7-python-pdf-extractors-so-you-dont-have-to-2025-edition-c88013922257)
- [BSWEN — MIT-licensed PyMuPDF alternative](https://docs.bswen.com/blog/2026-03-04-pymupdf-mit-alternative-commercial/)

**Vector extraction / PDF→DXF:**
- [pdfplumber Discussion #345 — What is a curve?](https://github.com/jsvine/pdfplumber/discussions/345)
- [pdfplumber Discussion #892 — Extracting Bezier curves](https://github.com/jsvine/pdfplumber/discussions/892)
- [pdfminer.six Issue #463 — Minimum example LTCurves](https://github.com/pdfminer/pdfminer.six/issues/463)
- [pdfminer.six Issue #126 — Graphical lines detection](https://github.com/pdfminer/pdfminer.six/issues/126)
- [pyPDFtoDXF](https://github.com/mjecke/pyPDFtoDXF) — Inkscape-based, reference only
- [naufraghi/pdf2dxf](https://github.com/naufraghi/pdf2dxf) — pdfalto + dxfwrite approach
- [micci184/pdf-to-dxf-converter](https://github.com/micci184/pdf-to-dxf-converter) — AI/raster pipeline

**Scan detection:**
- [PyMuPDF Discussion #1653 — How to identify scanned PDF](https://github.com/pymupdf/PyMuPDF/discussions/1653)
- [Quantrium — Identifying text-based and image-based PDFs](https://medium.com/quantrium-tech/identifying-text-based-and-image-based-pdfs-using-python-10dba29a02b4)

---

## Открытые вопросы (требуют уточнения)

- **Реальная стоимость PyMuPDF Pro для plana.** Нужен sales call с Artifex; единственный способ получить квоту. Если бюджет на инструменты >$2k/год и команда хочет богатый `get_drawings()` — может быть оправдано. Иначе — мигрируем.
- **Конкретные ГПЗУ-фикстуры**, на которых сравнить рендер pypdfium2 vs pymupdf. У меня нет к ним доступа.
- **Объём vector-import use case** — если это разовая фича для импорта 1-2 чертежей в неделю, оверкилл уровня pdfplumber'а ОК. Если поток в сотни PDF/мин — придётся вернуться к вопросу скорости (pdfplumber 9.5s avg!).
