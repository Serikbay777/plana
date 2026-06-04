# Maket.ai — пошаговый ресерч редактора (этапы работы)

Документ описывает, как именно устроен редактор Maket.ai (платформа `app.maket.ai` / `platform.maket.ai`) — AI-инструмент для генеративного архитектурного проектирования жилых планировок. Все факты взяты из публичных источников (официальный блог Maket, help-центр, обзоры, YouTube-ролики). Там, где конкретики в публичных источниках нет, явно отмечено «точно не указано в публичных источниках».

Ключевые ссылки-источники:
- Официальный гайд: https://www.maket.ai/blog/how-to-use-maket
- AI-редактирование (чат): https://www.maket.ai/blog/ai-editing-floor-plans
- Большой гайд по генератору 2026: https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026
- Drawing from scratch: https://www.maket.ai/blog/draw-a-floor-plan-from-scratch
- Plan Recognizer (upload): https://www.maket.ai/blog/ai-floorplan-recognizer-upload-an-existing-plan-get-right-to-editing
- Зонирование: https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance
- Рендеры по тексту: https://www.maket.ai/blog/create-renders-using-ai-and-a-text-prompt
- Features: https://www.maket.ai/features
- Pricing: https://www.maket.ai/pricing
- Overview: https://www.maket.ai/post/a-complete-overview-of-maket
- Для архитектора: https://www.maket.ai/post/how-to-use-maket-as-an-architect
- Обзор illustrarch: https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html
- Обзор archgyan: https://archgyan.com/maket-ai-floor-plan-generation-residential/
- Обзор promeai: https://www.promeai.pro/blog/maket-ai-review-2026-architecture/
- Maket Floorplan Generator (UI-details): https://www.maket.ai/post/maket-s-floorplan-generator-maximizing-design-efficiency
- YouTube tutorial: https://www.youtube.com/watch?v=d71_7rfaP0U
- YouTube updated guide 2025: https://www.youtube.com/watch?v=EGerOoAODXY
- Подборка/плейлист: https://www.youtube.com/playlist?list=PLoWZ2gj4aYqGL2SsPwwFtxnCWxLpHGUSk
- testingcatalog (про realtime editing): https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/

---

## Общая архитектура продукта (контекст)

Maket — это **браузерный SaaS** без установки. Внутри одного workspace объединены три ключевых режима:

1. **Floor Plan Generator** — генерация планировки по описанию / параметрам.
2. **Design Editor / Canvas** — ручная и AI-правка плана (2D-canvas + AI-чат).
3. **Visualize / Render** — переход в 3D, photorealistic-рендеры, restyle.

Дополнительно — **Regulatory Assistant** (зонирование, Q&A по PDF муниципальных норм) и **Plan Recognizer** (распознавание загруженной картинки плана; статус — в перестройке, V2 «coming soon» на 2026).

Целевая ниша — **residential**: single-family дома и small multi-family (2–4 юнита), 1–4 этажа. Для коммерческих объектов и крупных multi-family (>12 юнитов) Maket официально не рекомендован (см. illustrarch / archgyan).

Единица расчёта внутри платформы — **credits**: 20 кредитов на генерацию одного этажа, 10 — на рендер. Free-тариф — 50 кредитов, Plus — $20/мес и 300 кредитов в месяц; топ-апы от $10/150 кредитов.

---

## Этап 1. Создание / старт проекта

После логина пользователь попадает на **Dashboard**, где есть кнопка «Generate a new floor plan» / «Create» (вход в проект). По шагам:

1. **Создание проекта.** Запрашивается название проекта и выбирается AI-Tool — `Plan`, `Render`, `Restyle`, `Visualizer`. Для планировки выбирается `Plan` (источник: toolify.ai обзор; promeai).
2. **Выбор способа входа в редактор**. Доступны минимум три точки входа (см. «Complete Overview of Maket»):
   - **Plan Generator** — генерация по параметрам / чату.
   - **Start from Scratch / Draw Plans from Scratch** — пустой canvas, рисование стен вручную.
   - **Plan Recognizer** — загрузка существующего плана картинкой. *Note: фича V1 была отключена; V2 «coming soon» по состоянию на март 2026 — см. блог Maket.* Поддерживались только JPEG / PNG, без DWG/PDF.
