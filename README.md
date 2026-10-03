# TezFarmo

B2B wholesale platform connecting **Companies** (suppliers/distributors) with **Stores**. The product specification is
[`TZ.md`](TZ.md); implementation follows its parts in order (P00 → P13). Current state: [`PART_REPORT.md`](PART_REPORT.md).

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), Alembic, PostgreSQL 16, Redis 7, argon2, PyJWT.
- **Frontend:** React 18, TypeScript (strict), Vite, Tailwind, React Router 6, TanStack Query, Zustand, React Hook Form + Zod,
  i18next (`tg` default, `ru`, `en`).

## Local development

Use `make up`, `make migrate`, `make test`, `make lint`, `make fe-test`, `make fe-lint`,
`make fe-build`, `make traceability` or `make verify`. `make makemigration name="add items"`
creates an Alembic revision. With no GNU Make installed on Windows, the equivalent command
is `.venv/Scripts/python.exe scripts/dev.py <task>`; pass `--name "add items"` for makemigration.
`verify` stops at the first failed check and never migrates or stops the development database.
Tests use the separate test services; start them with `docker compose -f docker-compose.test.yml up -d`.
`lint` runs Ruff and strict mypy. `make seed` creates repeatable development demo accounts
and refuses staging/production. `make api-types` regenerates the frontend API schema types.
Install commit hooks with `make hooks` or `.venv/Scripts/python.exe scripts/dev.py hooks`
after installing dev dependencies. The installer uses UTF-8 for Windows paths containing Cyrillic.

For the isolated P00 acceptance stack, run
`docker compose -p tezfarmo-p00 -f docker-compose.p00.yml up -d --build --wait`.
Open `http://127.0.0.1:15174`; the API is on `http://127.0.0.1:18001`.
Demo accounts are `p00-{company,store,courier,admin}@example.tj`, password `P00Demo2026!`.
These are disposable local fixtures. Run `make fe-e2e` (or `scripts/dev.py fe-e2e` with
the virtual-environment Python) after `cd frontend && npx playwright install chromium`.
The browser suite exercises the real API, all four areas, responsive widths and WCAG AA checks.
`verify` covers unit/integration checks; the browser suite and live service checks are separate.
See [P00 acceptance](docs/P00_ACCEPTANCE.md) for the exact evidence and remote CI gate.

```bash
# services: PostgreSQL :5433, Redis :6380
docker compose up -d

# backend (API on :8001)
python -m venv .venv && .venv/Scripts/pip install -e "backend[dev]"   # or: pip install -r backend/requirements.txt
cp .env.example backend/.env
cd backend && ../.venv/Scripts/python -m alembic upgrade head
../.venv/Scripts/python -m uvicorn app.main:app --port 8001

# frontend (:5174, proxies /api to :8001)
cd frontend && npm ci && npm run dev
```

## Support and feedback

The account menu offers **Support** beside Profile and Logout. Signed-in users can report bugs or send
feedback at `/support` using a type and description, optionally attaching a PNG, JPEG or WebP screenshot
(up to 5 MB). Screenshots are stored privately and visible to the author and platform superadmins.
Users see their own reports, status, and the support team's reply. Platform superadmins
review reports, reply, and set Open / In progress / Resolved at `/admin/support`.
Run `alembic upgrade head` in the backend environment to create the support table and multiple-image fields (migration `0015`). Existing screenshots are preserved. Each support report accepts multiple screenshots, with a 5 MB limit per image.
No additional environment variables are needed.

## Google sign-in

Create an OAuth client with application type **Web application** in Google Cloud's Google Auth Platform.
Configure its consent screen and add your Google account as a test user while the app is in testing.
Add `http://localhost:5174/auth/google/callback` as an authorized redirect URI, exactly matching
`GOOGLE_REDIRECT_URI` in `backend/.env`. Put the client's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
in that file and restart the backend. Keep the secret on the backend; `.env.example` contains no credentials.
`GET /api/v1/meta` should report `auth.google: true`, enabling **Continue with Google** on login and registration.
For deployment, use the site's HTTPS callback URL in both Google Cloud and the backend configuration.
Verified Gmail and Google Workspace addresses sign in to an existing account directly and link Google automatically,
without requiring password login or a visit to the profile. Other email providers require explicit linking for existing
accounts because Google cannot guarantee their current ownership. An existing Google identity is never replaced.

Email registration starts a session automatically after the six-digit verification code is accepted.
`POST /api/v1/auth/email/verify` returns the same `{access_token, expires_in, user}` response and session cookies
as login; new users continue to business onboarding without entering their password again.

Google setup reference: <https://developers.google.com/identity/openid-connect/openid-connect>.

## Background jobs (P00)

Local commits are authorized for coherent, tested changes; the owner pushes them (see `AGENTS.md`).

Apply migration `0016` before starting jobs. Start the local worker and scheduler with
`docker compose --profile jobs up -d celery-worker celery-beat`. The worker dispatches durable
outbox events every five seconds, with eight attempts and exponential backoff. Event data cannot
be updated or deleted; only delivery metadata can change. Events without a registered consumer
retry and eventually fail rather than silently disappearing. External consumers must deduplicate
side effects using `event_id`. Business modules will register their handlers as they are implemented.
For a worker outside Docker, configure `CELERY_BROKER_URL` (default `redis://localhost:6380/1`).
Registration, organization/OWNER membership creation and verification decisions publish events
transactionally. Subscription and notification consumers are pending in P03/P11: starting the
dispatcher now will retry these unhandled events and eventually mark them FAILED while keeping
their records. Celery Beat also purges expired idempotency records daily.
`/api/health/ready` checks PostgreSQL, Redis and the private S3 bucket. Provision the bucket before
using readiness as a deployment gate; the probe does not create it.

## Tests

`python scripts/check_traceability.py` checks the incremental requirement/test map in
`docs/traceability.json`; CI fails if a tracked requirement has a missing or renamed test.
This currently covers selected foundation requirements and does not establish full TZ coverage.

`GET /metrics` exposes per-process HTTP counters and accumulated request duration in Prometheus
text format. Labels use route templates; unmatched paths share one label. Direct requests are
restricted to loopback/private addresses. Install `infra/nginx/metrics.conf.example` in the public
Nginx configuration to block public proxy access; an optional loopback listener is shown for scraping.
This change does not modify the live Nginx configuration or install a metrics collector.

Organization creation (`POST /api/v1/organizations/companies`, `/stores`) and verification
submission (`POST /api/v1/verification`) require a UUID `Idempotency-Key` header. Retrying the
same payload with the same key returns the original result; changing the payload with that
key returns 409. Verification rechecks current permissions and tenant context before replay.
The frontend keeps a submission key across retries while the form is mounted and rotates it
after success or a changed payload. Reloading the page starts a new submission.

```bash
# backend tests use their own PostgreSQL :5434 and Redis :6381 (SQLite is not accepted, TZ 01_GLOBAL §14)
docker compose -f docker-compose.test.yml up -d
cd backend && ../.venv/Scripts/python -m pytest && ../.venv/Scripts/python -m ruff check .

cd frontend && npm test && npm run lint && npm run build
```

## Deployment

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every push to `main` and every pull
request; a green run on `main` triggers
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), which deploys that exact commit to
production. The runbook — one-time server setup, manual deployment, rollback and safety rules — is
[docs/deployment.md](docs/deployment.md).

Git rules (TZ 00_README §5): small Conventional Commits, no `git push` by tooling — the owner pushes.
