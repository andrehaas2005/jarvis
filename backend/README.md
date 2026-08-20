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
├── requirements.txt
└── .env.example
```

## Retry + Idempotência

Toda ação sensível (enviar email, criar evento no calendário) deve passar
por `app.retry.run_idempotent`, passando uma `idempotency_key` única por
ação. Isso garante que a mesma ação não executa duas vezes mesmo se o
gatilho (voz, webhook, etc.) disparar múltiplas vezes — a causa raiz do
SCRUM-45.
