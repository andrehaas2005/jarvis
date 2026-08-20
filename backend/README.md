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
│   └── gmail/               # MCP Server do Gmail (SCRUM-14)
│       ├── gmail_client.py  # wrapper OAuth2 + Gmail API
│       └── server.py        # tools MCP: send_email, list_emails, read_email
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

## Retry + Idempotência

Toda ação sensível (enviar email, criar evento no calendário) deve passar
por `app.retry.run_idempotent`, passando uma `idempotency_key` única por
ação. Isso garante que a mesma ação não executa duas vezes mesmo se o
gatilho (voz, webhook, etc.) disparar múltiplas vezes — a causa raiz do
SCRUM-45.
