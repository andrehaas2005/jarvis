"""Integração com a API da ElevenLabs (SCRUM-48).

O agente é público (conecta sem autenticação para voz/texto — ver
`ELEVENLABS_AGENT_ID` em script.js), mas a ação de upload de arquivo
(`conversation.uploadFile`, usada pela visão da câmera) responde 403 nesse
modo anônimo. A correção é o frontend abrir a sessão com uma *signed URL*
autenticada em vez do `agentId` puro — e gerar essa URL exige a API key da
ElevenLabs, que nunca deve ir para o frontend. Por isso este endpoint mora
no backend: ele guarda a chave e devolve só a signed URL, de curta duração.
"""

import httpx

from app.config import get_settings
from app.logging_config import get_logger

logger = get_logger("jarvis.elevenlabs")

SIGNED_URL_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"


async def get_signed_conversation_url() -> str:
    """Pede à ElevenLabs uma signed URL para abrir a conversa autenticada.

    Levanta RuntimeError se a API key não estiver configurada, ou se a
    ElevenLabs responder com erro (ex.: agent_id inválido, key sem permissão).
    """
    settings = get_settings()
    if not settings.elevenlabs_api_key or not settings.elevenlabs_agent_id:
        raise RuntimeError(
            "ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID não configurados no .env "
            "(veja backend/.env.example)."
        )

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            SIGNED_URL_ENDPOINT,
            params={"agent_id": settings.elevenlabs_agent_id},
            headers={"xi-api-key": settings.elevenlabs_api_key},
        )
        response.raise_for_status()
        data = response.json()

    signed_url = data.get("signed_url")
    if not signed_url:
        raise RuntimeError(f"Resposta inesperada da ElevenLabs (sem signed_url): {data}")

    logger.info("elevenlabs_signed_url_issued")
    return signed_url
