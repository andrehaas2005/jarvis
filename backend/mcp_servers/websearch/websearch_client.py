"""Clientes HTTP dos provedores de busca na web (SCRUM-65).

Dois provedores, cada função devolve o mesmo formato normalizado (lista de
dicts com `title`/`url`/`snippet`) — quem chama (server.py) não precisa
saber qual provedor respondeu, só faz a alternância entre eles.
"""

from __future__ import annotations

from typing import Any

import httpx

_TAVILY_URL = "https://api.tavily.com/search"
_BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"


async def search_tavily(query: str, api_key: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Tavily é feito pra consumo por agentes de IA — devolve resultados já
    com um resumo/snippet direto, sem precisar raspar a página."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            _TAVILY_URL,
            json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
            },
        )
        response.raise_for_status()
        data = response.json()

    return [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("content", ""),
        }
        for item in data.get("results", [])
    ]


async def search_brave(query: str, api_key: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Brave Search API — resultados mais "crus" (título/link/descrição),
    tipo uma busca do Google mesmo."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            _BRAVE_URL,
            headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            params={"q": query, "count": max_results},
        )
        response.raise_for_status()
        data = response.json()

    results = data.get("web", {}).get("results", [])
    return [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        }
        for item in results[:max_results]
    ]
