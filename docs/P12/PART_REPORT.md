# P12 — reports, exports and admin

Owner continuation authorized: 2026-10-10. Status: DONE.

The backend supplies twelve tenant-scoped reports from a shared API/export query
registry, permission-filtered dashboard figures, asynchronous CSV/XLSX exports and
the superadmin APIs. The frontend connects reports, exports, dashboards and the
platform panel, including reason dialogs, audit changes, operational queues and
audited support reads. Detailed evidence and deviations are in
[P12 acceptance](../P12_ACCEPTANCE.md).

- [x] All twelve reports against known fixtures; financial figures use FinanceService.
- [x] Export creation, worker processing, formats, permission rechecks and expiry.
- [x] ADM-001..010 API coverage; ADM-004/005/009 integrate earlier parts.
- [x] Company/store dashboard figures and report permission-aware navigation.
- [x] Backend CI and full suite: 1736 tests passed.
- [x] Frontend lint, strict typing, formatting and 462 tests passed.
- [x] API types match across two generations; traceability references pass.
- [x] Production build and full `python scripts/dev.py verify` passed.
- [x] Isolated browser acceptance of reports, export, admin and responsive layouts.
- [x] All twelve reports: 20 paced API requests each; fixture p95 65.4–109.6 ms.

The P11 preference checkbox CI failure was fixed first in local commit `a0cd8ac`.
P11's real Telegram account linking and outbound acceptance are still pending, as
recorded in its report; this report does not claim those steps complete. Report
latency measurements use a small isolated fixture, not production-scale load.
Existing authentication behavior is preserved. No push is performed.
