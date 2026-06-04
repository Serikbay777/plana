# Maket.ai — полный обзор платформы (исследование, май 2026)

> Исследование подготовлено на основе официального сайта `maket.ai`, help-центра `help.maket.ai`, блога компании, обзоров на independent-площадках, отзывов на Trustpilot, материалов BetaKit / TechFundingNews и сравнительных рейтингов 2025–2026 годов.

---

## A. Общее описание продукта

**Maket** — это веб-платформа генеративного ИИ для проектирования **жилой** архитектуры. Она позволяет за минуты создать планировку этажа по текстовому описанию или набору параметров (площадь, форма участка, количество комнат, стиль), отредактировать её в чате, сгенерировать фотореалистичные рендеры и проверить соответствие нормам зонирования по загруженному PDF. Компания позиционирует себя как «ChatGPT для архитектуры» ([TFN](https://techfundingnews.com/montreal-maket-chatgpt-architecture-raises-3-7m-cad/)).

- **Компания:** Maket Technologies Inc., Монреаль, Канада.
- **Год основания:** 2020. Публичный запуск — 2023.
- **Основатели:** Patrick Murphy (CEO), Stéphane Turbide (COO), Simon Vallée (CPO).
- **Размер команды:** ~14–15 человек ([TFN](https://techfundingnews.com/montreal-maket-chatgpt-architecture-raises-3-7m-cad/)).
- **Финансирование:** более $4 млн CAD, последний seed-раунд — **$3,4 млн CAD** в октябре 2025 (лид — Amiral Ventures; ко-инвесторы: Blitzscaling Ventures, BY Venture Partners, Hidden Layers) ([BetaKit](https://betakit.com/maket-secures-3-4-million-to-make-floor-planning-quicker-with-ai/)).
- **Аудитория:** **более 1 млн зарегистрированных пользователей** v1 ([maket.ai](https://www.maket.ai/)).
- **Партнёры/клиенты:** Mattamy Homes, Dessins Drummond, архитектурная студия Atelier L’Abri ([10web](https://10web.io/ai-tools/maket/), [einpresswire](https://www.einpresswire.com/article/726246585/)).

### Целевая аудитория

Maket изначально позиционировался максимально широко: «архитектура должна быть доступна каждому». На практике сегментация выглядит так:

1. **Профессионалы** — архитекторы малых и средних бюро, дизайнеры интерьеров (быстрый concept-фаза, варианты для клиента).
2. **Девелоперы и подрядчики** — Custom Home Builders, small residential developers, риелторы, которым нужно показать инвестору варианты застройки участка.
3. **Домовладельцы (homeowners, renovators)** — люди, планирующие построить или перестроить частный дом, без опыта в CAD.

### Value proposition

- «Generate floor plans, explore layouts, and visualize your home with AI at your side» ([maket.ai](https://www.maket.ai/)).
- Снижение порога входа: натуральный язык вместо CAD; план за **секунды**, а не за неделю.
- CEO заявляет, что Maket покрывает **~70–75 % schematic-работы**, оставляя финальную проверку и нормоконтроль лицензированным специалистам ([testingcatalog](https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/)).
- Сравнение скорости: традиционно архитектор делает 3–5 вариантов планировки, Maket — 50–200 за то же время ([promeai](https://www.promeai.pro/blog/maket-ai-review-2026-architecture/)).

---

## B. Полный список функций (модулей)

### B.1 Floor Plan Generator (генератор планировок)

**Что делает.** Создаёт жилые планировки от **1 до 4 этажей** на основе параметров: форма участка/здания, общая площадь, количество и тип комнат (спальни, ванные, кухня, гараж, кабинет), стиль (modern, traditional, craftsman и др.), требования к ориентации.

**Как работает (шаги пользователя).**
1. Пользователь либо вводит «brief» в свободной форме («Two-story 200 m² family house with 3 bedrooms, attached garage, open-plan kitchen»), либо заполняет поля/выпадающие списки.
2. AI генерирует **множество вариантов** (десятки в одну сессию) с размерами комнат, стенами, дверями и базовой расстановкой мебели.
3. Пользователь сравнивает варианты бок-о-бок и выбирает «лучший» для дальнейшей доработки.

**Результат на выходе.** Размерные 2D-планировки с автоматическими размерами комнат и предложенной мебелью; всё редактируется (см. модуль AI Editing).

Источники: [maket.ai/features](https://www.maket.ai/features), [promeai](https://www.promeai.pro/blog/maket-ai-review-2026-architecture/), [illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html).

### B.2 AI Editing — чат-редактор планировки

**Что делает.** Conversational layer поверх уже сгенерированного плана. Пользователь правит план **командами на естественном языке**, изменения применяются практически в реальном времени.

**Примеры команд.**
- «Add a home office next to the kitchen»
- «Swap the kitchen and the dining room»
- «Rotate the plan 180 degrees»
- «Make the living room larger»

**Особенность.** AI «объясняет свои решения и отмечает компромиссы» (например, что увеличение гостиной уменьшит соседнюю спальню) — пользователь видит trade-offs до подтверждения. Это самый значимый апдейт v2 (выпущен в Q1 2026, доступен всем) ([testingcatalog](https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/)).

### B.3 Manual Floor Plan Editor (ручное редактирование)

Перетаскивание стен, смена дверей, поворот объектов, добавление мебели вручную; коррекция размеров. Описано как стартовая точка для итеративной работы поверх AI-генерации ([maket.ai/blog/what-does-ai-home-design-software-actually-do-in-2026](https://www.maket.ai/blog/what-does-ai-home-design-software-actually-do-in-2026)).

### B.4 Import existing plans

Можно загрузить **существующий план** (для ремонта/перестройки) и сделать на его основе альтернативные варианты — поддерживается воркфлоу «redesign».

### B.5 3D Visualization

Конвертация 2D-плана в **3D walkable** просмотр + базовое отображение объёмов здания. По обзорам, 3D-возможности относительно скромные по сравнению с Snaptrude или Forma — это «визуализатор», а не полноценный BIM ([techvernia](https://techvernia.com/pages/reviews/architecture/maket-ai.html), [aibuildingtools](https://aibuildingtools.com/blog/best-generative-design-tools)).

### B.6 AI Renders (Restyle / Style Transfer)

**Что делает.** Из 2D-плана или из 3D-сцены генерируются **фотореалистичные изображения** трёх типов:
- **Interior** — интерьерные кадры комнат;
- **Exterior** — экстерьеры здания;
- **Elevation** — фасады.

**Как работает.**
1. Выбрать тип кадра.
2. Написать текстовый промпт: «Modern kitchen with matte black cabinets, gold fixtures, and a skylight».
3. (Опционально) загрузить **reference image** — AI использует её как «структурное руководство» и наносит на эту структуру описанные материалы/стиль ([maket.ai/blog/create-renders-using-ai-and-a-text-prompt](https://www.maket.ai/blog/create-renders-using-ai-and-a-text-prompt)).

**Ограничения** (по собственному блогу Maket): пространственная точность зависит от наличия плана; освещение/тени иногда стилизованы; функциональный реализм (расстояния между приборами и пр.) не всегда соответствует нормам.

### B.7 Regulatory Assistant (Zoning Compliance)

**Что делает.** Пользователь загружает **локальный документ зонирования** (PDF/HTML/TXT/JSON/ZIP), а затем задаёт вопросы на естественном языке: setbacks, height limits, lot coverage, permitted uses, parking ratios, FAR ([maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance](https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance)).

**Важное ограничение.** Это **парсер документа**, а не живая база зональных правил по юрисдикциям. Если код муниципалитета обновился — AI знает только то, что вы загрузили. Не умеет cross-reference’ить пересечения overlay-зон (например, исторический район поверх базового зонирования) ([illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)).

### B.8 Cost Estimation / Environmental Analysis

В обзоре 10web упоминаются «cost estimation tools» и «environmental impact analysis» как часть платформы, но детальной документации публично нет — функции, вероятно, дают грубую оценку (квадратные метры × референсная стоимость) и помечены как assistant-уровневые ([10web](https://10web.io/ai-tools/maket/)).

### B.9 Daylighting overlay

Аналитический слой, показывающий распределение **естественного света** по сгенерированному плану — упомянуто как одна из «практически полезных» фич ([promeai](https://www.promeai.pro/blog/maket-ai-review-2026-architecture/)).

### B.10 Templates / Styles library

Библиотека архитектурных стилей (modern, traditional, craftsman, farmhouse и т. п.) + библиотека материалов и отделок. Можно загружать собственные референсы.

### B.11 Collaboration (заявлено)

В обзорах упоминается «real-time team collaboration» для платных тарифов и студийных команд ([10web](https://10web.io/ai-tools/maket/)).

### B.12 Roadmap v2 (Q1 2026, частично уже раскатано)

По данным BetaKit, в v2 заявлено:
- улучшенный генератор с granular fine-tuning;
- повышенное качество рендера;
- **Zoning code verification tools** (не только Q&A, а валидация плана);
- **HVAC planning**;
- **Material takeoff** (ведомости материалов).

Источники: [BetaKit](https://betakit.com/maket-secures-3-4-million-to-make-floor-planning-quicker-with-ai/), [TFN](https://techfundingnews.com/montreal-maket-chatgpt-architecture-raises-3-7m-cad/).

---

## C. AI-возможности

- **Какие модели — официально не раскрывается.** Maket не публикует, какие именно LLM/diffusion-модели лежат под капотом ([testingcatalog](https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/)).
- **Генерация плана:** проприетарная модель Maket, обученная на жилых планировках; вход — структурированные параметры + NL; выход — векторная 2D-планировка с семантическими тегами комнат.
- **AI Editing:** conversational-агент над уже существующим планом — интерпретирует команды и применяет геометрические трансформации с объяснением trade-offs.
- **Рендеры:** image-генерация по text/image-промпту (тип diffusion); поддерживает reference-изображение как structural guidance.
- **Regulatory Assistant:** retrieval/QA-агент над загруженным документом (классический RAG-сценарий).
- **Human-in-the-loop:** заявлено CEO явно — 25–30 % финальной работы (структурный анализ, нормы) остаются за лицензированным архитектором/инженером.

---

## D. Форматы экспорта

| Формат | Назначение | Статус |
|---|---|---|
| **PDF** | Печать, передача клиенту (на Free — с водяным знаком по части обзоров) | Есть |
| **PNG / JPG (рендеры)** | Превью в стандартном разрешении (Free) / hi-res (Pro) | Есть |
| **DXF** | Импорт в CAD (AutoCAD, Revit, SketchUp) | Есть (явно подтверждено в обзорах) |
| **DWG** | Прямой импорт в AutoCAD | Заявлено / в стадии раскатки на features-странице |
| **IFC / OBJ / FBX / GLTF** | BIM/3D-обмен | **Не поддерживаются** (нет упоминаний) |

Источники: [maket.ai/features](https://www.maket.ai/features), [illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html), [aibuildingtools](https://aibuildingtools.com/blog/best-generative-design-tools).

---

## E. Интеграции

- **CAD/BIM:** только через файловый экспорт (DXF/DWG → AutoCAD, Revit, SketchUp). **Прямого BIM-плагина нет** ([aibuildingtools](https://aibuildingtools.com/blog/best-generative-design-tools)).
- **API:** публичный API не задокументирован; для enterprise/студийных интеграций нужно обращаться напрямую.
- **OS:** SaaS — браузер, кросс-платформенно (macOS, Windows, Linux) ([10web](https://10web.io/ai-tools/maket/)).
- **Импорт референс-изображений:** PNG/JPG для рендеров.
- **Импорт зон-документов:** PDF, HTML, TXT, JSON, ZIP.

---

## F. Тарифы и бизнес-модель (по состоянию на 2026)

Maket работает на **кредитной модели**. Один этаж генерации = ~20 кредитов; один рендер = ~10 кредитов.

| План | Цена | Кредиты | Этажность | Разрешение | Дополнительно |
|---|---|---|---|---|---|
| **Free** | $0 | 50 one-time | 1 этаж | Preview / standard | Без банковской карты, ограниченный экспорт |
| **Plus / Pro** | **$20/мес** | 300/мес (refresh) | до 4 этажей | High-res экспорт | Multi-story, text-based optimization, можно докупать топ-ап пакеты |
| **Top-up pack** | от $10 | +150 кредитов | — | — | Не сгорают, переносятся |

> Месячные кредиты на Plus **не переносятся** на следующий месяц. Топ-апы — переносятся бессрочно ([maket.ai/pricing](https://www.maket.ai/pricing)).

В сторонних обзорах ранее встречались тарифы Pro $30/мес и Studio $99/мес (для команд из 5 пользователей) ([techvernia](https://techvernia.com/pages/reviews/architecture/maket-ai.html), [illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)) — это, по всей видимости, описание ценовой схемы **v1**. После релиза v2 структура упростилась до Free + Plus + Top-up.

**Enterprise-тарифа на сайте нет** — корпоративные сделки обсуждаются индивидуально.

---

## G. Сильные и слабые стороны

### Что хвалят

1. **Скорость.** «Десятки вариантов за минуту» — реальное конкурентное преимущество для concept-стадии ([illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)).
2. **Низкий порог входа.** Текстовые промпты, не нужен CAD-опыт.
3. **Цена.** $20/мес — самый дешёвый dedicated generative-design tool среди конкурентов ([aibuildingtools](https://aibuildingtools.com/blog/best-generative-design-tools)).
4. **Free-тариф** для теста без карты.
5. **DXF-экспорт** в CAD-цепочку.
6. **AI Editing v2** — действительно ощутимое улучшение UX по сравнению с «перегенерируй заново».
7. **Generous trial + clean UI**, описывается как «easy to pick up».

### На что жалуются

1. **Spatial reasoning.** Пользователи отмечают «странные пропорции, неудобную циркуляцию, коридоры впустую» ([illustrarch](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)).
2. **Trustpilot — 2,3/5** (на момент начала 2026, на ~7 отзывах). Жалобы: «парковка машин внутри дома», «комнаты без смысла» ([Trustpilot](https://www.trustpilot.com/review/maket.ai)).
3. **Прожорливость по кредитам.** «300 кредитов за 20 минут» — каждая генерация по 60 кредитов в репортах пользователей.
4. **Ограниченное редактирование** на v1 (фиксится в v2 чатом).
5. **Нет полноценного BIM** и нет IFC.
6. **Только residential** — коммерческие и общественные здания не поддерживаются.
7. **Сложная отписка** — обязательный опросник при cancellation.
8. **Качество рендеров не всегда соответствует маркетинговым материалам** — частая претензия.
9. **Zoning-инструмент не имеет live-базы кодов**, всё опирается на загруженный PDF.

---

## H. Конкуренты и позиционирование

| Инструмент | Сегмент | Подход | Где сильнее Maket / где слабее |
|---|---|---|---|
| **TestFit** | Real-estate feasibility (multifamily, hotels, parking) | Параметрическое реальное-время | TestFit сильнее в site planning и финансовых метриках; Maket дешевле и проще для residential |
| **Finch 3D** | Optimization-driven design | Constraint-based | Finch — про оптимизацию существующей идеи; Maket — про creative generation из текста |
| **ARCHITEChTURES** | Жилые многоэтажки, BIM | Generative + BIM-export | ARCHITEChTURES глубже по BIM; Maket доступнее для small firms |
| **Hypar** | Generative для проф. бюро (компонентная сборка) | Functions + Workflows | Hypar — для разработчиков/computational designers; Maket — для not-coders |
| **Spacemaker / Autodesk Forma** | Master-planning, urban | Cloud-based generative | Forma масштабнее, для urban scale; Maket — single-lot residential |
| **SWAPP** | Construction documentation (BIM) | AI-assisted CD | SWAPP — про CD/DD; Maket — про SD (schematic) |
| **ARK / Snaptrude / Archilabs** | BIM-первого-дня, browser-based | Real-time modeling | Snaptrude — полноценный browser-BIM; Maket — узкий концепт-инструмент |

Сводный вывод сравнений 2026: **Maket — лучший entry-level/budget-friendly инструмент для residential ideation**, но для серьёзной DD/CD-фазы требуется CAD/BIM-стек, в который Maket экспортирует через DXF/DWG ([aibuildingtools](https://aibuildingtools.com/blog/best-generative-design-tools), [aicreativeblog](https://aicreativeblog.com/maket-ai-vs-finch-3d-comparison), [coursiv](https://coursiv.io/blog/best-ai-tools-for-architects-2026)).

---

## I. Итоговый вердикт

Maket — это **«AI-эскизница для жилой архитектуры»**: быстро, дёшево, доступно домовладельцам и малым бюро; даёт 70–75 % schematic-фазы. Стратегия 2026 года — добавлять профессиональные слои (zoning verification, HVAC, material takeoff) и расширять воронку от homeowners к Custom Home Builders. Главные риски — качество spatial reasoning, тонкая цена кредитов и репутационные минусы на Trustpilot. Для команды, которая делает альтернативный продукт (например, **plana**), Maket — это benchmark «дешёвого AI-конкурента», от которого нужно отстраиваться: либо лучшим геометрическим качеством плана, либо нормоконтролем по live-БД кодов, либо глубокой BIM-интеграцией.

---

## Источники

- [maket.ai — главная](https://www.maket.ai/)
- [maket.ai — Features](https://www.maket.ai/features)
- [maket.ai — Pricing](https://www.maket.ai/pricing)
- [maket.ai — блог: AI-рендеры по text-промпту](https://www.maket.ai/blog/create-renders-using-ai-and-a-text-prompt)
- [maket.ai — блог: что делает AI home design в 2026](https://www.maket.ai/blog/what-does-ai-home-design-software-actually-do-in-2026)
- [maket.ai — Zoning Regulations](https://www.maket.ai/post/makets-zoning-regulations-simplifying-zoning-compliance)
- [TechFundingNews — «ChatGPT for architecture» raises $3.4M CAD](https://techfundingnews.com/montreal-maket-chatgpt-architecture-raises-3-7m-cad/)
- [BetaKit — Maket secures $3.4M](https://betakit.com/maket-secures-3-4-million-to-make-floor-planning-quicker-with-ai/)
- [TestingCatalog — AI Editing в Maket](https://www.testingcatalog.com/maket-ai-now-can-edit-your-floor-plans-in-realtime/)
- [Illustrarch — Maket.ai Review 2026](https://illustrarch.com/articles/design-softwares/73352-maket-ai-review.html)
- [Promeai — Maket.ai Review 2026: AI Space Planning](https://www.promeai.pro/blog/maket-ai-review-2026-architecture/)
- [Techvernia — Maket AI Review](https://techvernia.com/pages/reviews/architecture/maket-ai.html)
- [10web — Maket Review](https://10web.io/ai-tools/maket/)
- [AI Building Tools — Best Generative Design Software 2026](https://aibuildingtools.com/blog/best-generative-design-tools)
- [AI Building Tools — Maket Review (Free Tier)](https://aibuildingtools.com/tools/maket)
- [Trustpilot — Maket Reviews](https://www.trustpilot.com/review/maket.ai)
- [AI Creative Blog — Maket vs Finch 3D](https://aicreativeblog.com/maket-ai-vs-finch-3d-comparison)
- [Coursiv — 17 Best AI Tools for Architects 2026](https://coursiv.io/blog/best-ai-tools-for-architects-2026)
- [LinkedIn — Patrick Murphy (CEO, Maket)](https://ca.linkedin.com/in/patrick-murphy-2685114a)
