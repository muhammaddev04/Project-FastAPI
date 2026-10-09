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

## Services and P07/P09 integration

`ReturnService` drives the return state machine. A store requests a return against a
delivered order, the company approves per line, a warehouse member receives the goods and
the company completes it. Completing is the only step with money in it: the credit is
calculated once, written onto each line, posted as a credit note through the finance
service (its ledger entry and FIFO allocation included) and the restock part is returned
to stock in base units, all inside the caller's transaction (RET-010..012). The order
itself is never touched (RET-013). A return number comes from the core sequence
(`RET-2026-000001`), approving every line as zero is refused as a rejection, and the
completed row is written in one statement because the database then freezes it.

`DisputeService` keeps a dispute away from the ledger (DSP-020). Opening one marks the
order DISPUTED (T15); resolving it does nothing, asks finance for a credit adjustment, or
converts it into an approved return, and rejecting or withdrawing it also closes the order
(T17). An owner's credit resolves the dispute at once; a manager's leaves it under review
with the pending adjustment, and the owner's later approval or rejection finishes it
through the `ADJUSTMENT_APPROVED` / `ADJUSTMENT_REJECTED` handler, a rejection posting a
SYSTEM message into the chat (DSP-021). A converted return re-checks RET-003 but
deliberately not RET-002, because the dispute was opened inside the window (DSP-022).
`OpenDisputePort` is now real, so an open dispute holds its order open (DSP-004).

Two changes outside P10 were needed: P09's `reject_adjustment` now publishes
`ADJUSTMENT_REJECTED`, without which a waiting dispute could never learn the owner said
no; and P10 takes the company/subscription/partnership lock itself rather than through
`partners.locked`, because a warehouse member may receive a return but holds no partner
permission. The P10 permission matrix is in `app/core/permissions.py` and matches the TZ
table, including the operator who may review a dispute but not resolve it.

Validation: 22 service tests passed, covering the window and zero-day rule, the quantity
left after earlier returns, the credit with a shared order discount, the base-unit restock
and damaged goods, an untouched order, the real open-dispute port, a dispute that writes
no ledger row, all three DSP-021 paths, the converted return, a payment dispute leaving
its payment alone, returns working without a live subscription (RET-014) and the
permission matrix. The combined run of all 59 P10 tests with the P06-P09 regression passed
251 tests. Ruff and strict mypy over 125 source files passed, and the tracked manifest now
maps every P10 requirement except DSP-023 (no escalation exists in the MVP) and the parts
still to be built.

## API

The P10 endpoints of section 7 are served under `/api/v1`: the returnable lines of an
order, return list/detail/request, approve, reject, cancel, receive, completion preview
and complete, plus dispute list/detail/open, messages, start-review, resolve, reject and
withdraw. Every command requires an `Idempotency-Key`, and a replay returns the original
record instead of acting twice. Reads and writes are tenant scoped by company or store, so
another tenant's return is a 404 rather than a 403 (SEC-007). Lists use the project's
bounded pagination with a status filter and a deterministic tie breaker.

Cancelling is the one route open to both sides: the store cancels its own request without
explaining, the company must give a reason, and the service decides which permission
applies. The completion preview is a GET whose lines travel as repeated
`items=<return_item_id>:<accepted>:<restock>` parameters, and a malformed entry is a 422.

The dispute resolve body is `DisputeResolveIn` rather than `ResolveIn`: the finance module
already owns that name, and reusing it would have renamed P09's schema in the generated
frontend types. With that naming, regenerating `openapi.json` and `schema.d.ts` adds only
the P10 types and leaves every existing contract name untouched.

Validation: 10 API tests passed, covering the whole return workflow over HTTP (preview
20.00, credit note attached, four history rows), the required and replayed idempotency
key, a 404 for another tenant, refused store approval and company request, a version
conflict, store cancellation with list filters, the dispute workflow through to an owner
credit, a second dispute answered with `dispute_already_open`, payload rules for the
target reference and description, an operator who may review but not resolve, and the
malformed preview. All 70 P10 backend tests passed together (15 domain, 22 database, 23 service, 10 API). Frontend ESLint, TypeScript
and Prettier passed against the regenerated types.

## Remaining work

- A `DISPUTE` file category: `stored_files` has no such category yet, so a dispute photo
  cannot be uploaded for attachment even though a message can carry a file id.
- The SLA warning job (DSP-024 has its anchor but nothing emits the event yet).
- Store and company frontend, including the dispute chat with files.
- Tests for persisted behaviour, browser acceptance and the Part Acceptance report.

P11 workflows have not started. Existing authentication behavior is preserved.
