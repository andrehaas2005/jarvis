"""MCP Server de Contacts / Airtable (SCRUM-49).

Expõe `search_contact` e `add_or_update_contact` como ferramentas MCP.

Nasceu do diagnóstico do SCRUM-47 (Calendar Agent intermitente): o Calendar
Agent do n8n não tinha nenhum jeito determinístico de resolver nome→email
de um attendee — dependia do LLM alucinar ou de contexto de conversa. Este
MCP Server fecha essa lacuna: o backend orquestrador (SCRUM-16) deve chamar
`search_contact(name)` antes de `calendar.create_event` sempre que o
attendee vier como nome em vez de email.

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.contacts.server
"""

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from mcp_servers.contacts.contacts_client import ContactsClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.contacts.server")

mcp = MCPServer(
    name="jarvis-contacts",
    description="MCP Server de contatos (Airtable) para o JARVIS: lookup determinístico nome → email.",
)

_client: ContactsClient | None = None


def _get_client() -> ContactsClient:
    global _client
    if _client is None:
        if not settings.airtable_api_key or not settings.airtable_base_id:
            raise RuntimeError(
                "AIRTABLE_API_KEY / AIRTABLE_BASE_ID não configurados no .env "
                "(veja backend/.env.example)."
            )
        _client = ContactsClient(
            api_key=settings.airtable_api_key,
            base_id=settings.airtable_base_id,
            table_name=settings.airtable_table_name,
        )
    return _client


@mcp.tool()
async def search_contact(name: str) -> dict:
    """Busca um contato pelo nome exato. Retorna os campos do contato
    (name, email, phone) ou found=False se não existir na agenda."""
    client = _get_client()
    contact = await client.search_contact(name)
    if contact is None:
        return {"found": False}
    return {
        "found": True,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
    }


@mcp.tool()
async def add_or_update_contact(name: str, email: str = "", phone: str = "") -> dict:
    """Cria um novo contato ou atualiza um existente (casamento pelo nome).
    Passe apenas os campos que quer definir/alterar — os demais ficam como estão."""
    client = _get_client()
    contact = await client.upsert_contact(name, email, phone)
    return {
        "record_id": contact.record_id,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")
