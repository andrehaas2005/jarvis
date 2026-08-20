"""Cliente de baixo nível para a Google People API (Contatos do Google).

Usa os contatos reais do usuário (o mesmo agenda do Gmail/celular) em vez
de uma planilha ou tabela separada — sem cadastro duplicado, sem custo.

Este módulo não sabe nada sobre MCP — só encapsula a People API. Quem
expõe isso como ferramentas MCP é o `server.py` deste mesmo pacote.

Igual ao Calendar (google-api-python-client é síncrono), as chamadas rodam
em `asyncio.to_thread` no server.py — este cliente não é async.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from googleapiclient.discovery import build

from app.logging_config import get_logger
from mcp_servers.google_auth import get_google_credentials

logger = get_logger("jarvis.mcp.contacts")

# Escopo completo (não só readonly): add_or_update_contact precisa criar/editar.
SCOPES = ["https://www.googleapis.com/auth/contacts"]

_PERSON_FIELDS = "names,emailAddresses,phoneNumbers"


@dataclass
class Contact:
    resource_name: str  # ex.: "people/c123..." — necessário pra update
    etag: str
    name: str
    email: str
    phone: str


class ContactsClient:
    """Wrapper fino sobre a Google People API, com autenticação OAuth2."""

    def __init__(self, credentials_path: str, token_path: str) -> None:
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._service = None

    @property
    def service(self):
        if self._service is None:
            creds = get_google_credentials(self._credentials_path, self._token_path, SCOPES)
            self._service = build("people", "v1", credentials=creds)
        return self._service

    @staticmethod
    def _person_to_contact(person: dict[str, Any]) -> Contact:
        names = person.get("names", [])
        emails = person.get("emailAddresses", [])
        phones = person.get("phoneNumbers", [])
        return Contact(
            resource_name=person["resourceName"],
            etag=person.get("etag", ""),
            name=names[0].get("displayName", "") if names else "",
            email=emails[0].get("value", "") if emails else "",
            phone=phones[0].get("value", "") if phones else "",
        )

    def _list_all_people(self) -> list[dict[str, Any]]:
        """Lista todos os contatos do usuário (people/me), paginando."""
        people: list[dict[str, Any]] = []
        page_token: str | None = None

        while True:
            response = (
                self.service.people()
                .connections()
                .list(
                    resourceName="people/me",
                    personFields=_PERSON_FIELDS,
                    pageSize=1000,
                    pageToken=page_token,
                )
                .execute()
            )
            people.extend(response.get("connections", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        return people

    def _exact_match(self, name: str) -> Contact | None:
        """Busca um contato por nome exato (case-insensitive). Usado pelo
        upsert, que precisa ter certeza de casar com a pessoa certa antes
        de sobrescrever campos."""
        needle = name.strip().lower()

        for person in self._list_all_people():
            for name_entry in person.get("names", []):
                if name_entry.get("displayName", "").strip().lower() == needle:
                    return self._person_to_contact(person)

        return None

    def search_contact(self, name: str) -> tuple[Contact | None, list[Contact]]:
        """Busca um contato por nome entre os Contatos do Google do usuário.

        Primeiro tenta nome exato (case-insensitive). Se não achar, cai pra
        substring — útil pra voz/conversa, onde o nome raramente vem
        completo (ex.: "Maria" deve achar "Maria Aparecida de Oliveira").

        Retorna `(contact, candidates)`:
        - match único (exato ou substring): `(contact, [])`
        - nenhum match: `(None, [])`
        - substring bateu em mais de um contato (ambíguo, sem exato):
          `(None, candidates)` — quem chamar deve pedir pra especificar.
        """
        exact = self._exact_match(name)
        if exact is not None:
            logger.info(
                "contacts_search_found_exact",
                extra={"extra_fields": {"name": name, "resource_name": exact.resource_name}},
            )
            return exact, []

        needle = name.strip().lower()
        candidates: list[Contact] = []
        for person in self._list_all_people():
            for name_entry in person.get("names", []):
                if needle in name_entry.get("displayName", "").strip().lower():
                    candidates.append(self._person_to_contact(person))
                    break

        if len(candidates) == 1:
            logger.info(
                "contacts_search_found_substring",
                extra={"extra_fields": {"name": name, "resource_name": candidates[0].resource_name}},
            )
            return candidates[0], []

        if len(candidates) > 1:
            logger.info(
                "contacts_search_ambiguous",
                extra={"extra_fields": {"name": name, "matches": len(candidates)}},
            )
            return None, candidates

        logger.info("contacts_search_not_found", extra={"extra_fields": {"name": name}})
        return None, []

    def upsert_contact(self, name: str, email: str = "", phone: str = "") -> Contact:
        """Cria o contato se não existir (por Nome), ou atualiza os campos
        preenchidos (email/telefone) de um contato existente."""
        existing = self._exact_match(name)

        final_email = email or (existing.email if existing else "")
        final_phone = phone or (existing.phone if existing else "")

        body: dict[str, Any] = {"names": [{"givenName": name}]}
        if final_email:
            body["emailAddresses"] = [{"value": final_email}]
        if final_phone:
            body["phoneNumbers"] = [{"value": final_phone}]

        if existing:
            body["etag"] = existing.etag
            person = (
                self.service.people()
                .updateContact(
                    resourceName=existing.resource_name,
                    updatePersonFields=_PERSON_FIELDS,
                    body=body,
                )
                .execute()
            )
        else:
            person = self.service.people().createContact(body=body).execute()

        contact = self._person_to_contact(person)
        logger.info(
            "contacts_upsert",
            extra={"extra_fields": {"name": name, "created": existing is None}},
        )
        return contact
