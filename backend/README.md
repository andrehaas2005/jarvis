# JARVIS Backend (Python/FastAPI)

Orquestrador do JARVIS, escrito em Python. Substitui a arquitetura n8n
(ver [SCRUM-16](https://andrehaas2005.atlassian.net/browse/SCRUM-16) e
[SCRUM-17](https://andrehaas2005.atlassian.net/browse/SCRUM-17)).

## Stack

- **FastAPI** — servidor async
- **mcp** — SDK oficial Python da Anthropic para os MCP Servers
- **httpx** — chamadas HTTP async
- **sqlite3** (stdlib) — sistema de memória
- **python-dotenv / pydantic-settings** — configuração via `.env`

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Rodar localmente

```bash
uvicorn app.main:app --reload --port 8000
```

- Healthcheck: http://localhost:8000/health
- Docs automáticas: http://localhost:8000/docs

## Estrutura

```
backend/
├── app/
│   ├── main.py             # FastAPI app + rotas
│   ├── config.py           # Settings (variáveis de ambiente)
│   ├── logging_config.py   # Logging estruturado em JSON
│   └── retry.py            # Retry + idempotência (fix SCRUM-45/46)
├── mcp_servers/
│   ├── google_auth.py        # OAuth2 compartilhado (Gmail + Calendar)
│   ├── gmail/                # MCP Server do Gmail (SCRUM-14)
│   │   ├── gmail_client.py   # wrapper Gmail API
│   │   └── server.py         # tools MCP: send_email, list_emails, read_email
│   ├── calendar/              # MCP Server do Google Calendar (SCRUM-15)
│   │   ├── calendar_client.py # wrapper Calendar API
│   │   └── server.py          # tools MCP: create_event, list_events, get_event
│   └── contacts/              # MCP Server de Contacts / Airtable (SCRUM-49)
│       ├── contacts_client.py # wrapper Airtable REST API
│       └── server.py          # tools MCP: search_contact, add_or_update_contact
├── requirements.txt
└── .env.example
```

## MCP Server — Gmail (SCRUM-14)

Expõe 3 ferramentas MCP:

- **`send_email(to, subject, body, idempotency_key)`** — envia email. A
  `idempotency_key` é obrigatória e passa pelo `app.retry` do SCRUM-16: a
  mesma chave nunca dispara um segundo envio, mesmo com retries/webhooks
  duplicados (fix do SCRUM-45).
- **`list_emails(query, max_results)`** — lista emails (sintaxe de busca do Gmail).
- **`read_email(message_id)`** — lê o conteúdo completo de um email.

### Configurar credenciais do Gmail

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com/) e ative a Gmail API.
2. Crie uma credencial OAuth 2.0 do tipo "Desktop app" e baixe o `credentials.json`.
3. No `.env`, preencha:
   ```
   GMAIL_CREDENTIALS_PATH=/caminho/para/credentials.json
   GMAIL_TOKEN_PATH=/caminho/para/token.json
   ```
4. Na primeira execução, uma janela do navegador abre para autorizar — o `token.json` é salvo automaticamente para as próximas execuções.

### Rodar standalone (stdio, para testar com um MCP inspector)

```bash
python -m mcp_servers.gmail.server
```

## MCP Server — Google Calendar (SCRUM-15)

Expõe 3 ferramentas MCP:

- **`create_event(summary, start, end, idempotency_key, description, attendees)`**
  — cria evento (`start`/`end` em ISO 8601). A `idempotency_key` é
  obrigatória e passa pelo `app.retry` do SCRUM-16: retry/timeout do
  agente de voz não cria eventos duplicados (fix do SCRUM-47 — Calendar
  Agent intermitente).
- **`list_events(time_min, time_max, max_results)`** — lista eventos em um período.
- **`get_event(event_id)`** — lê os detalhes de um evento específico.

### Configurar credenciais do Calendar

Mesmo fluxo do Gmail (mesmo projeto no Google Cloud Console funciona para
os dois — só ative também a Calendar API):

```
CALENDAR_CREDENTIALS_PATH=/caminho/para/credentials.json
CALENDAR_TOKEN_PATH=/caminho/para/token.json
```

### Rodar standalone (stdio)

```bash
python -m mcp_servers.calendar.server
```

## MCP Server — Contacts / Airtable (SCRUM-49)

Nasceu do diagnóstico do SCRUM-47: o Calendar Agent do n8n não tinha nenhum
jeito determinístico de resolver nome→email de um attendee. Expõe 2 ferramentas MCP:

- **`search_contact(name)`** — busca contato por nome exato, retorna
  `{found, name, email, phone}`.
- **`add_or_update_contact(name, email, phone)`** — upsert por nome (cria
  se não existir, atualiza os campos passados se existir).

O backend orquestrador deve chamar `search_contact` antes de
`calendar.create_event` sempre que o attendee vier como nome em vez de
email — fecha o SCRUM-47 de vez.

### Configurar Airtable

1. Gere um Personal Access Token em [airtable.com/create/tokens](https://airtable.com/create/tokens) com escopo `data.records:read` e `data.records:write` na base de contatos.
2. Pegue o Base ID na URL da base (`https://airtable.com/appXXXXXXXXXXXXXX/...` — o `appXXXXXXXXXXXXXX` é o Base ID).
3. No `.env`:
   ```
   AIRTABLE_API_KEY=pat...
   AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
   AIRTABLE_TABLE_NAME=Sheet1
   ```

A tabela deve ter as colunas `Nome`, `Email`, `Telefone` (mesmo schema do `Contacts Agent Tool` do n8n).

### Rodar standalone (stdio)

```bash
python -m mcp_servers.contacts.server
```

## Retry + Idempotência

Toda ação sensível (enviar email, criar evento no calendário) deve passar
por `app.retry.run_idempotent`, passando uma `idempotency_key` única por
ação. Isso garante que a mesma ação não executa duas vezes mesmo se o
gatilho (voz, webhook, etc.) disparar múltiplas vezes — a causa raiz do
SCRUM-45.
