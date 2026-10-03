from __future__ import annotations

import pytest

from app.modules.auth.password_policy import common_passwords, password_problems


@pytest.mark.parametrize(
    ("password", "expected"),
    [
        ("Tezfarmo2026", []),
        ("Dushanbe-Market-7", []),
        ("Ab1", ["password_too_short"]),
        ("1234", []),
        ("abcd", []),
        ("!!!!", []),
        ("a" * 128, []),
        ("onlyletters", []),
        ("1234567890", []),
        ("password1", []),
        ("PASSWORD1", []),
        ("a1" * 65, ["password_too_long"]),
    ],
)
def test_iam_003_weak_password_rejected(password: str, expected: list[str]) -> None:
    assert password_problems(password) == expected


def test_iam_003_common_list_is_the_10k_list() -> None:
    assert len(common_passwords()) >= 9_900
    assert "qwerty123" in common_passwords()
