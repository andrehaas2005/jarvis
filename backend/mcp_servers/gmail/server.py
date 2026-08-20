"""MCP Server do Gmail (SCRUM-14).

Expõe `send_email`, `list_emails` e `read_email` como ferramentas MCP,
consumidas pelo backend orquestrador (SCRUM-16).

`send_email` exige `idempotency_key` e passa pelo módulo `app.retry`
(SCRUM-16) — a mesma chave nunca dispara um segundo envio, o que elimina a
causa raiz do SCRUM-45 (email disparando 8x) e do SCRUM-46 (atomicidade).

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.gmail.server
"""

import asyncio

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from app.retry import RetryConfig, make_idempotency_key, run_idempotent
from mcp_servers.gmail.gmail_client import GmailClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.gmail.server")

mcp = MCPServer(
    name="jarvis-gmail",
    description="MCP Server do Gmail para o JARVIS: envio e leitura de emails com idempotência.",
)

_client: GmailClient | None = None


def _get_client() -> GmailClient:
    global _client
    if _client is None:
        if not settings.gmail_credentials_path or not settings.gmail_token_path:
            raise RuntimeError(
                "GMAIL_CREDENTIALS_PATH / GMAIL_TOKEN_PATH não configurados no .env "
                "(veja backend/.env.example)."
            )
        _client = GmailClient(
            credentials_path=settings.gmail_credentials_path,
            token_path=settings.gmail_token_path,
        )
    return _client


@mcp.tool()
async def send_email(to: str, subject: str, body: str, idempotency_key: str) -> dict:
    """Envia um email pelo Gmail.

    `idempotency_key` é obrigatória: identifica unicamente esta intenção de
    envio (ex.: hash de to+subject+body, ou um ID vindo do chamador). Se a
    mesma chave for reenviada — por retry do agente de voz, webhook duplicado
    etc. — o email NÃO é enviado de novo; o resultado do primeiro envio é
    devolvido.
    """
    client = _get_client()

    async def _do_send():
        return await asyncio.to_thread(client.send_email, to, subject, body)

    key = make_idempotency_key("gmail.send_email", idempotency_key)
    return await run_idempotent(
        key,
        _do_send,
        RetryConfig(max_attempts=settings.jarvis_retry_max_attempts, backoff_seconds=settings.jarvis_retry_backoff_seconds),
    )


@mcp.tool()
async def list_emails(query: str = "", max_results: int = 10) -> list[dict]:
    """Lista emails do Gmail. `query` aceita a mesma sintaxe de busca do Gmail
    (ex.: 'from:fulano@exemplo.com is:unread')."""
    client = _get_client()
    emails = await asyncio.to_thread(client.list_emails, query, max_results)
    return [
        {
            "id": e.id,
            "thread_id": e.thread_id,
            "subject": e.subject,
            "sender": e.sender,
            "snippet": e.snippet,
        }
        for e in emails
    ]


@mcp.tool()
async def read_email(message_id: str) -> dict:
    """Lê o conteúdo completo de um email específico pelo seu ID."""
    client = _get_client()
    return await asyncio.to_thread(client.read_email, message_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
