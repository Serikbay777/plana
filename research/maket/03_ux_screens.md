# Maket.ai — Исследование UX и экранов интерфейса

> Дата исследования: 2026-05-21
> Цель: понять, как устроен интерфейс Maket.ai (AI floor plan generator) на уровне отдельных экранов, панелей и контролов, чтобы использовать как референс при проектировании собственного продукта.
> Источники: блог Maket, документация, обзоры (illustrarch, promeai, 10web, testingcatalog, toolify), отзывы Trustpilot, лендинг, страница pricing, YouTube-туториалы.

---

## Общая модель приложения

Maket — это **web-приложение в браузере** (работает на macOS / Windows / Linux), доступное по адресу `https://app.maket.ai` (точнее, `https://platform.maket.ai/dashboard/projects`). Анонсирован iPad-клиент, мобильных нативных приложений в полном виде нет, но упоминаются iOS/Android оболочки для просмотра. Для входа достаточно email, бесплатно дают 50 кредитов без привязки карты.

Интерфейс построен вокруг четырёх крупных режимов:

1. **Dashboard** — главная страница со списком проектов и точками входа в новый проект.
2. **Generation Wizard** — чат-помощник для генерации первой версии плана из текстового описания.
3. **Advanced Editor / Plan Editor** — основной режим, где живёт canvas с планировкой, тулбар, side-панели и AI-чат.
4. **Visualize mode** — режим 3D-визуализации с камерами и текстовыми промптами для рендера.

Дополнительно есть отдельные потоки: «Draw from Scratch» (рисование с нуля), «Restyle / Render from Image» (стилизация по референсу), «Regulatory Assistant» (загрузка zoning-документов и Q&A по нормам).

```
+--------------------------------------------------------------+
|  Top bar:  Maket logo  |  Workspace ▼  |  Credits 247  |  ⚙ |
+-----------+--------------------------------+-----------------+
|           |                                |                 |
|  LEFT     |     CANVAS (план или 3D)       |   RIGHT PANEL   |
|  RAIL     |     центр экрана               |   (props /      |
|  (tools)  |                                |    chat /       |
|           |                                |    variants)    |
|           |                                |                 |
+-----------+--------------------------------+-----------------+
|  Bottom: zoom % | grid toggle | floor selector | undo/redo  |
+--------------------------------------------------------------+
```

Это базовая схема, к которой я возвращаюсь по разделам ниже.

---

## 1. Главный Dashboard

После логина пользователь попадает на **`/dashboard/projects`** — страницу со списком его проектов. По описаниям из блога и обзоров:

- Сверху — **Top bar**: лого Maket слева, переключатель workspace (для тех, кто на Builder Platform), счётчик кредитов справа, аватар пользователя и иконка настроек. Кредиты — важный визуальный элемент, потому что каждое действие тратит их (генерация плана = 20 кредитов на этаж, рендер = 10 кредитов).
- В центре — **карточки проектов**: превью плана, название, дата изменения. Похоже на типичный grid, как в Figma/Canva.
- Главная CTA — крупная кнопка **«Generate a new floor plan»** или меню **«Create ▼»** с пунктами:
  - **Plan** (генерация планировки),
  - **Image** (рендер по тексту),
  - **Draw from Scratch** (ручное рисование).
- В левом sidebar — навигация по разделам (по описаниям и фрагментам видео):
  - Projects (мои проекты),
  - Drafts (черновики, незавершённые рендеры),
  - Library / Style Library (референсные стили),
  - Top Users / Community Gallery (рейтинг планов сообщества — упоминался как Top User ranking),
  - Regulatory Assistant (модуль зонирования),
  - Help / Tutorials,
  - Pricing / Upgrade (для free-аккаунтов).

Templates в классическом смысле «готовый шаблон с мебелью» отсутствуют — Maket позиционирует себя как генератор, а не библиотека шаблонов. Однако есть **Style Library** с готовыми визуальными стилями (Scandinavian, Modern, Industrial и т.п.), и **community gallery** с планами других пользователей в качестве вдохновения.

---

## 2. Wizard создания проекта

