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


def get_provider(provider_name: str, *, api_key: str, model: str) -> LLMProvider:
    """Fábrica: `LLM_PROVIDER` no `.env` decide qual provedor instanciar."""
    if provider_name == "anthropic":
        return AnthropicProvider(api_key=api_key, model=model)
    raise ValueError(f"LLM_PROVIDER '{provider_name}' não suportado (hoje só 'anthropic').")
