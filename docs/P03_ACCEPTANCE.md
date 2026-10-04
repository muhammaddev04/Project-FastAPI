# P03 local acceptance - 2026-10-04

P03 subscriptions and limits are implemented and locally accepted. Formal status remains
**PARTIAL** until the owner pushes the commits and required remote CI is green. No push or
`part-03-done` tag is created. P04 requires a new owner approval.

## Implemented behavior

- Migration `0018` adds plans, company subscriptions, append-only payments/history,
  idempotent reminders and plan requests. It seeds START/STANDARD/LARGE with the TZ sample
  prices/limits. Existing companies receive a fresh 14-day STANDARD trial with history,
  audit and an outbox event. Bootstrap IDs are UUIDv7; the temporary helper is removed.
- New Company creation starts its trial synchronously inside COMPANY_CREATED publication.
  Company, trial, audit and events commit/roll back together. Duplicate publication does
  not create another subscription. Store remains free and has no subscription.
- One canonical lifecycle handles calendar-month renewal and every timed transition.
  Delayed jobs catch up all overdue stages without extending the original deadlines.
  Status transitions record history, audit and durable events; data is never removed as
  punishment. Payment/history UPDATE/DELETE and non-superadmin payment recording are
  rejected by PostgreSQL triggers.
- SUPERADMIN records positive TJS CASH/BANK_TRANSFER payments of 1–12 calendar months.
  Amount must match current plan price × months, or an explicit override reason is audited.
  A future ACTIVE paid period is extended from its end; otherwise renewal starts now.
  Payment resets cancellation and reactivates blocked/cancelled subscriptions. Paid
  amounts/periods retain their original values when the plan price changes.
- Payment and owner plan-request endpoints require Idempotency-Key. Replay rechecks current
  access. Concrete resource paths participate in the request hash, so reusing a payment
  key for another subscription returns 409 rather than replaying another company's payment.
- SubscriptionGuard exposes all ten SubAction categories across six states and typed usage
  limits. P01 invitation creation checks MEMBER_INVITE; acceptance/reactivation enforce
  real active-member counts (including OWNER). Store is exempt. Downgrade preserves all
  existing members, and finite limits block new additions; NULL means unlimited.
- OWNER toggles paid-period cancellation and creates plan requests. C.MANAGER views billing
  but cannot change it. Other company roles receive only a minimal status/allowed-actions
  endpoint for banners and buttons, without billing details. Admin lists/filter/searches
  subscriptions, inspects history/payments, changes plans, extends current trials, creates/
  edits plans with version checks, and approves/dismisses pending requests with audit.
- Celery registers subscription_tick every 15 minutes and subscription_reminders hourly.
  Workers use FOR UPDATE SKIP LOCKED. Reminder events are deduplicated by subscription,
  kind and anchor (7/3/1 days before expiry and GRACE/SOFT_BLOCK/FULL_BLOCK entry).
- Company settings show plan/status/dates, usage progress, payment history, owner controls
  and plan requests. Company banners explain restricted states. Team invitation/reactivation
  controls obey allowed_actions. Admin has functional subscription/plan/request screens,
  a payment preview and explicit confirmation. TG/RU/EN labels/errors are translated.
  The cancellation checkbox updates immediately, adopts the saved response and rolls back
  to the server value on failure.

## Validation evidence

- Initial complete backend regression: 977 passed, with three old P01/P02 expectations
  failing because P03 added subscription permissions and trial audit/events. Those explicit
  expectations were updated; all 94 final billing/identity/organization/verification cases
  passed. Additional security/idempotency regression: 53 passed. Final migration/billing/
  company-event regression: 30 passed, including a disposable database upgraded from P02
  with an existing company and real invitation acceptance/reactivation limits.
  Final policy/team/billing/migration/idempotency run: 219 passed. After tightening plan
  read locks and safe partial updates, the last billing/idempotency/team run passed all 106
  cases, including stale cached-price/limit refresh and preservation of omitted PATCH fields.
- All 114 canonical policy tests passed, including the full 60-cell action matrix, leap
  years/month-end dates, delayed transitions, reactivation and finite/unlimited usage.
- Full frontend suite: 376 passed. Final subscription/team/shell regression: 54 passed,
  including the new cancellation failure/rollback test. Production builds, ESLint/TypeScript,
  strict mypy (79 application files), Ruff, formatting, generated API types and locale catalog
  checks passed. Twelve tooling tests passed; all SUB-001 through SUB-012 have valid references.
- All ten real-browser P00–P03 scenarios passed together (2.9 minutes). P03 exercises trial
  expiry → GRACE → SOFT_BLOCK → FULL_BLOCK, a disabled invitation, manual payment → ACTIVE,
  owner cancellation, plan request/approval, unlimited usage and creation of a private plan.
  Existing login, duplicate registration, team lifecycle, verification and private-file
  download scenarios also pass. Browser fixtures are guarded to the isolated acceptance DB.
- The actual development schema was upgraded from 0015 to 0018 without resetting data;
  Alembic check reports no schema/model differences. Existing companies now have trials.
  Development worker/Beat were built and started; inspect confirmed both P03 jobs registered.
  A separate-process worker test exposed missing ORM foreign-key targets when API startup
  was bypassed. Worker bootstrap now imports the complete registry and installs the real
  subscription ports. The regression executes actual tick/reminder task bodies without
  importing FastAPI; all five standalone-worker/foundation regression tests passed.
  Local job containers bind development source read-only.

## Part boundaries

Product counts/enforcement connect in P04, active-store partnership counts in P06, order
guards/buttons and store warnings in P07, and actual notification delivery in P11. P03
provides the canonical guard and transactional usage/event contracts; it does not claim
those future modules are already implemented. Current product/active-store counts are zero
because those tables/modules do not exist yet. Current login/registration/reset behavior
approved by the owner is preserved. Remote CI remains unverified until the owner's push.