При клике на «Generate a new floor plan» открывается **chat-based wizard** — это ключевая особенность Maket. Он не похож на классическую многошаговую форму со степпером сверху. Вместо этого — диалог: AI задаёт вопросы, пользователь отвечает в текстовом поле, ответы можно править как чат-сообщения.

**Четыре последовательных вопроса:**

1. **Number of floors** — выбор от 1 до 4 этажей (chip-ы / кнопки прямо в чате).
2. **Total floor area** — площадь, можно вводить в кв.футах или кв.метрах. Появляется числовое поле и переключатель единиц.
3. **Layout shape** — форма участка/контура здания: rectangular, L-shaped, или **custom dimensions per floor** (свежая фича: можно задавать форму попериметрово для каждого этажа отдельно).
4. **Room specifications** — количество спален, ванных, кухня, офис, гараж и т.п. Видимо, в виде набора счётчиков `–  1  +` для каждого типа комнаты.

После подтверждения параметров Maket показывает «генерация…» и через 1–3 минуты выводит результат — план уже в canvas редактора. Пропустить шаги полностью нельзя: AI без них не понимает контекст, но можно вводить ответы свободным текстом («двухэтажный дом 180 м², L-образный, 3 спальни, 2 ванные») — wizard поймёт и распарсит.

**Превью во время заполнения** есть в виде «иконки/мини-схемы» рядом с выбором shape (R-, L-форма и пр.), но полноценный live preview отсутствует — план рендерится только после полной отправки.

---

## 3. Главный экран редактора (Plan Editor / Advanced Editor)

Это сердце продукта. Layout — классический трёхколоночный:

```
+----------------------------------------------------------------------+
| MAKET ▾  Project "House_v2" / Draft     |  Credits 247  Save  Share |
+-----+----------------------------------------------+-----------------+
|     |  Edit | Build | Finishes | Objects | Visualize  ▾  (mode bar) |
|  T  +----------------------------------------------+-----------------+
|  O  |                                              |   AI CHAT       |
|  O  |                                              |   ┌───────────┐ |
|  L  |              C A N V A S                     |   │"Make the  │ |
|  B  |        (2D floor plan with rooms,            |   │ kitchen   │ |
|  A  |        dimensions, doors, windows)           |   │ 30% big.."│ |
|  R  |                                              |   └───────────┘ |
|     |                                              |  ─ или ─        |
|  ◧  |                                              |  PROPERTIES     |
|  □  |                                              |  выбранного     |
|  ⟂  |                                              |  объекта        |
|  ⌂  |                                              |                 |
|  ⤢  |                                              |                 |
+-----+----------------------------------------------+-----------------+
| Floor 1 | Floor 2 | + |   zoom 75%  ⊝ ⊕   | grid | undo ↶ redo ↷    |
+----------------------------------------------------------------------+
```

Ключевые зоны:

- **Top bar (mode tabs)**: горизонтальная панель вкладок-режимов: **Edit / Build / Finishes / Objects / Visualize**. Это основное переключение контекста.
  - *Edit* — выделение, перемещение, изменение комнат.
  - *Build* — конструктив: стены, двери, окна, лестницы.
  - *Finishes* — материалы и отделка (пол, стены, краска).
  - *Objects* — мебель из каталога drag-and-drop.
  - *Visualize* — переход в 3D-режим.
- **Left toolbar / tool rail**: вертикальная панель инструментов. Подтверждённые контролы (из обзора Draw from Scratch и описаний): **Furniture, Structure, Select, Draw Wall**. Side panel рядом «hosts stairs, doors, and windows» — то есть после выбора Structure появляется выдвижная панель со списком этих элементов.
- **Canvas в центре** — 2D top-down вид плана с автоматическими размерными линиями (dimensions), маркерами дверей, окон, мебели. Комнаты подписаны (Kitchen, Bedroom 1).
- **Right panel** — двусоставная: внизу/сверху чат с AI, и properties выбранного элемента (см. разделы 5 и 6).
- **Bottom bar / floor selector** — горизонтальный список этажей (`Floor 1`, `Floor 2`, кнопка `+` чтобы добавить), а также zoom-контролы, переключатель сетки и **undo/redo** (явно подтверждены в обзоре illustrarch: «Undo/redo controls — always accessible»).
- **Кнопка Generate** — для первичной генерации это «Generate a new floor plan» на dashboard, внутри редактора отдельной большой кнопки «Generate» нет — вся повторная генерация идёт через AI-чат справа («generate alternative», «try L-shape»). Внутри есть **«Render scene»** в Visualize-режиме.
- **Mini-map**: явных упоминаний нет, видимо отсутствует — типовой архитектурный план обычно помещается в canvas целиком при zoom-fit.
- **Список вариантов планировок (galleries)**: после первичной генерации Maket выдаёт **несколько вариантов сразу** (по обзорам — «10+ layout variations in under a minute»). Они отображаются как **карусель/grid миниатюр** в одной из панелей (вероятно, в нижней части или в левой) — пользователь кликает на понравившийся, и он открывается в canvas. Подробнее в разделе 7.

