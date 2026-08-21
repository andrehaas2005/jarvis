"""Provedores de LLM pro orquestrador (SCRUM-17).

Interface pequena de propósito: dado um system prompt, um histórico de
mensagens e uma lista de tools, roda o loop de tool-calling até o modelo
devolver uma resposta final em texto. Cada provedor concreto (Anthropic
hoje, OpenAI/outro no futuro) implementa só `run_tool_loop` — trocar de
provedor é trocar `LLM_PROVIDER` no `.env` e adicionar uma classe nova
aqui, sem tocar no resto do orquestrador (`router.py`, `tools.py`).
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable

from app.logging_config import get_logger

logger = get_logger("jarvis.orchestrator.providers")

# (tool_name, tool_input) -> resultado (serializado como string antes de voltar pro LLM)
ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str]]

MAX_TOOL_ITERATIONS = 6


class LLMProvider(ABC):
    """Contrato mínimo que todo provedor de LLM do orquestrador implementa."""

    @abstractmethod
    async def run_tool_loop(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> tuple[str, list[dict[str, Any]]]:
        """Roda o loop de tool-calling até o modelo parar de chamar ferramentas.

        Retorna `(texto_final, messages_atualizado)` — `messages_atualizado`
        inclui os turnos de assistant/tool_result gerados nesta chamada, pra
        quem chamou poder persistir na memória de sessão."""


class AnthropicProvider(LLMProvider):
    """Loop manual de tool-calling via Claude API (sem beta tool_runner —
    mantém o orquestrador sem dependência de recurso beta)."""

    def __init__(self, api_key: str, model: str) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    async def run_tool_loop(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> tuple[str, list[dict[str, Any]]]:
        messages = list(messages)

        for _ in range(MAX_TOOL_ITERATIONS):
            response = await asyncio.to_thread(
                self._client.messages.create,
                model=self._model,
                max_tokens=2048,
                system=system,
                tools=tools,
                messages=messages,
            )
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use":
                text = next((b.text for b in response.content if b.type == "text"), "")
                return text, messages

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
            tool_results = []
            for block in tool_use_blocks:
                try:
                    result = await tool_executor(block.name, block.input)
                    tool_results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": str(result)}
                    )
                except Exception as exc:  # noqa: BLE001 — devolve o erro pro LLM decidir o que fazer
                    logger.warning(
                        "orchestrator_tool_error",
                        extra={"extra_fields": {"tool": block.name, "error": str(exc)}},
                    )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": str(exc),
                            "is_error": True,
                        }
                    )
            messages.append({"role": "user", "content": tool_results})

        raise RuntimeError(
            f"orquestrador: excedeu {MAX_TOOL_ITERATIONS} iterações de tool-calling sem resposta final"
        )


class OllamaProvider(LLMProvider):
    """Modelo local via Ollama (SCRUM-23) — qualquer modelo instalado no
    servidor Ollama, não só um nome fixo (ex.: 'qwen3:4b', 'llama3.1',
    'mistral'...). Requer um modelo com suporte a tool-calling (a maioria
    dos modelos recentes do Ollama tem); modelos sem suporte simplesmente
    nunca vão chamar `tool_calls` e o loop devolve o texto direto.

    Usa a API nativa do Ollama (`/api/chat`, não a compatível com OpenAI)
    — formato de tools é bem parecido com o da Anthropic, só troca
    `input_schema` por `parameters` dentro de um wrapper `function`."""

    def __init__(self, base_url: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    @staticmethod
    def _to_ollama_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool["input_schema"],
                },
            }
            for tool in tools
        ]

    async def run_tool_loop(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> tuple[str, list[dict[str, Any]]]:
        import httpx

        ollama_tools = self._to_ollama_tools(tools)
        # Mensagens no formato Anthropic (content pode ser lista de blocks) não
        # servem direto pro Ollama — só precisamos do texto simples do usuário
        # aqui, já que quem monta o histórico (router.py) só grava turnos
        # user/assistant de texto puro nesse ponto do fluxo.
        chat_messages = [{"role": "system", "content": system}]
        chat_messages.extend(
            {"role": m["role"], "content": m["content"] if isinstance(m["content"], str) else str(m["content"])}
            for m in messages
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            for _ in range(MAX_TOOL_ITERATIONS):
                response = await client.post(
                    f"{self._base_url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": chat_messages,
                        "tools": ollama_tools,
                        "stream": False,
                    },
                )
                response.raise_for_status()
                data = response.json()
                message = data["message"]
                chat_messages.append(message)

                tool_calls = message.get("tool_calls") or []
                if not tool_calls:
                    text = message.get("content", "")
                    return text, messages + [{"role": "assistant", "content": text}]

                for call in tool_calls:
                    fn = call["function"]
                    try:
                        result = await tool_executor(fn["name"], fn.get("arguments") or {})
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "orchestrator_tool_error",
                            extra={"extra_fields": {"tool": fn["name"], "error": str(exc)}},
                        )
                        result = f"Erro: {exc}"
                    chat_messages.append({"role": "tool", "content": str(result)})

        raise RuntimeError(
            f"orquestrador (Ollama): excedeu {MAX_TOOL_ITERATIONS} iterações de tool-calling sem resposta final"
        )


def get_provider(
    provider_name: str, *, api_key: str, model: str, ollama_base_url: str = "http://localhost:11434"
) -> LLMProvider:
    """Fábrica: provedor efetivo (ver `app/settings_store.py` — configurável
    em runtime pela Settings Page, sem precisar editar `.env`/reiniciar)."""
    if provider_name == "anthropic":
        return AnthropicProvider(api_key=api_key, model=model)
    if provider_name == "ollama":
        return OllamaProvider(base_url=ollama_base_url, model=model)
    raise ValueError(f"LLM_PROVIDER '{provider_name}' não suportado (aceita 'anthropic' ou 'ollama').")
