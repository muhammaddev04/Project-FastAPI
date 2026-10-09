# P11 — notifications and Telegram

Owner approval: 2026-10-09. Status: IN PROGRESS; real account linking and outbound
Telegram acceptance remain required. SMS is deferred by [CR-004](../../changes/CR-004-p11-without-sms.md).

The code implements personal in-app notifications, preferences, outbox delivery,
optional Telegram linking, bot commands, retries and blocked-account recovery.
Detailed evidence is recorded in [P11 acceptance](../P11_ACCEPTANCE.md).

- [x] Automated notification and Telegram integration tests.
- [x] Isolated browser acceptance with Telegram unconfigured.
- [x] Isolated browser acceptance with fake Telegram credentials, linking, permissions,
  outbound delivery and unlinking.
- [x] Independent Playwright artifact directories for every acceptance project.
- [x] Real @TezFarmobot and webhook respond; pending updates and webhook errors are zero.
- [x] All verification stages on the P10/P11-only checkout: 1669 backend tests,
  451 frontend tests, lint, strict typing, migration parity, formatting, build and
  traceability. Frontend stages passed after correcting formatting; backend was unchanged.
- [ ] Owner links the application account through /profile/telegram.
- [ ] Real outbound delivery and tenant-specific commands are confirmed after linking.

Pressing ordinary Start does not associate a Telegram account with an application
user. The latest read-only database check found no linked account or consumed link
token. Automated transport doubles do not claim real transport acceptance. P11 is
not DONE until the remaining live steps pass. No push is performed.
