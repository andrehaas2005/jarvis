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


def _is_orphaned_tool_result(message: dict[str, Any]) -> bool:
    """`tool_result` (role `user`) sem o `tool_use` correspondente na mensagem
    anterior — a API da Anthropic rejeita isso com 400. Só acontece quando o
    corte de `_trim_window` cai bem no meio de um par tool_use/tool_result."""
    content = message.get("content")
    if not isinstance(content, list):
        return False
    return any(isinstance(block, dict) and block.get("type") == "tool_result" for block in content)


def _trim_window(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Corte por posição (`[-N:]`) ignora que um `tool_use` (mensagem do
    assistant) e o `tool_result` que responde a ele (mensagem seguinte, role
    `user`) precisam ficar juntos — se o corte cai entre os dois, sobra um
    `tool_result` órfão logo no início da janela, e a próxima chamada à
    Anthropic falha com 400 ("unexpected tool_use_id... must have a
    corresponding tool_use block"). Bug real visto em produção (SCRUM-59).

    Fix: depois do corte, descarta também qualquer `tool_result` órfão que
    tenha sobrado no início (o `tool_use` correspondente já foi perdido pelo
    corte de qualquer forma, então não tem como preservar o par — só dá pra
    evitar mandar a mensagem quebrada pra API)."""
    trimmed = messages[-MAX_MESSAGES_PER_SESSION:]
    while trimmed and _is_orphaned_tool_result(trimmed[0]):
        trimmed = trimmed[1:]
    return trimmed


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
        trimmed = _trim_window(messages)
        self._sessions[session_id] = (time.monotonic(), trimmed)
        self._sessions.move_to_end(session_id)
        while len(self._sessions) > MAX_SESSIONS:
            self._sessions.popitem(last=False)


_memory = SessionMemory()


def get_session_memory() -> SessionMemory:
    return _memory
