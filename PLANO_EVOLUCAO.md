# JARVIS — Plano de Evolução (estado da sessão)

> **Para outra instância do Claude retomando este trabalho:** leia este arquivo inteiro antes de
> fazer qualquer coisa. Ele substitui a necessidade de reanalisar o repositório do zero. As seções
> "Feito" já foram aplicadas e commitadas — não repita. A seção "Próximo passo imediato" é onde
> continuar.

## O sistema

Assistente pessoal por voz: interface HUD web (`index.html`/`script.js`/`styles.css`, widget
ElevenLabs ConvAI embutido) + orquestrador de agentes de IA em [n8n](https://n8n.andre.haas.nom.br)
(instância própria do usuário, VPS Hostinger). Arquitetura completa em [README.md](README.md).

- Workflow orquestrador: **JARVIS** (n8n, id `tFdX9V7oaOxPvR7O`, projeto "Personal")
- Sub-agentes (workflows separados, chamados como "tool" pelo JARVIS): Email Agent, Calendar Agent,
  Contact Agent, Content Creator Agent
- Repo GitHub: `github.com/andrehaas2005/jarvis` (branch `main`)
- Roadmap completo (documento visual) publicado como Artifact Claude: procurar por
  "JARVIS — Plano de Evolução" nos artifacts do usuário (título estável, favicon 🛰️) — mas **este
  arquivo markdown é a fonte de verdade para retomar o trabalho**, o artifact é só a versão bonita
  para o usuário ler.

## Roteiro de fases

- **Fase 0 — Faxina e base**: ✅ Concluída (commit `6b2fc08`). Git inicializado, README criado,
  duplicados arquivados em `archive/legacy/`, código morto removido de `script.js`.
- **Fase 1 — Segurança e confiabilidade**: ✅ Concluída nos arquivos do repo e no workflow JARVIS em
  produção (commit `07a7a8b`). Ver detalhes abaixo — **tem pendências de configuração que só o
  usuário pode fazer** (credenciais/OAuth).
- **Fase 2 — HUD funcional**: não iniciada.
- **Fase 3 — Novas capacidades**: não iniciada.
- **Fase 3b — Integração com AgentOS** (`C:\Users\andre\Projetos\AgentOS`, projeto irmão de
  publicação em redes sociais): não iniciada. Depende da Fase 2 do próprio AgentOS (publicação real
  no Instagram), que também ainda não está pronta lá.
- **Fase 4 — Operação e custo**: não iniciada.

## Fase 1 — o que foi feito

Nos arquivos `*.sanitized.json` deste repo (já commitados) e replicado manualmente no n8n de
produção via browser (workflow **JARVIS** apenas — ver pendências):

1. **Autenticação do webhook**: novo node "Verificar Segredo do Webhook" (IF) entre `Webhook` e o
   agente `JARVIS`, comparando header `x-jarvis-secret` com `$env.JARVIS_WEBHOOK_SECRET`. Se não
   bater, vai para node "Não Autorizado" (Respond to Webhook, HTTP 401,
   `{"error":"unauthorized"}`).
2. **Sessão de memória**: `Simple Memory` passou a usar
   `{{ $('Webhook').item.json.body.conversation_id || $('Webhook').item.json.headers['x-conversation-id'] || $('Webhook').item.json.headers.host }}`
   em vez de só `headers.host`.
3. **Tavily sem chave em texto**: nodes Tavily (em `JARVIS.sanitized.json` e
   `Content Creator Agent Tool.sanitized.json`) migrados de `api_key` no corpo da requisição para
   credencial `Header Auth` do n8n (`Authorization: Bearer <chave>`).
4. **Confirmação antes de ações destrutivas**: system prompts do JARVIS, Email Agent e Calendar
   Agent agora exigem que o agente pergunte e receba confirmação explícita do usuário antes de
   enviar/responder e-mail ou excluir/atualizar evento. **Isto é um controle a nível de prompt, não
   uma trava técnica** — depende do modelo seguir a instrução (documentado como ressalva no README
   e no artifact do roadmap).

### Confirmado visualmente no n8n de produção (workflow JARVIS)

Todos os 4 itens acima foram verificados abertos no editor do n8n, com o valor exato batendo com o
que está nos arquivos do repo. A credencial Tavily (`Bearer Auth account`, tipo Header Auth) já foi
criada e vinculada pelo usuário com uma chave real da Tavily.

## Pendências da Fase 1 (bloqueadas em ações que só o usuário pode fazer)

### Descoberta importante: sub-workflows e credenciais sumiram do n8n

Ao tentar abrir os workflows **Email Agent Tool**, **Calendar Agent Tool** e
**Content Creator Agent Tool** no n8n de produção para aplicar as mesmas correções da Fase 1
neles, descobri que **eles não existem mais** — sumiram de toda busca (lista completa de
workflows, inclusive com arquivados visíveis, busca por nome, command bar global do n8n). O node
"Email Agent" dentro do JARVIS só mostra "Email Agent Tool" como nome porque isso ficou **em
cache** nos parâmetros do próprio node (`cachedResultName`), não é uma referência viva — o ID
apontado (`bzRf138qpDd6ogEQ`, mesmo do export sanitizado) dá "Workflow not found".

Junto com isso, testei (filtro por tipo em Credentials) e confirmei que **nenhuma destas
credenciais existe mais** no n8n:
- Gmail OAuth2 API (usada pelo Email Agent Tool)
- Google Calendar OAuth2 API (usada pelo Calendar Agent Tool)
- Airtable Personal Access Token API (usada pelo Contacts Agent Tool)
- Anthropic API (usada pelo Content Creator Agent Tool)

**Não é um problema que eu resolva sozinho** — recriar as credenciais exige login/autorização OAuth
do Google (Gmail, Calendar) e geração de chaves em painéis externos (Airtable, Anthropic), ações
que só o usuário pode fazer.

Também **não confirmei** (parei antes de checar) se o `Contacts Agent Tool` também sumiu — é
provável, dado que a credencial Airtable sumiu, mas falta verificar o workflow em si do mesmo jeito
que os outros três.

Nota lateral (não é um problema, só um esclarecimento): o dashboard do n8n mostrava "82,4% de falha
nas execuções de produção" — **isso é de outros workflows do usuário** (`master_pauta_diaria_v1`,
`Corpo Vivo - WP Publisher`), sem relação com o JARVIS. O workflow JARVIS tem **zero execuções
registradas** até agora (não se sabe ainda se o widget ElevenLabs de fato está configurado para
chamar o webhook dele em produção).

