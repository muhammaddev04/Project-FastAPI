# CR-001 — Email instead of SMS as the authentication channel

| Field | Value |
|---|---|
| change_id | CR-001 |
| requester | Project owner (muhammaddev04) |
| date | 2026-09-25 |
| status | Approved by the project owner; implementation partial (see *Implementation status*) |

## Reason

The owner decided that TezFarmo authentication uses **email** as the identity and recovery channel. SMS is not
used anywhere in authentication, and no SMS provider is added.

## What the TZ said before this change

TZ v4 fixed a phone-based design. This CR changes it deliberately; the TZ did **not** originally require email.

- **DEC-17:** phone (E.164) + password, phone confirmed by SMS OTP.
- **P01 §2.1:** `users.phone` NOT NULL UNIQUE is the login identifier; `phone_verified_at` NOT NULL.
- **P01 §2.2 / IAM-001, IAM-002, IAM-015, IAM-016:** OTP codes sent by SMS for registration and password reset
  through `SmsPort`.
- **P01 §6:** `register/start {phone}`, `login {phone, password}`, `password/reset/start {phone}`.
- **P00 §4.1:** rate limits keyed by phone.

## New decision

| Topic | New rule |
|---|---|
| Login | email + password |
| Registration | email + password; account starts with an unverified email |
| Email verification | one-time, expiring secret sent by email (link or code) |
| Password recovery | email → one-time, short-lived reset secret → new password; responses never reveal whether an email is registered |
| Phone | optional contact attribute only; never used for login, recovery or any code delivery |
| Password policy | unchanged (IAM-003) for registration, reset and change |
| Sessions | unchanged (SEC-003/004/005, IAM-005..IAM-008) |
| Rate limits | same numbers as P00 §4.1, keyed by email instead of phone (`auth_login` email+ip, verification send/verify and `password_reset` per email) |
| Google sign-in | stays an optional extra method (owner requirement) |
| Organizations | unchanged: Company/Store, memberships and P02 verification are not affected |

## Affected requirement IDs

DEC-17, IAM-001, IAM-002, IAM-004, IAM-015, IAM-016, P01 §2.1, P01 §2.2, P01 §6, P00 §4.1 (auth rows), SEC-011
(email addresses are masked in logs like phone numbers were).

## Impact

- **DB:** `users.email` becomes NOT NULL and the unique login identifier (case-insensitive); `users.phone` and
  `users.phone_verified_at` become nullable. `otp_codes` (never created in this codebase) is not needed in its SMS
  form; the verification/reset secret storage belongs to the deferred work below.
- **API:** auth request bodies use `email` instead of `phone`. New email-channel endpoints replace the SMS ones.
- **Security:** no SMS OTP; secrets are delivered by email; no enumeration on registration/reset; nothing secret is
  logged (codes, tokens, passwords, SMTP credentials).
- **Infrastructure:** SMTP settings `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `FROM_EMAIL`
  (server-side only). `SmsPort` is no longer needed for authentication.
- **Frontend:** `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` use email.

## Implementation status

Done in this change:

- this CR
- the email service layer (provider interface, SMTP provider, development/test provider)
- localized email templates (tg/ru/en) for verification and password reset
- the `users` schema migration
- email-based frontend pages that show honest "not enabled yet" states driven by `/api/v1/meta`

**Deferred (blocked in the implementing session, not implemented, nothing faked):**

- creating, storing and checking verification and reset secrets
- issuing, rotating and revoking sessions (login, refresh, logout, logout-all)
- the registration completion, email verification and password reset endpoints
- password change

Until these land, `/api/v1/meta` keeps `password_login`, `registration`, `email_verification` and `password_reset`
disabled, and the frontend sends no credentials.
