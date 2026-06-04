# PRD: Stable Honest MVP

## 1. Introduction

Текущий Plana демонстрирует генерацию, редактирование, аналитику и экспорт, но
эти возможности не всегда используют одну сохранённую модель проекта. Некоторые
проверки, security-механизмы и quality checks неполны.

Phase 1 должен превратить прототип в стабильный и честный MVP-контур, на котором
можно безопасно строить дальнейшую AI-генерацию и CAD/BIM pipeline.

## 2. Product Assumptions

- Первый пользователь: девелопер или руководитель предпроектной проработки.
- Первая типология: многоквартирный жилой дом, типовой этаж.
- Результат: концептуальный типовой этаж плюс базовая модель здания.
- Основная ценность: сравнение вариантов по квартирографии, площади и
  предварительным ограничениям.
- DWG не входит в Phase 1.

## 3. Goals

- Сделать baseline checks зелёными и пригодными для CI.
- Исправить базовые auth и security-риски.
- Сохранять прогресс, результаты и введённые данные при переключении секций.
- Убрать видимые неработающие кнопки из основного пользовательского сценария.
- Открывать сохранённые результаты из истории.
- Сделать PDF-визуализацию восстановимым workspace.
- Считать предварительную стоимость от текущей модели здания.
- Сохранять `LayoutProject` как каноническую редактируемую модель.
- Обеспечить повторное открытие сохранённого layout.
- Считать метрики и создавать экспорты из текущей модели.
- Явно отличать проверенные, непроверенные и предварительные результаты.
- Сделать ошибки диагностируемыми через логи и Sentry.

## 4. Non-Goals

- Новый AI solver.
- Расширение генерации на новые типологии.
- Полный CAD-редактор.
- Семантический DXF, DWG или IFC import.
- DWG export.
- Полное нормативное согласование.
- Точная строительная смета.
- PostgreSQL, S3, биллинг и командные роли.

## 5. User Stories

### US-001: Restore backend boot and test discovery

**Description:** As a developer, I need the backend and test suite to start
reliably so that changes can be verified.

**Acceptance Criteria:**

- [ ] FastAPI application imports without the HTTP 204 response assertion.
- [ ] `python -m pytest tests -q` does not collect manual scripts.
- [ ] Existing backend tests run without collection errors.
- [ ] Tests pass.

### US-002: Restore static quality checks

**Description:** As a developer, I need baseline static checks to pass so that
automation does not compound existing errors.

**Acceptance Criteria:**

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `python -m ruff check plana_engine tests` passes.
- [ ] `python -m mypy plana_engine` passes.
- [ ] No unrelated behavior is changed to silence checks.

### US-003: Remove known dependency vulnerability

**Description:** As a product owner, I need known direct dependency
vulnerabilities resolved before pilot usage.

**Acceptance Criteria:**

- [ ] Next.js is updated to a compatible non-vulnerable version.
- [ ] `npm audit` no longer reports the known direct Next.js high severity issue.
- [ ] Frontend build and lint pass.

### US-004: Unify authentication contract

**Description:** As a user, I want protected application routes and API calls to
use a consistent session contract so that unauthorized access is blocked.

**Acceptance Criteria:**

- [ ] `/app` route protection uses the same session mechanism as authenticated API calls.
- [ ] Expired or missing authentication redirects or rejects consistently.
- [ ] Project endpoints enforce user ownership.
- [ ] Auth integration tests cover unauthorized and cross-user access.
- [ ] Security review is completed.

### US-005: Harden secrets and CORS

**Description:** As an operator, I need production configuration to fail safely
so that weak defaults are not deployed.

**Acceptance Criteria:**

- [ ] Production startup requires an explicit JWT secret.
- [ ] CORS origins are configurable and do not default to wildcard in production.
- [ ] Secrets are not logged.
- [ ] Configuration behavior is documented.
- [ ] Tests pass.

### US-006: Persist canonical LayoutProject

