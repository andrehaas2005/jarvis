"""Cliente de baixo nível pra Google Drive, Sheets e Docs (SCRUM-61).

Um cliente combinado (não três separados) de propósito: na prática o
usuário sempre pede "abre minha planilha X" — que precisa achar o arquivo
no Drive por nome ANTES de ler/escrever nele via Sheets/Docs API. Separar
em três credenciais/tokens diferentes só multiplicaria telas de consentimento
OAuth sem benefício real, já que os três sempre andam juntos aqui.

Este módulo não sabe nada sobre MCP — só encapsula as APIs do Google. Quem
expõe isso como ferramentas MCP é o `server.py` deste mesmo pacote.

Import síncrono (google-api-python-client é síncrono, igual Calendar/
Contacts) — as chamadas rodam em `asyncio.to_thread` no server.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from googleapiclient.discovery import build

from app.logging_config import get_logger
from mcp_servers.google_auth import get_google_credentials

logger = get_logger("jarvis.mcp.google_workspace")

# drive.readonly (achar arquivo por nome, ler metadados) + spreadsheets/documents
# completos (ler E escrever em qualquer planilha/doc que o usuário tenha acesso —
# não só os criados pelo Jarvis, já que o pedido real é "abre MINHA planilha que já
# existe"). Não pede escopo de escrita geral do Drive (criar/mover/deletar arquivo
# solto) de propósito — menor privilégio possível pro caso de uso real.
SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]

_SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet"
_DOC_MIME = "application/vnd.google-apps.document"


@dataclass
class DriveFile:
    id: str
    name: str
    mime_type: str
    web_link: str


class GoogleWorkspaceClient:
    def __init__(self, credentials_path: str, token_path: str) -> None:
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._drive_service = None
        self._sheets_service = None
        self._docs_service = None

    def _creds(self):
        return get_google_credentials(self._credentials_path, self._token_path, SCOPES)

    @property
    def drive(self):
        if self._drive_service is None:
            self._drive_service = build("drive", "v3", credentials=self._creds())
        return self._drive_service

    @property
    def sheets(self):
        if self._sheets_service is None:
            self._sheets_service = build("sheets", "v4", credentials=self._creds())
        return self._sheets_service

    @property
    def docs(self):
        if self._docs_service is None:
            self._docs_service = build("docs", "v1", credentials=self._creds())
        return self._docs_service

    # ------------------------------------------------------------ Drive

    def search_files(self, query: str, mime_type: str | None = None, max_results: int = 10) -> list[DriveFile]:
        """Busca arquivos por nome (substring, não precisa ser exato) no Drive
        do usuário. `mime_type` filtra por tipo (planilha/doc) quando informado."""
        safe_query = query.replace("'", "\\'")
        q_parts = [f"name contains '{safe_query}'", "trashed = false"]
        if mime_type:
            q_parts.append(f"mimeType = '{mime_type}'")
        results = (
            self.drive.files()
            .list(
                q=" and ".join(q_parts),
                fields="files(id, name, mimeType, webViewLink)",
                pageSize=max_results,
            )
            .execute()
        )
        return [
            DriveFile(id=f["id"], name=f["name"], mime_type=f["mimeType"], web_link=f.get("webViewLink", ""))
            for f in results.get("files", [])
        ]

    def resolve_file_id(self, name_or_id: str, mime_type: str) -> str:
        """Se `name_or_id` já parece um ID de arquivo do Drive (sem espaços,
        formato típico de ID), usa direto. Senão, busca por nome — precisa
        achar EXATAMENTE um arquivo do tipo certo, senão levanta erro
        descritivo (nunca adivinha, mesmo padrão do `_resolve_attendee` do
        Calendar)."""
        if " " not in name_or_id and len(name_or_id) > 20:
            return name_or_id

        matches = self.search_files(name_or_id, mime_type=mime_type)
        # Prioriza correspondência exata de nome se houver mais de uma batida.
        exact = [f for f in matches if f.name.lower() == name_or_id.lower()]
        if len(exact) == 1:
            return exact[0].id
        if len(matches) == 1:
            return matches[0].id
        if not matches:
            kind = "planilha" if mime_type == _SPREADSHEET_MIME else "documento"
            raise ValueError(f"Não encontrei nenhuma {kind} chamada '{name_or_id}' no Drive.")
        names = ", ".join(f.name for f in matches)
        raise ValueError(f"'{name_or_id}' bate com mais de um arquivo ({names}) — peça pro usuário ser mais específico.")

    # ----------------------------------------------------------- Sheets

    def read_sheet(self, name_or_id: str, cell_range: str | None = None) -> dict[str, Any]:
        file_id = self.resolve_file_id(name_or_id, _SPREADSHEET_MIME)
        meta = self.sheets.spreadsheets().get(spreadsheetId=file_id).execute()
        sheet_names = [s["properties"]["title"] for s in meta.get("sheets", [])]
        range_ = cell_range or sheet_names[0]
        values = (
            self.sheets.spreadsheets()
            .values()
            .get(spreadsheetId=file_id, range=range_)
            .execute()
            .get("values", [])
        )
        return {"file_id": file_id, "sheet_names": sheet_names, "range": range_, "values": values}

    def write_sheet(self, name_or_id: str, cell_range: str, values: list[list[Any]]) -> dict[str, Any]:
        file_id = self.resolve_file_id(name_or_id, _SPREADSHEET_MIME)
        result = (
            self.sheets.spreadsheets()
            .values()
            .update(spreadsheetId=file_id, range=cell_range, valueInputOption="USER_ENTERED", body={"values": values})
            .execute()
        )
        return {"file_id": file_id, "updated_cells": result.get("updatedCells", 0)}

    def append_sheet_row(self, name_or_id: str, sheet_name: str, values: list[Any]) -> dict[str, Any]:
        file_id = self.resolve_file_id(name_or_id, _SPREADSHEET_MIME)
        result = (
            self.sheets.spreadsheets()
            .values()
            .append(
                spreadsheetId=file_id,
                range=sheet_name,
                valueInputOption="USER_ENTERED",
                insertDataOption="INSERT_ROWS",
                body={"values": [values]},
            )
            .execute()
        )
        return {"file_id": file_id, "updated_range": result.get("updates", {}).get("updatedRange", "")}

    def create_spreadsheet(self, title: str) -> dict[str, str]:
        result = self.sheets.spreadsheets().create(body={"properties": {"title": title}}).execute()
        return {"file_id": result["spreadsheetId"], "web_link": result.get("spreadsheetUrl", "")}

    # Caracteres que o Google Sheets proíbe em nome de aba — acharia 400 (INVALID_ARGUMENT)
    # sem essa limpeza (achado real: "Pague Menos 02/09" tem "/" no nome, inválido).
    _SHEET_TITLE_FORBIDDEN = str.maketrans({c: "-" for c in "/\\?*[]:"})

    def create_sheet_tab(
        self, name_or_id: str, title: str, values: list[list[Any]] | None = None
    ) -> dict[str, Any]:
        """Cria uma aba (sheet) NOVA dentro de uma planilha JÁ EXISTENTE — pra
        organizar dados por assunto (ex.: uma aba por compra, pra comparar
        preços depois) sem criar uma planilha nova inteira toda vez. `values`
        (opcional) já escreve o conteúdo inicial da aba, começando em A1, numa
        chamada só (mais eficiente que abrir e depois escrever linha a linha)."""
        file_id = self.resolve_file_id(name_or_id, _SPREADSHEET_MIME)
        safe_title = title.translate(self._SHEET_TITLE_FORBIDDEN)[:100]  # 100 chars, limite do Sheets

        result = (
            self.sheets.spreadsheets()
            .batchUpdate(spreadsheetId=file_id, body={"requests": [{"addSheet": {"properties": {"title": safe_title}}}]})
            .execute()
        )
        sheet_id = result["replies"][0]["addSheet"]["properties"]["sheetId"]

        if values:
            self.write_sheet(file_id, f"'{safe_title}'!A1", values)

        return {"file_id": file_id, "sheet_id": sheet_id, "title": safe_title}

    # ------------------------------------------------------------- Docs

    def read_doc(self, name_or_id: str) -> dict[str, Any]:
        file_id = self.resolve_file_id(name_or_id, _DOC_MIME)
        doc = self.docs.documents().get(documentId=file_id).execute()
        text = "".join(
            run.get("textRun", {}).get("content", "")
            for element in doc.get("body", {}).get("content", [])
            for run in element.get("paragraph", {}).get("elements", [])
        )
        return {"file_id": file_id, "title": doc.get("title", ""), "content": text}

    def append_doc(self, name_or_id: str, text: str) -> dict[str, Any]:
        file_id = self.resolve_file_id(name_or_id, _DOC_MIME)
        doc = self.docs.documents().get(documentId=file_id).execute()
        end_index = doc.get("body", {}).get("content", [{}])[-1].get("endIndex", 1)
        self.docs.documents().batchUpdate(
            documentId=file_id,
            body={"requests": [{"insertText": {"location": {"index": end_index - 1}, "text": f"\n{text}"}}]},
        ).execute()
        return {"file_id": file_id}

    def create_doc(self, title: str, content: str = "") -> dict[str, str]:
        doc = self.docs.documents().create(body={"title": title}).execute()
        file_id = doc["documentId"]
        if content:
            self.docs.documents().batchUpdate(
                documentId=file_id,
                body={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
            ).execute()
        return {"file_id": file_id, "web_link": f"https://docs.google.com/document/d/{file_id}/edit"}
