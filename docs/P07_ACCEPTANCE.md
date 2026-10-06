# P07 orders

Owner approval: 2026-10-06. P08 requires separate approval.
Status: IMPLEMENTED AND LOCALLY ACCEPTED (2026-10-06).

## Implemented behavior

Store catalogue resolves current terms/prices with default-list fallback and displays
availability bands without exposing exact stock. Personal carts reprice on read;
checkout snapshots products, units, prices and address and clears the cart atomically.
Company users can create the same order on behalf of a store. Duplicate units merge.

OrderService owns every status change, history, audit and durable event. Confirmation
checks version, current terms, minimum, credit and stock in one transaction. Only
confirmed quantities reserve stock; discounts and overrides require OWNER/MANAGER.
Cancellation releases reservations and calls the P08 cancellation port. Terminating
a partnership cancels its NEW/VIEWED orders through the real P06 port implementation.
System transitions have no public endpoints; module-scoped SystemActor controls them.
The completion task runs every 30 minutes and respects dispute windows and open disputes.

Warehouse responses exclude monetary fields and use a printable quantity-only pick list.
Database triggers protect creation/confirmation/item snapshots and append-only history.
Company locks precede partnership/order/stock locks, matching P06 termination's order.

## Specification clarification

`COMPANY_ON_BEHALF` contains 17 characters. TZ's proposed VARCHAR(16) cannot store
its required enum value. The source column uses VARCHAR(20), preserving both values.

## Validation

`python scripts/dev.py verify` passed: 1160 backend tests, 405 frontend tests,
Linux dependency checks, Ruff, strict typing without cache, a fresh migration upgrade
and model drift, frontend lint/typing/format/build and complete P07 traceability.
Twenty tooling tests passed. Generated API types were regenerated twice with the same
hash. Development upgraded to `f78d0fa3dbff` without resetting data.

The isolated real P07 browser scenario passed checkout, partial confirmation,
warehouse assembly/readiness, a quantity-only printable pick list, cancellation and
stock release, repeat order, company-on-behalf creation/rejection and a 390px mobile
view without horizontal overflow. The full browser regression found a store-home
contrast issue: the class merger treated named font sizes as colours and removed the
button foreground. Its configuration now recognises the project's typography scale;
two focused unit tests and the real store-home accessibility scenario passed.
After this frontend-only fix, all frontend verification steps passed again with
407 tests, lint, typing, format, build and traceability. All 14 P00–P07 browser
scenarios then passed together in 6.5 minutes against the isolated acceptance stack.

Evidence: `p07-verify-final.log`, `p07-frontend-post-contrast.log`,
`p07-browser-final.log`, `p07-api-drift.log`, `p07-tooling.log` and
`p07-backend-ci-final.log` are local ignored logs. Remote CI and deployment await
the owner's push.

## Integration boundaries

P08 installs DeliveryCancellationPort and invokes dispatch/deliver/fail_delivery.
P09 replaces InitialCredit (zero outstanding/unapplied, actual terms credit limit)
and creates charges from delivery events. P10 replaces OpenDisputePort and invokes
dispute/completion. P11 delivers notifications from durable order events. These parts
have not started. Authentication behavior is preserved. No push or DONE tag.