**Description:** As a user, I want my edited layout saved with the project so
that my work is not lost.

**Acceptance Criteria:**

- [ ] Project storage supports a versioned `LayoutProject` payload.
- [ ] API can save and return the current layout for its owner.
- [ ] Existing projects without a layout remain readable.
- [ ] Schema and migration behavior are documented.
- [ ] Backend tests cover create, save, read and ownership.

### US-014: Preserve editor state and make actions reliable

**Description:** As a user, I want generation progress, generated results and
my entered data to remain available when I switch sections so that navigation
does not destroy my work.

**Acceptance Criteria:**

- [ ] Switching editor sections does not reset an active generation operation.
- [ ] Returning to a section shows the latest generation progress, result or error.
- [ ] Selected variants, entered form data and local edits are not reset without an explicit user action.
- [ ] Every visible enabled button in the main workflow performs a clear action.
- [ ] Unsupported or unavailable actions are hidden or disabled with an explanation.
- [ ] Browser regression tests cover switching sections during and after generation.
- [ ] A browser audit records remaining unreliable actions.

### US-015: Open saved results from history

**Description:** As a user, I want to open every saved supported result from
history so that generated work is reusable.

**Acceptance Criteria:**

- [x] History category buttons change the visible list.
- [x] Saved AI plans, visualizations, site placement, PDF results and architectural drawing results open in the correct workspace.
- [x] History load failures are visible and retryable.
- [x] Opening a result does not silently destroy unsaved work.
- [x] Browser regression tests cover each supported result type.

### US-016: Persist PDF visualization workspace

**Description:** As a user, I want my PDF visualization workflow to survive
section changes and later project reopening.

**Acceptance Criteria:**

- [ ] Switching sections does not reset the uploaded PDF, page state or results.
- [ ] Source PDF, page metadata and generated assets can be restored for the project owner.
- [ ] Each page shows an honest status and supports retry after failure.
- [ ] File limits, ownership and retention behavior are documented.
- [ ] Browser test covers upload, generation, section switch, return and reopen.

### US-017: Derive investment cost from the current building model

**Description:** As a user, I want the preliminary investment cost to represent
the current building variant rather than the site dimensions.

**Acceptance Criteria:**

- [ ] Building GFA and footprint are derived from the current layout or building model.
- [ ] Changing site dimensions alone does not change building construction cost.
- [ ] Result shows rate source, region, price level, accuracy range and exclusions.
- [ ] Site works and other non-building categories are separate from building cost.
- [ ] UI does not call the result a certified or exact smeta.
- [ ] Tests cover model-derived GFA and variant comparison.

### US-007: Load and save layout in the editor

**Description:** As a user, I want the editor to reopen my saved layout so that
I can continue work later.

**Acceptance Criteria:**

- [ ] Editor loads the saved layout when opening a project.
- [ ] User can save edited layout.
- [ ] UI shows saving, saved, unsaved and error states.
- [ ] Reloading the page preserves the saved geometry.
- [ ] Verify in browser using the browser skill.

### US-008: Export DXF from the current layout

**Description:** As a user, I want DXF export to match my visible edited layout
so that I can continue work in CAD.

**Acceptance Criteria:**

- [ ] DXF export accepts or resolves the current saved layout.
- [ ] Export no longer rebuilds geometry only from original marketing inputs.
- [ ] A test modifies a room and verifies the exported geometry changes.
- [ ] Export communicates its conceptual detail level.
- [ ] Tests pass.

### US-009: Derive metrics and panels from the current layout

**Description:** As a user, I want analytics to match my visible layout so that
variant comparison is trustworthy.

**Acceptance Criteria:**

- [ ] Floor metrics use the current layout.
- [ ] Kvartirografiya uses the current layout where required data exists.
- [ ] Aggregate cost uses model-derived area and shows its accuracy disclaimer.
- [ ] Changing layout geometry updates affected values.
- [ ] Tests pass.
- [ ] Verify in browser using the browser skill.

