"""Presença ativa do HUD — quantas abas/dispositivos estão com a página
aberta agora. Não identifica quem é a pessoa (sem login) — só conta
heartbeats recentes de sessões de navegador distintas.

Em memória, sem persistência — reinicia com o processo (mesmo padrão de
`orchestrator/memory.py` e `orchestrator/status_tracker.py`).
"""

from __future__ import annotations

import time

# Janela de "ativo": o front manda heartbeat a cada 20s (ver loadPresenceHeartbeat
# em script.js) — 45s dá margem pra perder um heartbeat sem sumir da contagem
# à toa (troca de aba, rede lenta, etc.).
_PRESENCE_TTL_SECONDS = 45

_sessions: dict[str, float] = {}


def heartbeat(session_id: str) -> int:
    """Registra que `session_id` está com a página aberta agora. Retorna a
    contagem atual de sessões ativas (incluindo essa)."""
    now = time.monotonic()
    _sessions[session_id] = now
    return _active_count(now)


def get_active_count() -> int:
    return _active_count(time.monotonic())


def _active_count(now: float) -> int:
    expired = [sid for sid, last_seen in _sessions.items() if now - last_seen > _PRESENCE_TTL_SECONDS]
    for sid in expired:
        del _sessions[sid]
    return len(_sessions)
