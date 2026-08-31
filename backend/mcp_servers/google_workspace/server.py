"""MCP Server do Google Drive/Sheets/Docs (SCRUM-61).

Expõe `search_drive_files`, `read_sheet`, `write_sheet`, `append_sheet_row`,
`create_spreadsheet`, `read_doc`, `append_doc` e `create_doc` como
ferramentas MCP, consumidas pelo backend orquestrador — mesmo padrão de
mcp_servers/gmail, calendar, contacts.

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.google_workspace.server
"""

from __future__ import annotations

import asyncio
from typing import Any

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from mcp_servers.google_workspace.google_workspace_client import GoogleWorkspaceClient

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.google_workspace.server")

mcp = MCPServer(
    name="jarvis-google-workspace",
    description="MCP Server do Google Drive/Sheets/Docs para o JARVIS: buscar arquivos e ler/editar planilhas e documentos.",
)

_client: GoogleWorkspaceClient | None = None


def _get_client() -> GoogleWorkspaceClient:
    global _client
    if _client is None:
        if not settings.google_workspace_credentials_path or not settings.google_workspace_token_path:
            raise RuntimeError(
                "GOOGLE_WORKSPACE_CREDENTIALS_PATH / GOOGLE_WORKSPACE_TOKEN_PATH não configurados "
                "no .env (veja backend/.env.example)."
            )
        _client = GoogleWorkspaceClient(
            credentials_path=settings.google_workspace_credentials_path,
            token_path=settings.google_workspace_token_path,
        )
    return _client


@mcp.tool()
async def search_drive_files(query: str, max_results: int = 10) -> dict:
    """Busca arquivos no Google Drive do usuário por nome (não precisa ser exato).
    Use pra achar o ID de uma planilha/documento antes de ler/editar, ou quando o
    usuário só quer saber se um arquivo existe."""
    client = _get_client()
    files = await asyncio.to_thread(client.search_files, query, None, max_results)
    return {"query": query, "results": [f.__dict__ for f in files]}


@mcp.tool()
async def read_sheet(spreadsheet: str, cell_range: str = "") -> dict:
    """Lê os valores de uma planilha do Google Sheets. `spreadsheet` aceita o
    NOME da planilha (ex.: 'Setembro/26 - Orçamento mensal') ou o ID direto —
    nome é resolvido automaticamente buscando no Drive. `cell_range` opcional
    (ex.: 'Página1!A1:D20'); sem isso, lê a primeira aba inteira."""
    client = _get_client()
    return await asyncio.to_thread(client.read_sheet, spreadsheet, cell_range or None)


@mcp.tool()
async def write_sheet(spreadsheet: str, cell_range: str, values: list[list[Any]]) -> dict:
    """Escreve/sobrescreve valores num intervalo de uma planilha (ex.: 'Página1!A2:D2').
    `values` é uma lista de linhas, cada linha uma lista de valores das colunas.
    `spreadsheet` aceita nome ou ID."""
    client = _get_client()
    return await asyncio.to_thread(client.write_sheet, spreadsheet, cell_range, values)


@mcp.tool()
async def append_sheet_row(spreadsheet: str, sheet_name: str, values: list[Any]) -> dict:
    """Acrescenta UMA linha nova ao final de uma aba da planilha (não sobrescreve
    nada existente) — use pra 'lançar' um item novo (ex.: uma conta de cobrança).
    `values` é a lista de valores das colunas, na ordem. `spreadsheet` aceita nome ou ID."""
    client = _get_client()
    return await asyncio.to_thread(client.append_sheet_row, spreadsheet, sheet_name, values)


@mcp.tool()
async def create_spreadsheet(title: str) -> dict:
    """Cria uma planilha nova e vazia no Google Sheets com o título dado."""
    client = _get_client()
    return await asyncio.to_thread(client.create_spreadsheet, title)


@mcp.tool()
async def read_doc(document: str) -> dict:
    """Lê o conteúdo de texto de um Google Docs. `document` aceita nome ou ID
    (nome é resolvido buscando no Drive)."""
    client = _get_client()
    return await asyncio.to_thread(client.read_doc, document)


@mcp.tool()
async def append_doc(document: str, text: str) -> dict:
    """Acrescenta texto ao final de um Google Docs existente. `document` aceita
    nome ou ID."""
    client = _get_client()
    return await asyncio.to_thread(client.append_doc, document, text)


@mcp.tool()
async def create_doc(title: str, content: str = "") -> dict:
    """Cria um Google Docs novo com o título dado, opcionalmente já com um
    conteúdo inicial."""
    client = _get_client()
    return await asyncio.to_thread(client.create_doc, title, content)


if __name__ == "__main__":
    mcp.run(transport="stdio")