3. **Тип проекта.** Параметр «тип проекта» как отдельная сущность (single-family / multi-unit / commercial) в UI **точно не указан** — Maket по умолчанию residential. Дифференциация идёт через **число этажей** (1–4) и **программу комнат**.
4. **Юнит-система.** Выбор Imperial / Metric (футы или метры). Исторически генератор работал в футах (см. archgyan), сейчас доступны оба.
5. **Входные параметры участка / здания** на этапе старта (4 обязательных инпута, согласно `how-to-use-maket`):
   - **Number of floors** — от 1 до 4.
   - **Floor area** — суммарная площадь (sqft или м²).
   - **Layout shape** — форма «footprint» здания: Rectangular, L-shaped и др. Новый **shape picker** позволяет задать кастомные размеры и **разную форму на каждый этаж**.
   - **Rooms** — список комнат: количество спален, ванных, кухня, кабинет, гараж и т. д.
6. **Загрузка контура / DWG.** Прямой загрузки DWG **в публичных источниках не подтверждено**. Plan Recognizer работал/будет работать с растровыми форматами JPEG/PNG. Контур участка задаётся через `shape picker` + габариты, а не из CAD-файла.
7. **Местоположение / климат.** Жёсткой привязки к гео-данным (адрес, климатическая зона) в публичных гайдах **не описано**. Привязка к локальным нормам делается отдельно — через Regulatory Assistant (PDF/JSON/HTML/TXT/ZIP загрузка муниципального кода, см. этап 7).
8. **Adjacency / соседство комнат.** На старте можно указать предпочтения по примыканиям: «open-concept kitchen-living», «master suite placement», «которая комната рядом с какой» — отдельный столбец adjacency в форме «Add rooms» (см. archgyan).
9. **Surprise me** — кнопка автозаполнения параметров «случайным разумным» набором (см. archgyan).
10. **Generate designs** — финальная кнопка запуска генерации (нижний-левый угол формы по описанию archgyan).

---

## Этап 2. Constraints / Параметры

Параметры, которые пользователь задаёт явно (по совокупности `ai-floor-plan-generator-guide-2026`, `how-to-use-maket`, archgyan, illustrarch):

- **Total area** — суммарная площадь дома (главный параметр, на который AI «весит больше всего»).
- **Lot dimensions / footprint shape** — габариты пятна застройки, форма участка (Rectangular, L-shape, кастом по shape-picker, разная форма по этажам).
- **Number of floors** — 1–4.
- **Список комнат**: каждая комната имеет:
   - Имя (редактируется).
   - X и Y dimensions (отдельные колонки в форме).
   - Quantity (через `+` рядом с «Add rooms»).
   - Adjacency — какая рядом с какой.
   - Удаление через `X`.
- **Стиль / эстетика** — задаётся скорее на этапе Visualize, чем на этапе генерации плана (modern, farmhouse, Scandinavian — см. этап 6).
- **Программа** — bedrooms / bathrooms / kitchen / office / garage и т. д.
- **Set-backs / отступы / coverage / height** — в самой форме генератора **отдельных полей не описано**; эти ограничения передаются опосредованно через габариты footprint и проверяются через **Regulatory Assistant** (см. этап 7).
- **Ориентация (north arrow / солнце)** — Maket «учитывает site subtleties orientation and entrance placement» (см. `ai-floor-plan-generator-guide-2026`), но конкретного контрола «поверни north» в UI **точно не описано**.
- **Высотные ограничения** — задаются числом этажей; height в метрах/футах отдельно не вводится.
- **Бюджет** — отдельного поля «budget» **не подтверждено**; cost-estimation модуль в публичных источниках отсутствует (см. этап 8).

Стиль работы с constraints — иерархия по словам Maket: total area → lot dimensions → residential program → site/orientation. Это «вес» для AI.

---

## Этап 3. AI-генерация планировки

