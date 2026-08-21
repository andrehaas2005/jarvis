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
from app.orchestrator.history_store import get_recent_summary, log_turn
from app.orchestrator.memory import get_session_memory
from app.orchestrator.providers import get_provider
from app.orchestrator.tools import TOOLS, execute_tool
from app.settings_store import get_llm_config

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
- Você TEM memória do que foi conversado nas últimas 24h, mesmo em ligações/sessões diferentes (ver seção "Conversas recentes" abaixo, quando presente) — nunca diga que "não tem memória permanente" ou que "só lembra desta conversa". Se o usuário perguntar algo que está nessa seção, responda normalmente, como quem lembra. Só avise sobre limitação de memória se ele pedir algo de mais de 24h atrás.

## Data/hora atual
{now}
{recent_history_section}"""

_RECENT_HISTORY_SECTION_TEMPLATE = """
## Conversas recentes (últimas 24h, fora desta sessão)
Isto é o que vocês conversaram nas últimas 24 horas, possivelmente em outra ligação — não é
o histórico desta conversa (esse já está acima, nas mensagens). Cada linha tem data e hora
reais (formato dd/mm hh:mm, mesmo fuso do "Data/hora atual" acima) — use isso pra situar
quando foi de verdade (hoje mais cedo, ontem etc.) em vez de chutar. Use só como contexto pra
não perguntar de novo algo que você já sabe, ou pra continuar um assunto em aberto — nunca
cite literalmente esta lista para o usuário, aja como se você só "lembrasse".
{history}
"""


async def handle_query(query: str, session_id: str) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY não configurada no .env (veja backend/.env.example)."
        )

    # Provedor/modelo/endereço efetivos vêm do settings_store (editável pela
    # Settings Page, SCRUM-23/59) — cai pro default do .env quando nunca foi
    # trocado.
    llm_config = get_llm_config()
    provider = get_provider(
        llm_config["llm_provider"],
        api_key=settings.anthropic_api_key,
        model=llm_config["llm_model"],
        base_url=llm_config["llm_base_url"],
        local_api_key=llm_config["llm_api_key"],
    )

    memory = get_session_memory()
    history = memory.get(session_id)
    messages = history + [{"role": "user", "content": query}]

    # Memória Nível 2 (SCRUM-25): resumo das últimas 24h, sobrevive a uma conversa nova
    # (conversation_id novo do ElevenLabs) ou a um restart do backend — diferente do
    # `history` acima, que é só desta sessão em RAM (Nível 1, SCRUM-24).
    recent_summary = get_recent_summary()
    recent_history_section = (
        _RECENT_HISTORY_SECTION_TEMPLATE.format(history=recent_summary) if recent_summary else ""
    )
    system = SYSTEM_PROMPT_TEMPLATE.format(
        now=datetime.now(_TIMEZONE).isoformat(),
        recent_history_section=recent_history_section,
    )

    logger.info(
        "orchestrator_query_received",
        extra={"extra_fields": {"session_id": session_id, "history_len": len(history)}},
    )

    text, updated_messages = await provider.run_tool_loop(system, messages, TOOLS, execute_tool)
    memory.set(session_id, updated_messages)
    log_turn(session_id, query, text)

    logger.info("orchestrator_query_answered", extra={"extra_fields": {"session_id": session_id}})
    return text
