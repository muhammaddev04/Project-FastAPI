"""Localized transactional emails (tg/ru/en). Copy lives in `locales/*.json` under `email.<template>.*`.

Templates only format what they are given; they never create or inspect the secrets they carry. The account
exists email has a button and the plain URL; the verification and password reset emails carry only a 6-digit code
to type into the app, with no link at all.
"""

from __future__ import annotations

from html import escape

from app.core.email import OutgoingEmail
from app.core.i18n import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, translate

# `account_exists` answers a registration attempt for an address that already has an account (IAM-001).
TEMPLATES = ("verification", "password_reset", "account_exists")
#: Templates that carry a code instead of a link.
CODE_TEMPLATES = ("verification", "password_reset")
_BRAND = "#0F766E"


def _paragraphs(paragraphs: list[str]) -> str:
    return "".join(f'<p style="margin:0 0 14px;line-height:1.55">{escape(text)}</p>' for text in paragraphs)


def _page(language: str, heading: str, content: str) -> str:
    return f"""<!doctype html>
<html lang="{escape(language)}">
  <body style="margin:0;background:#F8F9FF;font-family:Segoe UI,Arial,sans-serif;color:#0B1C30">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px">
          <tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700;color:{_BRAND}">TezFarmo</td></tr>
          <tr><td style="padding:8px 28px 0;font-size:18px;font-weight:600">{escape(heading)}</td></tr>
          {content}
        </table>
      </td></tr>
    </table>
  </body>
</html>"""


def _link_html(language: str, heading: str, paragraphs: list[str], label: str, url: str, footer: str) -> str:
    return _page(
        language,
        heading,
        f"""<tr><td style="padding:16px 28px 0;font-size:14px">{_paragraphs(paragraphs)}</td></tr>
          <tr><td style="padding:8px 28px 24px">
            <a href="{escape(url, quote=True)}"
               style="display:inline-block;background:{_BRAND};color:#FFFFFF;text-decoration:none;
                      padding:12px 20px;border-radius:4px;font-weight:600;font-size:14px">{escape(label)}</a>
          </td></tr>
          <tr><td style="padding:0 28px 28px;font-size:12px;color:#5B6770;line-height:1.5">
            {escape(footer)}<br><span style="word-break:break-all">{escape(url)}</span>
          </td></tr>""",
    )


def _code_html(language: str, heading: str, intro: str, label: str, code: str, after: list[str]) -> str:
    return _page(
        language,
        heading,
        f"""<tr><td style="padding:16px 28px 0;font-size:14px">{_paragraphs([intro])}</td></tr>
          <tr><td style="padding:0 28px;font-size:13px;color:#5B6770">{escape(label)}</td></tr>
          <tr><td style="padding:6px 28px 18px">
            <span style="display:inline-block;font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:700;
                         letter-spacing:8px;color:{_BRAND};background:#F0FDFA;border:1px solid #CCFBF1;
                         border-radius:6px;padding:10px 18px">{escape(code)}</span>
          </td></tr>
          <tr><td style="padding:0 28px 24px;font-size:14px">{_paragraphs(after)}</td></tr>""",
    )


def render(
    template: str,
    language: str,
    *,
    to: str,
    name: str,
    minutes: int,
    action_url: str | None = None,
    code: str | None = None,
) -> OutgoingEmail:
    """Build the email for `template` in `language` (falls back to tg, like every other message).

    Code templates (verification) need `code` and never contain a link; the others need `action_url`.
    """
    if template not in TEMPLATES:
        raise ValueError(f"unknown email template: {template}")
    language = language if language in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE

    def text(key: str) -> str:
        return translate(f"email.{template}.{key}", language, name=name, minutes=minutes, hours=minutes // 60)

    heading, intro, expiry, ignore = text("heading"), text("intro"), text("expiry"), text("ignore")
    if template in CODE_TEMPLATES:
        if code is None:
            raise ValueError(f"{template} needs a code")
        label, instruction = text("code_label"), text("instruction")
        plain = "\n\n".join([heading, intro, f"{label}: {code}", instruction, expiry, ignore, "TezFarmo"])
        html = _code_html(language, heading, intro, label, code, [instruction, expiry, ignore])
    else:
        if action_url is None:
            raise ValueError(f"{template} needs an action_url")
        action, footer = text("action"), text("footer")
        plain = "\n\n".join([heading, intro, f"{action}: {action_url}", expiry, ignore, "TezFarmo"])
        html = _link_html(language, heading, [intro, expiry, ignore], action, action_url, footer)
    return OutgoingEmail(to=to, subject=text("subject"), text=plain, html=html, template=template)
