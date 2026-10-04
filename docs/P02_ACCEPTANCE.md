# P02 local acceptance - 2026-10-04

Organizations and verification are implemented and locally accepted. Formal status remains
**PARTIAL** until the owner pushes the commits and required remote CI is green. No push or
`part-02-done` tag was performed. P03 requires a new owner approval.

## Accepted behavior

- Creating a Company or Store atomically creates its organization, profile and ACTIVE OWNER
  membership, audit records and domain events. Requests are idempotent. Company public codes
  use the required alphabet and retry actual unique-index collisions.
- The five-owned-organization limit serializes company/store creation by the same user.
  Tax identifiers are validated and unique; store coordinates are paired and range checked.
- Owners edit profiles; managers edit contact fields only. Approved and pending legal fields
  are locked. Concurrent updates check a freshly locked profile version; explicit null cannot
  clear required fields. Suspended organizations remain readable and reject mutations.
- Private verification uploads validate MIME, leading bytes and the 10 MB size limit, compute
  SHA-256 and sanitize display names. Uploads are audited.
- Only owners submit, with both company certificates or the store registration certificate.
  A partial unique constraint prevents multiple open requests. Legal snapshots are retained.
- SUPERADMIN reviews, approves as the assigned reviewer, or rejects with a reason. Owners
  see rejection and can submit a new request. Transitions update profile status, timestamps,
  versions, audit and events; review decisions serialize with profile edits.
- Owner and administrator downloads use a five-minute signed same-origin API URL in every
  environment. Docker's internal S3 hostname is never exposed to browsers. Missing, altered
  and expired grants are rejected; URL and content responses disable caching. Every admin
  document access is audited. Foreign organization documents return 404.
- Database triggers prevent deletion of verification files, document rows and requests.
- Admin document preview supports PDF and images in a modal and obtains a fresh audited URL
  on every open. Organization/profile mutations capture their own organization header so an
  organization switch cannot redirect an in-flight form action to another tenant.
- The typed trial starter is a transactional COMPANY_CREATED handler with a no-op P02
  implementation; P03 will supply real trial creation. Idempotent replay never calls it twice.

## Evidence

| Check | Result |
|---|---|
| Backend | Full suite: 848 passed. After the browser-discovered download fix, all 223 file/image/download/verification cases passed; final suspension/required-field/team checks: 56 passed. |
| Frontend | Full suite: 360 passed; final preview and organization-scope suite: eight passed, including two additional cases (362 distinct cases total). |
| Browser | All nine P00-P02 scenarios passed together. Company and Store each exercised create, upload, submit, signed preview/download, invalid grant rejection, review, reject, owner-visible reason, resubmit, approve and readonly legal fields. |
| Permissions/retention | All 42 P02 organization-role/permission cells tested through HTTP, alongside existing superadmin checks. All three retention triggers verified through PostgreSQL. |
| Static checks | Ruff lint/format, strict mypy across 73 app files, ESLint, TypeScript, Prettier and production build. |
| Tooling | Eleven tooling tests; all P00/P01/P02 requirement references valid; all 12 P02 IDs mapped. |
| Database/runtime | Migration downgrade/upgrade exercised by test sessions. Alembic reports no new upgrade operations. Seven isolated acceptance services healthy. No new schema migration was needed. |

The acceptance stack retains its `tezfarmo-p00` project name. Browser tests create fresh
verified owner fixtures only in its `tezfarmo_p00` database; the fixture factory refuses
other environments. Development and production data were not migrated or reset.

## Later-part contracts

Real trials and subscriptions belong to P03. Partnership activation enforces approval of
both organizations in P06 through the tested approval guard. Organization status changes,
ownership transfer and reason-audited SUPERADMIN legal overrides are explicitly assigned to
P12 (ADM-003). Retention policy/operations belong to P13. These later parts were not started.
The previously owner-approved authentication behavior remains unchanged.

## Reproduction

Start `docker compose -f docker-compose.test.yml up -d`, then run `scripts/dev.py verify`
with the virtual-environment Python. Run `python -m unittest discover -s scripts -p 'test_*.py'`.
For browser checks, start
`docker compose -p tezfarmo-p00 -f docker-compose.p00.yml up -d --build --wait`, install
Chromium with `cd frontend && npx playwright install chromium`, and run `npm run test:e2e`.
The browser fixture setup requires the Docker CLI. The remote acceptance gate awaits the
owner's push; passing local checks alone does not create a done tag.
