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
   `{{ANTHROPIC_CREDENTIAL_ID}}`, `{{TAVILY_API_KEY}}`) pelas suas credenciais reais no n8n.
3. **Webhook**: o node `Webhook` do workflow `JARVIS` expõe o endpoint que o agente ElevenLabs
   chama para executar ações. Aponte a integração de tool-calling do seu agente ElevenLabs para
   essa URL.

⚠️ O webhook hoje não tem autenticação e a memória de conversa usa o host do webhook como chave
de sessão — ver riscos e correções propostas no plano de evolução (Fase 1).

## Deploy do frontend

Arquivos estáticos — qualquer hospedagem simples (GitHub Pages, Netlify, Vercel, etc.) serve.
Nenhuma etapa de build é necessária.