- **Количество вариантов**: за одну генерацию платформа возвращает **несколько вариантов** (archgyan и `maket-s-floorplan-generator-maximizing-design-efficiency` указывают «produces four layout variations» — четыре варианта на запрос); официальный гайд формулирует как «multiple layout options».
- **Время** генерации — «about a minute or two for the first layout», последующие быстрее, так как параметры уже подгружены (`ai-floor-plan-generator-guide-2026`).
- **Что AI расставляет**: стены с реалистичными толщинами, **двери, окна, метки и размеры комнат**, базовая мебель (кровати, диваны, кухонные острова). Это покрывает ~70–75% традиционной schematic-фазы.
- **Принципы оптимизации**: разумная циркуляция, корректное примыкание программы, учёт adjacency-предпочтений, ориентация и расположение входа. Solar/освещение в плане как separate parameter в публичных источниках **не описаны** — это идёт уже в Visualize/render-фазе.
- **Регенерация**: «If not happy with the first result, users can generate another layout with the same inputs, or start from scratch with different requirements» (`ai-editing-floor-plans`).
- **Кост**: 20 credits за этаж генерации (Plus tier).
- **Качество**: обзоры (illustrarch, archgyan) отмечают периодические артефакты — «awkward proportions», «impractical circulation», «hallways that waste square footage», особенно на L-формах, склоны и multi-story. Поэтому ручная или AI-чат правка — обязательная следующая стадия.

---

## Этап 4. Редактирование плана на canvas (САМОЕ ВАЖНОЕ)

Редактор — гибрид: **AI chat side-panel + 2D canvas**. Можно свободно переключаться. Подробно по компонентам:

### 4.1. Раскладка интерфейса
- **2D canvas** в центре — собственно план.
- **Chat panel** сбоку — для AI-команд (этап 5).
- **Structure menu** — вставка структурных элементов: doors, windows, stairs.
- **Furniture catalog** — каталог мебели и фикстур с поиском.
- **Inspection panel** — правая боковая панель: показывает «detailed measurements» выделенного объекта.
- **Floor selector** — переключатель этажей сверху (на multi-story).
- **Undo / Redo** — всегда доступны, любой шаг откатывается.
- **Виртуальный ассистент** — заявленная функция для подсказок и Q&A прямо в редакторе (archgyan).

### 4.2. Инструменты на canvas (manual editing)

По `ai-editing-floor-plans`, `how-to-use-maket`, `draw-a-floor-plan-from-scratch`:

- **Перемещение стен** — drag walls.
- **Удаление стен** — delete wall.
- **Рисование новых стен** — «draw new walls to create entirely new rooms». В режиме «Draw from Scratch» — click-and-drag.
- **Изменение размеров комнат** — drag-handles по периметру комнаты. Числовые габариты редактируются (см. archgyan: колонки X/Y).
- **Добавление дверей / окон / лестниц** — через Structure menu, drag-into-canvas.
- **Расстановка мебели** — drag из каталога. Поворот / удаление по выделению. *Note: «Furniture isn't resizable yet» (`draw-a-floor-plan-from-scratch`) — мебель фиксированных стандартных размеров.*
- **Покраска / материалы** — color application к поверхностям, материалы пола и финиши (см. «how-to-use-maket-as-an-architect»).

### 4.3. Snap, grid, measurements
- **Inspection panel** показывает размеры выделенного элемента (комнаты, стены, проёма).
- **Конкретный snap-to-grid контрол / разрешение сетки / отдельные measurement-tools (линейка, dimension-string)** — в публичных источниках **точно не описаны**. Известно лишь, что план показывает «accurate dimensions».

### 4.4. Layers
- Отдельной полноценной layer-системы (как в AutoCAD) в публичных источниках **не описано**. Логические «слои» — это структурный (стены/двери/окна/лестницы) vs. furniture vs. styling — но это разные меню, а не пользовательские layers.

### 4.5. Multi-select, zoom, pan
- **Multi-select** — отдельно не задокументирован; элементы выделяются клик-выбором (inspection panel показывает один объект — «select any item to see its detailed measurements»).
- **Zoom / pan** — стандарт для web-canvas, но точные хоткеи / mouse-bindings **в публичных источниках не описаны**.

