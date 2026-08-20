"""MCP Server do Google Calendar (SCRUM-15).

Expõe `create_event`, `list_events` e `get_event` como ferramentas MCP,
consumidas pelo backend orquestrador (SCRUM-16).

`create_event` exige `idempotency_key` e passa pelo módulo `app.retry`
(SCRUM-16) — a mesma chave nunca cria um segundo evento, o que ataca a
causa raiz do SCRUM-47 (Calendar Agent intermitente: retries do agente de
voz criando eventos duplicados quando a chamada original só demorou a
responder).

`create_event` também resolve `attendees` que vierem como nome (não
email) via o Contacts MCP Server (SCRUM-49) antes de criar o evento —
fecha a outra causa raiz do SCRUM-47: o agente antigo não tinha lookup
determinístico de nome→email, só o LLM alucinando o email do attendee.

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.calendar.server
"""

import asyncio

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from app.retry import RetryConfig, make_idempotency_key, run_idempotent
from mcp_servers.calendar.calendar_client import CalendarClient
from mcp_servers.contacts.contacts_client import ContactsClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.calendar.server")

mcp = MCPServer(
    name="jarvis-calendar",
    description="MCP Server do Google Calendar para o JARVIS: consulta e criação de eventos com idempotência.",
)

_client: CalendarClient | None = None
_contacts_client: ContactsClient | None = None


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


def _get_contacts_client() -> ContactsClient | None:
    """None se o Contacts (SCRUM-49) não estiver configurado — nesse caso
    attendees precisam vir como email direto (sem lookup por nome)."""
    global _contacts_client
    if _contacts_client is None and settings.contacts_credentials_path and settings.contacts_token_path:
        _contacts_client = ContactsClient(
            credentials_path=settings.contacts_credentials_path,
            token_path=settings.contacts_token_path,
        )
    return _contacts_client


async def _resolve_attendee(raw: str) -> str:
    """Resolve um attendee pro email. Se já parece email, devolve como
    está. Senão, busca no Contacts (nome parcial ou completo — ver
    SCRUM-49). Levanta `ValueError` (com uma mensagem acionável) se não
    achar exatamente um contato — nunca adivinha, pra não repetir o bug
    do SCRUM-47."""
    if "@" in raw:
        return raw

    contacts = _get_contacts_client()
    if contacts is None:
        raise ValueError(
            f"Attendee '{raw}' não é um email e o Contacts (SCRUM-49) não está configurado "
            "neste ambiente — passe o email direto ou configure CONTACTS_CREDENTIALS_PATH/"
            "CONTACTS_TOKEN_PATH."
        )

    contact, candidates = await asyncio.to_thread(contacts.search_contact, raw)

    if contact is not None:
        if not contact.email:
            raise ValueError(f"O contato '{contact.name}' foi encontrado mas não tem email cadastrado.")
        return contact.email

    if candidates:
        names = ", ".join(c.name for c in candidates)
        raise ValueError(
            f"'{raw}' bate com mais de um contato ({names}) — peça pro usuário especificar "
            "melhor (ex.: sobrenome) antes de criar o evento."
        )

    raise ValueError(
        f"Não encontrei nenhum contato chamado '{raw}' — confirme o nome ou peça o email direto."
    )


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

    `attendees` aceita tanto emails quanto nomes (ex.: `["Maria Aparecida",
    "fulano@example.com"]`) — nomes são resolvidos via Contacts (SCRUM-49)
    antes de criar o evento. Se um nome não achar exatamente um contato
    (nenhum ou mais de um), o evento NÃO é criado e um erro descritivo é
    levantado — nunca adivinha o email.
    """
    client = _get_client()

    resolved_attendees = None
    if attendees:
        resolved_attendees = [await _resolve_attendee(a) for a in attendees]

    async def _do_create():
        return await asyncio.to_thread(
            client.create_event, summary, start, end, description, resolved_attendees
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
