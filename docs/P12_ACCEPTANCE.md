# P12 reports, exports and the admin panel

Owner approval: 2026-10-09 (P12 started while P10 is being finished by the second agent).

Status: DONE (2026-10-10). Backend and frontend are implemented; full verification,
isolated browser acceptance and generated API type drift checks passed.

Continuation authorized on 2026-10-10. The P11 preference-checkbox CI regression was
fixed and committed separately as `a0cd8ac` before resuming P12. P11's real-account
Telegram acceptance remains outside this P12 acceptance record.

## Implemented scope

### Reports (§1)

Twelve reports live in one registry (`app/modules/reports/domain.py`) that states, for
each of them, which organization type it belongs to, the permission it needs, its
columns and whether a period applies. The API (`GET /reports/{code}`) and the export
writer both read that registry and call the same query builder, so RPT-005 holds by
construction rather than by convention. Financial figures - receivables aging, store
debt and every dashboard money figure - come from `FinanceService.balances_query` and
`summary`, never from a parallel sum over orders (RPT-002). Periods are local
`Asia/Dushanbe` days, at most 366 of them, defaulting to the last thirty
(`report_range_too_large`, RPT-003). A report belonging to the other organization type
answers 404, and one the member's role may not read answers 403 (RPT-001, SEC-007).

New permissions: `reports.sales`, `reports.funnel`, `reports.finance`,
`reports.returns`, `reports.delivery`, `reports.inventory` (company) and
`reports.purchases`, `reports.debt` (store). They follow the "who" column of §1.2: an
operator sees the funnel, a warehouse role the stock reports, and the money reports
stay with the owner and the manager.

`GET /dashboard` answers the figures of §1.3 for the active organization. Each figure
is gated by the permission that opens the screen it links to, and a figure the member
may not read is absent from the answer rather than zero. The store's today list names
its stops; the handover code beside each one is fetched from that order's own delivery
endpoint, so the code never travels inside a list payload (DEL-012).

### Exports (§2)

`POST /exports` answers 202 and stores the request; the `heavy` Celery queue builds the
file (`tezfarmo.process_exports`). Report codes and the raw-data kinds (`orders`,
`products`, `prices`, `stock`, `statement`, and `audit_logs` for the platform) resolve
through one target table, and the permission required is the permission that reads the
same data in the API - checked when the request is made and again when the download URL
is asked for (EXP-001, EXP-002). Raw-data exports stream from the database rather than
materialising the result set; the ceiling is 200 000 rows and ten minutes, after which
the row is FAILED (EXP-005), and a run whose worker disappeared is failed on the next
pass instead of staying RUNNING. CSV is UTF-8 with a BOM, `;` separated, money with a
dot; XLSX is written with openpyxl's write-only workbook and money is a number with the
`#,##0.00` format (EXP-006). Headings are translated into the requester's language from
the backend catalogs, so a column heading reads the same in the API, in the file and in
the UI (EXP-007). The download is a 15-minute signed URL and every download is audited
(EXP-003); a file is deleted seven days after it was ready and the row becomes EXPIRED,
answering 410 (EXP-004). `export_create` is limited to 20 requests per organization per
hour, and `EXPORT_READY` notifies the member who asked (EXP-008).

An admin export has no organization, so it is owned by the superadmin who requested it;
the `stored_files` owner constraint was widened to allow exactly that one case.

### Admin (§3)

`/api/v1/admin/*` endpoints for ADM-001 (platform dashboard: organizations and
subscriptions by status, MRR, verification queue, outbox failures, reconciliation
issues and 24-hour notification failures), ADM-002 (user search, detail with
memberships, block/unblock with `token_version` bump and session revocation, logout-all),
ADM-003 (organization search and detail, the P02 §2.2 status machine, ownership
transfer that keeps exactly one active owner, legal-field correction with optimistic
concurrency), ADM-006 (audit viewer with filters plus a CSV/XLSX export through the
export queue), ADM-007 (outbox list and retry), ADM-008 (notification delivery
failures) and ADM-010 (read-only order list and partnership statement, each read
audited with its reason). ADM-004, ADM-005 and ADM-009 were delivered in P02, P03 and
P09 and are reachable from the same panel. ADM-011 holds: there is no impersonation
endpoint, and a test asserts that none exists.

