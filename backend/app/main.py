"""Backend orquestrador do JARVIS (FastAPI).

Substitui a arquitetura n8n (SCRUM-16/17). Responsável por orquestrar os
MCP Servers (Gmail, Calendar) com retry e idempotência, evitando os bugs
SCRUM-45 (email disparando 8x) e SCRUM-46 (falta de atomicidade).
"""

import asyncio
import hmac
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import User, authenticate, init_db, issue_token, verify_token
from app.chat_stream import publish, subscribe, unsubscribe
from app.config import get_settings
from app.elevenlabs import get_signed_conversation_url
from app.logging_config import get_logger, setup_logging
from app.orchestrator.connection_check import check_service
from app.orchestrator.history_store import init_history_db
from app.orchestrator.router import handle_query
from app.presence import get_active_count, heartbeat
from app.settings_store import get_llm_config_public, set_llm_config
from app.status import get_checkin, get_credits

settings = get_settings()
setup_logging(settings.jarvis_log_level)
logger = get_logger("jarvis.main")

# Monitoramento (SCRUM-39) — rastreamento de erro real em produção. Antes disso, um bug só
# aparecia se alguém fosse catar log manualmente no Web Terminal do VPS (foi assim que vários
# bugs reais foram achados nesta sessão) — agora qualquer exceção não tratada chega aqui
# automaticamente (integração FastAPI/Starlette do sentry-sdk detecta sozinha). Sem
# `SENTRY_DSN` configurada, isso é um no-op — comportamento de antes, sem mudança.
if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.jarvis_env, traces_sample_rate=0.1)
    logger.info("sentry_enabled")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_history_db()
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


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
async def auth_login(body: LoginRequest) -> dict:
    """Login do HUD (SCRUM-56). Primeiro passo de um sistema de perfis
    maior — hoje só um usuário seed (`andrehaas`, admin), a página de
    configuração pra criar outros vem depois."""
    user = authenticate(body.username, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    token = issue_token(user)
    return {
        "token": token,
        "user": {
            "username": user.username,
            "name": user.name,
            "jarvis_address": user.jarvis_address,
            "role": user.role,
        },
    }


@app.get("/auth/me")
async def auth_me(authorization: str | None = Header(default=None)) -> dict:
    """Valida o token do HUD e devolve o usuário — usado no carregamento do
    HUD pra confirmar a sessão antes de mostrar a tela (e pra restaurar o
    usuário sem precisar logar de novo a cada visita, dentro da validade
    do token)."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    user = verify_token(token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    return {
        "username": user.username,
        "name": user.name,
        "jarvis_address": user.jarvis_address,
        "role": user.role,
    }


def _require_user(authorization: str | None) -> User:
    token = (authorization or "").removeprefix("Bearer ").strip()
    user = verify_token(token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    return user


class LLMSettingsRequest(BaseModel):
    provider: str
    model: str
    base_url: str = ""
    # Chave do provedor 'local' (Groq/DeepInfra/etc. — quando exigem
    # autenticação; vazio pro llamafile do próprio VPS). Vazio também
    # significa "não mudar a já salva" — ver settings_store.set_llm_config.
    api_key: str = ""


@app.get("/settings/llm")
async def settings_llm_get(authorization: str | None = Header(default=None)) -> dict:
    """Provedor/modelo/endereço de IA em uso agora (Settings Page,
    SCRUM-23/59). Qualquer usuário logado pode ver — só admin pode trocar
    (ver PUT abaixo). Nunca devolve a api_key em texto puro — só
    `llm_api_key_set` (booleano), ver settings_store.get_llm_config_public."""
    _require_user(authorization)
    return get_llm_config_public()


@app.put("/settings/llm")
async def settings_llm_put(
    body: LLMSettingsRequest, authorization: str | None = Header(default=None)
) -> dict:
    """Troca o provedor/modelo/endereço/chave do orquestrador em runtime,
    sem restart — afeta todas as conversas (não é por usuário, ver
    settings_store.py). `provider`/`model`/`base_url` aceitam qualquer
    valor: não travamos numa lista fixa porque servidores novos (VPS, Mac
    do usuário via Tailscale, Groq/DeepInfra, Anthropic futuro) não devem
    exigir alterar código pra ficarem selecionáveis."""
    user = _require_user(authorization)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Só admin pode trocar o modelo de IA")
    try:
        set_llm_config(provider=body.provider, model=body.model, base_url=body.base_url, api_key=body.api_key)
        return get_llm_config_public()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


class ConnectRequest(BaseModel):
    service: str


@app.post("/status/connect")
async def status_connect(
    body: ConnectRequest, authorization: str | None = Header(default=None)
) -> dict:
    """Botão de "testar conexão" por serviço (SCRUM-60) — chamada real e
    silenciosa (não lista nada pro usuário) contra Email/Calendar/Contacts,
    disparada sob demanda. Diferente do GET /status/checkin (passivo, só
    reflete uso já feito numa conversa) — este dispara o teste agora, na
    hora do clique. Exige login (não precisa ser admin — não muda config,
    só lê)."""
    _require_user(authorization)
    try:
        return await check_service(body.service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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

    # Publica no stream do chat (SCRUM-26) — se o HUD tiver o painel aberto
    # ouvindo essa mesma sessão, a troca por voz aparece lá também (texto e
    # voz são a mesma conversa). Sem assinantes, é descartado sem custo.
    publish(session_id, role="user", text=query)
    publish(session_id, role="assistant", text=answer)

    return {"query": answer}


class ChatMessageRequest(BaseModel):
    message: str
    session_id: str
    # Gerado pelo frontend (chat.js) — ver chat_stream.publish() pro motivo
    # de existir (evitar mensagem duplicada por causa de corrida com o SSE).
    client_msg_id: str = ""


@app.post("/chat/message")
async def chat_message(
    body: ChatMessageRequest, authorization: str | None = Header(default=None)
) -> dict:
    """Chat de texto (SCRUM-26) — mesmo orquestrador da voz
    (`orchestrator/router.py`), mesma memória de sessão por `session_id`:
    uma mensagem digitada aqui continua a conversa de voz em andamento (se
    o frontend mandar o `conversation_id` do SDK do ElevenLabs) ou uma
    conversa só-texto (session_id gerado pelo frontend, ex. 'text-<uuid>').
    Serve tanto pra pedidos novos quanto pra aprovar/editar um rascunho
    (email, etc.) que o Jarvis mostrou no chat."""
    _require_user(authorization)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="campo 'message' obrigatório")

    try:
        answer = await handle_query(body.message, body.session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    publish(body.session_id, role="user", text=body.message, client_msg_id=body.client_msg_id)
    publish(body.session_id, role="assistant", text=answer, client_msg_id=body.client_msg_id)

    return {"reply": answer}


@app.get("/chat/stream")
async def chat_stream(session_id: str, token: str = "") -> StreamingResponse:
    """Server-Sent Events do chat (SCRUM-26) — o painel do HUD assina isso
    pra saber em tempo real quando o Jarvis tem algo novo pra mostrar (ex.:
    resposta de uma pergunta feita por voz, ou o rascunho de um email),
    sem precisar dar F5. `token` vem por query string em vez de header
    `Authorization` porque a API `EventSource` do navegador não permite
    header customizado."""
    user = verify_token(token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

    queue = subscribe(session_id)

    async def event_stream():
        try:
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {json.dumps(message)}\n\n"
                except TimeoutError:
                    # Keep-alive — sem isso, proxies (Cloudflare/nginx) derrubam
                    # a conexão SSE por inatividade antes de qualquer mensagem real chegar.
                    yield ": keep-alive\n\n"
        finally:
            unsubscribe(session_id, queue)

    # Cache-Control/X-Accel-Buffering: sem isso, proxies na frente da API (ver
    # nginx.frontend.conf — Cloudflare já causou bug real de cache aqui antes)
    # podem enfileirar os eventos em vez de entregar em tempo real.
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
