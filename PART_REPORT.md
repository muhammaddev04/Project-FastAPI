# Current progress — 2026-10-03

P00 remains PARTIAL. Added FND-010/012/013/022 infrastructure: transactional EventBus,
immutable outbox event data (migration `0016`), concurrent dispatch with row locks,
exponential retries and FAILED after eight attempts, Celery queues and periodic dispatch.
Local workers are available through the Docker Compose `jobs` profile; see README.
Consumers must deduplicate external effects by event_id. Missing consumers retry rather
than discard events. Registration (email and new Google accounts), Company/Store creation,
OWNER membership creation and verification submission/approval/rejection now publish events
in the business transaction. Payloads contain identifiers, not credentials or document contents.
Subscription and notification consumers remain pending in P03/P11; running the dispatcher
before those consumers exist eventually marks these events FAILED without deleting them.
S3 private-bucket readiness and daily expired-idempotency cleanup are implemented.

Validation: backend core suite 174 passed; Ruff lint and format passed; Celery configuration
loads; Docker Compose configuration validates. All seven event/outbox tests also passed,
including concurrent-worker dispatch and retry when no consumer is registered. These checks
do not establish a full P00 gate or a live worker/Beat deployment.

Latest validation: 116 relevant auth/organization/verification/health/outbox tests passed,
plus two organization-event tests covering duplicate requests and complete request rollback
when a synchronous event handler fails. Ruff lint and format passed.

P01 authentication is implemented (email registration/verification, login, refresh rotation,
logout/logout-all, password recovery/change, Google OAuth). Team mutations and invitations
remain missing. P02 organization profiles, files and verification workflow exist; complete
acceptance remains pending. P03–P13 business modules remain planned.

Other outstanding P00 work includes metrics, explicit UnitOfWork helpers,
traceability tooling, Makefile, and the remaining typecheck/acceptance gates. No production
migration or deployment was performed for this change.
Organization creation and verification submission now require Idempotency-Key and use the
transactional IdempotentRoute. Verification rechecks current org access and permission before
replay, and binds the request hash to the org. Frontend mutation hooks retain the key for the
same payload across retries until success, and rotate it when the payload/org changes. Keys
are in memory for the mounted form; persistence across reloads is not implemented.

Idempotency validation: 93 backend tests passed (organizations, verification, onboarding and
core idempotency); 17 frontend tests passed, including actual outgoing headers and key
rotation. Backend Ruff lint/format, frontend ESLint/typecheck and production build passed.
Existing frontend test warnings about React act/router flags and the large bundle remain.

---

# Historical report — P00 + P01 FOUNDATION and IDENTITY & ACCESS

The report below predates later authentication, storage, CI and verification work.

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
