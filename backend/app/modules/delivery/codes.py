"""DEL-010/011/012: the six-digit handover code.

The code is the only thing standing between a courier and a delivery marked DELIVERED, so it is
never written down in the clear. Two independent keys are used: an HMAC secret produces the digest
the server compares against, and an AES-GCM key produces the ciphertext the store (and only the
store) is shown. Holding the verifier therefore reveals no codes, and holding one ciphertext reveals
nothing about another — each is bound to its own delivery through the key material and the AAD.
"""

import hashlib
import hmac
import secrets
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

CODE_LENGTH = 6
#  DEL-011: the fifth wrong answer locks the code rather than letting a guesser walk the 10^6 space.
MAX_ATTEMPTS = 5
_NONCE_BYTES = 12


def generate() -> str:
    """A uniformly random six-digit code. `randbelow` is the CSPRNG; `random` would be guessable."""
    return f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"


def digest(delivery_id: UUID, code: str) -> str:
    """HMAC-SHA256 over `delivery_id:code`, so the same code on another delivery is a different digest."""
    secret = get_settings().delivery_code_hmac_secret.encode()
    return hmac.new(secret, f"{delivery_id}:{code}".encode(), hashlib.sha256).hexdigest()


def matches(delivery_id: UUID, code: str, expected: str | None) -> bool:
    """Constant-time comparison: a timing difference would leak the code digit by digit."""
    if not expected:
        return False
    return hmac.compare_digest(digest(delivery_id, code), expected)


def _cipher() -> AESGCM:
    key = hashlib.sha256(get_settings().delivery_code_encryption_key.encode()).digest()
    return AESGCM(key)


def encrypt(delivery_id: UUID, code: str) -> bytes:
    """Nonce || ciphertext, with the delivery id as associated data so it cannot be replayed elsewhere."""
    nonce = secrets.token_bytes(_NONCE_BYTES)
    return nonce + _cipher().encrypt(nonce, code.encode(), str(delivery_id).encode())


def decrypt(delivery_id: UUID, blob: bytes | None) -> str | None:
    """The stored code, or None when there is none or it does not belong to this delivery."""
    if not blob or len(blob) <= _NONCE_BYTES:
        return None
    try:
        plain = _cipher().decrypt(blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], str(delivery_id).encode())
    except InvalidTag:
        return None
    return plain.decode()
