"""Backend orquestrador do JARVIS (FastAPI).

Substitui a arquitetura n8n (SCRUM-16/17). Responsável por orquestrar os
MCP Servers (Gmail, Calendar) com retry e idempotência, evitando os bugs
SCRUM-45 (email disparando 8x) e SCRUM-46 (falta de atomicidade).
"""

import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.elevenlabs import get_signed_conversation_url
from app.logging_config import get_logger, setup_logging
from app.orchestrator.router import handle_query
from app.presence import get_active_count, heartbeat
from app.status import get_checkin, get_credits

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "jarvis_backend_starting",
        extra={"extra_fields": {"env": settings.jarvis_env, "port": settings.jarvis_api_port}},
    )
    yield
    logger.info("jarvis_backend_stopping")


app = FastAPI(
    title="JARVIS Backend",
    description="Orquestrador Python/FastAPI dos MCP Servers do JARVIS",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS liberado para o HUD (frontend) local durante o desenvolvimento.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Healthcheck simples — usado para validar que o backend está de pé."""
    return {"status": "ok", "env": settings.jarvis_env}


@app.get("/")
async def root() -> dict:
    return {
        "service": "jarvis-backend",
        "version": app.version,
        "docs": "/docs",
    }


@app.get("/elevenlabs/signed-url")
async def elevenlabs_signed_url() -> dict:
    """Devolve uma signed URL de curta duração para o frontend abrir a
    conversa autenticada com o agente (fix SCRUM-48: upload de arquivo
    retorna 403 em conexão anônima via agentId puro)."""
    try:
        signed_url = await get_signed_conversation_url()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"signed_url": signed_url}


@app.get("/status/checkin")
async def status_checkin() -> dict:
    """Estado real de Email/Calendar/Contacts pro painel do HUD (SCRUM-52)
    — baseado em uso real (última chamada de cada tool), não um ping
    sintético que poderia passar mesmo com o fluxo de voz quebrado."""
    return get_checkin()


@app.get("/status/credits")
async def status_credits() -> dict:
    """Consumo das APIs pagas (ElevenLabs, Anthropic) pro painel do HUD."""
    return await get_credits()


@app.post("/status/presence")
async def status_presence(request: Request) -> dict:
    """Heartbeat de presença — o HUD chama isso a cada ~20s enquanto a
    página está aberta (ver loadPresenceHeartbeat em script.js). Não
    identifica a pessoa (sem login), só conta abas/dispositivos distintos
    com heartbeat recente. `session_id` é gerado no navegador (sessionStorage,
    um por aba)."""
    body = await request.json()
    session_id = body.get("session_id", "")
    if not session_id:
        raise HTTPException(status_code=400, detail="campo 'session_id' obrigatório no corpo")
    return {"active_sessions": heartbeat(session_id)}


@app.get("/status/presence")
async def status_presence_get() -> dict:
    """Leitura sem registrar heartbeat — útil pra checar de fora (ex.: você
    perguntando pro Jarvis por voz) sem contar a própria consulta como sessão."""
    return {"active_sessions": get_active_count()}


@app.post("/jarvis/webhook")
async def jarvis_webhook(
    request: Request,
    x_jarvis_secret: str | None = Header(default=None, alias="x-jarvis-secret"),
    x_conversation_id: str | None = Header(default=None, alias="x-conversation-id"),
) -> dict:
    """Substitui o webhook do n8n (SCRUM-17) como ferramenta única do agente
    de voz do ElevenLabs. Mesmo contrato: `{"query": "..."}` no corpo,
    autenticado pelo header `x-jarvis-secret` — só troca a URL configurada
    na tool do agente.

    Um LLM (`app/orchestrator/router.py`) decide qual MCP tool chamar
    (Gmail/Calendar/Contacts) a partir da query, com memória de conversa
    por conversa — equivalente ao "Simple Memory" do n8n.

    O ElevenLabs manda o `conversation_id` no **corpo** da requisição (não
    como header) — foi um bug real em produção (achado sessão 3): sem
    `conversation_id` no corpo, todas as conversas caíam na mesma sessão
    'default' e o LLM via contexto de conversas completamente diferentes
    misturado. `x-conversation-id` (header) continua aceito como
    alternativa, pra manter compatibilidade se algum outro cliente usar."""
    if not settings.jarvis_webhook_secret or not hmac.compare_digest(
        x_jarvis_secret or "", settings.jarvis_webhook_secret
    ):
        raise HTTPException(status_code=401, detail="x-jarvis-secret inválido ou ausente")

    body = await request.json()
    query = body.get("query", "")
    if not query:
        raise HTTPException(status_code=400, detail="campo 'query' obrigatório no corpo")

    session_id = body.get("conversation_id") or x_conversation_id or "default"

    try:
        answer = await handle_query(query, session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"query": answer}
