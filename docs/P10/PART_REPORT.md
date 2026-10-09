# P10 — returns and disputes

Owner approval: 2026-10-08. Status: DONE.

The implementation covers persisted return and dispute workflows, the tenant-scoped
API, both sides' screens, private evidence and durable SLA warnings. Detailed design
and validation evidence are recorded in [P10 acceptance](../P10_ACCEPTANCE.md).

- [x] Return request, approval, receipt, completion, credit note and balance reduction.
- [x] Restock uses base units; accepted damaged goods with zero restock stay off the shelf.
- [x] All three dispute resolutions and order completion are covered by backend tests.
- [x] Disputes do not directly post ledger entries; credit goes through finance approval.
- [x] Store and company screens, chat and private evidence passed isolated browser acceptance.
- [x] SLA claims deduplicate retries and survive transaction rollback correctly.
- [x] Generated API types are stable across successive generations.
- [x] python scripts/dev.py backend-ci passed on the P10/P11-only checkout.
- [x] P10 requirement references are checked by --complete-p10.
- [x] All verification stages: 1669 backend tests and 451 frontend tests; lint, strict
  typing, migrations, formatting, build and traceability passed. The verify command
  stopped at frontend formatting; after formatting-only fixes its remaining stages
  passed on rerun. Backend code remained unchanged.

DSP-023 explicitly assigns the SUPERADMIN read-only view to P12 and excludes MVP
escalation. P12 belongs to Claude and is outside this commit. Existing login,
registration, email verification and password-reset behavior is preserved.