---

## 4. Toolbar редактора — все кнопки

По кусочкам из разных обзоров вырисовывается такой набор инструментов:

**Build-режим (стены и проёмы):**
- **Draw Wall** — рисование стены, кликая по точкам; можно задавать длину в инпуте.
- **Select / Move** — стандартный курсор.
- **Door** — установка двери на выбранную стену.
- **Window** — окно (по аналогии).
- **Stairs** — лестница для многоэтажных проектов.
- **Erase / Delete** — удаление выделенного.
- **Dimensions toggle** — включение/выключение размерных линий.

**Edit-режим:**
- **Drag handles** на углах комнат — изменение размеров перетаскиванием.
- **Rotate** (по контексту мебели — «rotate or delete any piece»).
- **Group / Ungroup** — явно не описано, но логично присутствует.

**Objects-режим:**
- **Furniture catalog**: «Drag and drop furniture items from an extensive catalog featuring unique retailers. Browse the catalog or search for specific items, then drag them into rooms, and rotate or delete any piece.» Каталог — это side-панель с категориями (Beds, Sofas, Tables…) и поиском.

**Finishes-режим:**
- **Material picker** для полов, стен, потолков — палитра текстур и цветов. По описаниям, доступны материалы и краски.

**Visualize-режим:**
- **Camera tool** — расстановка камер на 2D-плане.
- **Field of view slider** и first-person walkthrough mode для подбора кадра.
- **Render** / **Render scene** — большая CTA-кнопка для запуска рендера.

**Глобальные контролы:**
- **Pan / Zoom**: скролл мышью, плюс кнопки `⊝ ⊕` внизу.
- **2D / 3D toggle** реализован через вкладку **Visualize** в верхнем mode-bar (то есть это не маленький toggle где-то в углу, а отдельный полноценный mode), хотя в одном из описаний упомянуто «that little button in the right corner» — возможно, есть и быстрый shortcut в правом верхнем углу canvas.
- **Undo / Redo** — снизу, всегда доступны.

---

## 5. Sidebar / Property panel

Когда пользователь **выделяет элемент** в canvas (комнату, стену, мебель), справа в panel показывается «Inspection panel» с детальной информацией:

- **Размеры**: ширина, длина, площадь — отображаются в числовых полях с возможностью **прямого ввода** значения (можно ввести 3500 мм и стена изменится).
- **Положение**: координаты X/Y относительно начала плана.
- **Type** комнаты (Kitchen / Bedroom / Bathroom) — dropdown для смены назначения.
- **Material picker**: миниатюры материалов для пола, стен. Открывается из вкладки Finishes для выбранной поверхности.
- **Furniture library**: в режиме Objects — это полноценный browse с поиском, фильтрами по типу и стилю, drag-and-drop в комнату.
- **Delete / Duplicate / Rotate** — стандартные кнопки.

По описаниям, panel — **right side**, и в ней одновременно живут properties и чат: видимо, они переключаются вкладками или чат сворачивается внизу панели.

---

## 6. AI Chat / Assistant

Это **главное отличие Maket от классических CAD**. Чат-панель сидит **справа от canvas** (`«the chat panel sits next to your canvas»` — цитата из блога Maket).

Возможности:

