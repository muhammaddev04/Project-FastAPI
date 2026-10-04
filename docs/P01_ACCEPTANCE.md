# P01 local acceptance - 2026-10-04

Team and invitation implementation is locally accepted. Overall P01 remains **PARTIAL**:
the existing authentication product behavior differs from IAM-001/002/003/015, and green
remote CI is still unverified. No push or `part-01-done` tag was performed. P02 is not authorized.

## Implemented

- Invitation storage and migration 0017: case-insensitive uniqueness for pending org/email
  pairs, role constraints, seven-day expiry and hourly Celery cleanup. Expiry is audited.
- Owner-only invitations and role changes; owner/self protections; company/store role
  restrictions; optimistic membership versions and organization locks for concurrent changes.
- Email-bound inbox, accept, decline and revoke. Acceptance and reactivation call the typed
  subscription guard; its permissive P01 implementation awaits real limits in P03.
- Suspend, reactivate, revoke and non-owner leave, with audit records and the specified
  domain events. The next request reads membership state directly from PostgreSQL.
- Idempotent invitation creation and acceptance; failed email delivery rolls back invitation,
  audit and outbox writes. Direct delivery has a five-second timeout.
- Trusted `create-superadmin` CLI creates new verified accounts and refuses existing users;
  passwords are entered privately. No public superadmin-assignment endpoint was introduced.
- Frontend team actions, history, inbox badge, onboarding inbox and profile leave action;
  confirmation dialogs, reason fields, loading/error states and TG/RU/EN translations.
- Generated API declarations and all 16 IAM requirement references. References establish
  test coverage of actual behavior; they do not prove exact specification compliance.

## Validation

| Check | Local evidence |
|---|---|
| Backend regression | Initial full run: 791 passed, one obsolete response-field assertion failed; corrected contract/email suite: 37 passed; final team suite: 50 passed. Together, all 793 distinct current backend cases passed. |
| Frontend regression | Full suite: 357 passed; final inbox suite: two additional passing cases (359 distinct cases). |
| Browser | Five P00 real-API scenarios passed; P01 real-API lifecycle passed separately, including hidden manager mutations and immediate suspension enforcement. Test setup cleans up its own cross-membership and pending invitations. |
| Static checks | Ruff lint/format, strict mypy across 72 app files, ESLint, TypeScript, Prettier and production build. |
| Tooling | Ten tooling tests; complete P00/P01 reference check; zero missing error locale keys. |
| Migration/runtime | Test sessions reverse migrations to base and upgrade to head. Migration 0017 applied to the isolated acceptance stack; `alembic check` reports no new operations; seven services healthy. |

The local acceptance stack keeps the existing `tezfarmo-p00` project name and disposable
demo accounts. Development data was not migrated or reset.

## Authentication differences still requiring resolution

Current behavior was preserved while implementing the missing team functionality:

- IAM-001/002: email confirmation uses a six-digit code, valid for 15 minutes, and returns
  a session (`200`) for onboarding. TZ requires a verification link followed by `204` and login.
- IAM-003: password policy is 4-128 characters; TZ requires at least eight characters,
  a letter and digit, and rejection against the common-password list.
- IAM-015: reset uses an emailed code followed by a short-lived reset authorization,
  rather than the link-only flow in TZ. Single use and session invalidation are tested.
- IAM-009: rejection of blocked users is implemented and tested. The administrative
  block/unblock action remains in its explicitly assigned P12 scope.

No response to the optional authentication preference question was received during this work.
These differences are reported explicitly rather than silently replacing existing behavior.
Do not label P01 fully compliant or create its done tag until they are resolved and remote CI passes.

## Reproduction

Run `scripts/dev.py verify` with the virtual-environment Python after starting the isolated
test dependencies with `docker compose -f docker-compose.test.yml up -d`.
Run `python -m unittest discover -s scripts -p 'test_*.py'` from that environment.
For browser checks, start `docker compose -p tezfarmo-p00 -f docker-compose.p00.yml up -d --build --wait`,
install Chromium with `cd frontend && npx playwright install chromium`, then run `npm run test:e2e`.
See README for the private superadmin CLI and demo credentials.
