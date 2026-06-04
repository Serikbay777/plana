<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product planning guardrails

Before planning or implementing product work, read:

- `docs/planning/README.md`
- `docs/planning/MVP_SCOPE.md`
- `docs/planning/ARCHITECTURE_PRINCIPLES.md`
- `docs/planning/DECISIONS.md`
- `docs/planning/QUALITY_GATES.md`
- `docs/planning/ACTION_PLAN.md`

Do not treat target architecture, research notes, demo UI, or placeholder
endpoints as implemented product behavior. If a required product decision is
still open in `docs/planning/DECISIONS.md`, do not make it implicitly during
implementation. Ralph may only run against an approved PRD, on a clean feature
branch, with green baseline checks.
