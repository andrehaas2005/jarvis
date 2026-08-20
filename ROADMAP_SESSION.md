# 📋 JARVIS Roadmap - Sessão de Continuidade

**Data de Criação:** 2026-08-19  
**Última Atualização:** 2026-08-19 (sessão 2 — backend Python iniciado)  
**Status Geral:** Sprint 1 Ativo ✅ — Backend Python em construção

---

## 🎯 Quick Reference para Retomar

### Jira Board
- **URL:** https://andrehaas2005.atlassian.net/jira/software/projects/SCRUM/boards/1
- **Projeto:** SCRUM (Meus Projetos)
- **Sprint Ativo:** Sprint 1 - Fundação JARVIS (19/ago → 02/set/2026)
- **Tickets no Sprint:** 15 (4 BUGFIX + 11 FASE 1)

### Status Atual
```
Total Issues: 40 (SCRUM-8 a SCRUM-49)
├── 4 Epics (SCRUM-8 a SCRUM-11)
├── 36 Histórias (SCRUM-14 a SCRUM-49)
│   ├── 15 no Sprint 1 original + SCRUM-49 (novo, criado sessão 2)
│   └── 20 no Backlog (FASE 2 + FASE 3)
├── 5 tickets com código implementado nesta sessão (não mergeado): 14, 15, 16, 45/46/47 (diagnóstico), 48, 49
└── 0 Concluídos (nada foi mergeado/deployado ainda)
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

## 🚀 O que foi feito — SESSÃO 2 (backend Python)

**Decisão:** SCRUM-16 mudou de Node.js para **Python/FastAPI** — usuário está estudando Python e quer aplicar no projeto.

### ✅ Backend criado em `/backend` (branches separados por ticket, ainda não mergeados em main)

| Ticket | Branch | O que tem | Status Jira |
|---|---|---|---|
| SCRUM-16 | `feature/SCRUM-16-backend-python` | FastAPI app, config, logging JSON, **`app/retry.py`** (retry + idempotência — testado) | Em andamento |
| SCRUM-14 | `feature/SCRUM-14-mcp-gmail` | MCP Server Gmail (`send_email`, `list_emails`, `read_email`) — idempotência testada com mock | Em andamento |
| SCRUM-15 | `feature/SCRUM-15-mcp-calendar` | MCP Server Calendar (`create_event`, `list_events`, `get_event`) + `google_auth.py` compartilhado | Em andamento |
| SCRUM-48 | `feature/SCRUM-48-elevenlabs-signed-url` | Endpoint `GET /elevenlabs/signed-url` (backend) + `script.js` usando `signedUrl` (frontend, commit isolado em `feature/hud-3d-voz-gestos`) | Em análise |
| SCRUM-49 *(novo)* | `feature/SCRUM-49-mcp-contacts` | MCP Server Contacts/Airtable (`search_contact`, `add_or_update_contact`) — achado durante diagnóstico do SCRUM-47 | Em andamento |

**Todos os MCP Servers testados com mock** (sem credenciais reais ainda) — imports OK, tools registradas, idempotência validada end-to-end.

### 🔎 Diagnóstico dos bugs críticos (investigando os JSONs do n8n)
- **SCRUM-45/46** (email 8x / atomicidade): causa raiz = confirmação de envio garantida só por **prompt engineering** no `Email Agent Tool.json`, sem nenhuma camada determinística abaixo do LLM. Fix já implementado no `app/retry.py` (SCRUM-16) + SCRUM-14.
- **SCRUM-47** (Calendar intermitente): causa raiz real é **diferente** do suposto — o `Calendar Agent Tool.json` não tem lookup de nome→email de attendee, depende do LLM alucinar. Gerou o novo ticket **SCRUM-49**.
- **Todos os 4 bugfixes ficam "Em análise"/"Em andamento" e só fecham de vez após a migração completa do n8n (SCRUM-17, ainda não feita)** — o código novo resolve a causa raiz, mas o n8n antigo continua rodando em produção até lá.

### ⚠️ Pendências para fechar os tickets
1. Preencher credenciais reais no `backend/.env` (Google OAuth para Gmail/Calendar, API key do Airtable, API key da ElevenLabs) — ver `backend/.env.example` e `backend/README.md`
2. Conectar `search_contact` (SCRUM-49) ao fluxo de `create_event` (SCRUM-15) no orquestrador — hoje existem lado a lado, ainda não integrados
3. Nenhum branch foi mergeado em `main` ainda — todos aguardando revisão/teste com credenciais reais
4. `feature/hud-3d-voz-gestos` também não foi pusheado (3 commits locais à frente do origin)

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
1. **Preencher credenciais reais** em `backend/.env` (Google OAuth, Airtable, ElevenLabs) — sem isso nenhum MCP Server foi testado de ponta a ponta, só com mock
2. **Conectar SCRUM-49 → SCRUM-15**: orquestrador chama `search_contact` antes de `create_event` quando attendee for nome (fecha SCRUM-47 de vez)
3. **SCRUM-17** — Remover n8n / migrar de vez (só depois disso os SCRUM-45/46/47 fecham como Concluído)
4. Revisar e mergear os 5 branches de backend em `main` (nenhum foi mergeado ainda — ver tabela na seção "SESSÃO 2" acima)
5. Push de `feature/hud-3d-voz-gestos` (3 commits locais à frente do origin)

### CURTO PRAZO (Fim Sprint 1)
6. **SCRUM-20-23** — Settings Page
7. **SCRUM-24-25** — Sistema de Memória (Nível 1-2)
8. Testar o HUD end-to-end com o backend Python no ar (`uvicorn app.main:app --reload`) + credenciais reais

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
├── backend/                     ← NOVO (sessão 2) — só existe nos branches feature/SCRUM-*, não em main
│   ├── app/                     ← FastAPI: main.py, config.py, retry.py, elevenlabs.py
│   ├── mcp_servers/
│   │   ├── gmail/                (SCRUM-14)
│   │   ├── calendar/             (SCRUM-15)
│   │   └── contacts/             (SCRUM-49)
│   ├── .env.example              ← copiar pra .env e preencher credenciais reais
│   └── README.md                 ← setup completo de cada MCP Server
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
| n8n | https://n8n.andre.haas.nom.br |
| ElevenLabs | https://elevenlabs.io/app/agents |

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

**Próxima atualização:** Quando as credenciais reais forem preenchidas e os branches testados/mergeados, ou quando Sprint 1 terminar (02/set/2026)  
**Mantido por:** Claude + User  
**Token Economy:** Arquivo MD = economia de tokens em próximas sessões ✅
