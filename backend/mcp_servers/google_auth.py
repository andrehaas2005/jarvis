"""Autenticação OAuth2 compartilhada para os MCP Servers do Google
(Gmail, Calendar, Contacts). Extraído do gmail_client.py para reuso —
evita duplicar o mesmo fluxo installed-app em cada serviço Google novo.
"""

from __future__ import annotations

from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from app.logging_config import get_logger

logger = get_logger("jarvis.google_auth")


def get_google_credentials(credentials_path: str, token_path: str, scopes: list[str]) -> Credentials:
    """Retorna credenciais OAuth2 válidas, autenticando via navegador na
    primeira execução e reaproveitando/renovando o token salvo depois.

    Persistir o token renovado no disco é best-effort: em produção o mount
    de credenciais é somente leitura (`:ro`, decisão de segurança — o
    `credentials.json`/OAuth client não deve ser gravável pelo container).
    Se a escrita falhar, as credenciais renovadas em memória continuam
    válidas pra chamada atual; só não ficam em cache — a próxima chamada
    renova de novo via `refresh_token`, custo desprezível."""
    creds: Credentials | None = None
    token_file = Path(token_path)

    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), scopes)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, scopes)
            creds = flow.run_local_server(port=0)
        try:
            token_file.parent.mkdir(parents=True, exist_ok=True)
            token_file.write_text(creds.to_json())
        except OSError as exc:
            logger.warning(
                "google_auth_token_persist_failed",
                extra={"extra_fields": {"token_path": token_path, "error": str(exc)}},
            )

    return creds
