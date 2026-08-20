"""Cliente de baixo nível para a Gmail API (autenticação OAuth2 + operações).

Este módulo não sabe nada sobre MCP — só encapsula a Gmail API. Quem expõe
isso como ferramentas MCP é o `server.py` deste mesmo pacote.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from app.logging_config import get_logger

logger = get_logger("jarvis.mcp.gmail")

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]


@dataclass
class EmailMessage:
    id: str
    thread_id: str
    subject: str
    sender: str
    snippet: str


class GmailClient:
    """Wrapper fino sobre a Gmail API, com autenticação OAuth2 (installed app flow)."""

    def __init__(self, credentials_path: str, token_path: str) -> None:
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._service = None

    def _get_credentials(self) -> Credentials:
        creds: Credentials | None = None
        token_file = Path(self._token_path)

        if token_file.exists():
            creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self._credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)
            token_file.parent.mkdir(parents=True, exist_ok=True)
            token_file.write_text(creds.to_json())

        return creds

    @property
    def service(self):
        if self._service is None:
            creds = self._get_credentials()
            self._service = build("gmail", "v1", credentials=creds)
        return self._service

    def send_email(self, to: str, subject: str, body: str) -> dict[str, Any]:
        """Envia um email. Chamada síncrona (a Gmail API do Google não é async)."""
        message = MIMEText(body)
        message["to"] = to
        message["subject"] = subject
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        sent = self.service.users().messages().send(userId="me", body={"raw": raw}).execute()
        logger.info(
            "gmail_send_email",
            extra={"extra_fields": {"to": to, "subject": subject, "message_id": sent.get("id")}},
        )
        return {"message_id": sent.get("id"), "thread_id": sent.get("threadId")}

    def list_emails(self, query: str = "", max_results: int = 10) -> list[EmailMessage]:
        response = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        messages = response.get("messages", [])

        result: list[EmailMessage] = []
        for msg_ref in messages:
            detail = (
                self.service.users()
                .messages()
                .get(userId="me", id=msg_ref["id"], format="metadata", metadataHeaders=["Subject", "From"])
                .execute()
            )
            headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
            result.append(
                EmailMessage(
                    id=detail["id"],
                    thread_id=detail["threadId"],
                    subject=headers.get("Subject", "(sem assunto)"),
                    sender=headers.get("From", "(desconhecido)"),
                    snippet=detail.get("snippet", ""),
                )
            )
        return result

    def read_email(self, message_id: str) -> dict[str, Any]:
        detail = (
            self.service.users()
            .messages()
            .get(userId="me", id=message_id, format="full")
            .execute()
        )
        headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
        body = self._extract_body(detail.get("payload", {}))
        return {
            "id": detail["id"],
            "subject": headers.get("Subject", "(sem assunto)"),
            "sender": headers.get("From", "(desconhecido)"),
            "date": headers.get("Date", ""),
            "body": body,
            "snippet": detail.get("snippet", ""),
        }

    def _extract_body(self, payload: dict[str, Any]) -> str:
        if payload.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(payload["body"]["data"]).decode(errors="replace")

        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                return base64.urlsafe_b64decode(part["body"]["data"]).decode(errors="replace")

        return ""
