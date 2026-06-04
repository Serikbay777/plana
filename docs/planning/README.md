# Plana Planning

Этот каталог фиксирует продуктовые и технические решения для развития Plana.
Он нужен, чтобы команда, AI-агенты и автоматизация работали над проверяемым
продуктом, а не расширяли демонстрационные функции без общей модели.

## Статус документов

| Документ | Назначение |
|---|---|
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | Для кого строится продукт и какую проблему решает |
| [MVP_SCOPE.md](MVP_SCOPE.md) | Что входит и не входит в первую коммерчески полезную версию |
| [USER_JOURNEY.md](USER_JOURNEY.md) | Основной пользовательский сценарий и UX-принципы |
| [ARCHITECTURE_PRINCIPLES.md](ARCHITECTURE_PRINCIPLES.md) | Источник истины, границы AI и технические правила |
| [AI_STRATEGY.md](AI_STRATEGY.md) | Как использовать AI без подмены геометрии и проверок |
| [VALIDATION_PLAN.md](VALIDATION_PLAN.md) | Как проверить продуктовую гипотезу на реальных кейсах |
| [DELIVERY_ROADMAP.md](DELIVERY_ROADMAP.md) | Фазы развития и критерии завершения |
| [ACTION_PLAN.md](ACTION_PLAN.md) | Исполняемый порядок работ для Phase 1 |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Какие доказательства нужны до признания функции готовой |
| [SECURITY_AND_OBSERVABILITY.md](SECURITY_AND_OBSERVABILITY.md) | Security, Sentry, эксплуатационные требования |
| [OPERATING_MODEL.md](OPERATING_MODEL.md) | Как использовать Notion, GitHub, плагины и Ralph |
| [BACKLOG.md](BACKLOG.md) | Приоритетный backlog до подготовки Ralph PRD |
| [DECISIONS.md](DECISIONS.md) | Открытые и принятые продуктовые решения |
| [FUNCTIONAL_AUDIT.md](FUNCTIONAL_AUDIT.md) | Аудит реальных функций: стоимость, история, PDF и действия UI |

Исполняемый PRD Phase 1: [`tasks/prd-stable-honest-mvp.md`](../../tasks/prd-stable-honest-mvp.md).

## Правила использования

1. `PRODUCT_VISION.md`, `MVP_SCOPE.md` и `DECISIONS.md` утверждаются founder/product owner.
2. Изменения архитектуры должны соответствовать `ARCHITECTURE_PRINCIPLES.md`.
3. Новая функция не считается готовой без требований из `QUALITY_GATES.md`.
4. Ralph запускается только по утверждённому PRD с маленькими независимыми stories.
5. Если код и документ расходятся, это фиксируется как проблема. Нельзя молча
   считать целевую архитектуру уже реализованной.

## Рабочие состояния

- **Now**: доказано кодом, тестами и рабочим пользовательским сценарием.
- **Next**: утверждено для ближайшей фазы.
- **Later**: направление развития, но не обещание пользователю.
- **Not verified**: функция существует, но её корректность не доказана.

## Инструменты и их роли

| Инструмент | Роль |
|---|---|
| Notion | Исследования пользователей, интервью, нормы, решения |
| GitHub | Issues, pull requests, milestones, CI и releases |
| Ralph | Выполнение утверждённых маленьких stories |
| Context7 | Актуальная документация библиотек во время реализации |
| Product Design | User journey, прототипы и UX-проверка |
| Build Web Apps | Реализация утверждённого интерфейса |
| OpenAI Developers | AI-функции с evals, лимитами и контролем стоимости |
| Codex Security | Threat modeling и security review |
| Sentry | Ошибки, производительность и эксплуатационные сигналы |
