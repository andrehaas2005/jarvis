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


class RateLimitedError(Exception):
    """O provedor de LLM recusou a chamada por limite de taxa (429) —
    comum em planos gratuitos (Groq: só 8k tokens/minuto no gpt-oss-20b,
    achado real em produção, SCRUM-59). `router.py` traduz isso numa
    resposta de voz natural em vez de deixar virar 500 genérico pro
    usuário (achado real: ligação real batendo nisso segundos depois de
    testes manuais consumirem o teto por minuto)."""


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

        import anthropic

        for _ in range(MAX_TOOL_ITERATIONS):
            try:
                response = await asyncio.to_thread(
                    self._client.messages.create,
                    model=self._model,
                    max_tokens=2048,
                    system=system,
                    tools=tools,
                    messages=messages,
                )
            except anthropic.RateLimitError as exc:
                raise RateLimitedError(str(exc)) from exc
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


class LocalOpenAICompatibleProvider(LLMProvider):
    """Modelo local, em qualquer servidor que fale a API compatível com
    OpenAI (`/v1/chat/completions`) — llamafile, llama.cpp server, Ollama
    (também expõe esse endpoint), LM Studio, vLLM, text-generation-webui
    com a extensão OpenAI, etc. `base_url` e `model` são texto livre e
    configuráveis pela Settings Page (SCRUM-59): dá pra apontar pro VPS
    (serviço `jarvis-llamafile` no docker-compose) ou pra qualquer outra
    máquina na rede (ex.: o Mac do usuário via Tailscale) sem editar
    código — só trocar o endereço salvo.

    Requer um modelo com suporte a tool-calling; sem suporte, o modelo
    simplesmente nunca devolve `tool_calls` e o loop retorna o texto puro
    na primeira resposta.

    `api_key` (SCRUM-59, 2ª volta) — opcional, vazio quando aponta pro
    llamafile do próprio VPS (sem autenticação). Necessário pra qualquer
    provedor hospedado que fale essa mesma API (Groq, DeepInfra, Fireworks,
    etc.) — motivo real de existir: o VPS de 2 vCPU não dá conta de rodar
    inferência local em tempo hábil pra voz (achado em produção, ~15
    tokens/s, minutos por resposta), então a alternativa viável de "modelo
    livremente escolhível" é apontar pra um provedor hospedado rápido e
    barato em vez de hardware próprio."""

    def __init__(self, base_url: str, model: str, api_key: str = "") -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key

    @staticmethod
    def _to_openai_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
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

        openai_tools = self._to_openai_tools(tools)
        # Mensagens no formato Anthropic (content pode ser lista de blocks) não
        # servem direto — só precisamos do texto simples aqui, já que quem
        # monta o histórico (router.py) só grava turnos user/assistant de
        # texto puro nesse ponto do fluxo.
        chat_messages = [{"role": "system", "content": system}]
        chat_messages.extend(
            {"role": m["role"], "content": m["content"] if isinstance(m["content"], str) else str(m["content"])}
            for m in messages
        )

        # Timeout generoso de propósito: inferência CPU local de um modelo de
        # alguns bilhões de parâmetros pode levar dezenas de segundos por
        # resposta — bem mais lento que uma API na nuvem.
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        async with httpx.AsyncClient(timeout=180.0) as client:
            for _ in range(MAX_TOOL_ITERATIONS):
                response = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    headers=headers,
                    json={
                        "model": self._model,
                        "messages": chat_messages,
                        "tools": openai_tools,
                        "stream": False,
                        # Sem isso, um modelo local quantizado que não emite um
                        # token de parada limpo (comum sob CPU) gera até bater o
                        # teto do contexto (2048+ tokens) — minutos travado,
                        # parecendo "pensando" sem nunca responder. Achado real
                        # em produção (SCRUM-59): duas tasks canceladas em
                        # n_tokens=2048 nos logs do llamafile. 512 é generoso pra
                        # uma resposta de voz — bem mais que qualquer resposta
                        # útil precisa.
                        "max_tokens": 512,
                    },
                )
                if response.status_code == 429:
                    raise RateLimitedError(response.text)
                if response.status_code >= 400:
                    # Corpo da resposta de erro (a mensagem exata do provedor, ex.: qual
                    # campo/formato ele rejeitou) não aparecia nos logs antes — só o
                    # "400 Bad Request" genérico do httpx, sem contexto pra debugar.
                    logger.warning(
                        "orchestrator_local_provider_error",
                        extra={
                            "extra_fields": {
                                "status_code": response.status_code,
                                "body": response.text[:2000],
                            }
                        },
                    )
                response.raise_for_status()
                data = response.json()
                message = data["choices"][0]["message"]
                chat_messages.append(message)

                tool_calls = message.get("tool_calls") or []
                if not tool_calls:
                    text = message.get("content") or ""
                    return text, messages + [{"role": "assistant", "content": text}]

                for call in tool_calls:
                    fn = call["function"]
                    try:
                        import json as _json

                        args = _json.loads(fn.get("arguments") or "{}")
                        result = await tool_executor(fn["name"], args)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "orchestrator_tool_error",
                            extra={"extra_fields": {"tool": fn["name"], "error": str(exc)}},
                        )
                        result = f"Erro: {exc}"
                    chat_messages.append(
                        {"role": "tool", "tool_call_id": call.get("id", ""), "content": str(result)}
                    )

        raise RuntimeError(
            f"orquestrador (local): excedeu {MAX_TOOL_ITERATIONS} iterações de tool-calling sem resposta final"
        )


def get_provider(
    provider_name: str, *, api_key: str, model: str, base_url: str = "", local_api_key: str = ""
) -> LLMProvider:
    """Fábrica: provedor efetivo (ver `app/settings_store.py` — configurável
    em runtime pela Settings Page, sem precisar editar `.env`/reiniciar).

    `api_key` é sempre a chave da Anthropic (`.env`); `local_api_key` é a
    chave opcional do provedor `local` (Groq/DeepInfra/etc. — vazia quando
    aponta pro llamafile do próprio VPS, sem autenticação) — dois segredos
    diferentes, nunca confundir um com o outro."""
    if provider_name == "anthropic":
        return AnthropicProvider(api_key=api_key, model=model)
    if provider_name == "local":
        if not base_url:
            raise ValueError("Provedor 'local' precisa de um endereço de servidor configurado (base_url).")
        return LocalOpenAICompatibleProvider(base_url=base_url, model=model, api_key=local_api_key)
    raise ValueError(f"LLM_PROVIDER '{provider_name}' não suportado (aceita 'anthropic' ou 'local').")