### 4.6. Hotkeys / shortcuts
- Любых публичных списков hotkeys найти не удалось. **Точно не указано в публичных источниках.** Известно только, что **undo/redo всегда доступны** (вероятно Ctrl+Z / Ctrl+Y по стандарту web).

### 4.7. Multi-floor работа
- Floor selector сверху, переключение между этажами; новый shape picker позволяет разную форму footprint на этаж (`how-to-use-maket`).

---

## Этап 5. Уточнение через AI / Iteration (AI Chat editing)

Главная «фишка» 2026 года — **agentic AI editing**: правка по разговору, не drag-инструментами.

- **Где живёт**: панель чата сбоку от canvas; «можно переключаться между chat и canvas в любой момент» (`ai-editing-floor-plans`).
- **Что умеет AI-чат**:
   - Изменять размер комнаты («make the kitchen 30 percent bigger», «make the kitchen 20% bigger»).
   - Добавить комнату («add a powder room near the entry»).
   - Объединить комнаты («merge the two small bedrooms into one»).
   - Поменять местами комнаты («swap the bedroom and the office»).
   - Перевернуть / повернуть план («flip the layout», «rotate the plan 180 degrees»).
   - Высокоуровневая реорганизация — но AI плохо обрабатывает vague-промпты («reorganize this for better flow» работает плохо).
- **Скорость**: простые правки — секунды; сложные операции (swap, full reshuffle) — до 1–2 минут.
- **Best practice** (по официальному блогу):
   1. Один промпт — одно изменение.
   2. Конкретика > обтекаемость.
   3. Итеративное наращивание изменений.
- **Что AI-чат НЕ умеет** (`ai-editing-floor-plans`):
   - Точная индивидуальная расстановка мебели (это вручную).
   - Construction documents / permit drawings.
   - Применение финишей, цветов, стиля (это в Visualize).
   - Коммерческие проекты.
   - ~25–30% schematic-фазы остаются за архитектором.
- **Re-generate**: можно перегенерировать целиком с теми же или новыми параметрами.
- **Lock / unlock частей плана** — в публичных источниках **точно не указано**. Косвенно: пользователь управляет «что трогать» через формулировку промпта, отдельной кнопки «lock room» в гайдах не встречается.
- **Version history / comments** — официально **в публичных источниках не описано**. Известна только реверсивность через **undo/redo**.

---

## Этап 6. Визуализация (Visualize / Render / Restyle)

Переключение в **Visualize mode**. Состав модулей по `how-to-use-maket`, `create-renders-using-ai-and-a-text-prompt`, `a-complete-overview-of-maket`:

- **3D view** — однокликовый переход 2D → 3D. Поддерживается **first-person walkthrough** и **overview** (как два режима камеры).
- **Cameras на плане** — на 2D-плане появляются маркеры камер; кликом по камере можно подстраивать **position и angle**; 3D preview обновляется live.
- **Field of view** — настраиваемый.
- **Render scene** — кнопка запуска photorealistic-рендера (60–90 секунд по `draw-a-floor-plan-from-scratch`). 10 credits / рендер.
- **Render prompt** — текстовое уточнение прямо в момент рендера: «add curtains», «change flooring to oak».
- **Style references** — два источника:
   - **Maket library** — встроенные пресеты стилей (modern, farmhouse, Scandinavian и др.) и finishes.
   - **Custom inspiration** — загрузка картинок (Pinterest, дизайн-блоги) или текстовое описание.
- **Scope применения референса** — на весь этаж, конкретную комнату или отдельный предмет мебели.
- **Image types для рендера** (отдельный модуль `Create → Image`): **Interior**, **Exterior**, **Elevation**.
- **Restyle** — отдельный AI-tool: загрузка фото существующего интерьера/экстерьера → перерисовывание по новому стилю / материалам.
- **Visualizer** — модуль генерации референсного inspiration-набора по prompt-у; включает «reimagination» и «image cleanup».
- **Освещение / тени** — стилизованные, не физически точные. Maket официально предупреждает: «Lighting and shadows may be stylized or inconsistent».

