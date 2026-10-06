# P06 partnerships and terms

Owner approval: 2026-10-06. P07 requires separate approval.

Status: implemented and locally accepted. Remote CI and deployment await the owner's push.

## Delivered behavior

Backend introduces tenant-scoped partnerships, invitation/request workflows, receiver-only
acceptance, immutable versioned terms, verification checks, subscription enforcement,
and the P07 order cancellation port. Company writes serialize activation and terms updates.
ACTIVE and SUSPENDED partnerships both contribute to subscription usage. Shared profile
locks protect verification checks; company-owned active price lists are required for terms.
PostgreSQL rejects UPDATE/DELETE of terms and mismatched price-list ownership.

Company and store areas provide status/search/pagination, exact store lookup, public-code
requests, terms preview before acceptance, current/future/history views with change diffs,
owner-only credit editing, customer-code version checks, and confirmed state changes.
Termination requires a reason and the partner's name in the UI. Profiles respect the
verification-dependent tax-identifier privacy rule. Maps use an external coordinate link.

## Validation

The 42 P06 tests passed within the complete isolated regression: 1120 backend tests
passed in 18 minutes 38 seconds. Coverage includes both invitation directions,
tenant privacy, role restrictions, immutable database records, concurrent activation,
subscription limits, future terms, owner-only credit, version conflicts, transactional
cancellation-port rollback and the new-order gate.

`python scripts/dev.py verify` passed Linux dependency consistency, Ruff, strict typing,
fresh migration upgrade/model drift, frontend lint/typing/formatting, all 398 frontend
tests, production build and requirement traceability. All 19 tooling regressions passed.
`python scripts/dev.py backend-ci` passed on the final backend with exit code 0.
Two consecutive API generations produced identical types; locale error keys match.
Development is upgraded to 2125e5a871b4 without a reset.

All thirteen P00-P06 browser scenarios passed together in 5.4 minutes with exit code 0.
P06 covers company invitation/store acceptance, store request/company acceptance with
initial terms, future terms and history, suspension/reactivation, reason/name-confirmed
termination, maps and a 390px mobile layout without horizontal overflow. The initial
combined run under concurrent validation had four loading timeouts in earlier parts;
the final combined run passed after the other checks finished.

Browser acceptance exposed an existing cross-area organization-switch race: choosing a
second company could select the first instead. The switcher now commits the organization
and destination together; a dedicated regression covers this case. Terms preview waits
for an active price list to load, preventing native form validation from blocking review.
The isolated frontend polls Windows bind mounts so acceptance serves the current code.

## Integration boundaries

PRT-001 order/payment/ledger ownership is supplied by P07/P09 when those records exist.
P06 supplies the partnership identity, terms resolver and new-order gate. PRT-009 calls
OrderCancellationPort transactionally; its P06 no-op is replaced by P07. Existing orders,
payments, returns, disputes and ledgers remain the responsibility of their authorized parts.
P11 delivers notifications from the durable partnership/terms events.

Existing login, registration password policy, email-code verification and password reset
are preserved. Duplicate registration remains on the registration page with its email
error, covered by browser regression. No push or DONE tag. P07 has not started.
