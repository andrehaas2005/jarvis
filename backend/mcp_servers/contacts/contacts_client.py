"""Cliente de baixo nível para a Airtable REST API (tabela de contatos).

Este módulo não sabe nada sobre MCP — só encapsula a Airtable API. Quem
expõe isso como ferramentas MCP é o `server.py` deste mesmo pacote.

Diferente do Gmail/Calendar (Google API client é síncrono, roda em
`asyncio.to_thread`), a Airtable é consumida via REST simples — dá pra usar
`httpx.AsyncClient` async nativo, sem precisar de thread.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.logging_config import get_logger

logger = get_logger("jarvis.mcp.contacts")

AIRTABLE_API_BASE = "https://api.airtable.com/v0"


@dataclass
class Contact:
    record_id: str
    name: str
    email: str
    phone: str


class ContactsClient:
    """Wrapper fino sobre a Airtable REST API para a tabela de contatos."""

    def __init__(self, api_key: str, base_id: str, table_name: str) -> None:
        self._api_key = api_key
        self._base_id = base_id
        self._table_name = table_name

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    def _table_url(self) -> str:
        return f"{AIRTABLE_API_BASE}/{self._base_id}/{self._table_name}"

    @staticmethod
    def _record_to_contact(record: dict[str, Any]) -> Contact:
        fields = record.get("fields", {})
        return Contact(
            record_id=record["id"],
            name=fields.get("Nome", ""),
            email=fields.get("Email", ""),
            phone=fields.get("Telefone", ""),
        )

    async def search_contact(self, name: str) -> Contact | None:
        """Busca um contato por nome exato. Retorna None se não encontrar."""
        # Escapa aspas simples pra não quebrar a fórmula da Airtable.
        safe_name = name.replace("'", "\\'")
        formula = f"{{Nome}} = '{safe_name}'"

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                self._table_url(),
                headers=self._headers(),
                params={"filterByFormula": formula, "maxRecords": 1},
            )
            response.raise_for_status()
            data = response.json()

        records = data.get("records", [])
        if not records:
            logger.info("contacts_search_not_found", extra={"extra_fields": {"name": name}})
            return None

        contact = self._record_to_contact(records[0])
        logger.info(
            "contacts_search_found",
            extra={"extra_fields": {"name": name, "record_id": contact.record_id}},
        )
        return contact

    async def upsert_contact(self, name: str, email: str = "", phone: str = "") -> Contact:
        """Cria o contato se não existir (por Nome), ou atualiza os campos preenchidos."""
        existing = await self.search_contact(name)

        fields: dict[str, str] = {"Nome": name}
        if email:
            fields["Email"] = email
        if phone:
            fields["Telefone"] = phone

        async with httpx.AsyncClient(timeout=10.0) as client:
            if existing:
                response = await client.patch(
                    f"{self._table_url()}/{existing.record_id}",
                    headers=self._headers(),
                    json={"fields": fields},
                )
            else:
                response = await client.post(
                    self._table_url(),
                    headers=self._headers(),
                    json={"fields": fields},
                )
            response.raise_for_status()
            record = response.json()

        contact = self._record_to_contact(record)
        logger.info(
            "contacts_upsert",
            extra={"extra_fields": {"name": name, "created": existing is None}},
        )
        return contact
