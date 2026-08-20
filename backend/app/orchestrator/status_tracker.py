"""Rastreador de status das capacidades (Email/Calendar/Contacts) — dado
real de uso, não um ping sintético.

Nasceu do SCRUM-52: o Jarvis dizia "não tenho acesso" por voz mesmo com o
backend funcionando — sem visibilidade real de sucesso/falha por
ferramenta, era impossível confirmar rápido se era bug ou o modelo
alucinando. Cada chamada de tool (`app/orchestrator/tools.py`) registra
aqui o resultado; `GET /status/checkin` expõe isso pro painel do HUD.

Em memória, não persistido — reinicia com o processo (igual à memória de
sessão, ver `memory.py`). Suficiente pro uso atual: o painel mostra
"últimas N chamadas desde que o backend subiu", não histórico eterno.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any

MAX_EVENTS_PER_CAPABILITY = 50

# Agrupa as 8 tools em 3 capacidades visíveis no painel (nomes user-facing).
_TOOL_TO_CAPABILITY = {
    "send_email": "email",
    "list_emails": "email",
    "read_email": "email",
    "create_event": "calendar",
    "list_events": "calendar",
    "get_event": "calendar",
    "search_contact": "contacts",
    "add_or_update_contact": "contacts",
}

CAPABILITIES = ("email", "calendar", "contacts")


class StatusTracker:
    def __init__(self) -> None:
        self._events: dict[str, deque[dict[str, Any]]] = {
            cap: deque(maxlen=MAX_EVENTS_PER_CAPABILITY) for cap in CAPABILITIES
        }

    def record(self, tool_name: str, *, ok: bool, error: str | None = None) -> None:
        capability = _TOOL_TO_CAPABILITY.get(tool_name)
        if capability is None:
            return
        self._events[capability].append(
            {"tool": tool_name, "ok": ok, "error": error, "at": time.time()}
        )

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Estado atual de cada capacidade pro painel de check-in."""
        result: dict[str, dict[str, Any]] = {}
        for capability, events in self._events.items():
            events_list = list(events)
            if not events_list:
                result[capability] = {
                    "status": "sem_dados",
                    "last_call_at": None,
                    "last_ok": None,
                    "last_error": None,
                    "calls_tracked": 0,
                    "success_rate": None,
                }
                continue

            last = events_list[-1]
            successes = sum(1 for e in events_list if e["ok"])
            result[capability] = {
                "status": "ok" if last["ok"] else "erro",
                "last_call_at": last["at"],
                "last_ok": last["ok"],
                "last_error": last["error"],
                "calls_tracked": len(events_list),
                "success_rate": round(successes / len(events_list), 2),
            }
        return result


_tracker = StatusTracker()


def get_status_tracker() -> StatusTracker:
    return _tracker
