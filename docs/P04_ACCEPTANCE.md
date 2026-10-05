# P04 catalog, pricing and Excel import — local acceptance

Owner approval: 2026-10-05. P05 is not authorized.

## Delivered behavior

Company catalog supports two-level categories, sorting, tenant-scoped product CRUD,
activation/deactivation, search/filter/order/pagination, optional private product images,
and base/sale units with three-language names. Products and base units are created together.
Unit codes/coefficient are immutable in PostgreSQL; the base unit stays active. Category,
SKU/barcode, image ownership and category depth constraints protect company isolation.
Active product usage now feeds the P03 subscription guard. Catalog writes, activation,
imports and product image uploads enforce permissions, organization status and subscription.

Pricing provides an automatic DEFAULT list, custom lists, current/future prices, immutable
history, future cancellation/restoration and fallback resolution. PostgreSQL exclusion
constraints prevent overlapping intervals. Company/list locks serialize concurrent first
prices and updates; a bulk change applies in one transaction. Sale units are priced independently.
The UI collects edits, previews old/new prices and percentage differences, then confirms.

Excel import accepts .xlsx up to 5 MB/5000 rows, localized templates with instructions,
private original-file storage, durable jobs, row/error pagination, product upsert, category
creation and prices through the same pricing service. Duplicate rows, invalid fields,
formulas, unknown units/lists and changing imported base units produce preview errors.
The state machine supports upload, validation, confirmation, completion/failure and cancellation.
Each run uses a savepoint: any error rolls back every catalog/pricing/audit business change,
then persists the failed job and event. Concurrent jobs skip locked organizations/jobs;
locks follow the API order. Beat polls committed job states every five seconds, avoiding
the uncommitted-row/broker-delivery race. P11 will deliver notification events.

Company UI includes products/forms, a unit dialog with live conversion, category tree/sorting,
price lists/matrix/history and the import wizard/history in TG/RU/EN. Warehouse can read the
catalog without prices; operators can read prices without edits. Store catalog remains P07.
Keys capture company identity; idempotent product/price/import-confirm requests also bind
their tenant/resource. Existing login/registration/reset behavior is preserved.

## Validation

- Complete backend regression: 1026 passed against isolated real PostgreSQL, Redis and S3.
- Final cross-module P04/worker/files/identity regression: 79 passed, including product image
  upload/attachment, denied operator uploads, blocked-subscription uploads and all write roles.
- Complete frontend regression: 384 passed. Focused catalog/navigation/public checks: 31 passed.
- Real P04 browser acceptance passed: create product, BOX24 unit, default price preview/save,
  asynchronous successful import/new category, and immutable-base-unit error preview.
  The browser found a stale row/error cache after UPLOADED → VALIDATED; query revision now
  follows job status so completed parsing always refreshes preview.
- All eleven P00–P04 browser scenarios passed together (3.7 minutes), including the existing
  auth/team/verification/subscription flows. Seven final catalog UI regression tests passed.
- Production build, Ruff, strict mypy, ESLint, TypeScript, locale checks and requirement
  traceability passed. Twelve tooling tests passed. CAT/PRC/IMP mappings are enforced in CI.
- Migration 20261005_0019 upgraded development from P03 without resetting data.
  Alembic check reports no new upgrade operations. Development workers use the built
  Excel-enabled backend image and read-only source binds; acceptance services are isolated.
  Read-only worker inspection confirms `tezfarmo.process_imports` is registered. A manual
  development-wide task invocation was rejected by automatic approval review because it
  could apply all queued imports; it was not executed. Real job execution is verified in
  the isolated acceptance stack instead.

## Integration boundaries

P05/P07 will implement the stock/order usage-reference port; current tests prove immutable
base units when the port reports activity. An unused base unit can be recreated before
additional sale units/prices exist; existing unit/price history is preserved. Stock import
is introduced in P05, Store ordering/catalog in P07. Remote CI is unverified until the
owner pushes. Formal status remains PARTIAL pending that CI; no push/done tag.
