# 📋 JARVIS Roadmap - Sessão de Continuidade

**Data de Criação:** 2026-08-19  
**Última Atualização:** 2026-08-20 (sessão 3 — SCRUM-17: orquestrador Python em produção, testado por voz de ponta a ponta; n8n ainda ativo até desativação explícita)  
**Status Geral:** Sprint 1 Ativo ✅ — Backend Python rodando em produção (https://jarvis-api.andre.haas.nom.br), agora incluindo o orquestrador (`/jarvis/webhook`)

---

## 🎯 Quick Reference para Retomar

### Jira Board
- **URL:** https://andrehaas2005.atlassian.net/jira/software/projects/SCRUM/boards/1
- **Projeto:** SCRUM (Meus Projetos)
- **Sprint Ativo:** Sprint 1 - Fundação JARVIS (19/ago → 02/set/2026)
- **Tickets no Sprint:** 15 (4 BUGFIX + 11 FASE 1)

### Status Atual
```
Total Issues: 42 (SCRUM-8 a SCRUM-51)
├── 4 Epics (SCRUM-8 a SCRUM-11)
├── 38 Histórias (SCRUM-14 a SCRUM-51)
│   ├── 15 no Sprint 1 original + SCRUM-49/50 (sessão 2) + SCRUM-51 (sessão 3, bugfix)
│   └── 20 no Backlog (FASE 2 + FASE 3)
├── 6 tickets CONCLUÍDOS: 14, 15, 16, 48, 49, 50 (deploy real em produção, testado)
├── 2 tickets em Em análise: 45, 46 (fix real testado, falta remover n8n pra fechar)
└── 2 tickets em Em andamento: 17 (endpoint novo testado por voz, falta desativar n8n), 47 (fix testado, mesma pendência do 17)
```

---

## 🚀 O que foi feito — SESSÃO 1

### ✅ Criado
1. **Artifact HTML Roadmap** — análise completa dos 8 pontos de evolução
   - URL: https://claude.ai/code/artifact/80e1487c-9790-40cc-a6b9-c73799c50feb
   - Cobre: n8n removal, MCP servers, settings, chat, custom phrases, evolutions, deploy, memory

2. **Jira Board Completo**
   - 4 Epics criados (FASE 1, 2, 3, BUGFIX)
   - 35 Histórias criadas e linkadas
   - Deletados 7 tickets duplicados antigos (SCRUM-1 a SCRUM-7)

3. **Sprint 1 Iniciado**
   - 15 tickets movidos do backlog para o Sprint
   - Duração: 19/ago/2026 → 02/set/2026 (2 semanas)
   - 4 BUGFIXes críticos priorizado no início
   - 11 histórias da FASE 1 Fundação

---

## 🚀 O que foi feito — SESSÃO 2 (backend Python → produção)

**Decisão:** SCRUM-16 mudou de Node.js para **Python/FastAPI** — usuário está estudando Python e quer aplicar no projeto.

### ✅ CONCLUÍDO — rodando em produção real

| Ticket | O que tem | Status Jira |
|---|---|---|
| SCRUM-16 | FastAPI app, config, logging JSON, **`app/retry.py`** (retry + idempotência) | **Concluído** |
| SCRUM-14 | MCP Server Gmail (`send_email`, `list_emails`, `read_email`) | **Concluído** |
| SCRUM-15 | MCP Server Calendar (`create_event`, `list_events`, `get_event`) + `google_auth.py` compartilhado | **Concluído** |
| SCRUM-48 | Endpoint `GET /elevenlabs/signed-url` (backend) + `script.js` usando `signedUrl` (frontend) | **Concluído** |
| SCRUM-50 *(novo)* | Deploy em produção — Dockerfile, VPS Hostinger, Traefik, DNS | **Concluído** |
| SCRUM-49 *(novo)* | MCP Server Contacts/Google People API (`search_contact`, `add_or_update_contact`) — migrado de Airtable sessão 3, usa Contatos do Google reais, sem custo. Deployado e testado em produção (230 contatos reais) | Em andamento *(falta integrar com create_event)* |

**🌐 Produção:** https://jarvis-api.andre.haas.nom.br — `GET /health` e `GET /elevenlabs/signed-url` testados reais via HTTPS, 200 OK.

**Testado com credenciais e dados REAIS** (não mais mock):
- OAuth Google real (Gmail + Calendar) — tokens salvos local E no servidor
- `send_email`: email real enviado + 2ª chamada com mesma `idempotency_key` **não duplicou** (mesmo `message_id`)
- `create_event`: evento real criado na agenda + 2ª chamada **não duplicou** (mesmo `event_id`)
- ElevenLabs signed-url: testado real em produção, retornou `wss://api.elevenlabs.io/...` válido
- Contacts (Google People API, sessão 3): migrado de Airtable, **testado real** — 230 contatos retornados via `people.connections.list` local, PR #9 mergeado, deployado em produção (token copiado, `.env` atualizado, `git pull` + rebuild do `jarvis-backend`, `/health` OK). Falta só o teste de `search_contact`/`add_or_update_contact` ponta a ponta com um nome real

### 🖥️ Infraestrutura de produção (VPS Hostinger, descoberta+configurada nesta sessão)
- **Servidor:** `srv1068805.hstgr.cloud` (IP `72.61.131.105`), já hospeda n8n, AgentOS e outros projetos pessoais via Docker Compose (`/root/docker-compose.yml` **no servidor**, fora deste repo)
- **Traefik** já configurado como reverse proxy: TLS automático via Let's Encrypt + Cloudflare DNS challenge
- **DNS:** 100% no Cloudflare, com um registro **wildcard** (`*.andre.haas.nom.br` → IP do VPS) que cobre qualquer subdomínio novo automaticamente — não precisou criar registro nenhum
- `jarvis.andre.haas.nom.br` já estava ocupado por outro serviço (ferramenta própria da Hostinger, "OpenClaw") — por isso usamos `jarvis-api`
- Acesso ao servidor: painel Hostinger (Gerenciador Docker) → Web Terminal do container/host
- Credenciais reais no servidor: `/root/.env` (variáveis) e `/root/jarvis-credentials/` (Google OAuth tokens) — **nunca neste repo**
- Repo clonado no servidor em `/root/jarvis-repo` para builds futuros

### 🔎 Diagnóstico dos bugs críticos (investigando os JSONs do n8n)
- **SCRUM-45/46** (email 8x / atomicidade): causa raiz = confirmação de envio garantida só por **prompt engineering** no `Email Agent Tool.json`, sem nenhuma camada determinística abaixo do LLM. Fix testado com envio real em produção.
- **SCRUM-47** (Calendar intermitente): causa raiz real é **diferente** do suposto — o `Calendar Agent Tool.json` não tem lookup de nome→email de attendee, depende do LLM alucinar. Gerou o novo ticket **SCRUM-49**. Idempotência testada real; lookup de contato agora **integrado dentro do `create_event`** (sessão 3): `attendees` aceita nome, resolvido via Contacts antes de criar o evento; ambíguo ou não encontrado → erro descritivo, nunca adivinha.
- **SCRUM-45/46/47 continuam "Em análise"/"Em andamento" e só fecham como Concluído após a migração completa do n8n (SCRUM-17, ainda não feita)** — o n8n antigo continua rodando em produção até lá, no mesmo servidor.

### ⚠️ Cuidado ao mergear PRs empilhados no GitHub
Os primeiros PRs desta sessão foram criados empilhados (cada um com base no anterior). Ao mergear no GitHub, **apenas os PRs cuja base era `main` de fato atualizaram `main`** — os PRs "do meio" da pilha ficaram mergeados só no branch pai. Foi preciso `git merge origin/<branch-da-ponta-da-pilha>` manualmente para trazer tudo. **Da próxima vez:** PRs não-empilhados (todos com base `main` direto) evitam esse problema — foi o que usamos para o SCRUM-50 (deploy) e funcionou sem esse cuidado extra.

### ⚠️ Pendências restantes
1. ~~Ativar a People API + autorizar OAuth~~ — **feito** (local e produção)
2. ~~Conectar `search_contact` (SCRUM-49) ao fluxo de `create_event` (SCRUM-15)~~ — **feito** (sessão 3): `create_event` resolve `attendees` por nome via Contacts antes de criar o evento; testado real (nome único, ambíguo, não encontrado, email direto)
3. **SCRUM-17 — falta só desativar os workflows JARVIS no n8n** (ver seção abaixo) — o endpoint novo já está em produção e testado por voz

---

## 🚀 O que foi feito — SESSÃO 3 (SCRUM-17: orquestrador Python substitui o n8n)

### Diagnóstico
O agente de voz do ElevenLabs tinha **uma única ferramenta**: um webhook POST pro n8n (`n8n.andre.haas.nom.br/webhook/n8n-connection`), com **17.9% de taxa de erro** e **9.5s de latência média** (medidos no próprio painel do ElevenLabs — Ferramentas → stats). O n8n rodava um agente (`JARVIS`, node `@n8n/langchain.agent`, GPT-5) que decidia chamar sub-agentes aninhados: Email Agent Tool, Calendar Agent Tool, Contact Agent Tool, Content Creator Agent Tool (Tavily + geração de conteúdo).

### ✅ CONCLUÍDO
- **`app/orchestrator/`** (novo) — substitui o node `JARVIS` do n8n:
  - `providers.py` — abstração `LLMProvider` + `AnthropicProvider` (loop manual de tool-calling, sem beta `tool_runner`). Trocar de provedor no futuro = nova classe + `LLM_PROVIDER` no `.env`, sem reescrever o resto.
  - `tools.py` — 8 tools chamando os MCP Servers (Gmail/Calendar/Contacts) **direto**, sem os sub-agentes aninhados do n8n. `idempotency_key` gerada por hash de conteúdo, não exposta ao LLM.
  - `memory.py` — memória de sessão em processo por `conversation_id` (equivalente ao "Simple Memory" do n8n).
  - `router.py` — system prompt adaptado do `JARVIS.sanitized.json` original: roteamento puro + **confirmação explícita antes de ação destrutiva/irreversível**.
- **`POST /jarvis/webhook`** em `main.py` — mesmo contrato do webhook n8n (`{"query": "..."}` in/out, header `x-jarvis-secret`, reaproveitado o mesmo secret já usado pelo n8n).
- **Content Creator Agent (Tavily) ficou fora de escopo** — decisão da sessão, vira ticket separado se for retomado.
- **SCRUM-51 (bugfix, achado testando em produção):** `google_auth.py` quebrava com `[Errno 30] Read-only file system` ao tentar persistir token renovado — o mount `/app/.credentials:ro` no servidor é somente leitura de propósito. Fix: persistir vira best-effort (warning, não exceção); credenciais renovadas em memória continuam válidas pra chamada atual.
- **ElevenLabs reconfigurado:** tool renomeada de `n8n_webhook` pra `jarvis_backend`, URL trocada pra `https://jarvis-api.andre.haas.nom.br/jarvis/webhook`. Prompt do sistema do agente também tinha o nome da tool **hardcoded** (`'n8n'`) — corrigido pra `'jarvis_backend'` em todas as ocorrências (Primary Function, Corrections, Example Interactions) e publicado.
- **Testado real de ponta a ponta:**
  - Direto no endpoint (`curl`): `search_contact` funcionando, 401 sem secret correto
  - Confirmação antes de ação destrutiva: 1ª msg pede confirmação, 2ª msg (mesma sessão) executa — memória multi-turn OK
  - **Conversa real via preview do ElevenLabs:** "qual o email da Maria Aparecida?" → agente chamou `jarvis_backend` → resolveu via Contacts → resposta certa

### ⚠️ Pendente
- **Desativar (não deletar) os workflows JARVIS no n8n**: `JARVIS`, `Email Agent Tool`, `Calendar Agent Tool`, `Contacts Agent Tool`, `Content Creator Agent Tool` — só esses, o resto do n8n (outros projetos no mesmo Hostinger) continua rodando normal
- Só depois disso os SCRUM-45/46/47 fecham como **Concluído** de vez
- Monitorar taxa de erro/latência do `jarvis_backend` no painel do ElevenLabs nos próximos dias, comparando com os 17.9%/9.5s do n8n antigo

---

## 🔄 Workflow de Desenvolvimento

```
Issue criada no Jira
    ↓
[A FAZER] ← Backlog/Sprint
    ↓
Desenvolver localmente (branch feature/bugfix)
    ↓
[EM ANDAMENTO] ← Dev em progresso
    ↓
Commit com referência: "SCRUM-XX: descrição"
    ↓
[EM ANÁLISE] ← PR aberto/review
    ↓
Merge em main
    ↓
[EM DEPLOY] ← Enviado para staging/prod
    ↓
Deploy bem-sucedido em PRODUÇÃO
    ↓
[CONCLUÍDO] ← Fechar card
```

### Regras Importantes
- **Bugs encontrados em DEV:** Criar novo SCRUM issue imediatamente, priorizar, mover para Sprint
- **Antes de fechar:** Card só fecha APÓS deploy bem-sucedido em produção
- **Commits:** Sempre referenciar ticket: `git commit -m "SCRUM-45: fix email duplicate send"`
- **Contexto:** Este arquivo (ROADMAP_SESSION.md) é o único arquivo necessário para retomar em outro contexto

---

## 📊 Próximas Ações (Ordem de Prioridade)

### IMEDIATO (Sprint 1) — retomar por aqui
1. **SCRUM-17** — Desativar os workflows JARVIS no n8n (endpoint novo já testado por voz em produção — ver sessão 3)
2. Testar o HUD (frontend) apontando pro backend de produção (hoje `script.js` usa `JARVIS_BACKEND_URL = 'http://localhost:8000'` — trocar pra `https://jarvis-api.andre.haas.nom.br` quando for usar em produção)

### CURTO PRAZO (Fim Sprint 1)
5. **SCRUM-20-23** — Settings Page
6. **SCRUM-24-25** — Sistema de Memória (Nível 1-2)

---

## 💡 Sugestões de Otimização do Workflow

### ✅ Implementado
- Single Source of Truth: **Jira é a autoridade**
- Labels de Epic para rastreabilidade
- Status de Deploy separado antes de Concluído
- Arquivo MD para contexto entre sessões

### 🔄 Considerar Adicionar

1. **Estimativas de Story Points**
   - SCRUM-45/46 (BUGFIX): 8-13 pontos (complexo)
   - SCRUM-14/15 (MCP Server): 5-8 pontos
   - SCRUM-20-23 (Settings): 13-21 pontos (UI complexa)
   - Sugestão: Usar Fibonacci (3, 5, 8, 13, 21)

2. **Assignee + Time Tracking**
   - Adicionar ao card quem está trabalhando
   - Estimar vs. Realizado para velocidade da equipe

3. **Sub-tasks para Histórias Grandes**
   - SCRUM-16 (Backend): quebrar em sub-tasks
   - SCRUM-20 (Settings UI): quebrar em componentes

4. **Definition of Done Checklist**
   - [ ] Código commitado com referência SCRUM-XX
   - [ ] Testes unitários passando
   - [ ] Code review aprovado
   - [ ] Deployado em staging
   - [ ] Testado em staging
   - [ ] Mergado em main
   - [ ] Deployado em produção
   - [ ] Validado em produção

5. **Labels Adicionais**
   - `backend`, `frontend`, `bugfix`, `urgent`, `review-needed`
   - Facilita filtering rápido

6. **Automation Rules** (se Jira Premium)
   - Auto-move "EM ANÁLISE" → "EM DEPLOY" quando PR é merged
   - Auto-close card após merge + deploy

---

## 📁 Estrutura de Arquivos Relacionados

```
/Users/andrehaas/Projetos/jarvis/
├── ROADMAP_SESSION.md          ← VOCÊ ESTÁ AQUI
├── index.html                  ← HUD principal
├── script.js                   ← Lógica de voz/gestos (usa signedUrl — SCRUM-48)
├── styles.css                  ← Estilos
├── backend/                     ← NOVO (sessão 2) — já em main, rodando em produção
│   ├── app/                     ← FastAPI: main.py, config.py, retry.py, elevenlabs.py
│   ├── mcp_servers/
│   │   ├── gmail/                (SCRUM-14)
│   │   ├── calendar/             (SCRUM-15)
│   │   └── contacts/             (SCRUM-49 — Google People API, falta ativar API + autorizar OAuth)
│   ├── Dockerfile                ← usado pelo deploy em produção (SCRUM-50)
│   ├── .env.example              ← copiar pra .env e preencher credenciais reais
│   └── README.md                 ← setup + infra de produção completa
├── .git/
│   └── (commits referenciam SCRUM-XX)
└── *.sanitized.json             ← workflows n8n antigos (JARVIS, Email/Calendar/Contacts Agent Tool)
                                     — usados nesta sessão pra diagnosticar SCRUM-45/46/47
```

---

## 🔑 Chaves de Acesso & URLs

| Recurso | URL/Local |
|---------|-----------|
| Jira Board | https://andrehaas2005.atlassian.net/jira/software/projects/SCRUM/boards/1 |
| Artifact Roadmap | https://claude.ai/code/artifact/80e1487c-9790-40cc-a6b9-c73799c50feb |
| Git Repo | /Users/andrehaas/Projetos/jarvis |
| JARVIS Live | http://localhost:8743/index.html |
| **Backend Jarvis (produção)** | **https://jarvis-api.andre.haas.nom.br** |
| n8n | https://n8n.andre.haas.nom.br |
| AgentOS (outro projeto, mesmo VPS) | https://painel.andre.haas.nom.br |
| ElevenLabs | https://elevenlabs.io/app/agents |
| VPS (Hostinger hPanel) | Gerenciador Docker → `srv1068805.hstgr.cloud` → Web Terminal |
| Cloudflare (DNS de andre.haas.nom.br) | https://dash.cloudflare.com |
| Repo clonado no servidor | `/root/jarvis-repo` (para rebuild/deploy) |
| Docker Compose do servidor | `/root/docker-compose.yml` (fora deste repo git — inclui n8n, AgentOS, jarvis-backend, etc.) |

---

## 🚀 Como Retomar em Outro Contexto

### Passo 1: Ler este arquivo (ROADMAP_SESSION.md)
- Entender o status e próximas ações
- Verificar quais tickets estão em progresso

### Passo 2: Abrir Jira Board
- Ver cards em "EM ANDAMENTO"
- Atualizar status conforme necessário

### Passo 3: Checkout branch correspondente
```bash
git checkout feature/SCRUM-45-fix-email-duplicates
# ou
git checkout bugfix/SCRUM-46-email-atomicity
```

### Passo 4: Continuar desenvolvimento
- Código + Testes
- Commit: `git commit -m "SCRUM-45: implementar retry logic com idempotência"`
- Move card para "EM ANÁLISE"

### Passo 5: Após Deploy
- Atualizar card para "EM DEPLOY"
- Após sucesso em produção: "CONCLUÍDO"

---

## 📞 Decisões Arquiteturais

- **MCP Servers:** Substituir n8n para retry/idempotência (SCRUM-16)
- **Settings Modal:** React component com localStorage persistência (SCRUM-20)
- **Memória:** SQLite local + Notion MCP para semântica (SCRUM-24/25/33)
- **Deploy:** 2 semanas/Sprint, apenas após testes em staging

---

**Próxima atualização:** Quando a People API for ativada, o OAuth autorizado e o SCRUM-49 for integrado/deployado, ou quando o SCRUM-17 (remover n8n) avançar, ou quando Sprint 1 terminar (02/set/2026)  
**Mantido por:** Claude + User  
**Token Economy:** Arquivo MD = economia de tokens em próximas sessões ✅
