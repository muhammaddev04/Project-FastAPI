# Admin panel maintenance - 2026-10-10

The seven implemented platform screens were still rendered under the collapsed
"Planned" navigation group. They now appear as normal navigation beside the review
workflows. All twelve existing admin screens remain available.

Audit exports now preserve organization, actor, action, entity type, entity ID and
date filters. An unfiltered export includes the same history as the viewer rather
than silently defaulting to the current month. One-sided date filters and UTC date
boundaries follow the viewer. Tenant report/export period rules are unchanged.

The audit screen polls a new requester-only admin export status endpoint while an
export is pending or running. Download is enabled only for a ready, unexpired file;
failed and expired states are displayed. The download endpoint still enforces file
readiness, expiry and ownership independently of the frontend.

Regression coverage checks normal platform navigation, preservation of the action
filter, readiness polling, status ownership and the generated CSV against a filtered
audit viewer containing historical records. Isolated browser acceptance also downloads
the filtered audit CSV and checks that unrelated actions are absent.

Validation on 2026-10-10:

- Required `python scripts/dev.py backend-ci` passed: Linux dependency consistency,
  Ruff, strict mypy without cache, migrations from an empty disposable database and
  model drift check.
- Full backend suite: 1737 tests passed; full frontend suite: 464 tests passed.
- Frontend lint, strict typing and formatting passed.
- Isolated `python scripts/check_p12_browser.py` passed, including the new filtered
  audit download, admin operations and phone/tablet/desktop layouts.
- Generated API types matched repeated generation.
- Production build, traceability and full `python scripts/dev.py verify` passed.

No production database, server configuration or account privileges are changed by
this maintenance commit. No dependency or migration is needed.