---

## Этап 7. Compliance / проверка норм (Regulatory Assistant)

Отдельный AI-модуль `Regulatory Assistant` (источник: `makets-zoning-regulations-simplifying-zoning-compliance`).

- **Загрузка норм**: пользователь сам загружает муниципальный код. Поддерживаемые форматы: **JSON, HTML, TXT, PDF, ZIP**.
- **Использование**: интерфейс Q&A — пользователь пишет вопрос на естественном языке. Типовые запросы:
   - «What are the setback requirements for residential properties in my area?»
   - «Are there any restrictions on building height within this zoning district?»
   - «Permitted land uses for commercial properties?»
   - «Parking regulations for multi-family housing?»
   - «Maximum FAR (Floor Area Ratio)?»
- **Что проверяется** (на уровне Q&A): setbacks, height, lot coverage, permitted uses, parking, FAR.
- **Подсветка нарушений на плане**: автоматической визуальной отрисовки нарушений поверх canvas в публичных источниках **точно не описано** — Regulatory Assistant работает как chat-Q&A над загруженным документом, а не как live-validator план-VS-нормы. illustrarch явно подчёркивает: «interprets uploaded documents rather than maintaining a live database», нет cross-reference нескольких пересекающихся регуляций (overlay-зоны и т. п.).
- **Maket 2.0 (Q1 2026)** обещает «upgraded zoning code verification tools» — более автоматическую проверку. На момент мая 2026 это всё ещё в стадии раскатки.

---

## Этап 8. Cost Estimation

- В публичных источниках **отдельного модуля cost-estimator / material takeoff на сегодня нет**. Один из toolify-обзоров упоминает «real-time guidance on materials, costs and design options через виртуального ассистента», но конкретного UI/формул/документов не приводит — это уровень советов в чате.
- Roadmap Maket 2.0 (Q1 2026) включает «material takeoff features» и «HVAC planning» — то есть фича на горизонте, но не готовая.
- **Редактирование материалов** — есть, но это про эстетику/Visualize (paint, flooring, finishes), а не про BOQ. См. этап 6.
- Точность оценки, BOQ, единицы и формат экспорта смет — **точно не указано в публичных источниках**.

---

## Этап 9. Экспорт / финал

По `how-to-use-maket`, `ai-floor-plan-generator-guide-2026`, illustrarch:

- **Форматы экспорта**:
   - **DXF** — 2D CAD-файл; включает стены как линии, метки комнат, дверные/оконные swing-и, базовые размеры. Совместим с AutoCAD/BricsCAD/любым DXF-приёмником.
   - **PDF** — для клиентских презентаций / стройки / permit-пакета (но не permit-ready, см. ниже).
   - **JPEG/PNG** — растровые форматы для быстрого шеринга.
- **IFC / OBJ / Revit RVT** — **в публичных источниках не подтверждено**. Maket не позиционируется как BIM-инструмент.
- **Что входит в экспорт**: 2D-планы. **Фасады, спецификации, BOQ, развёртки** — отдельно не подтверждено в экспорте.
- **Доступность экспорта по тарифам**: 
   - Free — preview-render и стандартные экспорты (нюансы — у illustrarch: на free «no exports», на promeai — «standard resolution exports»). Источники расходятся; нужно проверять текущую версию pricing-страницы.
   - Plus ($20/мес, 300 credits) — high-resolution exports, multi-floor.
   - Pro ($30/мес) — по обзору illustrarch — полный DXF/PDF и advanced editing.
- **Продолжение в CAD**: DXF подхватывается AutoCAD без дорисовки; этим Maket удобен для архитектора как «schematic seed» под последующее доведение в CAD/BIM.
- **Важное предупреждение Maket**: «These aren't permit-ready documents. No AI floor plan generator currently produces drawings that a building department will accept for permit review.» Финальная permit-документация — за лицензированным архитектором.

---

## Дополнительно

