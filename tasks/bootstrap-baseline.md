# Bootstrap Baseline Checklist

## Цель

Сделать репозиторий пригодным для безопасной разработки и последующего запуска
Ralph. На этом этапе не добавляются новые продуктовые функции.

**Статус:** completed on 2026-06-04.

## Известное исходное состояние

По результатам технического аудита:

- `npm run build` проходит;
- `npm run lint` не проходит;
- `python -m pytest -q` собирает ручной скрипт `engine/scripts/phase1_curl_test.py`;
- `python -m pytest tests -q` блокируется FastAPI assertion для HTTP 204 endpoint;
- `python -m ruff check plana_engine tests` не проходит;
- `python -m mypy plana_engine` блокируется синтаксическим type comment;
- `npm audit` сообщает известную high severity проблему прямой зависимости Next.js.

Перед исправлением каждую проверку нужно повторить и сохранить актуальный
результат в progress log или issue.

## Правила

- не менять пользовательское поведение без необходимости;
- не смешивать независимые исправления в один commit;
- не отключать правило только ради зелёного статуса без объяснения;
- не запускать Ralph до полного завершения checklist;
- после каждого исправления запускать затронутую проверку и общий baseline.

## Task B-001. Исправить FastAPI boot blocker

**Статус:** completed.

### Контекст

DELETE endpoint проекта объявлен с HTTP 204, но текущая декларация ответа
конфликтует с требованиями FastAPI и блокирует импорт приложения.

### Acceptance Criteria

- FastAPI application импортируется без assertion.
- DELETE endpoint сохраняет корректную семантику HTTP 204.
- Добавлен или обновлён тест удаления проекта.
- `python -m pytest tests -q` переходит дальше collection.

## Task B-002. Исправить pytest discovery

**Статус:** completed.

### Контекст

Ручной curl script не должен собираться как автоматический pytest-тест.

### Acceptance Criteria

- Pytest по умолчанию собирает только поддерживаемые автоматические тесты.
- Ручной script остаётся доступным для ручного запуска.
- `python -m pytest -q` не требует запущенный backend только из-за manual script.

## Task B-003. Исправить mypy syntax blocker

**Статус:** completed.

### Контекст

Комментарий `# type: (total_m2, living_m2, label)` в `api/main.py` распознаётся
как некорректный type comment.

### Acceptance Criteria

- Mypy может полностью проанализировать пакет.
- Исправление не меняет runtime behavior.
- Новые mypy ошибки перечислены и разбиты на отдельные задачи при необходимости.

## Task B-004. Исправить Ruff baseline

**Статус:** completed.

### Acceptance Criteria

- Ruff ошибки исправлены небольшими логическими группами.
- Правила не отключены глобально без обоснования.
- `python -m ruff check plana_engine tests` проходит.

## Task B-005. Исправить frontend lint baseline

**Статус:** completed with zero lint errors. Existing warnings remain tracked as
non-blocking cleanup.

### Известные категории

- `Math.random()` во время render;
- `setState` в effects;
- доступ к ref во время render;
- предупреждения и ошибки в editor components.

### Acceptance Criteria

- Ошибки исправлены без изменения ожидаемого UX.
- `npm run lint` проходит.
- `npm run build` продолжает проходить.
- Изменённые UI-компоненты проверены в браузере.

## Task B-006. Исправить mypy baseline

**Статус:** completed.

### Acceptance Criteria

- Ошибки типизации исправлены или локально обоснованы.
- Не используются широкие игнорирования для сокрытия неизвестных типов.
- `python -m mypy plana_engine` проходит.

## Task B-007. Обновить Next.js

**Статус:** completed. Next.js and `eslint-config-next` are pinned to `16.2.7`;
safe transitive overrides remove the remaining npm audit findings.

### Acceptance Criteria

- Next.js обновлён до совместимой версии без известной прямой high severity проблемы.
- Проверены release notes и breaking changes.
- `npm audit` не сообщает исходную direct dependency проблему.
- `npm run lint` и `npm run build` проходят.

## Final Baseline Gate

```bash
npm run lint
npm run build
python -m pytest tests -q
python -m ruff check plana_engine tests
python -m mypy plana_engine
npm audit
```

После прохождения gate:

1. Зафиксировать результат в Phase 1 progress log.
2. Провести короткий review изменений.
3. Разрешить исполнение `scripts/ralph/prd.json`.

## Final Result

```text
npm run lint                         PASS, 0 errors
npm run build                        PASS, Next.js 16.2.7
python -m pytest tests -q             PASS, 68 tests
python -m ruff check plana_engine tests PASS
python -m mypy plana_engine           PASS, 54 source files
npm audit                             PASS, 0 vulnerabilities
local HTTP smoke                     PASS, frontend /, engine /health, Next.js /api/health proxy
```

Known non-blocking warnings:

- frontend lint reports existing unused/demo code and `<img>` optimization warnings;
- pytest reports `python-jose` use of deprecated `datetime.utcnow()`.
