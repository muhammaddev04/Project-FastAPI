# P00 + P01 — FOUNDATION and IDENTITY & ACCESS

## Status

- **P00 Foundation:** PARTIAL. Core layers needed by P01 are done. Missing: idempotency (FND-014), outbox, events, storage, Celery, CI and the traceability script.
- **P01 Identity & Access:** PARTIAL. Several security-critical flows are deferred (see *Known limitations*), so P01 is **not** DONE.

## Requirements

**Implemented, each with tests:**

| ID | What | Test(s) |
|---|---|---|
| FND-002/003 | Settings; production refuses weak secrets or debug | `tests/core/test_errors.py::test_fnd_002_*` |
| FND-004/010/015, AUD-001 | Async unit of work; append-only `audit_logs` trigger; redaction | `tests/core/test_audit.py` |
| FND-008/018/019, API-001 | Error envelope, tg/ru/en messages, X-Request-Id, masked logs | `tests/core/test_errors.py` |
| FND-016, SEC-006 | Redis sliding-window rate limits (P00 §4.1 table) | `tests/core/test_rate_limit.py` |
| FND-020 | `/api/health/live`, `/api/health/ready`, `/api/v1/meta` | `tests/core/test_health.py` |
| IAM-003 | Password policy (8–128, letter + digit, not in the 10k common list) | `tests/auth/test_password_policy.py` |
| IAM-005/009 | Access-token validation (typ, expiry, token_version, blocked user) | `tests/identity/test_me.py` |
| IAM-010/014, SEC-001/007 | `X-Org-Id` context: 400 / 404 (foreign) / 403 (blocked org, inactive membership) | `tests/identity/test_org_context.py` |
| P01 §5 | Permission registry + full `members.view` matrix | `test_permission_matrix_p01_members_view` |
| P01 §2.5 | Single OWNER; role must match org type (DB trigger) | `test_membership_*` |
| ORG-001/002/003 | Create Company/Store with OWNER membership; max 5 owned | `tests/organizations/test_create.py` |

**Deferred, not implemented:** IAM-001, IAM-002, IAM-004, IAM-006, IAM-007, IAM-008, IAM-011, IAM-012, IAM-013, IAM-015, IAM-016; FND-014; the owner's added requirements for e-mail verification and Google OAuth.

## Backend

- **Tables:** `audit_logs`, `users` (plus the owner-requested `email` / `email_verified_at`), `organizations`, `memberships`, `oauth_identities`. Migrations `0001` and `0002`.
- **Endpoints:**
  - `GET /api/health/live`, `GET /api/health/ready`
  - `GET /api/v1/meta` (includes which auth methods are enabled; all false today)
  - `GET /api/v1/me`, `PATCH /api/v1/me`
  - `GET /api/v1/members`
  - `POST /api/v1/organizations/companies`, `POST /api/v1/organizations/stores`

## Frontend

- **Routes:**
  - Auth: `/login`, `/register` (4 steps), `/reset`, `/auth/google/callback`
  - Account: `/welcome`, `/profile`
  - Company: `/company`, `/company/team`, `/company/:module`
  - Store: `/store`, `/store/team`, `/store/:module`
  - Courier: `/courier`
  - Status pages: `/403`, `/404`
- **Real API integration:** `/meta`, `/me`, `PATCH /me`, `/members` (with `X-Org-Id`), organization creation.
- **Auth screens:** they read `/meta` and state plainly that sign-in, registration, reset and Google are not enabled yet. Submit buttons stay disabled and no credentials are ever sent.
- **Shells and navigation:** role-aware per TZ §4.5 / §17 / §32.1. Modules from later phases open a "planned" page with no sample data.
- **i18n:** tg/ru/en with identical key sets, enforced by a test. Responsive layout verified at 390 / 768 / 1440 px (no horizontal overflow, no console errors).

## Tests

- **Backend:** 61 passed (pytest on real PostgreSQL + Redis); ruff check and ruff format are clean.
- **Frontend:** 65 passed (Vitest); `tsc -b`, ESLint and `vite build` are clean.
- **Integration:** checked through the Vite proxy against the running API: health, meta, localized 401 envelope, forged token, request-id echo, CORS refusal for a foreign origin.

## Git

- 22 local commits from `a55b746` to `10fd807` (plus this report).
- No push, no tag: the local tag `part-01-done` is withheld because P01 is not done.

## Known limitations

1. **Deferred because this session was stopped by a safety restriction:**
   - SMS verification codes (registration, reset, Google phone confirmation)
   - e-mail verification codes
   - session and refresh-token issuance, rotation and reuse detection
   - login, logout and logout-all
   - password reset and change
   - FND-014 idempotency, including the `Idempotency-Key` requirement on organization creation

   These need another implementation session. Until then no user can obtain a session, so the Company/Store shells are verified by component and integration tests only, not by a live sign-in.
2. **Frontend sign-out** only forgets the local in-memory session; server-side revocation depends on (1).
3. **Membership invitations and team management** (P01 §6 member mutations) are not implemented. The Team page is read-only.
4. **Google OAuth:** only the `oauth_identities` table and the disabled UI exist.
5. **Error code:** `organization_limit_reached` (ORG-003) is new and needs a CR entry in `changes/`.
6. **P00 items not yet built:** outbox, events, storage, Celery, CI workflow, traceability script and the Makefile.
7. **Build:** the production bundle is one chunk of about 530 kB; route-level code splitting is not done yet.

## Next Phase

Finish the deferred P01 items in (1). Then flip the corresponding flags in `backend/app/core/health.py::AUTH_METHODS`; the frontend screens enable themselves from `/meta`. Only then do the P01 acceptance and `part-01-done`, before P02.