### Onde conseguir cada credencial (já passado ao usuário, repetido aqui para referência)

1. **Anthropic API**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   → Create Key → colar no n8n em **Create credential → Anthropic**.
2. **Airtable Personal Access Token**: [airtable.com/create/tokens](https://airtable.com/create/tokens)
   → Create new token → scopes `data.records:read`, `data.records:write`, `schema.bases:read` →
   acesso à base "Lista de contatos" → colar no n8n em
   **Create credential → Airtable Personal Access Token API**.
3. **Gmail OAuth2**: no n8n, **Create credential → Gmail OAuth2 API** (copiar a Redirect URL que ele
   mostra) → no [Google Cloud Console](https://console.cloud.google.com/): ativar Gmail API, criar
   OAuth consent screen, criar OAuth Client ID (Web application) com essa Redirect URL → colar
   Client ID/Secret no n8n → **Connect my account** (login Google).
4. **Google Calendar OAuth2**: mesmo processo, ativar Google Calendar API no mesmo projeto Google
   Cloud, pode reusar o mesmo Client ID/Secret do Gmail (adicionar a nova Redirect URL do Calendar
   nas Authorized redirect URIs) → no n8n, **Create credential → Google Calendar OAuth2 API** →
   **Connect my account**.

## Próximo passo imediato

Perguntar ao usuário se ele já criou as 4 credenciais acima no n8n. Quando sim:

1. Verificar no n8n (`home/credentials`, filtro por tipo) que as 4 credenciais existem.
2. Verificar se `Contacts Agent Tool` também sumiu (mesma checagem que fiz para os outros 3: tentar
   abrir pelo node "Contact Agent" dentro do JARVIS, ver se dá "Workflow not found").
3. Para cada sub-workflow que sumiu (`Email Agent Tool.sanitized.json`,
   `Calendar Agent Tool.sanitized.json`, `Content Creator Agent Tool.sanitized.json`, possivelmente
   `Contacts Agent Tool.sanitized.json` — **estes arquivos no repo já têm as correções da Fase 1
   aplicadas**, usar como fonte):
   - Criar um workflow novo vazio no n8n
   - Colar o JSON do arquivo `.sanitized.json` correspondente (Ctrl+V no canvas depois de copiar o
     JSON para a área de transferência via `javascript_tool`/clipboard, já que "Import from file"
     abre um seletor de arquivo nativo do SO que a automação de navegador não consegue operar)
   - Reatribuir cada node à credencial real recém-criada (os campos de credencial vêm com IDs
     placeholder tipo `{{GMAIL_OAUTH_ID}}` que não existem — selecionar a credencial certa no
     dropdown de cada node)
   - Renomear o workflow para o nome original (ex.: "Email Agent Tool")
   - Salvar, anotar o novo workflow ID
4. Voltar ao workflow **JARVIS**, abrir cada node de sub-agente (Email Agent, Calendar Agent,
   Content Creator Agent, e Contact Agent se aplicável) e apontar o campo "Workflow" para o
   workflow recém-criado (o ID antigo não resolve mais).
5. Confirmar que a variável de ambiente `JARVIS_WEBHOOK_SECRET` está de fato configurada no n8n
   (Settings → Environment variables) — isso não foi verificado nesta sessão, só o node que a
   referencia.
6. Pendência externa ao n8n (não é tarefa desta sessão, mas fica registrada): configurar o agente
   ElevenLabs para enviar o header `x-jarvis-secret` e o campo `conversation_id` no corpo da chamada
   ao webhook — sem isso, a autenticação da Fase 1 vai bloquear todas as chamadas reais do
   ElevenLabs (retorna 401) porque hoje ele não manda esse header.
7. Depois de tudo isso, testar de ponta a ponta e então considerar a Fase 1 realmente completa em
   produção (hoje só o workflow JARVIS em si está correto — a cadeia inteira ainda não funciona por
   causa das peças que sumiram).

## Acesso ao n8n

- URL: `https://n8n.andre.haas.nom.br`
- Login: mesmo usuário/senha do usuário (não armazenado aqui)
- Workflow principal: **JARVIS**, projeto "Personal"
