"""Tools expostas ao LLM do orquestrador (SCRUM-17).

Substitui os sub-agentes do n8n (Email/Calendar/Contact Agent Tool) por
chamada direta às funções dos MCP Servers já existentes
(`mcp_servers/gmail`, `mcp_servers/calendar`, `mcp_servers/contacts`) —
um LLM só, sem sub-agentes aninhados, decide qual tool chamar.

`idempotency_key` (exigida por `send_email`/`create_event`, ver
SCRUM-45/46) é gerada aqui a partir de um hash do conteúdo, não exposta
ao LLM — ele não precisa saber que esse mecanismo existe.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx

from app.orchestrator.status_tracker import get_status_tracker
from mcp_servers.calendar import server as calendar_server
from mcp_servers.contacts import server as contacts_server
from mcp_servers.gmail import server as gmail_server
from mcp_servers.google_workspace import server as google_workspace_server
from mcp_servers.obsidian import server as obsidian_server
from mcp_servers.websearch import server as websearch_server

# Coordenadas padrão quando o usuário não especifica cidade — mesmo fallback do widget de
# clima no HUD (script.js, loadWeather()), São Paulo.
_DEFAULT_WEATHER_LOCATION = {"lat": -23.5505, "lon": -46.6333, "label": "São Paulo"}


def _weather_code_to_text(code: int) -> str:
    """Tradução dos códigos WMO da Open-Meteo — mesma tabela do HUD (script.js,
    weatherCodeToText()), duplicada aqui porque o orquestrador roda no backend, sem acesso
    ao clima já carregado no navegador do usuário."""
    if code == 0:
        return "céu limpo"
    if code <= 2:
        return "poucas nuvens"
    if code == 3:
        return "nublado"
    if code <= 48:
        return "neblina"
    if code <= 57:
        return "garoa"
    if code <= 67:
        return "chuva"
    if code <= 77:
        return "neve"
    if code <= 82:
        return "pancadas de chuva"
    if code <= 99:
        return "tempestade"
    return "condição desconhecida"


async def _get_weather(city: str | None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        if city:
            geo_response = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "pt"},
            )
            geo_response.raise_for_status()
            results = geo_response.json().get("results") or []
            if not results:
                return {"error": f'Não encontrei a cidade "{city}".'}
            location = {"lat": results[0]["latitude"], "lon": results[0]["longitude"], "label": results[0]["name"]}
        else:
            location = _DEFAULT_WEATHER_LOCATION

        forecast_response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": location["lat"],
                "longitude": location["lon"],
                "current": "temperature_2m,weather_code",
                "daily": "precipitation_probability_max",
                "timezone": "auto",
            },
        )
        forecast_response.raise_for_status()
        data = forecast_response.json()

    rain_chance = (data.get("daily", {}).get("precipitation_probability_max") or [None])[0]
    return {
        "city": location["label"],
        "temperature_celsius": round(data["current"]["temperature_2m"]),
        "condition": _weather_code_to_text(data["current"]["weather_code"]),
        "rain_chance_percent": rain_chance,
    }


def _content_hash(*parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:16]


TOOLS: list[dict[str, Any]] = [
    {
        "name": "send_email",
        "description": "Envia um email pelo Gmail. Ação irreversível — só chame depois de confirmação explícita do usuário na conversa.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Email do destinatário."},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "list_emails",
        "description": "Lista emails do Gmail. `query` aceita a sintaxe de busca do Gmail (ex.: 'from:fulano@exemplo.com is:unread').",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "default": ""},
                "max_results": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "read_email",
        "description": "Lê o conteúdo completo de um email específico pelo ID.",
        "input_schema": {
            "type": "object",
            "properties": {"message_id": {"type": "string"}},
            "required": ["message_id"],
        },
    },
    {
        "name": "create_event",
        "description": (
            "Cria um evento no Google Calendar. `attendees` aceita nome ou email "
            "(nomes são resolvidos via Contacts automaticamente). Ação irreversível "
            "— só chame depois de confirmação explícita do usuário na conversa."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "start": {"type": "string", "description": "ISO 8601, ex.: 2026-08-20T15:00:00-03:00"},
                "end": {"type": "string", "description": "ISO 8601"},
                "description": {"type": "string", "default": ""},
                "attendees": {"type": "array", "items": {"type": "string"}, "description": "Nomes ou emails."},
            },
            "required": ["summary", "start", "end"],
        },
    },
    {
        "name": "list_events",
        "description": "Lista eventos do Google Calendar em um período (ISO 8601).",
        "input_schema": {
            "type": "object",
            "properties": {
                "time_min": {"type": "string"},
                "time_max": {"type": "string"},
                "max_results": {"type": "integer", "default": 10},
            },
            "required": ["time_min", "time_max"],
        },
    },
    {
        "name": "get_event",
        "description": "Lê os detalhes de um evento específico do Calendar pelo ID.",
        "input_schema": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
        },
    },
    {
        "name": "search_contact",
        "description": "Busca um contato do Google Contacts por nome (aceita nome parcial). Use antes de enviar email ou criar evento com attendee cujo email você não tem.",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "add_or_update_contact",
        "description": "Cria ou atualiza um contato do Google Contacts (casamento pelo nome).",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string", "default": ""},
                "phone": {"type": "string", "default": ""},
            },
            "required": ["name"],
        },
    },
    {
        "name": "web_search",
        "description": (
            "Busca na internet (Tavily ou Brave, com alternância automática entre eles). Use "
            "sempre que o pedido depender de informação atual/externa que você não tem certeza "
            "— notícias, preços, eventos recentes, 'o que é X', 'quem é Y', etc. Nunca invente "
            "uma resposta que devia vir de uma busca real; chame esta ferramenta."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_notes",
        "description": (
            "Busca no 'segundo cérebro' do usuário — um vault de notas curadas com fatos, "
            "preferências, decisões e perfis de pessoas relevantes (não é o histórico da "
            "conversa, isso você já tem). Use sempre que precisar lembrar de algo pessoal "
            "sobre o usuário que não foi dito nesta conversa nem nas últimas 24h."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_note",
        "description": "Lê o conteúdo completo de uma nota específica do vault de memória pelo caminho (ex.: 'Fatos/comida-favorita').",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_note",
        "description": (
            "Cria ou sobrescreve uma nota no vault de memória do usuário — use pra registrar "
            "um fato, preferência ou decisão nova que o usuário compartilhou e que vale a "
            "pena lembrar permanentemente (ex.: 'Fatos/time-de-futebol.md'). Não use pra "
            "histórico de conversa comum, só pra memória curada de longo prazo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}, "default": []},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "append_note",
        "description": "Acrescenta conteúdo ao final de uma nota existente do vault de memória, sem apagar o que já estava escrito.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    },
    {
        "name": "search_drive_files",
        "description": "Busca arquivos no Google Drive do usuário por nome (não precisa ser exato). Use pra achar uma planilha/documento antes de ler/editar, ou pra confirmar se um arquivo existe.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "max_results": {"type": "integer", "default": 10}},
            "required": ["query"],
        },
    },
    {
        "name": "read_sheet",
        "description": "Lê os valores de uma planilha do Google Sheets. `spreadsheet` aceita o NOME da planilha (ex.: 'Setembro/26 - Orçamento mensal') ou o ID — nome é resolvido automaticamente no Drive. Sem `cell_range`, lê a primeira aba inteira.",
        "input_schema": {
            "type": "object",
            "properties": {"spreadsheet": {"type": "string"}, "cell_range": {"type": "string", "default": ""}},
            "required": ["spreadsheet"],
        },
    },
    {
        "name": "write_sheet",
        "description": "Escreve/sobrescreve valores num intervalo de células de uma planilha (ex.: 'Página1!A2:D2'). `values` é uma lista de linhas, cada linha uma lista de valores das colunas.",
        "input_schema": {
            "type": "object",
            "properties": {
                "spreadsheet": {"type": "string"},
                "cell_range": {"type": "string"},
                "values": {"type": "array", "items": {"type": "array"}},
            },
            "required": ["spreadsheet", "cell_range", "values"],
        },
    },
    {
        "name": "append_sheet_row",
        "description": "Acrescenta UMA linha nova ao final de uma aba da planilha, sem sobrescrever nada existente — use pra 'lançar' um item novo (ex.: uma conta de cobrança). `values` é a lista de valores das colunas, na ordem.",
        "input_schema": {
            "type": "object",
            "properties": {
                "spreadsheet": {"type": "string"},
                "sheet_name": {"type": "string"},
                "values": {"type": "array", "items": {}},
            },
            "required": ["spreadsheet", "sheet_name", "values"],
        },
    },
    {
        "name": "create_spreadsheet",
        "description": "Cria uma planilha nova e vazia no Google Sheets com o título dado.",
        "input_schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
        },
    },
    {
        "name": "read_doc",
        "description": "Lê o conteúdo de texto de um Google Docs. `document` aceita nome ou ID.",
        "input_schema": {
            "type": "object",
            "properties": {"document": {"type": "string"}},
            "required": ["document"],
        },
    },
    {
        "name": "append_doc",
        "description": "Acrescenta texto ao final de um Google Docs existente. `document` aceita nome ou ID.",
        "input_schema": {
            "type": "object",
            "properties": {"document": {"type": "string"}, "text": {"type": "string"}},
            "required": ["document", "text"],
        },
    },
    {
        "name": "create_doc",
        "description": "Cria um Google Docs novo com o título dado, opcionalmente já com conteúdo inicial.",
        "input_schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "content": {"type": "string", "default": ""}},
            "required": ["title"],
        },
    },
    {
        "name": "check_service_connections",
        "description": (
            "Testa a conexão real com Email, Agenda e Contatos agora (chamada leve e "
            "silenciosa, não lista nada) e diz quais estão conectados. Use quando o "
            "usuário pedir para 'conectar os serviços', testar a conexão, ou verificar "
            "se email/agenda/contatos estão funcionando. Depois de chamar, informe o "
            "resultado de cada serviço por nome (ex.: 'Email — Conectado, Agenda — "
            "Conectada, Contato — Não conectado')."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_weather",
        "description": (
            "Consulta o clima atual (temperatura, condição, chance de chuva hoje) de uma "
            "cidade. Sem `city`, usa São Paulo como padrão. Use sempre que o usuário "
            "perguntar sobre temperatura, clima ou previsão do tempo — nunca invente ou "
            "diga que não tem acesso, essa ferramenta existe exatamente pra isso."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string", "default": ""}},
        },
    },
]


async def execute_tool(name: str, tool_input: dict[str, Any]) -> Any:
    """Dispatcher: chama a função real por trás de cada tool do LLM,
    registrando sucesso/falha no status tracker (ver `status_tracker.py`,
    consumido por `GET /status/checkin` — painel de check-in do HUD)."""
    tracker = get_status_tracker()
    try:
        result = await _dispatch(name, tool_input)
    except Exception as exc:
        tracker.record(name, ok=False, error=str(exc))
        raise
    tracker.record(name, ok=True)
    return result


async def _dispatch(name: str, tool_input: dict[str, Any]) -> Any:
    if name == "send_email":
        idempotency_key = _content_hash(tool_input["to"], tool_input["subject"], tool_input["body"])
        return await gmail_server.send_email(
            to=tool_input["to"],
            subject=tool_input["subject"],
            body=tool_input["body"],
            idempotency_key=idempotency_key,
        )
    if name == "list_emails":
        return await gmail_server.list_emails(
            query=tool_input.get("query", ""), max_results=tool_input.get("max_results", 10)
        )
    if name == "read_email":
        return await gmail_server.read_email(message_id=tool_input["message_id"])
    if name == "create_event":
        idempotency_key = _content_hash(tool_input["summary"], tool_input["start"], tool_input["end"])
        return await calendar_server.create_event(
            summary=tool_input["summary"],
            start=tool_input["start"],
            end=tool_input["end"],
            idempotency_key=idempotency_key,
            description=tool_input.get("description", ""),
            attendees=tool_input.get("attendees"),
        )
    if name == "list_events":
        return await calendar_server.list_events(
            time_min=tool_input["time_min"],
            time_max=tool_input["time_max"],
            max_results=tool_input.get("max_results", 10),
        )
    if name == "get_event":
        return await calendar_server.get_event(event_id=tool_input["event_id"])
    if name == "search_contact":
        return await contacts_server.search_contact(name=tool_input["name"])
    if name == "add_or_update_contact":
        return await contacts_server.add_or_update_contact(
            name=tool_input["name"],
            email=tool_input.get("email", ""),
            phone=tool_input.get("phone", ""),
        )
    if name == "get_weather":
        return await _get_weather(tool_input.get("city") or None)
    if name == "web_search":
        return await websearch_server.web_search(
            query=tool_input["query"], max_results=tool_input.get("max_results", 5)
        )
    if name == "search_notes":
        return await obsidian_server.search_notes(
            query=tool_input["query"], max_results=tool_input.get("max_results", 10)
        )
    if name == "read_note":
        return await obsidian_server.read_note(path=tool_input["path"])
    if name == "write_note":
        return await obsidian_server.write_note(
            path=tool_input["path"], content=tool_input["content"], tags=tool_input.get("tags")
        )
    if name == "append_note":
        return await obsidian_server.append_note(path=tool_input["path"], content=tool_input["content"])
    if name == "search_drive_files":
        return await google_workspace_server.search_drive_files(
            query=tool_input["query"], max_results=tool_input.get("max_results", 10)
        )
    if name == "read_sheet":
        return await google_workspace_server.read_sheet(
            spreadsheet=tool_input["spreadsheet"], cell_range=tool_input.get("cell_range", "")
        )
    if name == "write_sheet":
        return await google_workspace_server.write_sheet(
            spreadsheet=tool_input["spreadsheet"],
            cell_range=tool_input["cell_range"],
            values=tool_input["values"],
        )
    if name == "append_sheet_row":
        return await google_workspace_server.append_sheet_row(
            spreadsheet=tool_input["spreadsheet"],
            sheet_name=tool_input["sheet_name"],
            values=tool_input["values"],
        )
    if name == "create_spreadsheet":
        return await google_workspace_server.create_spreadsheet(title=tool_input["title"])
    if name == "read_doc":
        return await google_workspace_server.read_doc(document=tool_input["document"])
    if name == "append_doc":
        return await google_workspace_server.append_doc(document=tool_input["document"], text=tool_input["text"])
    if name == "create_doc":
        return await google_workspace_server.create_doc(
            title=tool_input["title"], content=tool_input.get("content", "")
        )
    if name == "check_service_connections":
        # import local pra evitar ciclo (connection_check importa execute_tool daqui)
        from app.orchestrator.connection_check import check_all_connections

        return await check_all_connections()
    raise ValueError(f"Tool desconhecida: {name}")