- **Plain-language editing**. Пользователь пишет: *«Make the kitchen 20% bigger»*, *«Add a powder room near the entry»*, *«Flip the layout»*, *«Rotate the plan 180°»*, *«Swap the bedroom and the office»*, *«Merge the two small bedrooms into one»*. AI применяет изменения прямо в canvas, обычно за 5–30 секунд, для крупных перестроений — до 2 минут.
- **AI объясняет своё решение**: «The AI explains its reasoning as it works, flagging spatial trade-offs like reduced corridor access or altered room adjacency». То есть в чате видны не только результаты, но и комментарии AI о компромиссах.
- **Best practice — одно изменение за раз**: документация прямо рекомендует «short and concrete» промпты, не списки.
- **История диалога** прокручивается, можно вернуться к предыдущим шагам (вместе с undo).
- Помимо основного чата есть **Virtual Assistant** — отдельный помощник для вопросов о материалах, стоимости и альтернативах дизайна.
- И **Regulatory Assistant** — модуль, куда загружаются PDF с zoning-кодом, и можно задать вопрос plain-language про setback/lot coverage/height/permitted uses.

Расположение чата — фиксированная правая колонка, не overlay. Это сильно отличает Maket от продуктов, где AI-чат — это floating bubble.

---

## 7. Right panel — варианты планировок

После первой генерации Maket выдаёт **несколько вариантов (10+ за один запрос)**. По обзорам они показываются как:

- **Grid миниатюр** в отдельном представлении («multiple variations you can compare and customize»).
- Можно **открыть любой вариант в canvas**, скопировать в свой проект, продолжить редактировать.
- **Lock / favorite**: явных подтверждений нет, но есть упоминания «save to drafts or projects» — то есть варианты можно отправлять в drafts.
- **Compare side-by-side**: явно нигде не описано, но визуально grid позволяет визуально сравнивать.

Цена варианта — 20 кредитов на этаж. Поэтому при пакете 300 кредитов в месяц получается «up to 15 floor plan floors». Это важная UX-деталь: каждое нажатие «Generate variation» — это списание, и в UI рядом с CTA должен висеть индикатор стоимости в кредитах (по отзывам Trustpilot — *«each generate action burning 60 credits»* — пользователи жалуются именно на видимость и предсказуемость списания).

---

## 8. 3D View (Visualize mode)

Переход в 3D — через вкладку **Visualize** в верхнем mode-bar. Это отдельный режим, а не overlay над 2D.

Что происходит:

- На 2D-плане появляются **иконки камер**. Можно их добавлять, перетаскивать и поворачивать; preview 3D-кадра обновляется live.
- **Camera position и angle** настраиваются мышью; есть first-person walkthrough mode с FOV slider — можно «пройтись» по дому от первого лица.
- **Style reference**: можно выбрать стиль из встроенной **Style Library** или загрузить свой референс (изображение — Pinterest screenshot, Instagram, любая inspiration-картинка).
- **Prompt-поле**: текстом задаются финальные направления — «add curtains», «change flooring to oak», «include kitchen accessories», «moody evening lighting».
- **Render scene** — крупная CTA, запускает фотореалистичный рендер (10 кредитов).
- Готовые рендеры сохраняются в **Drafts** или в проект, можно скачать.
- **Image type**: Interior / Exterior / Elevation — три варианта рендера. Для Exterior — рендер фасада, для Elevation — техническая развёртка фасада.
- **Качество**: по отзывам, 3D-views в Maket «rough» — это рабочий ориентир для пользователя, а не презентационные материалы. Photorealistic render — отдельный финальный шаг через текстовый промпт.

Walk-through режим **есть** (first-person walkthrough), но это статичная навигация для подбора кадра, а не полноценный VR-тур.

---

## 9. Compliance panel (Regulatory Assistant)

Отдельный модуль, доступный из левого sidebar или меню Create. Это **не overlay поверх редактора** с цветовыми индикаторами нарушений, а отдельная вкладка/страница, где:

1. Пользователь загружает zoning-документ (поддерживаются JSON, HTML, TXT, PDF, ZIP).
2. Система парсит документ.
3. В **«designated text box»** пользователь задаёт вопросы plain-language: «What's the maximum height in R1 zone?», «What's the setback for side yard?».
4. AI отвечает текстом с цитатами/ссылками на документ.

