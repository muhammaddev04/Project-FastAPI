# Project collaboration preferences

- Implement each TZ part in order: backend, frontend, tests and acceptance, then the next part.
- The owner authorizes local commits without asking again. Commit coherent, tested changes with Conventional Commits.
- Never push automatically. The owner performs git push.
- Before every backend commit run `python scripts/dev.py backend-ci` (also enforced by pre-commit): clean Linux dependencies, Ruff, strict mypy without cache, and upgrade/check migrations on an isolated disposable database. Docker must be running; never bypass a failed hook. Before completing a TZ part run `python scripts/dev.py verify`, isolated browser acceptance, and generated API type drift checks. Dependency version changes must pass these checks before committing.
- Report unfinished requirements honestly; a partial part is not DONE.
- Ask the owner before starting each next TZ part. P08 is authorized (2026-10-06); P09 and later require a new approval.
- Preserve the current login, registration password policy, email-code verification and password reset even where TZ differs. Duplicate registration must show that the email is already registered on the registration page.
