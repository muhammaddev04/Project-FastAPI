"""Password acceptance policy: 4-128 characters, without composition requirements."""

from __future__ import annotations

from functools import cache
from pathlib import Path

MIN_LENGTH = 4
MAX_LENGTH = 128
_COMMON_FILE = Path(__file__).with_name("common_passwords.txt")


@cache
def common_passwords() -> frozenset[str]:
    lines = _COMMON_FILE.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip())


def password_problems(password: str) -> list[str]:
    """Return validation codes (matching locales `validation.<code>`); empty means the password is acceptable."""
    problems: list[str] = []
    if len(password) < MIN_LENGTH:
        problems.append("password_too_short")
    if len(password) > MAX_LENGTH:
        problems.append("password_too_long")
    return problems