### Collaboration / Share / Team
- Заявлено: **share links**, **comments**, **small team collaboration** в платных тарифах (несколько вторичных источников — RingCentral подборка, futurebuiltai и т. п.).
- На официальной pricing-странице **отдельных team-фич / enterprise-тарифа не описано** на момент ресерча.
- Полноценный multi-user real-time co-editing **в публичных источниках не подтверждён**.
- Version history / change log публично **не описаны**.

### Templates / saved projects
- Каждый проект сохраняется на dashboard; free-тариф ограничен **одним активным проектом** (illustrarch), pro-тариф — без жёсткого лимита. Полноценная библиотека шаблонов не описана.

### Mobile / responsive
- Maket — браузерный продукт. Полноценная mobile-app **в публичных источниках не подтверждена**; работает в desktop-браузере.

### Technical limits
- **Этажность**: до 4 этажей (roadmap — расширение до большего).
- **Тип объекта**: residential single-family и small multi-family (2–4 юнита). Crucial: не commercial, не large multi-family (>12).
- **Качество**: критика спорной spatial reasoning на L-shape, склонах, multi-story (illustrarch, Trustpilot 2.3/5 на момент ресерча).
- **Furniture resize** — ещё не реализован.

### Маркетинговое позиционирование на 2026
- Maket 2.0 (Q1 2026): granular fine-tuning controls, улучшенный рендеринг, zoning verification, HVAC planning, material takeoff.

---

## Краткий сквозной flow редактора (TL;DR)

1. Dashboard → New Project → выбрать AI-tool (Plan / Render / Restyle / Visualizer).
2. Plan generator: задать units, число этажей (1–4), общую площадь, shape footprint, программу комнат с размерами и adjacency, опционально Surprise me → Generate designs.
3. Получить ~4 варианта плана со стенами, дверями, окнами и базовой мебелью. Выбрать лучший.
4. Перейти в Design Editor: 2D canvas + AI-чат сбоку. Править стены / комнаты вручную drag-handles, добавлять doors/windows/stairs из Structure-меню, мебель из каталога. Inspection panel справа — размеры. Floor selector сверху — этаж.
5. В чате просить AI: «make kitchen bigger», «add powder room», «flip plan 180°» — по одной правке за раз. Undo/Redo всегда.
6. Переключиться в Visualize: расставить камеры на 2D-плане, выбрать стили из Maket library или загрузить inspiration. Запустить Render scene (60–90 с) → Interior/Exterior/Elevation, 10 credits.
7. (Опционально) Открыть Regulatory Assistant: загрузить муниципальный PDF/JSON/TXT/HTML/ZIP, спросить про setbacks/height/FAR/parking.
8. Экспорт: DXF (CAD) / PDF (презентация, клиент, permit-пакет на уровне schematic) / PNG/JPG.
9. (Опционально) Поделиться ссылкой с командой / клиентом.

---

## Источники

- https://www.maket.ai/blog/how-to-use-maket
- https://www.maket.ai/blog/ai-editing-floor-plans
- https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026
- https://www.maket.ai/blog/ai-floorplan-recognizer-upload-an-existing-plan-get-right-to-editing
- https://www.maket.ai/blog/draw-a-floor-plan-from-scratch
- https://www.maket.ai/blog/create-renders-using-ai-and-a-text-prompt
- https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance
- https://www.maket.ai/post/a-complete-overview-of-maket
- https://www.maket.ai/post/how-to-use-maket-as-an-architect
- https://www.maket.ai/post/maket-s-floorplan-generator-maximizing-design-efficiency
- https://www.maket.ai/features
- https://www.maket.ai/pricing
- https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html
- https://archgyan.com/maket-ai-floor-plan-generation-residential/
- https://www.promeai.pro/blog/maket-ai-review-2026-architecture/
- https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/
- https://www.youtube.com/watch?v=d71_7rfaP0U
- https://www.youtube.com/watch?v=EGerOoAODXY
- https://www.youtube.com/playlist?list=PLoWZ2gj4aYqGL2SsPwwFtxnCWxLpHGUSk
- https://www.toolify.ai/ai-news/aipowered-floor-plan-generation-maketai-comprehensive-guide-3619480
