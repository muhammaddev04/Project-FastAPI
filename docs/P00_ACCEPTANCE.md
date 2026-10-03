# P00 acceptance checkpoint

This checkpoint records verified behavior and remaining requirements. P00 is PARTIAL.

Local validation: 727 backend tests in the full suite plus four separately added foundation
tests passed; all 347 frontend tests passed; four tooling unittest cases, lint, frontend
typecheck and traceability checks passed. The newest full backend run used real isolated
PostgreSQL/Redis/S3 services and exercised downgrade base → upgrade head.

| Area | Current evidence | Remaining acceptance |
|---|---|---|
| Transactions | UnitOfWork, event/audit rollback, idempotency atomicity tests | Full strict typing gate |
| Outbox | Immutable payload, locked dispatch, retries/FAILED tests | Live worker and Beat integration; consumer/replay lifecycle in P03/P11 |
| Health | PostgreSQL, Redis and S3 probes; Redis/S3 failure tests | All required runtime services healthy together |
| Migrations | Test fixture runs downgrade base → upgrade head on isolated test PostgreSQL | Production migration/deployment remains outside this checkpoint |
| Frontend | Router, shells, locale, API and component tests | Browser E2E/responsive acceptance for all four areas |
| Tooling | Makefile and portable Python runner; 30 IDs and 104 test references | API type generation, dev seed, full TZ traceability |
| CI | Workflow contains backend/frontend tests and traceability | Remote green CI; strict mypy is not installed/configured |
| Metrics | Internal-client tests; public-deny Nginx template | Install live Nginx restrictions and collector |
| Git | Local commits authorized; .env files are untracked | Complete history review for secrets; no automatic push |

Some mapped requirements remain partial: test references demonstrate specific behavior,
not full completion of every clause. Unmapped P00 IDs currently include FND-000 (hooks),
FND-023 (complete OpenAPI error contracts), FND-030 (frontend tooling), FND-038 (accessibility
and theme acceptance), and FND-040 (strict typing/remote CI). Do not mark this part DONE
solely because the local tests or reference checker pass.

Run local checks with `make verify` or `.venv/Scripts/python.exe scripts/dev.py verify`.
Start the isolated test services beforehand. This command does not start live job workers,
run browser E2E, inspect remote CI, deploy, migrate development data or establish the complete
P00 phase gate. See PART_REPORT.md for the latest run results.
