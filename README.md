# JARVIS

Assistente pessoal por voz: interface HUD web (estilo Homem de Ferro) + orquestrador de agentes
de IA rodando em [n8n](https://n8n.io). O plano de evolução completo está documentado à parte
(artifact "JARVIS — Plano de Evolução").

## Arquitetura

```
Usuário (voz)
   │
   ▼
Widget ElevenLabs ConvAI (embutido no index.html)
   │  webhook POST
   ▼
n8n — workflow "JARVIS" (agente orquestrador, GPT-5 via OpenRouter)
   │
   ├─ Email Agent        (Gmail)
   ├─ Calendar Agent     (Google Calendar)
   ├─ Contact Agent      (Airtable)
   ├─ Content Creator     (Claude + Tavily)
   ├─ Tavily             (busca web)
   └─ Calculadora
```

- **Frontend** (`index.html`, `script.js`, `styles.css`): página estática com o painel HUD e o
  widget `<elevenlabs-convai>`. O botão de microfone e a barra de espaço acionam o widget da
  ElevenLabs, que é o caminho oficial de voz.
- **Orquestração** (`*.sanitized.json`): exports do n8n com credenciais substituídas por
  placeholders (`{{...}}`) — servem como referência da arquitetura, não são importáveis
  diretamente sem preencher as credenciais reais no seu n8n.
  - `JARVIS.sanitized.json` — workflow principal, recebe o webhook do agente de voz e roteia
    para os sub-agentes.
  - `Email Agent Tool.sanitized.json`, `Calendar Agent Tool.sanitized.json`,
    `Contacts Agent Tool.sanitized.json`, `Content Creator Agent Tool.sanitized.json` —
    sub-agentes especializados, cada um seu próprio workflow chamado como "tool" pelo agente
    principal.
- **`archive/legacy/`** — versões anteriores de `index.html`/`script.js`/`styles.css` mantidas
  por referência histórica (essencialmente idênticas às atuais, diferindo só no `agent-id` do
  widget ElevenLabs). Não são usadas em produção.

## Como configurar

1. **Widget ElevenLabs**: o `agent-id` está fixo em `index.html`, na tag
   `<elevenlabs-convai agent-id="...">`. Troque pelo ID do seu agente ElevenLabs.
2. **n8n**: reimporte os workflows `*.sanitized.json` no seu n8n e substitua os placeholders
   (`{{OPENAI_CREDENTIAL_ID}}`, `{{GMAIL_OAUTH_ID}}`, `{{GOOGLE_CALENDAR_OAUTH_ID}}`,
   `{{AIRTABLE_TOKEN_CREDENTIAL_ID}}`, `{{OPENROUTER_CREDENTIAL_ID}}`,
   `{{ANTHROPIC_CREDENTIAL_ID}}`) pelas suas credenciais reais no n8n.
3. **Webhook**: o node `Webhook` do workflow `JARVIS` expõe o endpoint que o agente ElevenLabs
   chama para executar ações. Aponte a integração de tool-calling do seu agente ElevenLabs para
   essa URL.

## Segurança (Fase 1 do plano de evolução)

O workflow `JARVIS` agora valida um segredo antes de processar qualquer requisição e usa uma
chave de sessão real em vez do host do webhook. Para isso funcionar, configure:

- **Segredo do webhook**: defina a variável de ambiente `JARVIS_WEBHOOK_SECRET` no seu n8n (Settings
  → Environment variables, ou `.env` da instância). O node "Verificar Segredo do Webhook" compara
  esse valor com o header `x-jarvis-secret` de cada requisição — configure seu agente ElevenLabs
  para enviar esse header com o mesmo valor. Requisições sem o header correto recebem `401` do
  node "Não Autorizado" e nunca chegam ao agente.
- **ID de conversa**: configure o agente ElevenLabs para enviar `conversation_id` no corpo da
  requisição (ou no header `x-conversation-id`). A "Simple Memory" do workflow usa esse valor como
  chave de sessão; se nenhum dos dois vier preenchido, ela cai de volta para o host do webhook
  (comportamento antigo, mantido só como último recurso).
- **Credencial da Tavily**: os nodes "Tavily" (em `JARVIS.sanitized.json` e em
  `Content Creator Agent Tool.sanitized.json`) agora usam uma credencial `Header Auth` do n8n em
  vez de embutir a chave no corpo da requisição. Crie uma credencial desse tipo com header
  `Authorization` e valor `Bearer <sua chave da Tavily>`, e aponte os dois nodes para ela.
- **Confirmação antes de ações destrutivas**: os system prompts do orquestrador (`JARVIS`), do
  `Email Agent` e do `Calendar Agent` agora exigem confirmação explícita do usuário, na própria
  conversa, antes de enviar e-mail, responder e-mail, excluir ou atualizar evento — o agente deve
  perguntar primeiro e só executar depois de uma resposta afirmativa.
  ⚠️ **Isto é um controle a nível de prompt, não uma trava técnica** — depende do modelo seguir a
  instrução corretamente. Nós `Send Email`, `Email Reply`, `Delete Event` e `Update Event` têm uma
  anotação (`notes`) lembrando disso, mas nada bloqueia a chamada no nível do workflow ainda. Uma
  trava técnica de verdade (ex.: pausar a execução e esperar uma segunda confirmação via webhook)
  é um item de reforço futuro, não incluído nesta fase.

## Deploy do frontend

Arquivos estáticos — qualquer hospedagem simples (GitHub Pages, Netlify, Vercel, etc.) serve.
Nenhuma etapa de build é necessária.
