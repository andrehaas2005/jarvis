"""Autenticação OAuth2 compartilhada para os MCP Servers do Google
(Gmail, Calendar). Extraído do gmail_client.py para reuso — evita duplicar
o mesmo fluxo installed-app em cada serviço Google novo.
"""

from __future__ import annotations

from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow


def get_google_credentials(credentials_path: str, token_path: str, scopes: list[str]) -> Credentials:
    """Retorna credenciais OAuth2 válidas, autenticando via navegador na
    primeira execução e reaproveitando/renovando o token salvo depois."""
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
        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(creds.to_json())

    return creds
