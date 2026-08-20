"""Autenticação do HUD (login) — primeiro passo de um sistema de perfis
maior (cada pessoa vai ter suas próprias credenciais Google — Gmail,
Calendar, Contacts —, enquanto ElevenLabs/Anthropic continuam únicos pro
sistema inteiro). Por enquanto: login funcional, um usuário seed (admin).
A página de configuração pra criar/editar outros usuários vem depois.

Sem dependência nova: hash de senha via `hashlib.pbkdf2_hmac` (stdlib) e
token assinado via HMAC (mesma ideia de um JWT simples, sem precisar de
`pyjwt`) — evita sessão em memória que se perde a cada restart do backend.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings
from app.logging_config import get_logger

logger = get_logger("jarvis.auth")

_PBKDF2_ITERATIONS = 200_000
_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60  # 14 dias — HUD de uso pessoal, não fica deslogando à toa


@dataclass
class User:
    username: str
    name: str
    jarvis_address: str  # como o Jarvis chama a pessoa, ex.: "Senhor André"
    role: str  # "admin" | "user"


def _db_path() -> Path:
    settings = get_settings()
    path = Path(settings.jarvis_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Cria a tabela de usuários e semeia o admin inicial, se ainda não existir.
    Chamado no startup do backend (ver lifespan em main.py)."""
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                jarvis_address TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at REAL NOT NULL
            )
            """
        )
        conn.commit()

        existing = conn.execute("SELECT 1 FROM users WHERE username = ?", ("andrehaas",)).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO users (username, name, jarvis_address, password_hash, role, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "andrehaas",
                    "André Haas",
                    "Senhor André",
                    _hash_password("123456"),
                    "admin",
                    time.time(),
                ),
            )
            conn.commit()
            logger.info("auth_seed_admin_created", extra={"extra_fields": {"username": "andrehaas"}})


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{salt.hex()}:{digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split(":")
    except ValueError:
        return False
    salt = bytes.fromhex(salt_hex)
    expected = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return hmac.compare_digest(expected.hex(), digest_hex)


def authenticate(username: str, password: str) -> User | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not _verify_password(password, row["password_hash"]):
        logger.info("auth_login_failed", extra={"extra_fields": {"username": username}})
        return None
    logger.info("auth_login_ok", extra={"extra_fields": {"username": username}})
    return User(username=row["username"], name=row["name"], jarvis_address=row["jarvis_address"], role=row["role"])


def get_user(username: str) -> User | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        return None
    return User(username=row["username"], name=row["name"], jarvis_address=row["jarvis_address"], role=row["role"])


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def issue_token(user: User) -> str:
    """Token assinado (HMAC) com o segredo do servidor — não fica sessão
    nenhuma pra guardar, expira sozinho em `_TOKEN_TTL_SECONDS`."""
    settings = get_settings()
    payload = {"username": user.username, "role": user.role, "exp": time.time() + _TOKEN_TTL_SECONDS}
    payload_b64 = _b64url_encode(json.dumps(payload).encode("utf-8"))
    signature = hmac.new(settings.jarvis_auth_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256)
    return f"{payload_b64}.{_b64url_encode(signature.digest())}"


def verify_token(token: str) -> User | None:
    settings = get_settings()
    try:
        payload_b64, signature_b64 = token.split(".")
        expected_signature = hmac.new(
            settings.jarvis_auth_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(expected_signature, _b64url_decode(signature_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        if payload["exp"] < time.time():
            return None
    except (ValueError, KeyError, json.JSONDecodeError):
        return None
    return get_user(payload["username"])
