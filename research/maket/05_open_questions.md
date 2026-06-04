# Maket.ai — Закрытие 6 открытых вопросов (доп. ресерч)

**Дата:** 2026-05-21
**Источники:** maket.ai (blog, pricing, features, contact, faqs), help.maket.ai (недоступен извне через WebFetch — ECONNREFUSED), Trustpilot, third-party reviews (illustrarch, promeai, techvernia, archpulse, similarlabs, navtools, 10web, welcome.ai, archgyan), LinkedIn (Stéphane Turbide), BetaKit, TechFundingNews, TestingCatalog, YouTube (Maket official channel).

**TL;DR:** Maket — единый продукт без формальных Enterprise/Teams тарифов (только Free и Plus $20/мес), без публичного API и SSO, без mobile app. Regulatory Assistant работает по принципу "загрузи свой PDF" (нет встроенной БД городов). Canvas-редактор простой (chat + drag), без снэпа/слоёв/хоткеев в публичной документации. Версионирования и lock как формальной фичи не задокументировано. Реальная latency генерации ~45 секунд для 4 вариантов плана; рендер — секунды-минуты.

---

## ВОПРОС 1: Юрисдикции Regulatory Assistant

### Ответ

**Regulatory Assistant — это НЕ географически-ограниченная фича со встроенной базой городов. Это RAG-стиль ассистент над пользовательскими документами.**

#### Как работает

Согласно официальной статье Maket «Maket's Zoning Regulations: Simplifying Zoning Compliance» и подтверждено сторонними обзорами:

1. Пользователь **сам загружает zoning-документ** (zoning by-law, municipal code, planning regulation, restrictive covenant).
2. После короткой обработки задаёт вопросы на естественном языке («What is the maximum setback?», «Can I build a duplex on R-2?»).
3. AI отвечает на основе **содержимого этого конкретного загруженного документа**.

#### Поддерживаемые форматы загрузки

`JSON`, `HTML`, `TXT`, `PDF`, `ZIP`.

#### Встроенная база городов

**Нет.** Maket explicitly не поддерживает live-базу зонирования по городам/штатам/провинциям. Из illustrarch review (2026):

> «The tool interprets uploaded documents rather than maintaining a live database of zoning codes across jurisdictions. If your local code has been recently amended, the AI will only know what you upload.»

#### Гео-охват по факту

- **Глобальная фича** — работает с любым zoning-документом на любом языке/формате, который пользователь загрузит.
- **Маркетинг ориентирован на Северную Америку** (Канада, США), т.к. сам Maket базируется в Монреале, клиенты — Mattamy Homes (Канада), Dessins Drummond (Квебек), Atelier L'Abri (Монреаль).
- **Города, по которым есть ссылки в блог-материалах:** упоминаний конкретных pre-loaded городов **нет**.

#### Известные ограничения

1. Нет cross-reference между overlapping regulations (например, historic district + base zoning).
2. Не отслеживает амендменты — пользователь должен сам загружать актуальный PDF.
3. Не работает как «verify my plan against zoning» — это чисто Q&A над документом, не валидация плана.

#### Roadmap

В v2.0 (Q1 2026, идёт rollout) обещаны **«zoning code verification tools»** — это намёк на то, что в будущем Regulatory Assistant сможет автоматически чекать сгенерированный план против загруженного кода. Сейчас это **не доступно**.

---

## ВОПРОС 2: Возможности canvas-редактора

### Ответ (подтверждено vs опровергнуто vs не задокументировано публично)

Это самый «тёмный» из 6 вопросов — Maket публично документирует canvas-редактор очень скудно. По крупицам собрано из help-центра (косвенно через сторонние source), туториалов в блоге и обзоров.

#### Подтверждено (есть)

| Фича | Статус | Источник / цитата |
|---|---|---|
| **Drag-to-resize rooms** | ДА | "Resize rooms by dragging handles, move or delete walls" — maket.ai/blog/how-to-use-maket |
| **Add walls / doors / windows / stairs** | ДА | Через Structure menu — официальный workflow |
| **Drag-and-drop furniture** | ДА | Furniture catalog, можно драгать в комнаты |
| **Rotate / delete furniture** | ДА | "rotate or delete any piece" |
| **Undo / Redo** | ДА | "Undo and redo are always available" / "every change is reversible" |
| **Inspection panel с размерами при выделении** | ДА | "Select any item to see its detailed measurements in the inspection panel on the right" — это и есть фактический "measurement tool" |
| **Floor selector (multi-story)** | ДА | Переключатель этажей в топ-баре |
| **Switch chat ↔ canvas** | ДА | «switch between chat and canvas at any time» |
| **Adjacency / clearance warnings** | ДА | Live-индикация конфликтов adjacency и clearance во время редактирования |

