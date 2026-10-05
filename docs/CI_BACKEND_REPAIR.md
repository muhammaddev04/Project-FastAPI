# Backend CI repair — 2026-10-05

The backend jobs in runs [37306037470](https://github.com/muhammaddev04/Project-FastAPI/actions/runs/37306037470),
[37297537797](https://github.com/muhammaddev04/Project-FastAPI/actions/runs/37297537797),
and [37186731392](https://github.com/muhammaddev04/Project-FastAPI/actions/runs/37186731392)
failed at strict mypy. Ruff passed; migration and pytest steps were skipped.
Deployment was correctly withheld because CI was unsuccessful. The latest run's frontend,
browser acceptance and deployment configuration jobs succeeded.

A clean Python 3.12 Linux install reproduced five errors: the email-token return type,
verification's two-entity select and catalog's two-entity select. Local Windows mypy passed
even with its incremental cache disabled. The unbounded SQLAlchemy requirement resolved
to **2.1.3 in Linux**, whereas the local environment had **2.0.54**. The newer library's
query typing differs. Both dependency manifests now explicitly use the tested SQLAlchemy
2.0.54 and Alembic 1.20.0; Ruff 0.16.8 and mypy 2.4.0 are also pinned. No auth behavior,
query logic, migration history or strict-checking rules were changed to hide the errors.

## Prevention

- `python scripts/dev.py backend-ci` builds the Linux validation image from the same
  requirements as GitHub Actions and checks package consistency, Ruff, strict mypy without
  incremental caching, `alembic upgrade head`, and `alembic check`.
- The installed pre-commit hook runs this gate for backend and related tooling changes.
  Docker must be running; failed checks must be fixed before committing.
- `python scripts/dev.py backend-ci-tests` adds all backend tests. `verify` uses this
  Linux test command instead of relying only on the local Windows environment.
- Every invocation creates a uniquely named Compose project, with an ephemeral PostgreSQL
  database and no published ports, persistent database volumes or application `.env` mount.
  It does not migrate/reset the development or production database. Resources are cleaned
  up after success or failure.
- Tooling regression tests check matching pinned versions, required gates and isolation.
  `backend/constraints.txt` records the complete validated dependency set. CI requirements,
  the Linux gate and production image installs all use it; update it explicitly when upgrading.
  CI logs its installed dependency versions and checks package consistency for diagnosis.
- Before finishing each TZ part, also run the frontend checks, generated API drift check
  and isolated browser acceptance, as recorded in `AGENTS.md`.

## Validation

Clean Linux: Ruff passed (167 Python files formatted), strict nonincremental mypy passed
(85 application files), all migrations through `20261005_0019` applied, and Alembic found
no model/schema drift. **1032 backend tests passed in 542 seconds.** Seventeen tooling
regression tests passed; local lint, requirement traceability and generated API type drift
checks passed. The constraints also resolved successfully in a Windows pip dry run.
The constrained production backend image built successfully; its package consistency
check and Alembic CLI smoke check passed.

Local validation does not deploy production. The owner pushes the fix; a green CI run on
that exact commit is still required before the existing deployment workflow runs. P05 is
not started by this repair.
