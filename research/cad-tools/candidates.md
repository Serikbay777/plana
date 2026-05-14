# Candidates — досье на каждого кандидата

Сгруппированы по слою: **Browser editors → DXF stack → 3D kernels → 2D editors → IFC/BIM → Server-side**.

Лицензии: **MIT/Apache/BSD = безопасно**, **LGPL = можно линковать в коммерческий продукт**, **GPL/AGPL = "вирусные"**, **proprietary = надо договариваться**.

---

## A. Браузерные viewer + editor (полные решения)

### A1. `@mlightcad/cad-viewer` ⭐ ТОП-КАНДИДАТ

- **Repo:** https://github.com/mlightcad/cad-viewer
- **NPM:** `@mlightcad/cad-viewer`
- **Лицензия:** **MIT**
- **Версия:** **v1.5.0 (2026-05-09)** — свежее
- **Звёзд:** ~600
- **Форматы:** DXF (полная), DWG (через LibreDWG WASM, с оговорками)
- **Что умеет:**
  - Парсинг DXF/DWG **полностью в браузере** (WASM)
  - Рендер через Three.js (WebGL) или SVG-бэкенд
  - **Базовое редактирование:** move, copy, rotate, scale, delete, undo/redo
  - Layers, toolbar, command line, status bar
  - Drag & drop, fetch by URL
- **Что НЕ умеет:**
  - Save to DXF — **в roadmap**, но ещё нет
  - Полноценные draw-tools (создание новых стен/линий) — частично
  - Некоторые DWG (особенно Tianzheng) ломаются на LibreDWG
- **Стек:** TypeScript (85%) + Vue 3 (13%). Ядро framework-agnostic, есть пример для React. Three.js под капотом.
- **Интеграция в Next.js:** возможна, но Vue-обвес придётся либо подключать в "острове", либо использовать `@mlightcad/cad-simple-viewer` (минимальная обвязка) и собирать UI на React.
- **Когда брать:** хочешь самый быстрый старт для DXF/DWG **в браузере**. Готов пилить export сам, пока авторы не сделают.

### A2. `dxf-viewer` (vagran)

- **Repo:** https://github.com/vagran/dxf-viewer
- **NPM:** `dxf-viewer` (~37K monthly downloads)
- **Лицензия:** **MPL-2.0**
- **Форматы:** DXF **только viewing**
- **Сильное:** оптимизирован под огромные файлы, web-worker pipeline, batching, instanced rendering, layer toggle.
- **Слабое:** только viewer (никакого редактирования), ограниченная поддержка размеров (только linear), нет hatch patterns, нет lineweights, нет paper space.
- **Интеграция:** чисто JS-пакет, ставится в Next.js без проблем (dynamic import — есть DOM/WebGL).
- **Когда брать:** если нужен только viewer с **отличной производительностью** и редактор будешь писать сам поверх three.js.

### A3. `three-dxf-viewer` (ieskudero)

- **Repo:** https://github.com/ieskudero/three-dxf-viewer
- **Лицензия:** MIT
- **Поверх:** `dxf-parser` + Three.js + `rtf.js`
- **Уровень:** возвращает Three.js Object3D — встраиваешь в свою сцену.
- **Когда брать:** если уже глубоко в three.js и нужна гибкость интеграции в свою 3D-сцену (плюс к плоскому floorplan).

### A4. `three-dxf` (gdsestimating)

- **Repo:** https://github.com/gdsestimating/three-dxf
- **Лицензия:** MIT
- **Уровень:** "канонический" простейший рендер DXF в three.js. Сейчас уступает по фичам vagran-у, но проще.

### A5. `three-dxf-loader` (prolincur)

- **Repo:** https://github.com/prolincur/three-dxf-loader
- **Лицензия:** MIT
- **Уровень:** работает с react-three-fiber, оборачивает `dxf-parser`.
- **Когда брать:** если фронт уже на R3F.

### A6. `dxf-render` (arbaev)

- **Уровень:** новейший, framework-agnostic, "больше entity, чем у любой другой JS-либы" (по словам автора).
- **Зрелость:** молодой, мало звёзд. Risk.

---

## B. DXF stack — модульные парсеры/писатели

### B1. `dxf-parser` (gdsestimating)

- **Repo:** https://github.com/gdsestimating/dxf-parser
- **Лицензия:** MIT
- **Что:** чистый парсер DXF в JS-объект. **Не рендерит**.
- **Используется:** под капотом `three-dxf`, `three-dxf-loader`, `three-dxf-viewer`.

### B2. `dxf` (npm)

- Альтернативный комбинированный парсер + SVG-конвертер.

### B3. `dxf-writer`

- **NPM:** `dxf-writer`
- **API:** `drawText/drawCircle/drawLine` + layer mgmt → `toDxfString()`.
- **Зрелость:** простой, без paper space, без блоков. Базовая запись.

### B4. `@tarikjabiri/dxf` (dxfjs/writer)

