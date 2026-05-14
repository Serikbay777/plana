# Recommendation — стек для plana

> Базируется на текущем состоянии plana: Next.js 16 + React 19 + three.js + Python `ezdxf` + Kazakh-CAD prompt-движок.
> Цель: дать пользователю загрузить DXF/DWG → редактировать (двигать стены, объекты) → выгрузить обратно DXF.

## Рекомендуемый стек (двух-фазный план)

### Фаза 1 — MVP (1-2 недели): viewer + базовый edit + export

**Frontend:**
- **`@mlightcad/cad-viewer`** для импорта/просмотра DXF+DWG (MIT, WASM-парсер DWG уже встроен).
  - Подключается dynamic import'ом в Next.js client component (`'use client'`).
  - Использует Three.js — наша зависимость уже стоит.
  - Базовое редактирование (move/copy/rotate/scale/delete + undo/redo) идёт OOTB.
- **`@tarikjabiri/dxf`** (или `dxf-writer`) для генерации экспортного DXF на клиенте.
  - Маппинг из in-memory модели cad-viewer'а → DXF entities.
  - Если автор `@mlightcad/cad-viewer` зарелизит свой save-to-DXF до того, как мы напишем свой — переключиться на него.

**Backend (Python, `engine`):**
- **`ezdxf`** уже есть. Оставляем как:
  - Серверный fallback экспорт (если клиентского `dxf-writer`'а не хватит).
  - Серверный рендер preview (`ezdxf.addons.drawing` → SVG/PNG).
- **`ODA File Converter`** как Docker side-car для DWG → DXF (надёжнее LibreDWG, бесплатный).
  - Если ODA EULA блокер — `LibreDWG` через CLI `dwg2dxf` как fallback.

**Поток данных:**
```
┌─────────────────────────────────┐
│ Пользователь грузит файл (DXF/DWG)
└──────────────┬──────────────────┘
               │
        ┌──────▼──────┐
        │ Если DWG →  │
        │  /api/dwg-  │── вызов ODA sidecar → DXF
        │  to-dxf     │
        └──────┬──────┘
               │ (DXF blob)
        ┌──────▼──────────────────┐
        │ @mlightcad/cad-viewer   │
        │  парсит в браузере,      │
        │  рендерит, даёт edit-UI  │
        └──────┬──────────────────┘
               │ (user edits)
        ┌──────▼──────────────────┐
        │ Export: @tarikjabiri/dxf │
        │  serialize в DXF-строку  │
        └──────┬──────────────────┘
               │ (DXF blob → download)
               ▼
        Скачивание DXF
```

**Что НЕ делаем в Фазе 1:**
- Не пытаемся написать DWG (это закрытый формат, выгружаем как DXF).
- Не делаем 3D-кернел (BREP/STEP — другая лига, отдельный проект).
- Не интегрируем BIM/IFC — это **отдельная** ветка plana, если понадобится.

### Фаза 2 — Architecture-aware editor (4-8 недель): кастомный layer для квартир

Когда станет ясно, что нужно "редактировать квартиру" (с пониманием стен/комнат/дверей), а не голые DXF-сущности:

**Опция A — поверх mlightcad:**
- Поверх `@mlightcad/cad-viewer` строим **semantic layer**: "линии в layer WALL → стены", "блоки `DOOR` → двери".
- UI редактирования квартирных понятий (площадь комнаты, разворот двери) — React поверх ядра cad-viewer'а.

**Опция B — кастомный двигатель на Konva.js:**
- `dxf-parser` парсит DXF → нормализованная модель квартиры (Room/Wall/Door/Window).
- **`Konva.js`** + `react-konva` рисует и редактирует.
- `@tarikjabiri/dxf` сериализует обратно.
- Плюс: полный контроль над UX, плотная интеграция с plana-engine (KZ-нормы инсоляции, площадей и т.д.).
- Минус: пишем больше кода.

**Опция C — react-planner с DXF-адаптером:**
- Берём `react-planner` как готовый редактор плана (drag&drop из каталога).
- Пишем **двунаправленный адаптер** `DXF ↔ react-planner JSON`.
- Плюс: готовый редактор с каталогом мебели/дверей/окон, 3D-навигация.
- Минус: react-planner на React 16, потребуется проверка с React 19, своя стилистика.

**На фазе 1 не выбираем между A/B/C** — собираем данные на реальном использовании.

---

## Почему именно так

### Почему mlightcad, а не построить свой?

- Это **единственный** opensource-проект, который **одновременно** парсит DXF и DWG в браузере. Альтернатива — серверный DWG→DXF + клиентский только DXF (это всё равно делаем как fallback, см. ODA sidecar).
- Авторы активны (v1.5.0 от 2026-05-09).
- Лицензия MIT — без рисков.
- Внутри Three.js — мы уже на нём.
- Vue-зависимость в UI-слое **не блокер**: ядро framework-agnostic. Vue-обвес обходим, используем core API.

### Почему ezdxf на сервере остаётся

- Уже в стеке, MIT, зрелый.
- Может **рисовать preview** (`drawing` addon → PNG/SVG/PDF). Полезно для миниатюр, экспорта PDF.
- Может **валидировать** и **нормализовать** загруженный DXF перед отдачей на клиент.
- Может работать как server-authoritative writer для случаев, когда клиентского `dxf-writer`'а не хватает (например, paper space, dimensions, hatches с паттернами).

### Почему ODA File Converter для DWG, а не LibreDWG

- ODA — golden standard, используется FreeCAD и ezdxf-аддоном.
- Бесплатный (для большинства use cases). Проверить EULA для коммерческого SaaS — стандартно ОК.
- LibreDWG (GPLv3) использовать только через CLI subprocess, чтобы не заразить кодобазу. Применим как fallback.

### Почему не OpenCascade.js / Replicad

- Это **3D BREP**-кернелы для инженерного CAD. Не подходит для интерактивного 2D-плана.
- 10-30MB WASM-бандл — тяжёлый для browser-first продукта.
- API "code-CAD" — не "мышкой двигать стены".
- Если в будущем понадобится 3D-визуализация квартиры с реальной геометрией стен — рассмотрим Replicad. Сейчас — overkill.

### Почему не xeokit / не AGPL

- AGPL заразит весь plana — это SaaS, AGPL потребует открыть исходники сервиса.
- Коммерческая лицензия xeokit — платная, не вписывается в "opensource-stack" цель.

### Почему не FreeCAD headless

- Не для веба.
- Docker-образ ~700MB.
- Cold start медленный.
- Дублирует функции ezdxf для нашего DXF-сценария.

---

## Риски и митигации

| Риск | Митигация |
|---|---|
| `@mlightcad/cad-viewer` не зарелизит DXF save вовремя | Пишем свой клиентский экспорт через `@tarikjabiri/dxf` (1-2 дня работы). Серверный ezdxf как finally-fallback. |
| DWG-файл не парсится LibreDWG WASM | На сервере конвертируем через ODA. Клиент видит уже DXF. |
| Vue-зависимость mlightcad конфликтует с React | Используем только core API (без Vue UI-компонентов). Если конфликт всё равно — переходим на `@mlightcad/cad-simple-viewer` или собираем свой viewer на `dxf-viewer` (vagran). |
| Огромные DXF-файлы (>50MB) тормозят клиент | Web-worker (vagran-овский dxf-viewer это уже умеет). MLight тоже делает в worker'е. Серверный preview для thumbnail. |
| ODA EULA не подходит | LibreDWG CLI как fallback. Если совсем критично — заплатить за CAD Exchanger / Aspose. |
| Three.js bundle разрастается | Tree-shaking, dynamic import только тех компонентов viewer'а, что нужны. |

---

## Что точно НЕ делать

1. **Не использовать LibreDWG как библиотеку**, только как CLI subprocess (GPL-заразность).
2. **Не подключать xeokit-sdk** (AGPL).
3. **Не интегрировать FreeCAD headless** для нашего use case — overkill.
4. **Не пилить свой DXF-парсер с нуля.** Берём `dxf-parser` / `dxf-viewer` / `mlightcad`.
5. **Не пилить свой DWG-парсер.** Используем ODA или LibreDWG через CLI.
6. **Не блокировать UI** во время парсинга больших файлов — обязательно web-worker.

---

## Конкретные следующие шаги

См. [`integration-sketch.md`](integration-sketch.md) — там файловая структура, API, конкретные сниппеты, минимальный POC.
