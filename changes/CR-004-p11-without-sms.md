# P11 without SMS — 2026-10-09

The owner explicitly requested no SMS for now and authorized choosing the simplest
alternative without asking further questions. P11 therefore uses always-on IN_APP
notifications and optional Telegram. No SMS provider, sending, daily SMS costs or SMS
preferences are enabled. NTF-008 and NTF-020..022 and staging SMS acceptance are
deferred by this instruction. Critical events remain visible in the application.

The existing email authentication, verification, invitations and password reset stay
unchanged. Telegram is optional and requires server-side credentials for live delivery.
