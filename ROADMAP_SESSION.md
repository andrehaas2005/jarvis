# 📋 JARVIS Roadmap - Sessão de Continuidade

**Data de Criação:** 2026-08-19  
**Última Atualização:** 2026-08-19  
**Status Geral:** Sprint 1 Ativo ✅

---

## 🎯 Quick Reference para Retomar

### Jira Board
- **URL:** https://andrehaas2005.atlassian.net/jira/software/projects/SCRUM/boards/1
- **Projeto:** SCRUM (Meus Projetos)
- **Sprint Ativo:** Sprint 1 - Fundação JARVIS (19/ago → 02/set/2026)
- **Tickets no Sprint:** 15 (4 BUGFIX + 11 FASE 1)

### Status Atual
```
Total Issues: 39 (SCRUM-8 a SCRUM-48)
├── 4 Epics (SCRUM-8 a SCRUM-11)
├── 35 Histórias (SCRUM-14 a SCRUM-48)
│   ├── 15 no Sprint 1 (A FAZER)
│   └── 20 no Backlog (FASE 2 + FASE 3)
└── 0 Concluídos
```

---

## 🚀 O que foi feito NESTA SESSÃO

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

### IMEDIATO (Sprint 1)
1. **SCRUM-45** — Fix email workflow executando 8x (CRÍTICO)
2. **SCRUM-46** — Garantir atomicidade no envio (CRÍTICO)
3. **SCRUM-47** — Calendar Agent intermitente (CRÍTICO)
4. **SCRUM-48** — ElevenLabs file upload 403 (CRÍTICO)
5. **SCRUM-14** — MCP Gmail Server (core)
6. **SCRUM-15** — MCP Calendar Server (core)

### CURTO PRAZO (Fim Sprint 1)
7. **SCRUM-16** — Backend Node.js orquestrador
8. **SCRUM-17-19** — Remover n8n (migration)
9. **SCRUM-20-23** — Settings Page
10. **SCRUM-24-25** — Sistema de Memória (Nível 1-2)

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
├── script.js                   ← Lógica de voz/gestos
├── styles.css                  ← Estilos
├── .git/
│   └── (commits referenciam SCRUM-XX)
└── n8n/                        ← A ser removido (FASE 1)
    ├── JARVIS.json
    ├── Email Agent Tool.json
    ├── Calendar Agent Tool.json
    └── ... (workflows)
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

**Próxima atualização:** Quando Sprint 1 terminar (02/set/2026)  
**Mantido por:** Claude + User  
**Token Economy:** Arquivo MD = economia de tokens em próximas sessões ✅