#### Опровергнуто или НЕ задокументировано публично

| Фича | Вердикт |
|---|---|
| **Snap-to-grid** | **Не задокументировано публично.** Ни в одном из ~20 source-материалов нет ни одного упоминания «snap», «grid snap», «alignment guides». Учитывая что Maket позиционируется как «no learning curve» и редактор простой drag-based — скорее всего есть только базовое выравнивание стен друг к другу, без классической snap-to-grid настройки. **Нужно проверить в app.maket.ai под аккаунтом.** |
| **Layer system (стены/мебель/размеры как отдельные слои)** | **Опровергнуто как формальная фича.** Нет упоминаний layers panel или toggle visibility. Внутренне есть категории объектов (walls, furniture, doors), но это не пользовательский layer system типа Photoshop/AutoCAD. |
| **Multi-select объектов** | **Не задокументировано публично.** Все туториалы показывают работу с одним объектом за раз («select any item»). Marquee selection или shift+click multi-select — не упоминаются. **Нужно проверить в app.maket.ai.** |
| **Keyboard shortcuts / hotkeys** | **Не задокументировано публично.** Maket не публикует hotkeys cheat sheet, ни в блоге, ни в YouTube-туториалах (включая официальный канал @maketplans). Учитывая «click-and-drag» позиционирование продукта — вероятно есть только базовые (Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Delete для удаления), но публично не задокументированы. |
| **Dedicated measurement / ruler tool** | **Опровергнуто как отдельный tool.** Размеры показываются только при выделении объекта (inspection panel справа). Отдельного «click two points to measure» инструмента не задокументировано. |
| **Group / ungroup** | **Не задокументировано публично.** Концепция группировки не упоминается ни в одном source. Очень вероятно отсутствует. |
| **Copy / paste между проектами** | **Не задокументировано публично.** Нет упоминаний clipboard, duplicate object, или cross-project paste. Внутри проекта Ctrl+C/V вероятно работает на отдельных объектах, но cross-project — крайне сомнительно. **Нужно проверить в app.maket.ai.** |

#### Вывод по Q2

Canvas-редактор Maket — **намеренно упрощённый, chat-first**. Целевой пользователь — не профессиональный CAD-пользователь, а homeowner / small builder, которому хватает drag-и-drop и chat-команд. Профессиональные tooling-фичи (snap-grid с настройкой шага, layer panel, multi-select, advanced hotkeys, ruler tool) — либо отсутствуют, либо настолько не приоритетные что Maket их не маркетит.

**Это конкурентная возможность** для plana.ai: если делать профессиональный canvas — это сильное отличие.

---

## ВОПРОС 3: Lock / Version history / Branches

### Ответ

#### Lock частей плана

**Не задокументировано как формальная UI-фича.**

Есть единственное упоминание workflow-паттерна в reviews:
> «The recommended workflow includes locking circulation and cores before styling and versioning each iteration.»

Но это **описание best practice от рецензента**, не указание на UI-кнопку «Lock». В официальной документации Maket нет упоминаний «lock element», «freeze room», «pin part of plan». 

Скорее всего сейчас (v2 в rollout) lock в формальном виде **нет** — пользователь полагается на undo/redo и на то что AI старается не ломать существующие зоны при chat-edit.

#### Version history / Snapshots

**Не задокументировано как формальная фича.**

- Есть `undo/redo` — но это не version history (linear stack без именованных snapshots).
- В similarlabs описании Premium-тира упомянуто «versioning» как фича, но это **сторонний обзор с возможно outdated info** (там же $30 цена которой нет на актуальном maket.ai/pricing).
- На официальной pricing-странице Maket **нет упоминания** ни «version history», ни «snapshots», ни «save versions».
- AI Editing блог-пост (2026) описывает «every change is reversible» и «stays editable on the canvas at all times» — но это про in-session editing, не про сохранение версий.

#### Откат к предыдущей версии (помимо undo)

**Не задокументировано публично.** Скорее всего только через undo (Ctrl+Z), pojkalku undo stack ограничен сессией.

#### Branches / параллельные варианты от одной точки

**Не задокументировано как explicit фича.**

Что есть похожее:
- При генерации создаётся **несколько вариантов сразу** (4 layout options per request, по illustrarch review).
- Можно «regenerate» с изменёнными параметрами для получения новых вариантов.