Every state-changing admin action requires a reason of at least ten characters
(`override_reason_required`) and is recorded with `actor_type = SUPERADMIN`; a
platform administrator is still created only through the CLI, never through the API.

The frontend provides the report registry, period/group filters, matching tables and
charts, CSV/XLSX requests and a paginated export list that polls pending work. Reports
and exports are visible to operators and warehouse members with the relevant report
permission. The admin panel includes the existing verification/subscription screens,
user and organization actions, old/new audit details, operational queues and support
reads of orders and partnership statements with a mandatory reason.

Migration: `20261009_0027`, following the P10 revision `20261009_p10_finalize`.

## Deliberate deviations

- **EXP-002 answers 403, not 404, for a revoked membership.** The request context
  (IAM-010) refuses a revoked membership before any export is looked up, so the file is
  unreachable one step earlier than the TZ sentence describes. A member of another
  organization does get 404, and a member who lost the data permission gets 403
  `permission_denied`. Both are covered by tests.
- **The diagrams are inline SVG, not recharts.** The sanctioned frontend stack (§3.2)
  does not list a charting library; recharts appears only in the §5 screen description.
  Both shapes the screen asks for - a line for a measure over time and bars for the
  aging buckets - are drawn against the design tokens, with a hover tooltip, a single
  series per chart and the same rows listed in the table underneath.
- **A P10 migration had to be corrected to run at all.** The uncommitted
  `20261009_p10_finalize` revision dropped a check constraint by its final name without
  `op.f(...)`, so Alembic's naming convention prefixed it a second time and a fresh
  database could not migrate. One line in that file was fixed; it is the second agent's
  file and is not part of the P12 commit.

## Validation record (2026-10-09)

- Clean Linux dependency installation, Ruff, strict mypy without cache, migration
  upgrade from an empty disposable database and Alembic model drift checks passed in
  the disposable CI project (`python scripts/check_backend_ci.py`).
- P12 backend suite passed: reports (18 cases), exports (17 cases) and admin (34
  cases), run both locally against real PostgreSQL, Redis and object storage and in
  the disposable Linux CI project.
- Traceability: every RPT, EXP and ADM requirement of the P12 section is mapped
  (`python scripts/check_traceability.py --complete-p12`), and `dev.py traceability`
  now enforces P12 as well.
- Full backend suite in the disposable CI project passed on 2026-10-10: **1736
  tests**, including permission, audit and notification-group changes to earlier parts.
- `python scripts/dev.py verify` passed on 2026-10-10: ESLint, TypeScript,
  Prettier, **462 Vitest tests**, production build and traceability, in addition to
  the complete disposable Linux backend checks and suite above.
- Isolated browser acceptance (`python scripts/check_p12_browser.py`) passed on
  2026-10-10 in disposable project `tezfarmo-p12-f4e0c60403`:
  the delivered-order figures on both dashboards, the sales report against a known
  fixture, the 366-day refusal, an export from request to signed download, the store
  side seeing only its own reports, the admin status change with its reason, the audit
  entry it produces, the ops screens, audited orders and statement reads, and report
  and admin layouts at 390/768/1440 pixels. The signed CSV contents were checked for
  BOM, semicolon separators and the known 57.00 total.
- RPT-004: all twelve API reports passed 20 paced requests each, with fixture p95
  **65.4–109.6 ms**, below two seconds. This small-fixture measurement does not claim
  production-scale performance; the production load gate belongs to P13.
- `python scripts/dev.py backend-ci` passed independently on 2026-10-10 before the
  frontend/CI completion commit.
- Generated API type drift check (`dev.py api-types` twice) passed on 2026-10-10;
  both generated files match the committed API contract.

## Part Acceptance (§7)

- [x] Every report of §1.2 with correct numbers from a known fixture (automated).
- [x] Export: request → ready → download → expiry (automated).
- [x] Admin: ADM-001..010, with ADM-004/005/009 reached through the parts that own them.
- [x] Dashboards for company and store.
- [x] [PART_REPORT.md](P12/PART_REPORT.md).
