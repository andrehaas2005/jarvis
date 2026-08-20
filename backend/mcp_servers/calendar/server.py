"""MCP Server do Google Calendar (SCRUM-15).

Expõe `create_event`, `list_events` e `get_event` como ferramentas MCP,
consumidas pelo backend orquestrador (SCRUM-16).

`create_event` exige `idempotency_key` e passa pelo módulo `app.retry`
(SCRUM-16) — a mesma chave nunca cria um segundo evento, o que ataca a
causa raiz do SCRUM-47 (Calendar Agent intermitente: retries do agente de
voz criando eventos duplicados quando a chamada original só demorou a
responder).

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.calendar.server
"""

import asyncio

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from app.retry import RetryConfig, make_idempotency_key, run_idempotent
from mcp_servers.calendar.calendar_client import CalendarClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.calendar.server")

mcp = MCPServer(
    name="jarvis-calendar",
    description="MCP Server do Google Calendar para o JARVIS: consulta e criação de eventos com idempotência.",
)

_client: CalendarClient | None = None


def _get_client() -> CalendarClient:
    global _client
    if _client is None:
        if not settings.calendar_credentials_path or not settings.calendar_token_path:
            raise RuntimeError(
                "CALENDAR_CREDENTIALS_PATH / CALENDAR_TOKEN_PATH não configurados no .env "
                "(veja backend/.env.example)."
            )
        _client = CalendarClient(
            credentials_path=settings.calendar_credentials_path,
            token_path=settings.calendar_token_path,
        )
    return _client


@mcp.tool()
async def create_event(
    summary: str,
    start: str,
    end: str,
    idempotency_key: str,
    description: str = "",
    attendees: list[str] | None = None,
) -> dict:
    """Cria um evento no Google Calendar.

    `start`/`end` em ISO 8601 (ex.: '2026-08-20T15:00:00-03:00').

    `idempotency_key` é obrigatória: identifica unicamente esta intenção de
    criação (ex.: hash de summary+start+end, ou um ID vindo do chamador).
    Se a mesma chave for reenviada — retry do agente de voz, timeout seguido
    de nova tentativa etc. — o evento NÃO é criado de novo; o resultado da
    primeira criação é devolvido. Isso elimina eventos duplicados, a causa
    raiz do SCRUM-47.
    """
    client = _get_client()

    async def _do_create():
        return await asyncio.to_thread(
            client.create_event, summary, start, end, description, attendees
        )

    key = make_idempotency_key("calendar.create_event", idempotency_key)
    return await run_idempotent(
        key,
        _do_create,
        RetryConfig(max_attempts=settings.jarvis_retry_max_attempts, backoff_seconds=settings.jarvis_retry_backoff_seconds),
    )


@mcp.tool()
async def list_events(time_min: str, time_max: str, max_results: int = 10) -> list[dict]:
    """Lista eventos do Google Calendar em um período.

    `time_min`/`time_max` em ISO 8601 (ex.: '2026-08-20T00:00:00-03:00')."""
    client = _get_client()
    events = await asyncio.to_thread(client.list_events, time_min, time_max, max_results)
    return [
        {
            "id": e.id,
            "summary": e.summary,
            "start": e.start,
            "end": e.end,
            "description": e.description,
            "html_link": e.html_link,
        }
        for e in events
    ]


@mcp.tool()
async def get_event(event_id: str) -> dict:
    """Lê os detalhes de um evento específico pelo seu ID."""
    client = _get_client()
    return await asyncio.to_thread(client.get_event, event_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