### US-010: Show honest validation statuses

**Description:** As a user, I want to distinguish checked and unchecked
requirements so that I do not mistake missing validation for compliance.

**Acceptance Criteria:**

- [ ] Validation result contract supports `pass`, `warning`, `fail` and `not_checked`.
- [ ] UI does not show a green success state for checks that did not run.
- [ ] Preliminary checks are visibly labelled.
- [ ] Tests cover insufficient-data behavior.
- [ ] Verify in browser using the browser skill.

### US-011: Add correlation IDs and structured logs

**Description:** As an operator, I need requests and failures traceable across
the web proxy and engine so that incidents can be diagnosed.

**Acceptance Criteria:**

- [ ] Requests receive a correlation ID.
- [ ] Correlation ID is forwarded between Next.js and FastAPI.
- [ ] Backend logs include request ID, project ID where available, duration and status.
- [ ] Logs do not include secrets or tokens.
- [ ] Tests pass.

### US-012: Add Sentry error reporting

**Description:** As an operator, I need frontend and backend failures visible so
that pilot issues are not discovered only through users.

**Acceptance Criteria:**

- [ ] Frontend and backend Sentry configuration is environment-controlled.
- [ ] Releases and environments are attached to events.
- [ ] Auth tokens, secrets and uploaded file contents are not sent.
- [ ] A test error can be traced with its correlation ID.
- [ ] Setup and verification steps are documented.

### US-013: Add CI and browser smoke test

**Description:** As a team, we need automated checks for the main workflow so
that regressions are blocked before merge.

**Acceptance Criteria:**

- [ ] GitHub CI runs frontend build and lint.
- [ ] GitHub CI runs backend tests, Ruff and mypy.
- [ ] Browser smoke test covers opening a project, editing, saving, reloading and exporting.
- [ ] Pull requests cannot be considered ready while required checks fail.
- [ ] CI usage is documented.

## 6. Functional Requirements

- FR-1: The system must store a versioned canonical `LayoutProject`.
- FR-2: The editor must load and save the canonical project layout.
- FR-3: DXF export must represent the current layout.
- FR-4: Analytics must derive from the current model where data exists.
- FR-5: Validation must distinguish unchecked requirements.
- FR-6: Protected routes and project data must require consistent authentication.
- FR-7: Production configuration must not use weak secret or CORS defaults.
- FR-8: Errors must be traceable through correlation IDs, logs and Sentry.
- FR-9: CI must enforce baseline frontend and backend checks.
- FR-10: Internal editor navigation must preserve active operation state and results.
- FR-11: Visible enabled actions in the main workflow must perform a clear action.
- FR-12: Saved supported results must be openable from history.
- FR-13: PDF visualization must be a persistent project workspace.
- FR-14: Preliminary cost must derive from the current building model and versioned rate data.

## 7. UX Requirements

- Saving state is visible.
- Unsaved changes are visible.
- Export level of detail is visible.
- Cost accuracy is visible.
- Unchecked requirements are visible.
- Error states provide a recovery action where possible.
- Generation progress and results remain observable across section changes.
- Unavailable actions are disabled with a reason or removed from the MVP UI.

## 8. Security Requirements

- Project ownership is enforced server-side.
- Secrets are required and never logged.
- CORS is restricted in production.
- Sentry payloads exclude sensitive data.
- Security review is required for auth and pilot readiness.

## 9. Success Metrics

- Main workflow completes without manual database or file intervention.
- Switching sections during generation does not lose progress or results.
- The main workflow contains no visible enabled buttons without a working action.
- Saved layout survives reload and later reopening.
- Edited geometry is reflected in DXF export.
- Required CI checks pass on the release branch.
- Pilot errors can be diagnosed from logs and Sentry.

## 10. Open Questions

- Which exact validation rules are included in the first pilot?
- Which cost data source and accuracy range will be shown?
- Which real DXF file becomes the first export fixture?
- Is IFC required for the first pilot or only before commercial release?