Но **branching от одной точки в дереве итераций** (как в Figma, Git) — нет.

#### Вывод по Q3

Workflow «итеративная работа с lock + version history + branches» в Maket **не реализован формально**. Это потенциально вторая большая конкурентная возможность для plana — если вы хотите дать архитектору «защищу critical zones и попробую 3 варианта в параллель», в Maket этого нет.

Подтверждение из Trustpilot review (negative):
> «Each time you hit 'generate' it burns 60 credits and either does nothing or creates a new floorplan that is missing things you specified earlier so it is useless.»

— это симптом отсутствия lock: AI каждый раз генерирует «с нуля», не сохраняя ранее зафиксированные пользователем элементы.

---

## ВОПРОС 4: Реальная latency и performance в 2026

### Ответ

#### Генерация floor plan

- **~45 секунд** для генерации 4 вариантов плана (illustrarch review, январь 2026): «Within about 45 seconds, users received four floor plan options».
- Marketing-обещание «in seconds» / «in minutes» — реальная цифра ближе к **30-60 секундам**.
- Сложные multi-floor планы могут занимать **до пары минут**.

#### AI Editing (chat-команды на существующий план)

Из maket.ai/blog/ai-editing-floor-plans:
- Простые edits («make kitchen 30% bigger», «add a powder room near the entry») — **секунды**.
- Сложные операции (room swaps, full reorganizations) — **«up to a minute or two»**.

#### Рендер (3D photorealistic)

- Промо обещает «in seconds» / «in minutes».
- Точные числа в публичных source не указаны.
- Рендер стоит **10 credits** против 20 credits за floor plan generation, что косвенно говорит о меньшей вычислительной стоимости и более быстром времени.
- Косвенно из Trustpilot: пользователи не жалуются на render latency, жалуются на quality.

#### Queueing / очередь

- **Публично не задокументировано наличие очереди.**
- В Trustpilot reviews нет жалоб типа «waited X minutes in queue».
- Скорее всего инфраструктура справляется — у Maket ~1M users (v1 cumulative), но активных одновременно меньше.
- В October 2025 они подняли $3.4M CAD seed (Amiral Ventures) — частично для масштабирования инфры под v2.

#### Жалобы на скорость в свежих reviews (2025-2026)

- **Trustpilot 2.3/5 (7 reviews)** — основные жалобы НЕ про скорость, а про:
  1. Сжигание кредитов («burns 60 credits per generate»)
  2. Качество выходов (плохая адекватность плана требованиям)
  3. Невозможность отменить подписку
- Positive reviews и обзоры подчёркивают: **«speed is the real win»** — Maket сокращает «hours to minutes» для feasibility-discussions с клиентом.

#### Полный iterative session

По данным reviews: **30 минут — 2 часа** полная итеративная сессия (generate → edit → finalize → export). Это agreement с тем, что AI делает ~70-75% schematic work, остальное — мануальные правки.

#### Вывод по Q4

Maket по latency **не имеет проблем** — 45 секунд для 4 вариантов это конкурентоспособно. Главная боль не в скорости, а в **«прожорливости» кредитов и качестве результата** (см. Q5).

---

## ВОПРОС 5: Точная структура кредитов и top-ups

### Ответ

#### Стоимость операций (актуально на 2026, по maket.ai/pricing)

| Операция | Стоимость в кредитах | Источник |
|---|---|---|
| **Floor plan generation** | **20 credits / floor** | Official pricing page |
| **3D render** | **10 credits / render** | Official pricing page |
| **AI Edit (chat-команда)** | ? Публично не указано отдельной строкой | — |
| **Regenerate (re-run генерации)** | Равно полной generation = 20 credits / floor | По логике + Trustpilot отзыв «burns 60 credits» (=3 floors × 20) |

#### Тарифные планы (на pricing-странице Maket, май 2026)

| Параметр | Free | Plus |
|---|---|---|
| Цена | $0 | **$20 / месяц** |
| Кредитов в месяц | **50** | **300** |
| Multi-floor (до 4) | Нет | Да |
| Высокое разрешение экспорта | Нет | Да |
| Top-up packs | **Недоступно** | **Доступно** |
| Text-based optimization | Нет | Да |
| Card required | Нет | Да |

#### Top-up packs

