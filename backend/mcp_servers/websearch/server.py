"""MCP Server de busca na web (SCRUM-65).

Expõe `web_search` como ferramenta MCP — pedido do usuário: dar ao Jarvis
capacidade de pesquisar na internet, com dois provedores configuráveis pela
Settings Page (Tavily e Brave, cada um com sua própria chave) e alternância
automática entre eles: se o provedor preferido falhar (chave ausente/
inválida, erro de rede, limite excedido), tenta o outro sozinho, sem expor
esse detalhe pro usuário — só cai pro genérico "não consegui buscar" se os
dois falharem (ou se nenhum tiver chave configurada).

Rodar standalone (stdio, para testar com um MCP client/inspector):
    python -m mcp_servers.websearch.server
"""

from __future__ import annotations

from mcp.server import MCPServer

from app.logging_config import get_logger, setup_logging
from app.config import get_settings
from app.settings_store import get_search_config
from mcp_servers.websearch.websearch_client import search_brave, search_tavily

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.mcp.websearch.server")

mcp = MCPServer(
    name="jarvis-websearch",
    description="MCP Server de busca na web (Tavily/Brave, com alternância automática) para o JARVIS.",
)

_PROVIDER_FUNCS = {
    "tavily": search_tavily,
    "brave": search_brave,
}


@mcp.tool()
async def web_search(query: str, max_results: int = 5) -> dict:
    """Busca `query` na internet e devolve uma lista de resultados (title,
    url, snippet) pra você resumir pro usuário — nunca invente uma resposta
    sem checar aqui quando o pedido depender de informação atual/externa
    (notícias, preços, "o que é X", eventos recentes, etc.).

    Tenta o provedor preferido (configurado na Settings Page) primeiro; se
    falhar e o outro provedor tiver uma chave configurada, tenta o outro
    automaticamente antes de desistir."""
    config = get_search_config()
    preferred = config["search_provider"]
    order = [preferred] + [p for p in _PROVIDER_FUNCS if p != preferred]

    keys = {"tavily": config["tavily_api_key"], "brave": config["brave_api_key"]}
    errors: dict[str, str] = {}

    for provider in order:
        api_key = keys.get(provider, "")
        if not api_key:
            errors[provider] = "sem chave de API configurada"
            continue
        try:
            results = await _PROVIDER_FUNCS[provider](query, api_key, max_results)
            if provider != preferred:
                logger.info(
                    "websearch_fallback_used",
                    extra={"extra_fields": {"preferred": preferred, "used": provider}},
                )
            return {"provider": provider, "query": query, "results": results}
        except Exception as exc:  # noqa: BLE001 — qualquer falha tenta o próximo provedor
            errors[provider] = str(exc)
            logger.warning(
                "websearch_provider_failed",
                extra={"extra_fields": {"provider": provider, "error": str(exc)}},
            )

    raise RuntimeError(
        f"Nenhum provedor de busca disponível/funcionando agora. Detalhes: {errors}"
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
