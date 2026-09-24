from __future__ import annotations

import json
from functools import cache
from pathlib import Path

SUPPORTED_LANGUAGES = ("tg", "ru", "en")
DEFAULT_LANGUAGE = "tg"
LOCALES_DIR = Path(__file__).resolve().parent.parent / "locales"


@cache
def _catalog(language: str) -> dict[str, str]:
    path = LOCALES_DIR / f"{language}.json"
    if not path.exists():
        return {}
    data: dict[str, str] = json.loads(path.read_text(encoding="utf-8"))
    return data


def resolve_language(accept_language: str | None) -> str:
    """Pick tg/ru/en from an Accept-Language header; default tg (01_GLOBAL §12)."""
    if not accept_language:
        return DEFAULT_LANGUAGE
    for part in accept_language.split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in SUPPORTED_LANGUAGES:
            return code
    return DEFAULT_LANGUAGE


def translate(key: str, language: str = DEFAULT_LANGUAGE, **params: object) -> str:
    """FND-018: translate with fallback to tg, then to the key itself."""
    template = _catalog(language).get(key) or _catalog(DEFAULT_LANGUAGE).get(key) or key
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template
