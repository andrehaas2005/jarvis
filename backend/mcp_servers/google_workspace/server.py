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
    `spreadsheet` aceita nome ou ID.

    IMPORTANTE: `cell_range` precisa começar com o nome REAL da aba — NUNCA
    chute 'Sheet1'/'Planilha1' (nem todo Google Sheets usa esse nome padrão;
    é comum ser 'Página1', ou um nome customizado como 'Transações'). Se
    você ainda não sabe o nome da aba desta planilha nesta conversa, chame
    `read_sheet` primeiro (o retorno traz `sheet_names` com os nomes reais)
    — só então monte o `cell_range`. Achado real em produção: 8 tentativas
    seguidas com 'Planilha1' e 'Sheet1' falharam (HTTP 400 'Unable to parse
    range') antes de acertar."""
    client = _get_client()
    return await asyncio.to_thread(client.write_sheet, spreadsheet, cell_range, values)


@mcp.tool()
async def append_sheet_row(spreadsheet: str, sheet_name: str, values: list[Any]) -> dict:
    """Acrescenta UMA linha nova ao final de uma aba da planilha (não sobrescreve
    nada existente) — use pra 'lançar' um item novo (ex.: uma conta de cobrança).
    `values` é a lista de valores das colunas, na ordem. `spreadsheet` aceita nome ou ID.

    IMPORTANTE: `sheet_name` precisa ser o nome REAL da aba — NUNCA chute
    'Sheet1'/'Planilha1'. Se ainda não souber o nome desta planilha nesta
    conversa, chame `read_sheet` primeiro (retorna `sheet_names`) antes de
    chamar esta ferramenta.

    IMPORTANTE #2 — verifique duplicata antes de chamar: olhe os dados que
    `read_sheet` já retornou e confira se já não existe uma linha pro mesmo
    item (mesma entidade/descrição parecida, mesma data ou mesmo mês). Se
    existir, use `write_sheet` pra corrigir o valor/data dessa linha em vez
    de chamar `append_sheet_row` — nunca duplique uma linha que já existe só
    porque o valor mudou. Achado real em produção: já existia 'Cartão C6'
    com vencimento 01/09 (valor desatualizado) e uma nova linha foi
    acrescentada pro mesmo cartão/mesma data em vez de corrigir a existente."""
    client = _get_client()
    return await asyncio.to_thread(client.append_sheet_row, spreadsheet, sheet_name, values)


@mcp.tool()
async def create_spreadsheet(title: str) -> dict:
    """Cria uma planilha NOVA e vazia no Google Sheets com o título dado.

    SÓ use esta ferramenta quando o usuário pedir explicitamente pra criar
    uma planilha nova. Se o usuário se referir a "minha planilha" ou citar
    um nome de planilha que já deveria existir (orçamento, controle, etc.),
    use `search_drive_files`/`read_sheet`/`write_sheet`/`append_sheet_row`
    nela — NUNCA crie uma planilha nova como substituto por não ter achado
    a certa ou por uma chamada anterior ter falhado. Achado real em
    produção: o usuário pediu pra lançar uma conta 'na minha planilha'
    (referindo-se a uma planilha existente que estava com ela aberta na
    tela) e esta ferramenta foi usada pra criar uma planilha nova e
    diferente — os dados foram parar num arquivo que o usuário não estava
    vendo, e ele achou que nada tinha sido salvo."""
    client = _get_client()
    return await asyncio.to_thread(client.create_spreadsheet, title)


@mcp.tool()
async def create_sheet_tab(spreadsheet: str, title: str, values: list[list[Any]] = None) -> dict:
    """Cria uma aba (sheet) NOVA dentro de uma planilha JÁ EXISTENTE — use isso
    (não `create_spreadsheet`) quando o pedido for organizar algo por assunto
    dentro de uma planilha que o usuário já tem, ex.: "cria uma aba pra essa
    compra com os itens, pra eu comparar preço depois". `spreadsheet` aceita
    nome ou ID (resolvido igual às outras tools). `values` (opcional) já
    escreve o conteúdo inicial a partir de A1 — uma lista de linhas, cada
    linha uma lista de colunas; use pra escrever tudo numa chamada só em vez
    de várias `append_sheet_row`. `title` não pode ter / \\ ? * [ ] : (nomes
    de aba do Google Sheets não aceitam esses caracteres — são trocados por
    "-" automaticamente, então pode passar como estiver)."""
    client = _get_client()
    return await asyncio.to_thread(client.create_sheet_tab, spreadsheet, title, values)


@mcp.tool()
async def create_drive_file(folder_path: str, filename: str, content: str, mime_type: str = "text/plain") -> dict:
    """Cria um arquivo de TEXTO de verdade no Google Drive do usuário (não uma
    planilha/doc — um arquivo comum, ex.: código-fonte, Markdown, backup de conversa),
    dentro de uma pasta (cria a pasta se não existir). Use isso quando o usuário pedir
    pra "salvar"/"exportar" código/testes que você gerou, ou fazer backup de alguma
    conversa, como arquivo real no Drive dele — não confundir com `write_note`
    (memória interna do Jarvis no Obsidian, não é o Drive do usuário).

    `folder_path` organiza em pastas (várias, separadas por "/") — ex.:
    "Jarvis-Chat" pra backup de conversa, ou "Jarvis-Dev/<Empresa>/<Cliente>" pra
    código/teste exportado de um cliente específico. `mime_type` default é texto
    puro; use "text/markdown" pra Markdown, "text/x-swift" (ou deixe texto puro
    mesmo) pra código-fonte — o Drive não valida isso à risca, é só metadado."""
    client = _get_client()
    return await asyncio.to_thread(client.create_drive_file, folder_path, filename, content, mime_type)


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
