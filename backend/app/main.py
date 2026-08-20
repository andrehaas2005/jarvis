"""Backend orquestrador do JARVIS (FastAPI).

Substitui a arquitetura n8n (SCRUM-16/17). Responsável por orquestrar os
MCP Servers (Gmail, Calendar) com retry e idempotência, evitando os bugs
SCRUM-45 (email disparando 8x) e SCRUM-46 (falta de atomicidade).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.elevenlabs import get_signed_conversation_url
from app.logging_config import get_logger, setup_logging

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