**Цветовой индикации нарушений на плане (типа красный = нарушение setback)** в публичной документации не подтверждено — это слабое место по сравнению с Archistar и подобными. В описаниях упоминается «AI-driven verification systems that ensure regulatory alignment throughout the design process», но это, видимо, ручная сверка через Q&A, а не live-проверка.

---

## 10. Export modal

Экспорт — feature **Plus-тира** ($20/мес). Описания упоминают форматы:

- **DXF** — для CAD-workflow (AutoCAD, Revit, ArchiCAD).
- **PDF** — для клиентской печати.
- **JPEG** — растровая картинка плана.
- **Shareable Link to Project** — публичная ссылка для коллег/клиентов.

Модалка вызывается, скорее всего, через кнопку **Share** в верхнем правом углу или меню `⋯ → Export`. Внутри — выбор формата radio-кнопками, выбор листа (этажа) или «all floors», выбор разрешения для растров, кнопка **Download**. DWG-экспорт упомянут на странице features как «coming soon».

---

## 11. Цветовая схема и стиль

По косвенным признакам (лендинг, скриншоты в обзорах):

- **Тема — светлая** по умолчанию, тёмная тема явно не упомянута. Canvas — белый/светло-серый, план рисуется чёрными контурами с заливкой по типу комнаты.
- **Корпоративные цвета**: акцентный синий/фиолетовый (по виду лого и кнопок), нейтральные серые для chrome, лёгкие пастельные заливки комнат на 2D-плане (например, кухня — мягкий бежевый, спальня — голубой). Это типичный «design tool» паттерн.
- **Шрифты**: sans-serif современный, скорее всего Inter/SF Pro — стандарт для SaaS.
- **Иконки**: тонкие линейные (выглядит как Lucide / Phosphor по описаниям тулбара).
- **Визуальный тон**: «accessible, not professional CAD» — то есть намеренно мягкий и непугающий, в отличие от ArchiCAD / Revit с их плотным dense UI.

---

## 12. Onboarding

- **Tutorial при первом входе**: явно описанного первого онбординг-тура с tooltip-ами не зафиксировано. Вместо этого основной онбординг — это **сам wizard**, который через chat-разговор учит пользователя структуре продукта (задаёт вопросы — пользователь понимает, что Maket нужны эти данные).
- **Demo project**: явных demo-проектов в аккаунте нет, но **Top Users gallery** служит источником вдохновения и фактически работает как набор «реальных» примеров.
- **Tooltips**: по обзорам, интерфейс «no learning curve» — это значит, что инструменты подписаны и интуитивны. Подтверждённых hover-tooltip-ов с подсказками не нашёл, но они логично должны быть на иконках toolbar.
- **Help / Tutorials**: ссылка на help center `help.maket.ai` (на момент исследования сервер не отвечал — `ECONNREFUSED`), а также видеотуториалы на YouTube-канале Maket — есть полные walkthrough-ы («Generate a Floor Plan with AI in Minutes | Maket Tutorial»). Внутри приложения должна быть кнопка `?` ведущая на help-центр.
- **Free credits** (50 шт.) — фактически часть онбординга: пользователь получает достаточно, чтобы сгенерировать первый план и пару рендеров без оплаты.

---

## Сводная карта экранов

```
LOGIN
  │
  ▼
DASHBOARD ──► Projects grid
  │           Drafts
  │           Style Library
  │           Community Gallery / Top Users
  │           Regulatory Assistant
  │           Help
  │
  ├──► "Generate Plan"  ──► WIZARD (4 шага в чате) ──► EDITOR
  ├──► "Draw from Scratch" ──► EDITOR (пустой canvas)
  ├──► "Image / Render"  ──► IMAGE GENERATION MODAL
  └──► Open project       ──► EDITOR
                              │
                              ├── Edit  (canvas + properties)
                              ├── Build (walls/doors/windows/stairs)
                              ├── Finishes (materials)
                              ├── Objects (furniture catalog)
                              └── Visualize ──► 3D view + cameras
                                               │
                                               └──► RENDER MODAL
                                                       └──► EXPORT modal (DXF/PDF/JPEG)
```

---

## Что важно учесть при проектировании похожего продукта

