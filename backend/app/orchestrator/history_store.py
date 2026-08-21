"""Memória Nível 2 (SCRUM-25): histórico de conversa persistido em SQLite,
sobrevive a reinício do backend e a `conversation_id` novos — diferente da
`SessionMemory` (Nível 1, `memory.py`), que é em RAM e só dura enquanto a
mesma conversa/processo estiver de pé.

Cada turno (pergunta do usuário + resposta final do Jarvis) é gravado
aqui depois de respondido. A cada nova pergunta, um resumo das últimas
24h é injetado no system prompt (ver router.py) — assim o Jarvis lembra
do que vocês conversaram mais cedo no mesmo dia, mesmo numa conversa por
voz totalmente nova (ElevenLabs gera um `conversation_id` diferente a
cada sessão — sem isso, cada conversa começava do zero).

Mesmo arquivo do login (`jarvis.db`, no volume persistente) — tabela
separada, sem relação com usuários/auth.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from app.config import get_settings
from app.logging_config import get_logger

logger = get_logger("jarvis.orchestrator.history_store")

# Janela injetada no prompt (SCRUM-25 pede 24h) e teto de segurança pra não deixar o
# prompt gigante numa conversa muito falante — pega só os turnos mais recentes dentro
# da janela, não todos.
_WINDOW_SECONDS = 24 * 60 * 60
_MAX_TURNS_IN_PROMPT = 20
# Limpeza: não vale manter histórico indefinidamente num arquivo que também guarda auth.
_RETENTION_SECONDS = 7 * 24 * 60 * 60


def _db_path() -> Path:
    settings = get_settings()
    path = Path(settings.jarvis_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_history_db() -> None:
    with _connect() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS conversation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at REAL NOT NULL,
                session_id TEXT NOT NULL,
                query TEXT NOT NULL,
                response TEXT NOT NULL
            )"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at "
            "ON conversation_history (created_at)"
        )
        conn.commit()


def log_turn(session_id: str, query: str, response: str) -> None:
    """Grava um turno (chamado depois que o orquestrador já respondeu). Falha aqui não
    deve derrubar a resposta pro usuário — é só best-effort, por isso o try/except."""
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO conversation_history (created_at, session_id, query, response) "
                "VALUES (?, ?, ?, ?)",
                (time.time(), session_id, query, response),
            )
            conn.execute(
                "DELETE FROM conversation_history WHERE created_at < ?",
                (time.time() - _RETENTION_SECONDS,),
            )
            conn.commit()
    except sqlite3.Error as error:
        logger.warning("history_store_log_failed", extra={"extra_fields": {"error": str(error)}})


def get_recent_summary() -> str:
    """Texto pronto pra entrar no system prompt com o que rolou nas últimas 24h — vazio
    se não houve conversa nesse período (não polui o prompt à toa)."""
    cutoff = time.time() - _WINDOW_SECONDS
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT created_at, query, response FROM conversation_history "
                "WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?",
                (cutoff, _MAX_TURNS_IN_PROMPT),
            ).fetchall()
    except sqlite3.Error as error:
        logger.warning("history_store_read_failed", extra={"extra_fields": {"error": str(error)}})
        return ""

    if not rows:
        return ""

    lines = []
    for row in reversed(rows):  # ordem cronológica no prompt, mais fácil do modelo seguir
        hora = time.strftime("%H:%M", time.localtime(row["created_at"]))
        # Corta cada lado pra não deixar um turno gigante engolir o orçamento de contexto.
        query = row["query"][:300]
        response = row["response"][:300]
        lines.append(f'- [{hora}] Você perguntou: "{query}" — Jarvis respondeu: "{response}"')
    return "\n".join(lines)
