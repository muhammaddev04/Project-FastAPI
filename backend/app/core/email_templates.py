"""Localized transactional emails (tg/ru/en). Copy lives in `locales/*.json` under `email.<template>.*`.

Templates only format what they are given; they never create or inspect the secrets inside the action link.
"""

from __future__ import annotations

from html import escape

from app.core.email import OutgoingEmail
from app.core.i18n import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, translate

# `account_exists` answers a registration attempt for an address that already has an account (IAM-001).
TEMPLATES = ("verification", "password_reset", "account_exists")
_BRAND = "#0F766E"


def _html(language: str, heading: str, paragraphs: list[str], action_label: str, action_url: str, footer: str) -> str:
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.55">{escape(text)}</p>' for text in paragraphs)
    return f"""<!doctype html>
<html lang="{escape(language)}">
  <body style="margin:0;background:#F8F9FF;font-family:Segoe UI,Arial,sans-serif;color:#0B1C30">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px">
          <tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700;color:{_BRAND}">TezFarmo</td></tr>
          <tr><td style="padding:8px 28px 0;font-size:18px;font-weight:600">{escape(heading)}</td></tr>
          <tr><td style="padding:16px 28px 0;font-size:14px">{body}</td></tr>
          <tr><td style="padding:8px 28px 24px">
            <a href="{escape(action_url, quote=True)}"
               style="display:inline-block;background:{_BRAND};color:#FFFFFF;text-decoration:none;
                      padding:12px 20px;border-radius:4px;font-weight:600;font-size:14px">{escape(action_label)}</a>
          </td></tr>
          <tr><td style="padding:0 28px 28px;font-size:12px;color:#5B6770;line-height:1.5">
            {escape(footer)}<br><span style="word-break:break-all">{escape(action_url)}</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>"""


def render(template: str, language: str, *, to: str, name: str, action_url: str, minutes: int) -> OutgoingEmail:
    """Build the email for `template` in `language` (falls back to tg, like every other message)."""
    if template not in TEMPLATES:
        raise ValueError(f"unknown email template: {template}")
    language = language if language in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE

    def text(key: str) -> str:
        # Copy may state the lifetime in minutes or whole hours (the 24-hour verification link).
        return translate(f"email.{template}.{key}", language, name=name, minutes=minutes, hours=minutes // 60)

    heading, intro, expiry, ignore = text("heading"), text("intro"), text("expiry"), text("ignore")
    action, footer = text("action"), text("footer")
    plain = "\n\n".join([heading, intro, f"{action}: {action_url}", expiry, ignore, "TezFarmo"])
    return OutgoingEmail(
        to=to,
        subject=text("subject"),
        text=plain,
        html=_html(language, heading, [intro, expiry, ignore], action, action_url, footer),
        template=template,
    )
