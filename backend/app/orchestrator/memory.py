"""Memória de sessão em processo (equivalente ao "Simple Memory" do n8n —
`memoryBufferWindow` por `conversation_id`).

Em memória, não persistida — reinicia com o processo. Suficiente pro uso
atual (janela de conversa curta, mesma instância). Se algum dia precisar
sobreviver a restart/múltiplas instâncias, trocar por Redis é uma troca
isolada nesse módulo, sem tocar no resto do orquestrador.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any

MAX_SESSIONS = 500
MAX_MESSAGES_PER_SESSION = 20  # janela — mensagens mais antigas são descartadas
SESSION_TTL_SECONDS = 60 * 60 * 2  # 2h de inatividade


class SessionMemory:
    def __init__(self) -> None:
        self._sessions: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        expired = [
            key for key, (last_used, _) in self._sessions.items() if now - last_used > SESSION_TTL_SECONDS
        ]
        for key in expired:
            del self._sessions[key]

    def get(self, session_id: str) -> list[dict[str, Any]]:
        self._evict_expired()
        entry = self._sessions.get(session_id)
        return list(entry[1]) if entry else []

    def set(self, session_id: str, messages: list[dict[str, Any]]) -> None:
        self._evict_expired()
        trimmed = messages[-MAX_MESSAGES_PER_SESSION:]
        self._sessions[session_id] = (time.monotonic(), trimmed)
        self._sessions.move_to_end(session_id)
        while len(self._sessions) > MAX_SESSIONS:
            self._sessions.popitem(last=False)


_memory = SessionMemory()


def get_session_memory() -> SessionMemory:
    return _memory
