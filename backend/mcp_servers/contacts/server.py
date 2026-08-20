"""MCP Server de Contacts / Google Sheets (SCRUM-49).

Expõe `search_contact` e `add_or_update_contact` como ferramentas MCP.

Nasceu do diagnóstico do SCRUM-47 (Calendar Agent intermitente): o Calendar
Agent do n8n não tinha nenhum jeito determinístico de resolver nome→email
de um attendee — dependia do LLM alucinar ou de contexto de conversa. Este
MCP Server fecha essa lacuna: o backend orquestrador (SCRUM-16) deve chamar
`search_contact(name)` antes de `calendar.create_event` sempre que o
attendee vier como nome em vez de email.

Usa a Google People API (Contatos do Google) — os contatos reais do
usuário, mesma conta já usada pelo Gmail/Calendar, sem cadastro duplicado
e sem custo.

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.contacts.server
"""

import asyncio

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from mcp_servers.contacts.contacts_client import ContactsClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.contacts.server")

mcp = MCPServer(
    name="jarvis-contacts",
    description="MCP Server de contatos (Google Contacts / People API) para o JARVIS: lookup determinístico nome → email.",
)

_client: ContactsClient | None = None


def _get_client() -> ContactsClient:
    global _client
    if _client is None:
        if not settings.contacts_credentials_path or not settings.contacts_token_path:
            raise RuntimeError(
                "CONTACTS_CREDENTIALS_PATH / CONTACTS_TOKEN_PATH não configurados no .env "
                "(veja backend/.env.example)."
            )
        _client = ContactsClient(
            credentials_path=settings.contacts_credentials_path,
            token_path=settings.contacts_token_path,
        )
    return _client


@mcp.tool()
async def search_contact(name: str) -> dict:
    """Busca um contato pelo nome (aceita nome parcial, ex.: "Maria" acha
    "Maria Aparecida de Oliveira" se só existir uma). Retorna os campos do
    contato (name, email, phone) se achar exatamente um.

    Se `name` bater em mais de um contato, retorna `found=False,
    ambiguous=True` e a lista de `candidates` — quem chamou deve pedir pra
    o usuário especificar melhor (ex.: sobrenome) antes de seguir.
    Se não achar nenhum, retorna só `found=False`."""
    client = _get_client()
    contact, candidates = await asyncio.to_thread(client.search_contact, name)
    if contact is not None:
        return {
            "found": True,
            "name": contact.name,
            "email": contact.email,
            "phone": contact.phone,
        }
    if candidates:
        return {
            "found": False,
            "ambiguous": True,
            "candidates": [{"name": c.name, "email": c.email} for c in candidates],
        }
    return {"found": False}


@mcp.tool()
async def add_or_update_contact(name: str, email: str = "", phone: str = "") -> dict:
    """Cria um novo contato ou atualiza um existente (casamento pelo nome).
    Passe apenas os campos que quer definir/alterar — os demais ficam como estão."""
    client = _get_client()
    contact = await asyncio.to_thread(client.upsert_contact, name, email, phone)
    return {
        "resource_name": contact.resource_name,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")
