"""Authenticated encryption with the maintained Fernet implementation.

This format is intentionally separate from Laravel's APP_KEY encryption.
Import legacy plaintext connections through the CLI, not Laravel ciphertext.
"""
import base64
import hashlib
import json
from cryptography.fernet import Fernet, InvalidToken

PREFIX = "s4f1:"


def _fernet(secret: str) -> Fernet:
    if not secret:
        raise ValueError("S4_SECRET_KEY is required")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def seal(value, secret: str) -> str:
    return PREFIX + _fernet(secret).encrypt(json.dumps(value, ensure_ascii=False).encode()).decode()


def unseal(token, secret: str):
    if not token:
        return {}
    if not isinstance(token, str):
        return token
    if not token.startswith(PREFIX):
        if token.startswith("s4e1:"):
            raise ValueError("Unsupported experimental encryption format")
        return json.loads(token)
    try:
        return json.loads(_fernet(secret).decrypt(token[len(PREFIX):].encode()))
    except InvalidToken as exc:
        raise ValueError("Invalid key or damaged encrypted record") from exc


def mask(value: str, keep: int = 4) -> str:
    value = str(value or "")
    return "*" * len(value) if len(value) <= 2 * keep else value[:keep] + "…" + value[-keep:]
