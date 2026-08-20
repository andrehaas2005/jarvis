"""Orquestrador do JARVIS (SCRUM-17) — substitui o node "JARVIS" do n8n.

Um LLM (Anthropic por padrão, ver `providers.py`) decide qual tool chamar
a partir da query do usuário — mesmo papel do agente `@n8n/langchain.agent`
do workflow antigo, mas chamando os MCP Servers Python direto (sem os
sub-agentes aninhados Email/Calendar/Contact Agent Tool).

System prompt adaptado do `JARVIS.sanitized.json` original — mesmas regras
de negócio (roteamento puro, confirmação explícita antes de ação
destrutiva/irreversível), sem o Content Creator/Tavily (fora de escopo
desta migração, ver ROADMAP_SESSION.md).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.logging_config import get_logger
from app.orchestrator.memory import get_session_memory
from app.orchestrator.providers import get_provider
from app.orchestrator.tools import TOOLS, execute_tool

logger = get_logger("jarvis.orchestrator.router")

_TIMEZONE = ZoneInfo("America/Sao_Paulo")

SYSTEM_PROMPT_TEMPLATE = """\
# Overview
Você é um assistente pessoal. Seu trabalho é chamar a ferramenta correta pra atender o pedido do usuário. Você nunca deve escrever e-mails ou criar resumos por conta própria — só chamar a ferramenta certa com os dados certos.

## Regras
- Ações que envolvem enviar email pra alguém ou criar evento com participante: se você não tem o email da pessoa, use `search_contact` primeiro.
- Ações destrutivas ou irreversíveis (enviar email, criar evento) exigem confirmação explícita do usuário nesta mesma conversa antes de você chamar a ferramenta:
  1. Descreva a ação em detalhes (o que será enviado/criado, para quem, quando) e pergunte se o usuário confirma.
  2. Só chame a ferramenta depois que o usuário responder afirmativamente. Nunca presuma confirmação implícita.
  3. Se o usuário pedir a ação e ainda não houver confirmação prévia na conversa, sua resposta deve ser a pergunta de confirmação — não chame a ferramenta ainda.
- Se um nome não for encontrado no Contacts, ou for ambíguo (bater com mais de uma pessoa), pergunte ao usuário pra especificar em vez de adivinhar.

## Data/hora atual
{now}
"""


async def handle_query(query: str, session_id: str) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY não configurada no .env (veja backend/.env.example)."
        )

    provider = get_provider(
        settings.llm_provider, api_key=settings.anthropic_api_key, model=settings.anthropic_model
    )

    memory = get_session_memory()
    history = memory.get(session_id)
    messages = history + [{"role": "user", "content": query}]

    system = SYSTEM_PROMPT_TEMPLATE.format(now=datetime.now(_TIMEZONE).isoformat())

    logger.info(
        "orchestrator_query_received",
        extra={"extra_fields": {"session_id": session_id, "history_len": len(history)}},
    )

    text, updated_messages = await provider.run_tool_loop(system, messages, TOOLS, execute_tool)
    memory.set(session_id, updated_messages)

    logger.info("orchestrator_query_answered", extra={"extra_fields": {"session_id": session_id}})
    return text
