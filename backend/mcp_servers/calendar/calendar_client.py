"""Cliente de baixo nível para a Google Calendar API (operações de evento).

Este módulo não sabe nada sobre MCP — só encapsula a Calendar API. Quem
expõe isso como ferramentas MCP é o `server.py` deste mesmo pacote.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from googleapiclient.discovery import build

from app.logging_config import get_logger
from mcp_servers.google_auth import get_google_credentials

logger = get_logger("jarvis.mcp.calendar")

SCOPES = ["https://www.googleapis.com/auth/calendar"]


@dataclass
class CalendarEvent:
    id: str
    summary: str
    start: str
    end: str
    description: str
    html_link: str


class CalendarClient:
    """Wrapper fino sobre a Google Calendar API, com autenticação OAuth2."""

    def __init__(self, credentials_path: str, token_path: str, calendar_id: str = "primary") -> None:
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._calendar_id = calendar_id
        self._service = None

    @property
    def service(self):
        if self._service is None:
            creds = get_google_credentials(self._credentials_path, self._token_path, SCOPES)
            self._service = build("calendar", "v3", credentials=creds)
        return self._service

    def create_event(
        self,
        summary: str,
        start: str,
        end: str,
        description: str = "",
        attendees: list[str] | None = None,
    ) -> dict[str, Any]:
        """Cria um evento. `start`/`end` em ISO 8601 (ex.: '2026-08-20T15:00:00-03:00')."""
        body: dict[str, Any] = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": start},
            "end": {"dateTime": end},
        }
        if attendees:
            body["attendees"] = [{"email": email} for email in attendees]

        created = (
            self.service.events()
            .insert(calendarId=self._calendar_id, body=body)
            .execute()
        )
        logger.info(
            "calendar_create_event",
            extra={"extra_fields": {"summary": summary, "event_id": created.get("id")}},
        )
        return {
            "event_id": created.get("id"),
            "html_link": created.get("htmlLink"),
            "status": created.get("status"),
        }

    def list_events(self, time_min: str, time_max: str, max_results: int = 10) -> list[CalendarEvent]:
        """Lista eventos em um período. `time_min`/`time_max` em ISO 8601."""
        response = (
            self.service.events()
            .list(
                calendarId=self._calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        items = response.get("items", [])
        return [
            CalendarEvent(
                id=item["id"],
                summary=item.get("summary", "(sem título)"),
                start=item.get("start", {}).get("dateTime", item.get("start", {}).get("date", "")),
                end=item.get("end", {}).get("dateTime", item.get("end", {}).get("date", "")),
                description=item.get("description", ""),
                html_link=item.get("htmlLink", ""),
            )
            for item in items
        ]

    def get_event(self, event_id: str) -> dict[str, Any]:
        event = (
            self.service.events()
            .get(calendarId=self._calendar_id, eventId=event_id)
            .execute()
        )
        return {
            "id": event["id"],
            "summary": event.get("summary", "(sem título)"),
            "description": event.get("description", ""),
            "start": event.get("start", {}).get("dateTime", event.get("start", {}).get("date", "")),
            "end": event.get("end", {}).get("dateTime", event.get("end", {}).get("date", "")),
            "attendees": [a.get("email") for a in event.get("attendees", [])],
            "html_link": event.get("htmlLink", ""),
        }
