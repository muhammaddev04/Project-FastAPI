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

## Remaining requirements

- Backend models, immutable database triggers and migrations.
- Transactional FinanceService, locking, synchronous delivery charges and real CreditPort.
- Payments, approvals, adjustments, credit notes, history, audit and events.
- Tenant-scoped APIs, idempotency and courier offline PAYMENT_RECORD.
- Daily reminder/reconciliation workers and superadmin issue resolution.
- Company/store finance pages and courier cash recording.
- Database, concurrency, permission and Hypothesis tests of persisted operations.
- Complete verify, isolated browser acceptance and generated API type drift checks.
- Final acceptance evidence and PART_REPORT.md.

P10 remains unauthorized. Existing authentication behavior is preserved.
