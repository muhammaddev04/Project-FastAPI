# P08 delivery

Owner approval: 2026-10-06, including continuation and a local commit. P09 requires separate approval.
Status: IMPLEMENTED AND LOCALLY ACCEPTED, 2026-10-08.

## Implemented behavior

ORDER_READY synchronously creates a delivery with frozen address and a new attempt number.
Order cancellation uses the real delivery port. A single service writes delivery/run
transitions, history, audit and outbox events. Delivery completion invokes the existing
order/stock transition inside the same transaction; failures roll all business effects back.

The company board assigns deliveries, creates dated courier runs, reorders stops by drag
or keyboard buttons, and starts/finishes/cancels runs. Company delivery detail exposes
history, assignment, cancellation, code regeneration and a reasoned manual-confirm dialog.
Owners/managers can perform courier actions online. Operators and warehouse staff have
read access; couriers see only assigned stops. Started runs cannot change their composition.
Run updates cannot take another run's stops. Today's courier response includes all local
dated runs, terminal stops and standalone active deliveries, with batched store/item reads.

Six-digit codes use a CSPRNG, HMAC-SHA256 verification and independent AES-256-GCM
encryption. Only the authorized store response exposes a code while the delivery is in
transit/arrived. Five wrong attempts persist independently of the failed request and lock
the code. Online and synced confirmations use rate limiting. Regeneration resets the lock;
manual confirmation requires a ten-character reason, audit and a store notification event.
Codes are omitted from company/courier responses, audit, history, outbox and sync logs.

The mobile courier PWA provides ordered stops, maps/call links, quantities without item
prices, order total, arrive/confirm/fail controls, connectivity, pending count and issues.
Every courier action is first recorded in IndexedDB with UUIDv7 and user/company scope.
Queued codes use WebCrypto AES-GCM with a tab-session key kept outside IndexedDB.
The service worker caches assets and partitions courier read snapshots by user/company.
Reconnect and thirty-second checks sync pending work with bounded retry backoff.
Acknowledged operations leave the queue; rejected/conflicting operations become issues
with authoritative server state. Logout warns about pending work and never erases it.
A cancelled logout keeps the current session; password-change logout remains unconditional.

Sync processes at most 100 operations in client-time order, each in its own transaction.
An operation lock serializes concurrent retries before any effects. Duplicate results
retain the original recorded outcome. Permission failures disclose no other courier's or
tenant's delivery state. The immutable sync log permits deletion only after thirty days;
the scheduled cleanup uses that retention rule. PAYMENT_RECORD remains explicitly
unsupported until P09.

## Validation

The required `python scripts/dev.py verify` passed its complete backend phase (1192
tests), then identified stale frontend expectations and an IndexedDB test-environment
error. Those were fixed; the complete frontend rerun passed all 418 tests across 48
files, lint, typecheck, formatting and production build. The already-passed backend
regression was not repeated unnecessarily.

Final clean Linux `python scripts/dev.py backend-ci` passed dependencies, Ruff, strict
mypy without cache, isolated migration upgrade and model drift. The focused delivery
integration suite passed all 32 tests. Tooling passed 20 tests; P00-P08 traceability and
repeated generated API type hashes passed.

The isolated real-browser P08 scenario passed: company run creation/reordering/start,
store code display, a 390px courier view, cached offline reads, encrypted pending
arrival/confirmation, cancelled logout preserving work, reconnection and atomic stock
shipment, duplicate replay, authoritative conflict display, and run completion.
Isolated acceptance workers were restored after testing.
Evidence logs are local ignored artifacts: `p08-verify.log`, `p08-delivery-final.log`,
`p08-browser.log`, `p08-api-drift.log`, `p08-tooling.log` and `p08-backend-ci-final.log`.

## Integration boundaries

P09 creates financial charges through the existing same-transaction order/event boundary.
P11 consumes the durable delivery events and obtains encrypted codes for notifications;
no plaintext code is placed in the outbox. These later parts have not started.
Closing the courier tab loses its session key; abandoned encrypted confirmations become
visible issues requiring a new online code entry. The queue itself remains on the device.
Authentication, registration password rules, email verification/reset and duplicate-email
registration behavior are preserved. No push or deployment is performed.
