# Maket.ai — полный ресерч

Ресерч собран **2026-05-21** параллельно четырьмя агентами (3 — по живым источникам через WebFetch/WebSearch, 1 — из training data с пометками `[требует верификации]`).

## Файлы

| # | Файл | Что внутри | Источник данных |
|---|---|---|---|
| 1 | [01_overview.md](01_overview.md) | Продукт, компания, тарифы, фичи, бизнес-модель, сильные/слабые стороны, конкуренты сводно | Живые источники (maket.ai, blog, Trustpilot, ProductHunt, illustrarch) |
| 2 | [02_editor_stages.md](02_editor_stages.md) | **9 этапов работы редактора** — от создания проекта до экспорта. Floor Plan Generator, AI-чат правки, Visualize, Regulatory Assistant. Toolbar, hotkeys, известные лимиты. | Живые источники (help-центр, blog, YouTube, testingcatalog) |
| 3 | [03_ux_screens.md](03_ux_screens.md) | UX-карта: Dashboard, Wizard (conversational), Editor layout (3 колонки), tabs Edit/Build/Finishes/Objects/Visualize, AI-чат справа, export modal, ASCII-схемы экранов | Живые источники (help, blog, YouTube tutorials, reviews) |
| 4 | [04_tech_ai_competitors.md](04_tech_ai_competitors.md) | Гипотезы про техстек (вероятно React + Konva/Fabric + three.js, AWS + diffusion), детальная конкурентная таблица **Maket vs TestFit / Finch3D / Architechtures / Hypar / Forma / ARK / SWAPP** по 12 параметрам | Training data, многое помечено `[требует верификации]` |
| 5 | [05_open_questions.md](05_open_questions.md) | **Ответы на 6 открытых вопросов:** юрисдикции Regulatory Assistant, snap/layers/multi-select, lock/version history, latency, точная структура кредитов, отсутствие Enterprise-тарифа. Выявляет **3 больших окна для plana**. | Живые источники (pricing, blog, Trustpilot, illustrarch, BetaKit, LinkedIn, testingcatalog) |

## Главные находки (TL;DR)

### Что такое Maket
- Канадский (Монреаль) SaaS, основан 2020, **seed $3.4M CAD октябрь 2025** (Amiral Ventures), команда ~15 человек, **>1 млн пользователей v1**. Партнёры: Mattamy Homes, Atelier L'Abri.
- Только **residential**: single-family + small multi-family, **1–4 этажа**. Никакого commercial.
- Тариф: **Free** ($0, 50 кредитов, 1 этаж) и **Plus** ($20/мес, 300 кредитов, 4 этажа, hi-res). Кредитная модель — генерация ~20 кр, рендер ~10 кр.

### Модули
1. **Floor Plan Generator** — план по тексту или по параметрам (этажи / площадь / footprint / комнаты).
2. **AI Editing (v2)** — чат-правка плана командами вроде «add office», объясняет trade-offs, рекомендует одно изменение за раз.
3. **AI Renders** — Interior / Exterior / Elevation по text-промпту + reference image (10 кредитов/рендер, ~60–90 с).
4. **Regulatory Assistant** — загружаешь zoning PDF, Q&A по setbacks/FAR/высоте. **Авто-подсветки нарушений на canvas нет.**
5. **Visualize** — first-person walkthrough + камеры на плане.
6. В roadmap v2 (Q1 2026): HVAC, material takeoff, zoning verification.

### Редактор — 9 этапов
1. Dashboard → New Project (Plan / Image / Draw from Scratch)
2. **Conversational wizard** (4 вопроса: этажи → площадь → shape → комнаты), не классическая форма
3. AI генерирует ~4 варианта плана, ~1–2 минуты, 20 кредитов/этаж
4. **Canvas-редактор**: drag-handles на комнатах, рисование стен, Structure (doors/windows/stairs), Furniture-каталог, Inspection panel справа, floor selector, undo/redo
5. **AI-чат справа** — правки plain language («make kitchen bigger»)
6. **Visualize**: камеры, walkthrough, рендер
7. **Regulatory Assistant**: PDF zoning + Q&A
8. Cost estimation — **отсутствует**, в roadmap
9. **Экспорт**: DXF, PDF, JPEG/PNG. DWG «coming soon». **IFC/OBJ/RVT нет**. Share-link только Plus.

