# P11 notifications and Telegram

Owner approval: 2026-10-09. Scope change: [CR-004](../changes/CR-004-p11-without-sms.md).

Status: local implementation and automated acceptance passed. P11 is not DONE until the
live Telegram acceptance below is verified. SMS is explicitly deferred by the owner.

## Implemented scope

Notifications are created by the outbox consumer, independently of business
transactions. The event/user uniqueness constraint prevents duplicate notifications.
The complete P11 recipient policy checks active users, memberships and permissions;
Telegram delivery checks access again immediately before sending. IN_APP is always
enabled. Telegram preferences use the specification's event groups and defaults.
There is no SMS sending, provider configuration or SMS preferences UI.

Personal notification APIs support pagination, unread filtering, counts, individual
reads, reading all and preferences without requiring X-Org-Id. The header polls the
unread count every 30 seconds and shows the latest ten notifications. The full list,
preferences and Telegram account pages support tg/ru/en and mobile layouts.

Optional Telegram uses aiogram 3, authenticated and rate-limited webhook processing,
update deduplication, single-use SHA-256 link tokens with ten-minute expiry, account
uniqueness and unlinking. The web page generates its QR locally. Bot commands reuse
existing service permissions for organizations, orders, debt, courier stops and
delivery codes. Warehouse order responses omit prices. Organization selection lives
in Redis for 24 hours. Existing authentication and email flows are unchanged.

External delivery runs in the worker, with five-second timeout, persistent retries,
three-attempt failure state and blocked-account handling. Delivery codes are decrypted
only when preparing an authorized Telegram message; they never enter notification
parameters, outbox payloads, audit records or saved error messages. Failed deliveries
are persisted for the future P12 admin view; P12 is outside this change.

Migration: `20261009_0026`, following P10 revision `20261008_0025`.

## Validation record (2026-10-09)

- Clean Linux dependency installation, Ruff, strict mypy without cache, migration
  upgrade from an empty disposable database and Alembic model drift checks passed.
- Final notification and Telegram integration suite passed (76 cases), including
  persistent retries, forbidden-chat handling, real outbox dispatch and date formatting.
  An additional regression covers recovery after unblocking the bot: authenticated
  private updates restore future delivery, while group updates cannot change that state.
- Frontend notification tests passed (9 cases). Full frontend verification passed:
  449 tests, ESLint, TypeScript, Prettier and the production build.
- Isolated browser acceptance passed in both modes through
  `python scripts/check_p11_browser.py` and
  `python scripts/check_p11_browser.py --configured-telegram`. The configured
  mode uses fake external credentials and authenticated simulated Telegram updates:
  single-use linking with a local QR, automatic status polling, organization selection,
  orders/debt commands, outbox delivery through a fake sender, unlinking and denial
  after unlinking. It does not claim live Telegram transport acceptance.
- Browser acceptance also checks pagination, reading all/individual notifications,
  preferences surviving refresh, user-scoped headers, no SMS controls and layouts
  at 390/768/1440 pixels. Each disposable database and container is removed afterward.
  The frontend image is fixed during acceptance so concurrent IDE edits cannot
  hot-reload its code midway through the test.
- Generated API type drift check passed: successive generations were identical.
- Verification tooling tests passed (17 cases). P11 non-SMS requirements have
  explicit test references in `docs/traceability.json` and `--complete-p11`.
- `python scripts/dev.py verify` passed: 1663 backend tests, 449 frontend tests,
  the production build and requirement traceability. This full run preceded the
  final bot-unblocking regression; the focused suite verifies that final change.

## Remaining live acceptance

The configured @TezFarmobot authenticated successfully on 2026-10-09. Its registered
webhook matches the configured HTTPS endpoint, it has no pending updates and no
recorded delivery error. The local notification worker and scheduler respond normally.

There are currently zero linked application accounts. The owner must complete the
web linking flow and press Start in Telegram to authorize the bot chat. Live inbound
linking, receipt of an outbound event and tenant-specific bot commands still require
that interaction. Automated transport doubles do not replace these live steps.

P11 is not DONE until these live acceptance steps pass. SMS staging acceptance and
NTF-008/020/021/022 are deferred by CR-004. P12 is outside this change.

The local runtime needs this computer, Docker, the API, notification worker, beat
scheduler and temporary HTTPS tunnel to remain running. A permanent deployment
requires a stable HTTPS endpoint.

Concurrent P10 work is excluded from the P11 commits. P11 consumes its existing
business events and does not add P10 transitions, endpoints or frontend workflows.
No push is performed.

## Optional deployment setup

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_WEBHOOK_PATH_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and
`TELEGRAM_WEBHOOK_BASE_URL` through the deployment's secret configuration. Use an
HTTPS webhook base URL and independent random path/header secrets. Then execute
`python -m app.cli telegram-set-webhook` in the backend environment. Run the
existing Celery worker with the notifications queue and beat schedule. Without
these settings, in-app notifications remain available and Telegram linking is
disabled with an explanation in the profile page.