- **Repo:** https://github.com/dxfjs/writer
- **TypeScript-first**, более полный API чем `dxf-writer`. Использует `Writer` + `Entity`.

### B5. `dxf-doc`

- Низкоуровневый, требует понимания DXF. Поддерживает hatches.

### B6. `makerjs` (Microsoft) ⭐

- **Repo:** https://github.com/Microsoft/maker.js
- **NPM:** `makerjs`
- **Лицензия:** Apache-2.0 (Microsoft Garage)
- **Что:** 2D-параметрическое моделирование (примитивы, булевы, паттерны).
- **Экспорт:** **DXF, SVG, PDF, STL, JSCAD CSG/CAG**.
- **Стек:** работает в Node.js и в браузере.
- **Когда брать:** если хочешь генерировать чертежи **программно** (например, "квартира из шаблона + параметры") и потом отдавать DXF юзеру.

---

## C. 3D CAD kernels (WASM)

### C1. `OpenCascade.js`

- **Repo:** https://github.com/donalffons/opencascade.js
- **Сайт:** https://ocjs.org
- **Лицензия:** **LGPL-2.1** (важно: можно использовать в проприетарном продукте через dynamic linking, но WASM модификации должны оставаться открытыми)
- **Что:** порт OpenCascade Technology (зрелого C++ CAD-кернела) в WASM.
- **Форматы:** STEP, IGES, BRep, STL.
- **Когда брать:** нужен серьёзный 3D BREP (булевы, fillet, shell, lofting). Не для plane-плана 2D-квартиры.
- **Размер:** WASM-бандл ~10-30MB (зависит от профиля сборки).

### C2. `Replicad`

- **Сайт:** https://replicad.xyz
- **Что:** идеологическая обёртка над OpenCascade.js, API в стиле CadQuery/CascadeStudio (sketching → shaping → modify).
- **Экспорт:** **STEP**.
- **Когда брать:** хочешь "code-CAD" с дружелюбным API. Не интерактивный редактор.

### C3. `CascadeStudio`

- **Repo:** https://github.com/zalo/CascadeStudio
- **Что:** полноценное **приложение** (а не библиотека). Live-scripted CAD IDE в браузере.
- **Экспорт:** STEP, STL, OBJ.
- **Когда брать:** хочешь "взять интерфейс готовый". Не для embed.

### C4. `JSCAD` (OpenJSCAD)

- **Repo:** https://github.com/jscad/OpenJSCAD.org
- **Сайт:** https://jscad.app
- **Лицензия:** MIT
- **Что:** параметрическое 2D/3D через JS-код.
- **Экспорт:** **STL, AMF, DXF, JSON, X3D, SVG, OBJ**.
- **V3:** в активной разработке (на 2026-05), breaking changes.
- **Когда брать:** программная генерация моделей с DXF-выхлопом. Хорошо для интеграции "params → 3D + DXF".

### C5. `JSketcher`

- **Repo:** https://github.com/xibyte/jsketcher
- **Что:** параметрический 2D-скетчер + 3D через OpenCascade (WASM). 2D-constraint engine (coincident, parallel, perpendicular, tangent, fillet и т.д.).
- **Экспорт:** STL, DWG, SVG.
- **Зрелость:** активный (1784 commits), но **standalone**-приложение, без npm-пакета для встраивания.

---

## D. 2D-планировщики (React/canvas)

### D1. `react-planner` (cvdlab)

- **Repo:** https://github.com/cvdlab/react-planner
- **Лицензия:** MIT
- **Звёзд/Commits:** 1500+ commits
- **Что:** React-компонент для рисования планов зданий. Drag & drop из настраиваемого каталога объектов (стены, двери, окна, мебель). 2D-чертёж → 3D-навигация в той же либе.
- **Стек:** React 16+, Redux, Immutable.js, three.js для 3D-просмотра.
- **Форматы:** **свой JSON-формат**. DXF-импорт **не описан** (надо писать адаптер `dxf-parser → react-planner model`).
- **Когда брать:** хочешь дать юзеру привычный "редактор квартиры" с заранее заготовленным каталогом стен/дверей/мебели. Импорт DXF писать самим.

### D2. `arcada` (mehanix)

- **Repo:** https://github.com/mehanix/arcada
- **Стек:** React + Pixi.js + Zustand + Mantine UI.
- **Что:** интерьерный редактор, более молодой проект.
- **Когда брать:** хочешь pixi.js-производительность и более современный стейт-менеджмент. Меньше зрелости чем react-planner.

### D3. `Konva.js`

- **Сайт:** https://konvajs.org
- **Лицензия:** MIT
- **Что:** **низкоуровневая** библиотека "object model on top of Canvas". Layers, hit detection, drag, transformer-handles, JSON-сериализация. Есть `react-konva`.
- **Когда брать:** хочешь полный кастом редактора. Лучший выбор как **движок** для собственного floorplan-редактора в React. Хорошо ложится поверх `dxf-parser` (парсишь DXF → создаёшь Konva-shapes).

### D4. `Fabric.js`