- **Стартовая цена: $10 за 150 credits.**
- **Только для Plus subscribers** (Free пользователи не могут покупать top-up).
- **Top-up credits НИКОГДА не сгорают** — переносятся между месяцами, остаются даже после отмены подписки (ждут возобновления).
- Стартовый пак $10/150 = **$0.067 за кредит**, то есть один render = $0.67, один floor plan = $1.33 на top-up.

#### Что насчёт месячных кредитов Plus

- **Сгорают ежемесячно.** Из Trustpilot: «if you have any credits left over they won't roll over».
- Reset каждый billing cycle.
- Это **жалоба №1** в негативных отзывах — пользователи теряют 50-200 кредитов в месяц если не используют.

#### Годовая подписка со скидкой

- **На официальной pricing-странице (май 2026) — НЕТ.**
- Один сторонний review (techvernia) упоминает $288/год (=$24/мес, 20% скидка) — но эта цифра упомянута только там и противоречит другому number у того же автора ($30/мес). Скорее всего **outdated данные** про v1.
- ArchPulse review (2026) упоминает «$24/month billed annually» для Pro — но это **тоже не подтверждается** на актуальном maket.ai/pricing.
- **Вывод:** актуально доступен **только monthly billing**. Возможно скидка обсуждается с sales для enterprise, но публично не предлагается.

#### Что говорят про прожорливость кредитов

- Trustpilot review (2025): «Each time you hit 'generate' it burns 60 credits (of the 300 you get each month) and either does nothing or create a new floorplan that is missing things you specified earlier so it is useless.»
- Это указывает на **двойную проблему**:
  1. 60 credits per regenerate = только 5 регенераций в месяц (300/60).
  2. Регенерация не сохраняет предыдущие constraints → пользователь тратит кредиты впустую.

#### Расчёт «реальной» месячной capacity

- 300 credits / 20 per floor = **15 floor plans** в месяц
- Или 300 / 10 = **30 renders** в месяц
- Или микс: например, 5 multi-floor projects по 2 floors (=200 credits) + 10 renders (=100 credits) = 1 проект полностью в месяц на $20.

#### Вывод по Q5

Структура простая и прозрачная:
- **20 credits / floor generated**
- **10 credits / render**
- $20/мес = 300 credits = ~15 floor plans или ~30 renders
- Top-up $10 / 150 credits (только для Plus, не сгорают)
- **Monthly Plus credits СГОРАЮТ** — это раздражает пользователей
- **Годовая подписка публично не предлагается**

---

## ВОПРОС 6: Enterprise / Teams тариф

### Ответ

#### Существует ли формальный Enterprise / Teams / Business план?

**Публично НЕТ.**

На официальной maket.ai/pricing только два тира: **Free и Plus $20/мес**. Ни одного упоминания Enterprise, Business, Studio, Teams тарифа на pricing-странице.

#### Что есть похожее

1. **Contact-sales путь:** на maket.ai/contact упомянут «enterprise specialist» — Patrick (вероятно CEO Patrick Murphy) принимает enterprise-запросы на `help@maket.ai`.
2. **Известные B2B-клиенты:** Mattamy Homes (крупный канадский homebuilder), Dessins Drummond (Квебек), Atelier L'Abri (Монреаль). Эти отношения вероятно идут через **кастомные контракты**, а не публичный тариф.
3. **«Real-time collaboration»** упоминается в маркетинге, но это in-project collaboration в рамках Plus, не teams workspace.

#### SSO

- **Публично не задокументировано.** Welcome.ai source упоминает «advanced security features (data encryption, secure access controls)» — но это generic, не SSO/SAML.
- Авторизация на app.maket.ai — email/password + Google OAuth. **Корпоративный SSO не предлагается публично.**

#### Командная работа / multi-user workspaces

- **Не задокументировано.** Один account = один пользователь.
- На сторонних обзорах есть путаница (welcome.ai говорит «real-time collaboration tools», archpulse говорит «Studio $79/мес с 5 users» — но это outdated данные **не подтверждаются** на maket.ai/pricing).
- **Текущая реальность май 2026:** один пользователь = один Plus подписка = один workspace. Командной работы как feature нет.

#### White-label

**Публично не предлагается.** Нет упоминаний в каком-либо source.

#### API-доступ

- **Публичного API нет.**
- maket.ai/integration описывает только «one-click integrations с архитектурным софтом» (DXF/DWG/PDF exports) — это не API, это export-форматы.
- В sourcedaytora обзорах из 2025 (archpulse, techvernia) упоминается «API access on Studio plan» — но **Studio тариф на актуальном pricing отсутствует**, эти данные либо outdated, либо ошибочны.
- Patrick Murphy в интервью говорит, что они «iterate with Claude» — то есть они потребители Anthropic API, но **не открывают свой API публично**.