1. **Чат — не overlay, а полноценная правая колонка**. Это структурное решение, оно задаёт UX: пользователь параллельно видит canvas и историю общения с AI.
2. **Mode-tabs (Edit/Build/Finishes/Objects/Visualize)** — основной способ разнести функциональность; внутри каждой вкладки своя левая палитра. Это лучше, чем плоский тулбар со всем сразу.
3. **Wizard как conversational onboarding** — лучше, чем форма со степпером, потому что одновременно учит модель и пользователя.
4. **Кредиты должны быть видны постоянно** (top bar) и **рядом с каждой генерирующей кнопкой** — иначе появляются жалобы Trustpilot про «сжёг кредиты за 20 минут».
5. **Множественные варианты при первой генерации** — это сильный UX-ход; пользователь не тратит время на «не тот» план.
6. **3D — отдельный режим, а не toggle поверх 2D**. Камеры на 2D-плане + live preview справа — это удобная метафора.
7. **Compliance — пока слабое место Maket** (Q&A по PDF без визуальной разметки нарушений на плане). Это **зона для конкурентного преимущества**: визуальная разметка нарушений прямо в canvas с цветовыми индикаторами и подсказками — реальная польза.
8. **Lock/favorite вариантов** не подтверждён — тоже зона роста.
9. **Темная тема** отсутствует — для архитекторов, работающих часами, это упущение.
10. **Mini-map** отсутствует — но для маленьких 1–4-этажных домов это и не критично.

---

## Источники

### Официальные блоги и страницы Maket
- [How to Use Maket: Design Your Home from Idea to 3D](https://www.maket.ai/blog/how-to-use-maket)
- [AI Editing for Floor Plans: Talk to Your Plan, See Changes Live](https://www.maket.ai/blog/ai-editing-floor-plans)
- [Create Renders Using AI and a Text Prompt](https://www.maket.ai/blog/create-renders-using-ai-and-a-text-prompt)
- [Elevate Your Design Projects with Advanced Editing Capabilities](https://www.maket.ai/blog/elevate-your-design-projects-with-advanced-editing-capabilities)
- [Maket Zoning Regulations: Simplifying Zoning Compliance](https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance)
- [How to use Maket as a Home Builder](https://www.maket.ai/post/how-to-use-maket-as-a-home-builder)
- [AI Floor Plan Generator: Everything You Need to Know](https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026)
- [Best Interior Design Software for Beginners in 2026](https://www.maket.ai/blog/best-interior-design-software-beginners)
- [Features | Maket](https://www.maket.ai/features)
- [Pricing | Maket](https://www.maket.ai/pricing)
- [Maket | Landing](https://www.maket.ai/)

### Видео-туториалы
- [Maket.AI Tutorial (2025) — Full Beginners Tutorial — YouTube](https://www.youtube.com/watch?v=EGerOoAODXY)
- [Generate a Floor Plan with AI in Minutes | Maket Tutorial — YouTube](https://www.youtube.com/watch?v=d71_7rfaP0U)
- [Generative floor plan design using AI — Maket.ai — YouTube](https://www.youtube.com/watch?v=VPaeZWgt4TI)
- [Creating Floor Plans with AI using Maket — Does it really work? — YouTube](https://www.youtube.com/watch?v=2Gi8rIb90lY)

### Сторонние обзоры и отзывы
- [Maket.ai Review 2026 — illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)
- [Maket.ai Review 2026 — promeai](https://www.promeai.pro/blog/maket-ai-review-2026-architecture/)
- [Maket Review — 10web.io](https://10web.io/ai-tools/maket/)
- [Maket — testingcatalog: real-time editing](https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/)
- [Maket — testingcatalog: Draw from Scratch free](https://www.testingcatalog.com/maket-opens-draw-from-scratch-tool-to-all-users-for-free/)
- [Maket — Architizer Tech](https://tech.architizer.com/listing/maket.html)
- [Maket — similarlabs](https://similarlabs.com/p/maket-ai)
- [Maket — creati.ai](https://creati.ai/ai-tools/maket/)
- [Visualizee vs Maket](https://visualizee.ai/comparison/maket-ai)
- [Maket — Trustpilot user reviews](https://www.trustpilot.com/review/maket.ai)