- Альтернатива Konva. Single canvas, проще API, но менее производительный на больших сценах.

### D5. `Paper.js`

- Лучшее для **vector-математики**, безье, boolean path operations. Для floor plan'а с длинными редактируемыми контурами.

---

## E. IFC / BIM (если plana пойдёт в архитектурный BIM)

### E1. `web-ifc` (ThatOpen)

- **Repo:** https://github.com/ThatOpen/engine_web-ifc
- **Лицензия:** MIT
- **Что:** **чтение И запись** IFC файлов в JS/WASM на нативных скоростях.

### E2. `@thatopen/components` + `@thatopen/components-front`

- **Repo:** https://github.com/ThatOpen/engine_components
- **Лицензия:** **MIT**
- **Версия:** **v3.4.0 (2026-04-09)** — свежий
- **Что:** "BIM tools based on Three.js" — IFC loader, post-production, dimensions, floorplan navigation, **DXF export**.
- **Стек:** Three.js, работает в браузере и Node.js.
- **Когда брать:** если plana будет работать с BIM-моделями (полноценные здания). MIT — можно встраивать.

### E3. `xeokit-sdk`

- **Лицензия:** **AGPLv3** (или коммерческая)
- **Только viewer**. AGPL заразит вашу кодобазу или потребует купить коммерческую лицензию.
- **Когда брать:** если plana **open-source под AGPL** — отличный viewer. Иначе — обходить.

---

## F. Server-side (Python/CLI)

### F1. `ezdxf` (Python) ⭐ УЖЕ В СТЕКЕ

- **Лицензия:** MIT
- **Сайт:** https://ezdxf.readthedocs.io
- **Что:** Python-библиотека для DXF.
  - **Read/Write:** DXF AC1009 (R12) → AC1032 (R2018). Старые сохраняются в R12.
  - **Render:** через `ezdxf.addons.drawing` → matplotlib backend → SVG/PNG/PDF.
  - **DWG:** **не умеет напрямую**. Аддон `odafc` использует **ODA File Converter** как мост.
- **Не CAD-кернел.** Не делает булевы операции, fillet и пр. Это I/O-слой.
- **Используется в plana:** да, в `engine/plana_engine/cad/floorplan_dxf.py`.

### F2. `LibreDWG` (GNU)

- **Repo:** https://github.com/LibreDWG/libredwg
- **Лицензия:** **GPLv3** (важно — заразит ваш сервер, если линковать статически; через CLI `dwg2dxf` — нет)
- **Что:** C-библиотека для чтения/записи DWG. CLI `dwg2dxf` конвертирует DWG ↔ DXF.
- **Зрелость:** активно развивается, но не покрывает все DWG entity.
- **Когда брать:** нужен **open-source** DWG-bridge. Готов к тому, что часть файлов сломается.

### F3. `ODA File Converter` (Open Design Alliance)

- **Сайт:** https://www.opendesign.com/guestfiles/oda_file_converter
- **Лицензия:** проприетарная, **бесплатно для использования** (даже коммерческого, насколько мы видим в политике ODA). Не open-source.
- **Что:** CLI/GUI для конвертации DWG ↔ DXF между всеми версиями.
- **Зрелость:** **golden standard**. Используется FreeCAD и ezdxf под капотом.
- **Когда брать:** нужен **надёжный** DWG-bridge без боли. Установить как side-car контейнер.

### F4. `FreeCAD` headless

- Можно запускать в `-c` (console) режиме и скриптовать на Python.
- Тяжёлый (~700MB image), тащит Qt.
- DXF импорт нативный, DWG — через ODA или LibreDWG.
- **Когда брать:** нужен полноценный CAD-кернел на сервере (BREP, конструктивные операции). Для plane-DXF — overkill.

### F5. Аспозе и аналоги

- **Aspose.CAD**, **CAD Exchanger SDK** — мощные, но **коммерческие**. Платные лицензии.

---

## G. Honorable mentions

- **LibreCAD / QCAD** — desktop only. Reference для UX 2D-CAD, не встроишь.
- **OpenSCAD** — текстовый 3D-CAD. Не интерактивный.
- **BRL-CAD** — для CSG/инженерии, не для архитектуры.
- **SVG-Floorplan-Editor (oodavid)** — простой, можно подсмотреть подходы.
- **draw.io / Excalidraw** — не CAD, но диаграммные, хорошие референсы UX.

---

## Что отвечает на вопрос "import → edit → export DXF/DWG в браузере, полностью OSS"?

Идеальный ответ: **`@mlightcad/cad-viewer`** — он есть, MIT, свежий, у него уже есть все три ноги (правда, export пока в roadmap).

Реалистичный ответ: **гибрид** — `dxf-viewer` или `mlightcad` для view, **`Konva.js` или собственный three.js слой** для edit, **`dxf-writer` / `makerjs`** для export. Сервер на `ezdxf` подстраховывает (надёжная запись + конвертация).

Подробный план — в [`recommendation.md`](recommendation.md).
