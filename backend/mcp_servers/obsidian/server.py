"""MCP Server do vault Obsidian (SCRUM-63) — "segundo cérebro" do Jarvis.

Expõe `search_notes`, `read_note`, `write_note`, `append_note` e `list_notes` como
ferramentas MCP, consumidas pelo backend orquestrador — mesmo padrão de
mcp_servers/gmail, calendar, contacts.

Escopo: memória CURADA (fatos, preferências, decisões, perfis de pessoas) — não o
histórico bruto de conversa, que continua em SessionMemory (app/orchestrator/memory.py).

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.obsidian.server
"""

from __future__ import annotations

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from mcp_servers.obsidian.obsidian_client import Note, ObsidianClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.obsidian.server")

mcp = MCPServer(
    name="jarvis-obsidian",
    description="MCP Server do vault Obsidian para o JARVIS: memória de longo prazo curada (fatos, preferências, projetos, pessoas).",
)

_client: ObsidianClient | None = None


def _get_client() -> ObsidianClient:
    global _client
    if _client is None:
        if not settings.obsidian_vault_path:
            raise RuntimeError(
                "OBSIDIAN_VAULT_PATH não configurado no .env (veja backend/.env.example)."
            )
        _client = ObsidianClient(settings.obsidian_vault_path)
    return _client


def _note_to_dict(note: Note) -> dict:
    return {
        "path": note.path,
        "title": note.title,
        "content": note.content,
        "tags": note.tags,
        "links": note.links,
    }


@mcp.tool()
async def search_notes(query: str, max_results: int = 10) -> dict:
    """Busca notas no vault por texto (título, tags ou conteúdo)."""
    notes = _get_client().search_notes(query, max_results=max_results)
    return {"query": query, "results": [_note_to_dict(n) for n in notes]}


@mcp.tool()
async def read_note(path: str) -> dict:
    """Lê o conteúdo completo de uma nota específica pelo caminho (ex.: 'Fatos/comida-favorita')."""
    note = _get_client().read_note(path)
    return _note_to_dict(note)


@mcp.tool()
async def write_note(path: str, content: str, tags: list[str] | None = None) -> dict:
    """Cria uma nota nova ou sobrescreve uma existente por completo. Use pra registrar um
    fato/preferência/decisão novo, ou pra reescrever uma nota já existente do zero."""
    note = _get_client().write_note(path, content, tags=tags)
    return _note_to_dict(note)


@mcp.tool()
async def append_note(path: str, content: str) -> dict:
    """Acrescenta conteúdo ao final de uma nota existente (cria se não existir). Use pra
    complementar uma nota sem apagar o que já estava escrito nela."""
    note = _get_client().append_note(path, content)
    return _note_to_dict(note)


@mcp.tool()
async def list_notes(folder: str = "") -> dict:
    """Lista os caminhos de todas as notas do vault (ou de uma pasta específica, ex.: 'Fatos')."""
    return {"folder": folder or "(raiz)", "notes": _get_client().list_notes(folder)}


if __name__ == "__main__":
    mcp.run(transport="stdio")