#### Outdated / противоречивые данные

Несколько обзорных сайтов (techvernia, archpulse, similarlabs) приводят **разные числа для тарифов**:
- $30/мес Pro / $99/мес Studio (techvernia)
- $29/мес Pro / $79/мес Studio (archpulse)
- $10/мес Basic / $30/мес Premium (similarlabs)

**Все эти источники конфликтуют с официальным maket.ai/pricing**, где только Free + Plus $20/мес. Это указывает на то, что:
1. Maket **сильно упростил pricing к v2** (Q1 2026 rollout) — раньше было 3-4 тира, сейчас 2.
2. Старые обзорные сайты не обновили данные.
3. Любые claims про «Studio plan with API, SSO, teams» — **untrustworthy outdated**.

#### Вывод по Q6

**Enterprise/Teams/Business план в текущей публичной форме отсутствует.** Большие клиенты идут через персональный контракт с CEO. Это **третья большая конкурентная возможность** для plana — у Maket нет ни formal teams, ни SSO, ни API, ни white-label.

---

## Дополнительно

### Mobile app (iOS / Android)

**НЕТ нативного приложения.**

- Maket — **web-only**.
- Существует WebCatalog desktop wrapper для macOS/Windows (третья сторона), но это не нативное приложение.
- Один из обзоров (best-interior-design-software-beginners) явно говорит: **«Web-only (iPad support coming)»** — то есть iPad-версия в roadmap, но iOS/Android в нативном виде не анонсированы.

### Браузерная совместимость

- **Официально поддерживаются: Chrome, Safari, Firefox** (по integration-странице и сторонним обзорам).
- **OS:** Любая, на которой работают эти браузеры: macOS, Windows, Linux.
- Edge публично не упомянут, но скорее всего работает (Chromium-based).
- Mobile browser support не подтверждён — UI не оптимизирован под touch.

### Limits — максимумы

| Параметр | Лимит | Источник |
|---|---|---|
| Максимальное число этажей | **4** | Multi-floor generation up to 4 floors (Plus only) |
| Площадь | **Не задокументирован hard cap** | Примеры в туториалах: 1200-2400 sq ft |
| Число комнат | **Не задокументировано** | Constraint-based generation, не enforced limit |
| Размер uploaded zoning PDF | Не указан | — |
| Активных проектов | Не указан для Plus | Free может быть ограничен 1-3 |

### Offline-режим

**НЕТ.** Maket — чистый SaaS на app.maket.ai, требует постоянное подключение. Ни одного упоминания offline-режима, local install, или PWA.

### Roadmap v2 (Q1 2026 rollout — активно идёт)

Анонсированы в v2:
- Upgraded floor plan generator с более granular fine-tuning
- Improved visual rendering
- **Zoning code verification tools** (auto-validate plan against uploaded code) — потенциально снимает ограничение Regulatory Assistant
- **HVAC planning capabilities**
- **Material takeoff features**
- DXF / DWG export (DXF был live в v1, DWG «coming soon»)
- Image export «coming soon»
- Custom furniture asset integration «coming soon»
- Interior style options «coming soon»

### Что НЕ найдено в открытых source (требует логин в app.maket.ai)

1. **Точный список keyboard shortcuts** — если они существуют, публично не задокументированы.
2. **Существует ли snap-to-grid и какой шаг** — нужно открыть редактор и проверить.
3. **Multi-select поведение** — marquee? shift+click?
4. **Внутренний layer system** — есть ли toggle для walls/furniture/dimensions visibility.
5. **Точное число pre-loaded zoning документов** (если они вообще есть в Regulatory Assistant как библиотека).
6. **Точная стоимость AI Edit chat-команды в кредитах** (отдельно от регенерации).
7. **Render latency точная** в секундах.
8. **Edge browser support** (фактический, не маркетинговый).
9. **Project limit** на Free vs Plus.

---

## Итоговая таблица «Maket уязвимости / конкурентные возможности для plana»

