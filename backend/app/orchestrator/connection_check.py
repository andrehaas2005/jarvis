"""Teste de conexão real por serviço (SCRUM-60) — diferente do check-in
passivo (`status_tracker.py`, que só registra o que já foi usado numa
conversa), isto dispara uma chamada leve e silenciosa AGORA, sob demanda:
botão na Settings/HUD, ou o comando de voz "conectar os serviços".

Reaproveita `orchestrator.tools.execute_tool` de propósito — assim o
resultado também alimenta o `status_tracker`, e o painel de check-in
"real" reflete o teste sem precisar de um caminho de código duplicado.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.orchestrator.tools import execute_tool

# tool + argumentos mínimos que servem só pra confirmar que a API responde —
# sem custo de listar/mostrar dado nenhum pro usuário (o botão não deve
# "printar" nada, só mudar o indicador).
_PING_CALLS: dict[str, tuple[str, dict[str, Any]]] = {
    "email": ("list_emails", {"max_results": 1}),
    "contacts": ("search_contact", {"name": ""}),
}


def _calendar_ping_args() -> dict[str, Any]:
    # janela de 1 dia a partir de agora — max_results=1 mantém a chamada barata
    # mesmo numa agenda cheia; o valor exato não importa, só a resposta 200.
    now = datetime.now(timezone.utc)
    return {"time_min": now.isoformat(), "time_max": (now + timedelta(days=1)).isoformat(), "max_results": 1}


CHECKABLE_SERVICES = ("email", "calendar", "contacts")


async def check_service(service: str) -> dict[str, Any]:
    """Testa um serviço só — usado pelo botão individual (`POST
    /status/connect`) e por `check_all_connections`."""
    if service not in CHECKABLE_SERVICES:
        raise ValueError(f"serviço desconhecido: {service!r} (aceita {CHECKABLE_SERVICES})")

    if service == "calendar":
        tool_name, tool_args = "list_events", _calendar_ping_args()
    else:
        tool_name, tool_args = _PING_CALLS[service]

    try:
        await execute_tool(tool_name, tool_args)
        return {"service": service, "connected": True, "error": None}
    except Exception as exc:  # noqa: BLE001 — qualquer falha de rede/API vira "não conectado"
        return {"service": service, "connected": False, "error": str(exc)}


async def check_all_connections() -> dict[str, dict[str, Any]]:
    """Testa os 3 serviços em paralelo — usado pelo comando de voz "conectar
    os serviços" (tool `check_service_connections`, ver tools.py)."""
    results = await asyncio.gather(*(check_service(service) for service in CHECKABLE_SERVICES))
    return {result["service"]: result for result in results}
