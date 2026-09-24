"""IAM-003 password rules, shared by every flow that sets a password.

Rules: at least 8 and at most 128 characters, at least one letter and one digit, and not one of the 10k most
common passwords (SecLists `10k-most-common.txt`, MIT licence), compared case-insensitively.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

MIN_LENGTH = 8
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
    if not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
        problems.append("password_needs_letter_and_digit")
    if password.lower() in common_passwords():
        problems.append("password_too_common")
    return problems