### UX-фишки которые стоит украсть
- **Conversational wizard** вместо степпера
- **AI-чат как фиксированная правая колонка** (не overlay)
- **Mode tabs** Edit/Build/Finishes/Objects/Visualize в одной строке сверху
- **Множественная генерация** (4–10 вариантов сразу) — сильный hook
- **Кредитный счётчик постоянно в top-bar**
- **Footprint-редактор** с Rect / L / custom, разным на каждом этаже

### Слабые места Maket (наши потенциальные преимущества)
- **2.3/5 на Trustpilot** — главные жалобы: спам-маркетинг, плохой spatial reasoning («машины внутри дома»), сложная отписка, прожорливость по кредитам
- **Только residential, max 4 этажа** — выше — никак
- **Нет визуализации нарушений зонирования на плане** — это chat-assistant, не live-overlay
- **Нет BIM** (IFC/RVT), нет публичного API, нет плагинов Revit/Rhino/AutoCAD
- **Output не permit-ready** — Maket это явно говорит
- **Cost estimation отсутствует** — обещают
- **Zoning AI это RAG поверх загруженного PDF**, не живая БД муниципальных кодов

### Конкуренты (где Maket в ландшафте)
Maket — **самый дешёвый и доступный** AI-инструмент для жилой архитектуры. Не конкурирует с TestFit/Finch3D/Hypar (B2B-developers, multifamily, $1.5–5k/seat/год), а расширяет рынок «вниз» — на home-builders, риелторов, DIY-homeowners. Сверху давит Autodesk Forma (бренд, BIM-стек, дорого).

## Ответы на открытые вопросы (см. [05_open_questions.md](05_open_questions.md))

| Вопрос | Ответ |
|---|---|
| Юрисдикции Regulatory Assistant | **Нет встроенной БД городов** — это RAG над пользовательским PDF. Гео-агностик. Auto-validation плана против кода обещают в v2.0. |
| Snap-to-grid, layers, multi-select, hotkeys, measurement | **Публично не задокументированы.** Скорее всего отсутствуют — Maket позиционируется как «no learning curve». |
| Lock частей плана / version history / branches | **Нет.** Только undo/redo. Regenerate теряет ранее заданные constraints — жалоба в Trustpilot подтверждает. |
| Реальная latency 2026 | ~45 сек на 4 варианта (illustrarch). Простые AI Edits — секунды. Очередей нет. Это **не боль**. |
| Структура кредитов | 20 кр/этаж, 10 кр/рендер. Free 50 / Plus $20=300/мес (сгорают). Top-up $10/150 кр — **только Plus, не сгорают**. **Годовой подписки нет.** |
| Enterprise / Teams | **Не существует публично.** Только Free + Plus $20. API нет, SSO нет, multi-user workspace нет, white-label нет. Большие клиенты через contact-sales. |

## Три больших окна для plana (главный вывод ресерча)

1. **Профессиональный canvas-редактор** — snap-to-grid, layers, multi-select, keyboard shortcuts, measurement tool, group/copy-paste. Всего этого у Maket нет.
2. **Lock / version history / branches** — возможность залочить часть плана при regenerate и сохранять snapshots. У Maket вообще нет.
3. **Teams / Enterprise / API** — самое большое окно. У Maket публично только Free + $20 для одного пользователя. Никаких команд, SSO, API, white-label.

Дополнительные слабые места: monthly credits сгорают (главная жалоба Trustpilot), нет mobile/iPad, нет offline, max 4 этажа, только residential, output не permit-ready.
