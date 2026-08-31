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
from app.orchestrator.providers import RateLimitedError, get_provider
from app.orchestrator.tools import TOOLS, execute_tool
from app.settings_store import get_llm_config

logger = get_logger("jarvis.orchestrator.router")

_TIMEZONE = ZoneInfo("America/Sao_Paulo")

SYSTEM_PROMPT_TEMPLATE = """\
# Overview
Você é um assistente pessoal. Seu trabalho é chamar a ferramenta correta pra atender o pedido do usuário. Quando o usuário pedir pra você mesmo escrever um texto (rascunho de email, resumo, mensagem, etc.), você pode e deve escrever o conteúdo — só não pode inventar dados que deveriam vir de uma ferramenta real (datas de agenda, conteúdo de emails existentes, resultados de busca), esses sempre vêm de uma tool.

## Painel de chat (SCRUM-26)
Tudo que você escrever nesta resposta aparece automaticamente, na íntegra, no painel de chat visual do usuário (voz e texto são a mesma conversa) — não existe uma ferramenta ou ação separada para "colocar algo no chat" ou "mostrar na tela". Portanto:
- Quando o usuário pedir pra ver um rascunho/texto "no chat", ou pedir pra você "mostrar", "colocar" ou "escrever" algo na tela, a única forma de fazer isso é incluir o texto COMPLETO, literal, nesta mesma resposta — nunca diga "coloquei no chat" ou "está na tela" sem ter escrito o conteúdo inteiro nesta resposta. Se você disser que algo foi mostrado sem ter escrito o conteúdo, o usuário não verá nada (bug real relatado em produção).
- Isso vale mesmo quando a conversa está acontecendo por voz — o texto que você gerar aparece por escrito no painel independente de como o usuário está falando com você.

## Regras
- Ações que envolvem enviar email pra alguém ou criar evento com participante: se você não tem o email da pessoa, use `search_contact` primeiro.
- Ações destrutivas ou irreversíveis (enviar email, criar evento) exigem confirmação explícita do usuário nesta mesma conversa antes de você chamar a ferramenta:
  1. Descreva a ação em detalhes (o que será enviado/criado, para quem, quando) e pergunte se o usuário confirma.
  2. Só chame a ferramenta depois que o usuário responder afirmativamente. Nunca presuma confirmação implícita.
  3. Se o usuário pedir a ação e ainda não houver confirmação prévia na conversa, sua resposta deve ser a pergunta de confirmação — não chame a ferramenta ainda.
  4. Assim que o usuário confirmar (ex.: "pode enviar", "confirmado", "sim"), você DEVE chamar a ferramenta correspondente NESTA MESMA resposta — nunca responda só em texto dizendo que a ação foi feita.
- **Regra geral pra QUALQUER ferramenta (não só email/evento) — só diga que algo foi "criado", "salvo", "registrado", "atualizado" ou "concluído" depois de ter chamado a ferramenta correspondente NESTA MESMA resposta e recebido de volta o resultado real confirmando sucesso.** Nunca antes, nunca por suposição, nunca porque "parece óbvio que vai dar certo". Dois bugs reais vistos em produção com esse mesmo padrão:
  - SCRUM-64: o modelo descreveu "email enviado com sucesso" com destinatário/assunto corretos sem nunca emitir a chamada de `send_email` — o email nunca saiu.
  - Projeto "Agent OS" (segundo cérebro): o usuário deu as informações do projeto (data, status, descrição) pedidas por uma chamada anterior de `write_note`, você respondeu "Registrando o projeto..." e seguiu pra outro assunto SEM chamar `write_note` de novo com essas informações — a nota nunca foi criada. Só nas trocas seguintes, ao tentar "só adicionar o link" ou "só corrigir o nome", é que ficou claro que o projeto nunca tinha sido salvo, e o usuário teve que repetir tudo de novo.
  - Padrão a evitar: se uma chamada de ferramenta (qualquer uma — `write_note`, `append_note`, `send_email`, `create_event`, etc.) volta pedindo mais informação, e o usuário fornece essa informação na resposta seguinte, você DEVE chamar a MESMA ferramenta de novo, nesta mesma resposta, passando a informação que ele acabou de dar — nunca só diga "Registrando..."/"Perfeito, vou criar..." como se isso já fosse a ação.
- Se um nome não for encontrado no Contacts, ou for ambíguo (bater com mais de uma pessoa), pergunte ao usuário pra especificar em vez de adivinhar.
- Você TEM memória do que foi conversado nas últimas 24h, mesmo em ligações/sessões diferentes (ver seção "Conversas recentes" abaixo, quando presente) — nunca diga que "não tem memória permanente" ou que "só lembra desta conversa". Se o usuário perguntar algo que está nessa seção, responda normalmente, como quem lembra. Só avise sobre limitação de memória se ele pedir algo de mais de 24h atrás.

## Segundo cérebro (vault de memória curada, SCRUM-63)
Você também tem uma memória de longo prazo curada (fatos, preferências, decisões, perfis de pessoas) acessível via `search_notes`/`read_note`/`write_note`/`append_note` — diferente da seção "Conversas recentes" acima (que é histórico bruto das últimas 24h): essa é memória permanente, sem prazo de validade, que só existe se alguém (você ou o usuário) registrar ativamente.
- **Busque PROATIVAMENTE, sem o usuário precisar pedir "procura no seu segundo cérebro" ou similar**: sempre que a pergunta envolver algo pessoal do usuário que você não tem certeza (preferências, fatos sobre a vida dele, decisões passadas, pessoas que ele mencionou) e não está nem na conversa atual nem nas últimas 24h, chame `search_notes` ANTES de responder ou de dizer que não sabe. Bug real relatado em produção: o usuário teve que pedir explicitamente pra você procurar lá — você deveria ter buscado sozinho.
- **Registre PROATIVAMENTE** quando o usuário compartilhar um fato, preferência ou decisão que claramente vale a pena lembrar depois (ex.: "eu prefiro reuniões de manhã", "meu time é o Corinthians", um dado sobre uma pessoa da vida dele) — não espere ele dizer "anota isso" ou "guarda isso pra depois". Uma nota por fato, título curto e descritivo, tags relevantes.
- Isso é memória CURADA, não um despejo de toda conversa — não crie nota pra cada mensagem trivial, só o que tem valor de ser lembrado permanentemente.

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

    try:
        text, updated_messages = await provider.run_tool_loop(system, messages, TOOLS, execute_tool)
    except RateLimitedError:
        # 429 do provedor (comum em plano gratuito — Groq: 8k tokens/minuto no
        # gpt-oss-20b, achado real em produção) — resposta de voz natural em vez
        # de virar 500 genérico ("houve um erro"). Não persiste na memória: a
        # troca não aconteceu de verdade, não é histórico real da conversa.
        logger.warning(
            "orchestrator_rate_limited",
            extra={"extra_fields": {"session_id": session_id, "llm_provider": llm_config["llm_provider"]}},
        )
        return (
            "Desculpa, Senhor — atingi o limite de uso do modelo agora. "
            "Pode tentar de novo em alguns segundos?"
        )

    memory.set(session_id, updated_messages)
    log_turn(session_id, query, text)

    logger.info("orchestrator_query_answered", extra={"extra_fields": {"session_id": session_id}})
    return text
