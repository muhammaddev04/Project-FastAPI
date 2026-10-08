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

## Transactional service and P07/P08 integration

`FinanceService` posts ledger entries and updates the balance projection under a
partnership balance lock, following the existing company/subscription lock order.
Posting, deterministic FIFO allocation, history, audit and outbox events share
the caller's transaction. Savepoints undo a failed service operation even when
the caller catches its error.

Synchronous `ORDER_DELIVERED` handling creates one charge from the delivered
order's total and frozen credit days, using the Dushanbe date. Zero-total orders
are logged without a charge. Partnership activation initializes the projection;
first postings also initialize it safely. The real P07 CreditPort uses persisted
net balance, outstanding and unapplied credit when confirming orders.

Internal service operations implement pending/confirmed/rejected/cancelled
payments, company/store ownership checks, courier CASH/assigned-delivery checks,
current payment-method terms and the always-allowed PAYMENT subscription policy.
Owner/manager adjustments implement owner approval, immediate owner posting,
debit/credit/refund effects and refund credit checks at approval time. The P10
credit-note port exists and deduplicates its source; P10 workflows remain unauthorized.
Balance summaries include overdue and aging; FIFO previews calculate without
posting allocations. Finance errors use the TZ codes with meaningful tg/ru/en text.

Validation: mandatory `python scripts/dev.py backend-ci` passed dependency
compatibility, Ruff, strict uncached Linux typing, fresh migrations and model
drift. The final isolated finance run passed all 33 service/integration/permission
tests and all 237 domain tests. The P07/P08/partnership regression run passed all
114 existing tests. Coverage includes persisted FIN-034, prepayment allocation,
concurrent payments and first credit-note posting/source replay, owner approval,
refund checks at approval, current payment methods, terminal payment protection,
courier scope, cancelled-subscription collection, real order credit blocking,
frozen delivery terms/Dushanbe date, zero-total delivery, and rollback of both
finance posting and the delivery/order/stock transaction on event failure.
Local ignored evidence: `p09-service-tests.log` (regressions and an initial clock
fixture failure corrected in the final run) and `p09-service-final-tests.log`
(270 passed). This is backend service validation, not full P09 acceptance.

## Finance API and offline cash

Tenant-scoped summary, partnership balances, charge detail, FIFO preview and
Dushanbe-date statements are exposed through the P09 routes. Lists use bounded
pagination, deterministic tie breakers and validated filters. Aggregated balance
reads use one SQL snapshot without multiplying charge/credit joins. Statements
include the opening balance and an inclusive local end date.

Payment record/confirm/reject/cancel and adjustment create/approve/reject routes
require idempotency keys. Cached replies check current membership/permissions,
bind the tenant and resource into the request hash, and check the additional
confirmation permission before replaying a record-and-confirm request.
Store owners can report pending payments; confirmation remains company-only.
Superadmins can list and resolve reconciliation issues with an audit record.

Courier `PAYMENT_RECORD` accepts only amount and note for the courier's assigned
delivery, creates a pending CASH payment, and returns its payment ID. Replaying
the operation returns the original ID without another payment. Each offline
operation remains a separate transaction. The sync log retains only allowed
scalar payload fields, excluding extra and nested handover-code fields.

The finance response schema uses `FinancePaymentOut` to preserve the existing
subscription `PaymentOut` generated API contract. Frontend API types are updated;
finance screens and the courier cash interface remain unfinished.

Validation: the final mandatory `python scripts/dev.py backend-ci` passed
clean Linux dependencies, Ruff/format, strict uncached mypy (120 source files),
fresh migrations and zero model drift. The isolated combined run passed 79
finance API/service and delivery tests. After adding terminal-payment,
adjustment-decision and aging coverage and preserving the billing schema name,
the final isolated API run passed all 19 tests. Frontend lint, TypeScript
typecheck and formatting passed. Regenerating OpenAPI and API types produced
identical artifacts. Ignored local evidence: `p09-api-final-tests.log`,
`p09-api-complete-tests.log`, `p09-api-final-ci.log`.

This implementation checkpoint does not constitute browser acceptance or
completion of P09.

## Daily finance workers

Celery Beat schedules debt reminders at 09:00 and reconciliation at 03:30
Asia/Dushanbe (04:00 and 22:30 UTC). Standalone Celery installs the finance
handlers and real P07 credit port alongside the other domain modules.

Reminders cover one day before due, the first overdue day, and each seventh
day thereafter. They exclude paid charges, respect the company's opt-out,
and report only the outstanding amount. A unique reminder claim and its
outbox event share a transaction; concurrent runs and retries emit once.

Reconciliation follows the posting company lock order and checks projection
versus ledger, projection versus outstanding minus unapplied, allocation
totals for every charge and credit, positive delivered/disputed/completed
orders with a charge, and confirmed payments with a credit and ledger entry.
Each discrepancy creates an unresolved issue and durable event; the task
reports mismatches to Sentry after the transaction commits. It does not
repair financial rows, including missing balance projections.

The focused isolated run passed 12 finance/subscription worker tests,
including standalone Celery schedules/wiring/Sentry, reminder rollback and
concurrency, and deliberate disposable-database corruption for all six
reconciliation checks. Mandatory `python scripts/dev.py backend-ci` passed
clean Linux dependencies, Ruff/format, strict uncached typing and fresh
migrations without model drift. Local ignored evidence: `p09-worker-tests.log`
and `p09-worker-ci.log`.

The combined isolated run passed all 357 finance domain/model/service/API/job,
delivery and standalone subscription-worker tests. After adding explicit Sentry
initialization for a worker without FastAPI startup, the final focused run
passed all 12 worker tests and the final mandatory backend-ci passed strict
typing for 121 source files plus all dependency, formatting and migration
checks. Evidence: `p09-worker-final-tests.log`,
`p09-worker-standalone-tests.log`, `p09-worker-final-ci.log`.

## Remaining requirements

- Company/store finance pages and courier cash recording.
- Hypothesis tests of persisted operations.
- Complete verify, isolated browser acceptance and generated API type drift checks.
- Final acceptance evidence and PART_REPORT.md.

P10 remains unauthorized. Existing authentication behavior is preserved.