| Вопрос | Maket-статус | Plana-opportunity |
|---|---|---|
| Regulatory Assistant | Только user-upload, нет gov DB | **HIGH** — если plana построит curated DB зонирования по топ городам Казахстана/СНГ/EU |
| Snap-to-grid, hotkeys, multi-select | Не задокументировано / минимально | **HIGH** — профессиональный canvas с hotkeys, snap, layers как differentiator |
| Lock / Version history / Branches | Только undo/redo | **HIGH** — lock zones + named snapshots + parallel variants — большой gap |
| Latency / queue | 45s for 4 plans — OK | LOW — паритет, не дифференциатор |
| Credit pricing | $20/мес, 300 credits, monthly burn | MEDIUM — годовая подписка, rollover, прозрачные пакеты — конкурентное преимущество |
| Enterprise / Teams / API / SSO / White-label | Нет публично | **HIGHEST** — отдельный Business тариф с API + SSO + multi-seat — открытый рынок |
| Mobile | Web-only, iPad в roadmap | MEDIUM — нативный iPad early differentiator |
| Offline | Нет | LOW — современные пользователи не ожидают |

---

## Источники (ключевые)

### Официальные (maket.ai)

- https://www.maket.ai/pricing — pricing (Free + Plus $20)
- https://www.maket.ai/features — общий feature list
- https://www.maket.ai/faqs — index без ответов в HTML
- https://www.maket.ai/contact — enterprise contact (`help@maket.ai`)
- https://www.maket.ai/integration — интеграции (нет API)
- https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance — Regulatory Assistant
- https://www.maket.ai/blog/how-to-use-maket — workflow
- https://www.maket.ai/blog/ai-editing-floor-plans — AI Editing v2
- https://www.maket.ai/blog/best-interior-design-software-beginners — упоминание «web-only, iPad coming»
- https://www.maket.ai/blog/draw-a-floor-plan-from-scratch — drawing
- https://www.maket.ai/blog/top-rated-ai-floor-plan-tools-compared-in-2026 — сравнение
- https://platform.maket.ai/login — login screen

### Сторонние обзоры

- https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html — главный 2026 review (с latency 45s)
- https://www.promeai.pro/blog/maket-ai-review-2026-architecture/ — 2026 architect review
- https://techvernia.com/pages/reviews/architecture/maket-ai.html — 2026 review (outdated pricing)
- https://www.archpulse.co/tool/maket-ai — 2026 review (outdated pricing)
- https://similarlabs.com/p/maket-ai — Basic/Premium тиры (вероятно outdated)
- https://10web.io/ai-tools/maket/ — обзор
- https://navtools.ai/tool/maket-ai — обзор
- https://www.welcome.ai/solution/maket — error-page при fetch
- https://www.trustpilot.com/review/maket.ai — 2.3/5, 7 reviews, основные жалобы про credits и cancel
- https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/ — AI Editing launch
- https://betakit.com/maket-secures-3-4-million-to-make-floor-planning-quicker-with-ai/ — $3.4M CAD seed Oct 2025
- https://techfundingnews.com/montreal-maket-chatgpt-architecture-raises-3-7m-cad/ — то же
- https://www.linkedin.com/posts/stephane-turbide-5963777a_maket-ai-powered-floor-plan-creation-activity-7429609787543166976-ufQk — Maket 2.0 Beta launch

### YouTube

- https://www.youtube.com/@maketplans — официальный канал (не удалось извлечь содержимое через WebFetch)
- https://www.youtube.com/watch?v=d71_7rfaP0U — Tutorial: Generate a Floor Plan with AI in Minutes
- https://www.youtube.com/watch?v=EGerOoAODXY — 2025 NEW UPDATED GUIDE (полный туториал)

### LinkedIn / Crunchbase

- https://www.linkedin.com/in/patrick-murphy-2685114a/ — Patrick Murphy CEO
- https://ca.linkedin.com/company/maket-ai — Maket company page (49 employees)
- https://www.crunchbase.com/person/patrick-murphy-e62d — Crunchbase
- https://pitchbook.com/profiles/company/482478-13 — PitchBook (Montreal, ~49 employees)

### Help-центр

- https://help.maket.ai/ — **недоступен извне через WebFetch (ECONNREFUSED)** — требует ручной заход через браузер.

---

## Подытог

Maket по состоянию на май 2026 — **простой, доступный, ориентированный на массового пользователя SaaS**. Их сильные стороны: скорость генерации (~45с), простая ценовая модель ($20/мес), AI Editing через chat. Их слабые стороны (важные для конкурентов): отсутствие enterprise/teams тарифа, нет API, нет SSO, нет formal version history / lock / branches, минимальный canvas-tooling (snap, layers, hotkeys), нет mobile app, ограниченный Regulatory Assistant (только user-upload).

Несколько критических открытых вопросов **не могут быть подтверждены без логина в app.maket.ai** — все они помечены выше в тексте как «нужно проверить под аккаунтом».
