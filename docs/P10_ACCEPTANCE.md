# P10 returns and disputes

Owner approval: 2026-10-08.
Status: IN PROGRESS. P10 is not DONE.

## Domain foundation

`app/modules/returns/domain.py` holds the P10 calculations as pure functions, so a
preview and a posting share one implementation and neither can drift from the other.

Returns: the order must be DELIVERED, DISPUTED or COMPLETED (RET-001); the window is
`delivered_at + return_days` with `return_days = 0` forbidding returns outright
(RET-002); a line may not exceed its delivered quantity less every earlier accepted
return, and the requested/approved/received/accepted/restock ladder is bounded at each
step (RET-003). Credit is `accepted x unit_price x (subtotal - discount) / subtotal`,
rounded once per line so a shared discount cannot drift, and the delivery fee is never
refunded (RET-010). Restock converts the order unit back to base units with the order's
own coefficient snapshot, and an accepted line with zero restock is damaged goods that
never reach the warehouse (RET-012).

Disputes: only a DELIVERED order inside `dispute_window_hours` can be disputed
(DSP-001); a payment can be disputed in any status for 30 days (DSP-002); a dispute
credit cannot exceed the order total (DSP-021); and the SLA warning returns the latest
due anchor, 48 hours after opening and every 24 hours after that, so a retry or a
concurrent run claims the same anchor instead of warning twice (DSP-024).

The unit fraction rule is deliberately left with `orders.service.check_quantity`, which
already owns it, rather than duplicated here.

Validation: 15 P10 domain tests passed, covering the TZ-named return and dispute cases
including the proportional-discount credit, the base-unit restock, both state machines
and the SLA anchor. Ruff lint and format, strict mypy over 122 source files and the
tracked reference manifest (RET-001/002/003/010/012, DSP-001/002/021/024) passed.

This is a calculation layer only. Nothing is persisted and no endpoint exists, so no
return or dispute workflow is available to a user.

## Database foundation

Revision `20261008_0025` adds `returns`, `return_items`, `return_status_history`,
`disputes` and `dispute_messages`. The dispute-to-return reference is created after
`returns` exists, because the two tables point at each other.

The database, not a read-then-write, enforces the rules that matter:

- One open return and one open dispute per order, as partial unique indexes over the
  open statuses (RET-004, DSP-003). A closed return frees the order for another attempt.
- The quantity ladder: approved <= requested, received <= approved, accepted <= received,
  restock <= accepted, and each later step requires the one before it (RET-003).
- `OTHER` must carry a note, a dispute description is at least 10 characters, a dispute
  has exactly one subject matching its target type, and a credit note can only hang off a
  completed return that earned credit.
- Returns and disputes are immutable except for the columns their state machine moves;
  a finished return and a closed dispute cannot be rewritten or deleted, and a return
  quantity, once decided, cannot be rewritten (the step can only be filled in).
- Status history and dispute messages are append-only through the core `forbid_mutation`
  guard, and a SYSTEM message has no user author (DSP-010, DSP-021).
- Both tables reuse the finance partnership-ownership trigger, so a record cannot be filed
  under a company or store that is not its own partnership.

Validation: 22 database protection tests passed against migrated PostgreSQL, asserting
the actual trigger and constraint errors through direct SQL. The migration applied from
an empty database, rolled back and re-applied, and `alembic check` reports no model
drift. Ruff and strict mypy over 123 source files passed.

These are foundation tests. No return or dispute workflow exists yet: there is still no
service, endpoint or screen, so nothing can create one of these rows in the product.

## Remaining work

- Services: the return state machine with credit-note and restock posting, dispute
  resolution including the three resolution types, and the real `OpenDisputePort`.
- APIs with idempotency keys, the P10 permission matrix, audit records and events.
- The SLA warning job.
- Store and company frontend, including the dispute chat with files.
- Tests for persisted behaviour, browser acceptance and the Part Acceptance report.

P11 workflows have not started. Existing authentication behavior is preserved.
