# P05 inventory and stock ledger

Owner approval: 2026-10-05. P06 requires separate approval.

## Delivered behavior

Company warehouse has tenant-scoped stock lists/details, available and reserved quantities,
low-stock filters and thresholds, barcode/SKU receipt entry, unit conversion previews,
confirmed inventory counts and write-offs, and filtered movement history in TG/RU/EN.
Manual writes enforce organization, subscription and role permissions. Operators can read;
warehouse users can receive and edit thresholds; couriers cannot access stock.

StockService owns all quantity changes. Receipt, count, write-off, reservation, release,
shipment and return operations update balances and append immutable movements in the same
transaction. Sorted product locks prevent inconsistent multi-product stock updates;
source locks serialize reservation retries and closing an order. Insufficient reservations
report every shortage and roll back the entire operation. Closing a reservation is repeatable.
Idempotency protects manual receipt, count and write-off requests.

STOCK Excel imports validate SKU, units and quantities before confirmation and use the same
stock writer during application. A failure rolls back every receipt, movement and audit
change. Imported receipts retain their import source. Existing product stock is backfilled
at zero during migration; newly created products get stock through PRODUCT_CREATED.

PostgreSQL enforces nonnegative balances, reserved <= quantity, tenant ownership and movement
immutability. Base-unit edits are refused after real stock activity. LOW_STOCK is emitted
transactionally at most once per product in 24 hours after a movement. Daily reconciliation
runs at 03:00 UTC+5, compares movement and active-reservation totals, emits mismatch events
and reports errors without changing stock.

## Validation

The final isolated inventory suite passed all 46 tests, including 50 simultaneous
reservations, reverse multi-product locking, idempotent closure, immutable database records,
all role permissions, subscription restrictions, low-stock cooldown, mismatch detection,
STOCK import success/rollback, tenant checks and migration backfill.

Linux dependency consistency, Ruff, strict mypy and fresh migration upgrade/model drift
checks passed. The focused frontend inventory/navigation suite passed all 15 tests.
Complete regression passed: 1078 backend tests and 390 frontend tests. All twelve P00-P05
browser scenarios passed together in 6.9 minutes. Eighteen tooling regressions, generated
API type drift, locale error keys and INV requirement traceability passed.

The real P05 browser flow passed: scan a barcode, receive 24 BOX24 as 576 PCS, configure
a low-stock threshold, count 500 PCS, write off one BOX24 to 476 PCS, filter low stock and
write-off movements, import two PCS asynchronously and verify the final 478 PCS. The
390px mobile view has no horizontal overflow. Browser acceptance caught and fixed missing
receipt units: product list responses omit units, so selecting a product now loads its detail.

Development upgraded from P04 without a reset. CI includes INV-001 through INV-010
traceability and browser acceptance; the pre-commit Linux migration gate remains mandatory.

## Integration boundaries

P07 will supply real order numbers and links through the OrderNumbers port and invoke the
reservation service from order workflows. P05 provides and tests those stock operations;
order screens are implemented in their authorized part. P11 will deliver low-stock
notifications from the durable event. Existing authentication behavior is preserved.

Remote CI and deployment remain unverified until the owner pushes. No push or DONE tag.
