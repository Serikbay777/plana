# Operating Model

## Цель

Инструменты должны ускорять принятые решения, а не принимать продуктовые
решения вместо команды.

## Источники истины

| Область | Источник истины |
|---|---|
| Product vision и scope | `docs/planning/` в репозитории |
| Исследования и интервью | Notion |
| Исполняемые задачи | GitHub Issues и Milestones |
| Код и технические решения | Git repository и pull requests |
| Ошибки production | Sentry |
| Реализованное поведение | Код, тесты и проверенный пользовательский сценарий |

Решение, принятое в Notion или разговоре, переносится в `DECISIONS.md`, если оно
меняет scope, архитектуру или обязательное поведение продукта.

## Роли инструментов

### Product Design

Использовать до реализации пользовательского шага:

- user journey;
- wireframes;
- состояния ошибок;
- проверка понятности интерфейса;
- дизайн критических сценариев.

Не использовать для маскировки неработающих функций красивым UI.

### Build Web Apps

Использовать после утверждения UX и API contract:

- реализация интерфейса;
- адаптивность;
- доступность;
- browser verification.

### OpenAI Developers

Использовать для AI-функций:

- выбор модели;
- structured outputs;
- evals;
- latency и стоимость;
- обработка ошибок и лимитов.

AI-функция без eval-набора не попадает в основной сценарий.

### Codex Security

Использовать на security checkpoints:

- auth;
- загрузка файлов;
- публичные API;
- фоновые задачи;
- production deployment;
- биллинг и командный доступ.

### GitHub

Использовать для исполнения:

- один milestone на фазу;
- issues из утверждённого backlog;
- pull request на небольшую законченную story;
- обязательные CI checks;
- release notes по пользовательскому поведению.

### Sentry

Использовать для эксплуатации:

- frontend и backend errors;
- release tracking;
- performance;
- import/export failures;
- AI provider failures.

Sentry issue не заменяет продуктовую аналитику или structured logs.

### Notion

Использовать для материалов, которые неудобно хранить в git:

- интервью;
- исследования рынка;
- нормативные источники;
- meeting notes;
- пилотные клиенты.

### Context7

Использовать во время реализации для проверки актуальной документации
библиотек. Решения, влияющие на архитектуру, всё равно фиксируются в репозитории.

### Ralph

Использовать только для маленьких утверждённых stories:

1. PRD утверждён.
2. Story имеет проверяемые acceptance criteria.
3. Базовые проверки зелёные.
4. Рабочее дерево чистое.
5. Используется отдельная ветка.
6. После выполнения проводится человеческий review.

## Delivery loop

```text
Research in Notion
  -> decision in docs/planning
  -> PRD
  -> GitHub milestone and issues
  -> design and API contract
  -> implementation
  -> tests and browser verification
  -> pull request review
  -> release
  -> Sentry and product metrics
  -> next decision
```

## Запрещённые сокращения

- создавать GitHub issues из неутверждённой идеи;
- запускать Ralph на крупной фазе целиком;
- считать документацию библиотеки архитектурным решением;
- выпускать UI без error states;
- выпускать AI-функцию без evals;
- считать отсутствие Sentry ошибок доказательством продуктовой ценности;
- хранить критические решения только в чате.

