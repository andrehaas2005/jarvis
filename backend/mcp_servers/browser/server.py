"""MCP Server do navegador interno (SCRUM-69).

Expõe `browser_open`, `browser_scroll`, `browser_click`, `browser_type`,
`browser_close_tab`, `browser_list_tabs`, `browser_bookmark_add`,
`browser_bookmark_list` e `browser_bookmark_remove` como ferramentas MCP.

Diferente de `websearch` (busca texto/snippets), este server abre e mostra
a página de verdade — pro painel flutuante do HUD (ver `/browser/*` em
main.py, mesmo padrão do `/obsidian/graph`).

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.browser.server
"""

from __future__ import annotations

from mcp.server import MCPServer

from app.config import get_settings
from app.logging_config import get_logger, setup_logging
from mcp_servers.browser.browser_client import BookmarkStore, BrowserManager

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.browser.server")

mcp = MCPServer(
    name="jarvis-browser",
    description="Navegador interno do JARVIS: abre, navega e mostra páginas de verdade num painel flutuante do HUD.",
)

_manager: BrowserManager | None = None
_bookmarks: BookmarkStore | None = None


def get_manager() -> BrowserManager:
    global _manager
    if _manager is None:
        _manager = BrowserManager(
            max_tabs=settings.browser_max_tabs,
            idle_timeout_seconds=settings.browser_idle_timeout_seconds,
        )
    return _manager


def get_bookmarks() -> BookmarkStore:
    global _bookmarks
    if _bookmarks is None:
        if not settings.browser_bookmarks_path:
            raise RuntimeError("BROWSER_BOOKMARKS_PATH não configurado no .env (veja backend/.env.example).")
        _bookmarks = BookmarkStore(settings.browser_bookmarks_path)
    return _bookmarks


def _tab_result(tab) -> dict:
    return {"tab_id": tab.id, "title": tab.title, "url": tab.url}


@mcp.tool()
async def browser_open(url: str, tab_id: str = "") -> dict:
    """Abre `url` no navegador interno (painel flutuante do HUD) — use
    quando o usuário pedir pra abrir/navegar/consultar um site de verdade
    (diferente de `web_search`, que só traz snippets de busca).

    Sem `tab_id`, abre numa aba NOVA. Passe o `tab_id` de uma aba já aberta
    (retornado por esta ferramenta ou por `browser_list_tabs`) pra navegar
    NELA em vez de abrir outra — use isso quando o usuário disser 'nessa
    mesma aba'/'aqui' em vez de 'numa aba nova'. Só existem no máximo
    algumas abas simultâneas (as mais antigas sem uso fecham sozinhas) —
    isso é normal, não é erro.

    Retorna `tab_id`/`title`/`url` (não a imagem — o HUD busca o screenshot
    sozinho pelo `tab_id`, não descreva o conteúdo visual sem antes checar
    o que a página realmente diz, se for resumir pro usuário)."""
    tab = await get_manager().open(url, tab_id or None)
    return _tab_result(tab)


@mcp.tool()
async def browser_scroll(tab_id: str, direction: str = "down", amount: int = 700) -> dict:
    """Rola a página numa aba aberta. `direction`: 'up' ou 'down'."""
    tab = await get_manager().scroll(tab_id, direction, amount)
    return _tab_result(tab)


@mcp.tool()
async def browser_click(tab_id: str, x: float, y: float) -> dict:
    """Clica na posição (x, y) em pixels da aba — as mesmas coordenadas do
    screenshot que o HUD mostra (viewport 1280x800). Use pra navegar
    clicando em links/botões da página."""
    tab = await get_manager().click(tab_id, x, y)
    return _tab_result(tab)


@mcp.tool()
async def browser_type(tab_id: str, text: str, press_enter: bool = False) -> dict:
    """Digita `text` no elemento focado da aba (ex.: depois de um
    `browser_click` num campo de busca). `press_enter=True` pra submeter."""
    tab = await get_manager().type_text(tab_id, text, press_enter)
    return _tab_result(tab)


@mcp.tool()
async def browser_close_tab(tab_id: str) -> dict:
    """Fecha uma aba do navegador interno."""
    await get_manager().close_tab(tab_id)
    return {"closed": tab_id}


@mcp.tool()
async def browser_list_tabs() -> dict:
    """Lista as abas abertas no navegador interno agora (id/título/URL)."""
    return {"tabs": await get_manager().list_tabs()}


@mcp.tool()
async def browser_bookmark_add(title: str, url: str) -> dict:
    """Salva um favorito (título + URL) — pra voltar depois rapidamente.
    Isso é uma lista simples, diferente de guardar como conhecimento
    permanente no segundo cérebro: se a página for relevante o bastante pra
    ENSINAR algo (não só "lembrar de voltar aqui"), prefira registrar com
    `write_note`/`append_note` (segundo cérebro) resumindo o aprendizado, em
    vez de (ou além de) favoritar."""
    return get_bookmarks().add(title, url)


@mcp.tool()
async def browser_bookmark_list() -> dict:
    """Lista os favoritos salvos, mais recente primeiro."""
    return {"bookmarks": get_bookmarks().list()}


@mcp.tool()
async def browser_bookmark_remove(bookmark_id: str) -> dict:
    """Remove um favorito pelo `id` (retornado por `browser_bookmark_list`)."""
    removed = get_bookmarks().remove(bookmark_id)
    return {"removed": removed}


if __name__ == "__main__":
    mcp.run(transport="stdio")
