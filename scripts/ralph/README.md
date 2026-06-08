# Ralph for Plana

This directory contains Ralph-ready execution data for the approved Phase 1 PRD.

## Important

Do not run Ralph until Wave 0 in `docs/planning/ACTION_PLAN.md` is complete and
all baseline checks are green.

Ralph is intended for the small independent stories after repository bootstrap.
Human review is required after every story.

## Source documents

- `tasks/prd-stable-honest-mvp.md`
- `docs/planning/ACTION_PLAN.md`
- `docs/planning/QUALITY_GATES.md`
- `docs/planning/ARCHITECTURE_PRINCIPLES.md`

## Run prerequisites

- clean working tree;
- separate feature branch;
- authenticated Claude Code or Amp;
- `jq`;
- passing baseline checks.

## Run

From the repository root, after the prerequisites are satisfied:

```bash
cd scripts/ralph
./ralph.sh --tool claude 1
```

Start with one iteration and review the commit before increasing the iteration
count.
