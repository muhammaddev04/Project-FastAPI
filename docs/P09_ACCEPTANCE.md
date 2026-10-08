# P09 finance

Owner approval: 2026-10-08 (`p09 oghoz kun`).
Status: IN PROGRESS. P09 is not DONE.

## Backend foundation

The finance domain defines exact-cent payment validation, ledger directions,
Dushanbe due dates, deterministic FIFO allocation, charge states, aging,
net-balance credit checks and reminder scheduling. Allocation plans are pure
and preserve their inputs so posting and preview can share the same calculation.

Domain tests cover the mandatory 1000/700/500 and 1200 example, FIFO tie-breaking,
overpayments, boundaries and 200 reproducible generated allocation scenarios.
These scenarios do not replace the required Hypothesis test of persisted operations.

Validation: isolated clean Linux checks passed dependency compatibility, Ruff,
strict mypy without cache, fresh migrations and model drift. All 237 finance
domain tests passed against the isolated test harness. Evidence:
`p09-domain-ci.log` and `p09-backend-ci.log` (ignored local artifacts).
Full-part verify, browser acceptance and API drift are still pending.

## Database foundation

The registered ORM models and revision `20261008_0024` add charges, credits,
allocations, ledger entries, balance projections, payments and their history,
adjustments, credit notes, debt reminders and reconciliation issues. Companies
default to debt reminders enabled.

PostgreSQL protects immutable facts: ledger, allocation, credit-note, history and
reminder rows cannot be updated or deleted; charge/credit updates are restricted
to allocation projections, and final payments/adjustments are immutable.
Financial records must match their partnership's company/store, and allocations
must connect a charge and credit from that same partnership. Unique source keys,
ledger direction checks and allocation/status constraints are database-enforced.

Direct SQL database tests cover these protections, duplicate source and reminder
identities, and the permitted allocation projection update. These are foundation
tests, not acceptance of payment workflows or persisted FIN-002 invariants.

Validation: `python scripts/dev.py backend-ci` passed clean Linux dependency
compatibility, Ruff, strict mypy without cache, fresh migrations and model drift.
All 24 database protection tests passed in an isolated PostgreSQL/Redis/storage
project, including migration downgrade/upgrade and assertions of the actual
trigger/constraint error. All 237 existing finance domain tests also passed.
Local ignored evidence: `p09-models-retest.log` and
`p09-models-final-tests.log`. Full-part verify, browser acceptance and generated
API type drift checks remain pending.

## Remaining requirements

- Transactional FinanceService, locking, synchronous delivery charges and real CreditPort.
- Payments, approvals, adjustments, credit notes, history, audit and events.
- Tenant-scoped APIs, idempotency and courier offline PAYMENT_RECORD.
- Daily reminder/reconciliation workers and superadmin issue resolution.
- Company/store finance pages and courier cash recording.
- Database, concurrency, permission and Hypothesis tests of persisted operations.
- Complete verify, isolated browser acceptance and generated API type drift checks.
- Final acceptance evidence and PART_REPORT.md.

P10 remains unauthorized. Existing authentication behavior is preserved.
