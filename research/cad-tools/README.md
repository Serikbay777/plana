# CAD Tools Research — Open-Source Landscape для plana

> **Цель:** дать пользователю возможность загрузить CAD-файл (DXF/DWG/IFC/SVG), редактировать его в браузере и экспортировать обратно.
> **Дата ресерча:** 2026-05-14.
> **Контекст проекта:** Next.js 16 + React 19 фронтенд, Python `ezdxf`-движок (FastAPI), три.js уже в зависимостях. Прошлый Phase-1 DXF-пайплайн через ezdxf был откатан в коммите `6edf301`.

---

## TL;DR — рекомендация

| Сценарий | Рекомендация |
|---|---|
| Хочешь **быстрый MVP** (загрузил DXF/DWG → посмотрел → подвинул объекты → сохранил) | **`@mlightcad/cad-viewer`** (MIT, единственный браузерный DXF+DWG viewer **и** редактор; уже умеет move/copy/rotate/scale/delete + undo/redo). v1.5.0 от 2026-05-09. |
| Хочешь **полный кастом** на React (свой UI, своя логика стен/комнат) | **`dxf-viewer` (vagran) + `dxf-parser` + `dxf-writer` или `makerjs`** + собственный редактор поверх **Konva.js** или **three.js**. Больше кода, но полный контроль. |
| Нужен **планировщик квартир/этажей** "из коробки" с каталогом объектов | **`react-planner`** (MIT, React 16+, 2D-чертёж → 3D-навигация). DXF-импорт придётся писать самим. |
| Нужно **3D / параметрика / BREP / STEP** | **OpenCascade.js** (LGPL-2.1) или его обёртка **Replicad**. Это "code-CAD", не интерактивный редактор. |
| Нужно **BIM/IFC** | **That Open Engine** (`@thatopen/components`, MIT) поверх **`web-ifc`** (MIT, WASM). |
| **Сервер-сайд** конвертация DWG↔DXF | **ODA File Converter** (бесплатный, но проприетарный, зрелый) или **LibreDWG** (GPL, ещё развивается). |
| Сервер-сайд DXF read/write/render | **`ezdxf`** (уже в стеке) + его `drawing` addon (рендер в SVG/PNG/PDF через matplotlib). |

**Конкретный рекомендуемый стек для plana** → см. [`recommendation.md`](recommendation.md).

---

## Структура ресерча

| Файл / Папка | Что внутри |
|---|---|
| [`README.md`](README.md) | Этот файл — обзор и TL;DR |
| [`tz-alignment.md`](tz-alignment.md) | **Главное!** Как ресерч ложится на полное ТЗ "AI-платформы". CAD-тулы — это ~30% продукта; разбор слоёв, доменной модели |
| **[`next/`](next/)** | **Вторая волна ресерча** — IFC, PDF-парсеры, geometry, constraint solvers, AI floor plan generation. См. [`next/README.md`](next/README.md) |
| [`candidates.md`](candidates.md) | Подробные досье на 20+ кандидатов с лицензиями, фичами, ограничениями |
| [`matrix.md`](matrix.md) | Сводная таблица фичей (DXF/DWG/IFC × view/edit/export × лицензия × фреймворк) |
| [`recommendation.md`](recommendation.md) | Рекомендуемый стек для plana с обоснованием (CAD-only Phase 1) |
| [`integration-sketch.md`](integration-sketch.md) | Конкретный план интеграции (файловая структура, API, потоки данных) |
| [`format-primer.md`](format-primer.md) | Краткий ликбез по форматам: DXF vs DWG vs IFC vs SVG vs STEP |
| [`sources.md`](sources.md) | Все источники (ссылки) использованные в ресерче |

> **Маршруты чтения:**
> - **Если у вас полное ТЗ AI-платформы** → [`tz-alignment.md`](tz-alignment.md) → [`next/README.md`](next/README.md) → детальные файлы.
> - **Если нужен только CAD (Phase 1 MVP)** → [`recommendation.md`](recommendation.md) → [`integration-sketch.md`](integration-sketch.md).

---

## Ключевые находки

1. **Браузерных полноценных DXF/DWG-редакторов почти нет.** Единственный кандидат "OOTB" — `@mlightcad/cad-viewer`, но его редактирование пока базовое и Save-to-DXF в планах. Всё остальное — либо чистые **viewer**'ы, либо **code-CAD** (программный 3D), либо **floorplan-редакторы** без DXF-импорта.

2. **DWG — закрытый бинарный формат AutoCAD.** Открытых решений два:
   - **LibreDWG** (GNU) — открыт, но не покрывает все entity. Часть DWG не парсится.
   - **ODA File Converter** — бесплатный, проприетарный, зрелый. Используется внутри FreeCAD и ezdxf-аддона.
   - Практический путь: **конвертировать DWG → DXF на сервере** и работать дальше с DXF.

3. **DXF в JS — экосистема "конструктор".** Есть отдельные:
   - **парсеры** (`dxf-parser`, `dxf`),
   - **рендеры** (`dxf-viewer` (vagran), `three-dxf`, `three-dxf-viewer`, `three-dxf-loader`, `dxf-render`),
   - **писатели** (`dxf-writer`, `@tarikjabiri/dxf`, `dxf-doc`, `makerjs`).
   - Полного "editor"'а среди них нет — его надо собирать самим.

4. **OpenCascade.js → Replicad** — серьёзный 3D-кернел в WASM, но это **code-CAD** (сценарии на JS), а не "мышкой двигать стены". Для архитектурного MVP это перебор.

5. **Уже используемый `ezdxf` остаётся отличной серверной основой** — MIT, читает/пишет DXF от R12 до R2018, имеет рендер-аддон (SVG/PNG/PDF). DWG не умеет напрямую — нужен мост.

6. **IFC/BIM — отдельная зрелая ветка** (`That Open Engine` + `web-ifc`). Если plana пойдёт в BIM, это правильный путь.

---

## Что НЕ подходит (и почему)

- **xeokit-sdk** — AGPLv3, требует open-source всю вашу кодобазу или коммерческой лицензии. Только viewer.
- **CascadeStudio** — Studio, не embeddable как библиотека. Это **продукт**, не SDK.
- **JSketcher** — мощный, но standalone-приложение. Нет npm-пакета для embed.
- **LibreCAD / QCAD / FreeCAD** — desktop, не для браузера. Можно использовать в headless-режиме на сервере, но это тяжёлый путь (FreeCAD весит ~700MB и тащит Qt).
- **Aspose.CAD / CAD Exchanger** — коммерческие, не open-source.

---

## Что почитать дальше

→ [`recommendation.md`](recommendation.md) — конкретный план для plana
→ [`matrix.md`](matrix.md) — если хочется сравнить кандидатов в одной таблице
→ [`candidates.md`](candidates.md) — глубокие досье на каждого кандидата
