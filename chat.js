// Painel de Chat de Texto do JARVIS (SCRUM-26/27/28).
//
// Reaproveitável por design: qualquer resposta do orquestrador (voz ou texto)
// pode aparecer aqui — o primeiro uso real é mostrar o rascunho de um email
// antes de confirmar o envio, mas não tem nada específico de email no código.
//
// Texto e voz compartilham a MESMA sessão/memória do backend: se há uma
// ligação de voz ativa (window.jarvisInterface.activeConversationId), o chat
// usa esse mesmo session_id; sem ligação ativa, usa um session_id próprio,
// gerado uma vez e guardado no localStorage.
(function () {
    'use strict';

    const CHAT_BACKEND_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'http://localhost:8000'
        : 'https://jarvis-api.andre.haas.nom.br';

    const DB_NAME = 'jarvis-chat';
    const DB_VERSION = 1;
    const STORE_NAME = 'messages';
    const TEXT_SESSION_KEY = 'jarvis-chat-text-session-id';
    const WIDTH_KEY = 'jarvis-chat-width';

    class JarvisChat {
        constructor() {
            this.panel = document.getElementById('jarvisChatPanel');
            this.resizeHandle = document.getElementById('jarvisChatResizeHandle');
            this.messagesEl = document.getElementById('jarvisChatMessages');
            this.input = document.getElementById('jarvisChatInput');
            this.sendBtn = document.getElementById('jarvisChatSend');
            this.closeBtn = document.getElementById('jarvisChatClose');
            this.minimizeBtn = document.getElementById('jarvisChatMinimize');
            this.fab = document.getElementById('jarvisChatFab');
            this.attachPhotoBtn = document.getElementById('jarvisChatAttachPhoto');
            this.attachFileBtn = document.getElementById('jarvisChatAttachFile');
            this.topbarBtn = document.getElementById('topbarChat');

            if (!this.panel) return; // login.html/terms.html etc. não têm o painel

            this.db = null;
            this.eventSource = null;
            this.currentSessionId = null;
            // client_msg_id dos envios em andamento desta aba — o backend ecoa esse id de
            // volta no SSE pra mensagens vindas de /chat/message; usamos isso (não o texto)
            // pra filtrar o próprio eco, porque o publish() do backend acontece ANTES da
            // resposta HTTP voltar — o SSE pode chegar antes do fetch() resolver aqui.
            this._ownRequestIds = new Set();

            this._initDb();
            this._bindEvents();
            this._restoreWidth();
            // Conecta ao SSE já na carga da página, independente do painel estar aberto —
            // sem isso, "abre sozinho quando tem algo novo" não funcionaria: com o painel
            // fechado a stream ficava desconectada, e o publish() do backend descarta
            // silenciosamente mensagens sem ninguém assinando no momento (ver chat_stream.py).
            this._switchSession(this.getSessionId());
        }

        // ---------------------------------------------------------------- sessão

        getSessionId() {
            const activeVoiceId = window.jarvisInterface && window.jarvisInterface.activeConversationId;
            if (activeVoiceId) return activeVoiceId;
            let id = localStorage.getItem(TEXT_SESSION_KEY);
            if (!id) {
                id = `text-${crypto.randomUUID()}`;
                localStorage.setItem(TEXT_SESSION_KEY, id);
            }
            return id;
        }

        // Troca a sessão "ativa" (histórico + stream) só se de fato mudou — chamado na
        // carga da página, ao abrir o painel, e quando uma ligação de voz começa/termina
        // (ver resubscribe(), chamado por script.js).
        _switchSession(sessionId) {
            if (sessionId === this.currentSessionId) return;
            this.currentSessionId = sessionId;
            this._loadHistory(sessionId);
            this._connectStream(sessionId);
        }

        // Chamado por script.js quando uma ligação de voz conecta/desconecta — a sessão
        // "certa" pra ouvir muda entre a sessão de texto e a da ligação de voz ativa.
        resubscribe() {
            this._switchSession(this.getSessionId());
        }

        // ------------------------------------------------------------ IndexedDB

        _initDb() {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('session_id', 'session_id');
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                // Se a sessão já foi definida antes do DB terminar de abrir (comum na carga
                // da página, ver construtor), o primeiro _loadHistory rodou sem histórico —
                // tenta de novo agora que o DB está pronto de verdade.
                if (this.currentSessionId) this._loadHistory(this.currentSessionId);
            };
            request.onerror = () => {
                console.warn('[CHAT] Não consegui abrir o IndexedDB — histórico não vai persistir nesta sessão.');
            };
        }

        _saveMessage(sessionId, role, text, kind) {
            if (!this.db) return;
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).add({
                session_id: sessionId,
                role,
                text,
                kind: kind || 'message',
                ts: Date.now(),
            });
        }

        _loadHistory(sessionId) {
            this.messagesEl.innerHTML = '';
            if (!this.db) return;
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const index = tx.objectStore(STORE_NAME).index('session_id');
            const request = index.getAll(sessionId);
            request.onsuccess = () => {
                const rows = request.result || [];
                rows.sort((a, b) => a.ts - b.ts);
                rows.forEach((row) => this._renderMessage(row.role, row.text, row.kind, row.ts));
                this._scrollToBottom();
            };
        }

        // ---------------------------------------------------------------- render

        _renderMessage(role, text, kind, ts) {
            const bubble = document.createElement('div');
            bubble.className = `jarvis-chat-msg ${role}`;
            if (kind && kind !== 'message') bubble.dataset.kind = kind;

            const body = document.createElement('div');
            body.textContent = text;
            bubble.appendChild(body);

            const time = document.createElement('span');
            time.className = 'jarvis-chat-msg-time';
            time.textContent = new Date(ts || Date.now()).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
            });
            bubble.appendChild(time);

            this.messagesEl.appendChild(bubble);
            this._scrollToBottom();
        }

        _scrollToBottom() {
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }

        // --------------------------------------------------- abrir/fechar/minimizar

        open() {
            this._switchSession(this.getSessionId());
            this.panel.hidden = false;
            this.fab.hidden = true;
            this.input.focus();
        }

        // Só esconde visualmente — a stream SSE continua ligada em segundo plano (ver
        // construtor) pra "abre sozinho quando tem algo novo" funcionar mesmo fechado.
        close() {
            this.panel.hidden = true;
            this.fab.hidden = true;
        }

        // Mobile: mesma ideia do close() — esconde o painel, vira uma bolha flutuante —
        // dá pra espiar o HUD sem perder o lugar na conversa.
        minimize() {
            this.panel.hidden = true;
            this.fab.hidden = false;
        }

        toggle() {
            if (this.panel.hidden) this.open();
            else this.close();
        }

        // -------------------------------------------------------------- envio

        async _send() {
            const text = this.input.value.trim();
            if (!text) return;
            const sessionId = this.getSessionId();
            const clientMsgId = crypto.randomUUID();
            this.input.value = '';
            this._autoGrow();
            this.sendBtn.disabled = true;

            this._renderMessage('user', text, 'message', Date.now());
            this._saveMessage(sessionId, 'user', text);
            this._ownRequestIds.add(clientMsgId);
            // Rede de segurança: se o eco do SSE nunca chegar (stream caiu, proxy
            // bufferizando), não queremos vazar memória guardando o id pra sempre.
            setTimeout(() => this._ownRequestIds.delete(clientMsgId), 30000);

            const token = localStorage.getItem('jarvis-auth-token');
            try {
                const response = await fetch(`${CHAT_BACKEND_URL}/chat/message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ message: text, session_id: sessionId, client_msg_id: clientMsgId }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                this._renderMessage('assistant', data.reply, 'message', Date.now());
                this._saveMessage(sessionId, 'assistant', data.reply);
            } catch (error) {
                this._ownRequestIds.delete(clientMsgId);
                this._renderMessage(
                    'assistant',
                    `⚠️ Não consegui falar com o backend agora (${error.message}).`,
                    'message',
                    Date.now()
                );
            } finally {
                this.sendBtn.disabled = false;
            }
        }

        // ----------------------------------------------------------------- SSE

        _connectStream(sessionId) {
            this._disconnectStream();
            const token = localStorage.getItem('jarvis-auth-token');
            const url = `${CHAT_BACKEND_URL}/chat/stream?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token || '')}`;
            this.eventSource = new EventSource(url);
            this.eventSource.onmessage = (event) => {
                let payload;
                try {
                    payload = JSON.parse(event.data);
                } catch (error) {
                    return;
                }
                if (payload.client_msg_id && this._ownRequestIds.has(payload.client_msg_id)) {
                    // Já renderizamos isso localmente — é só o eco do nosso próprio envio
                    // voltando pelo stream (outros assinantes da mesma sessão, tipo outra
                    // aba aberta, precisam dele; esta aba não, senão duplica a bolha).
                    // Não apaga o id aqui: user e assistant chegam em dois eventos separados
                    // com o MESMO client_msg_id, e os dois precisam ser filtrados.
                    return;
                }
                this._saveMessage(sessionId, payload.role, payload.text, payload.kind);
                // Chegou algo novo por fora (voz, outra aba) — abre sozinho se estiver
                // fechado, pra não perder um rascunho ou resposta.
                if (this.panel.hidden) this.open();
                this._renderMessage(payload.role, payload.text, payload.kind, (payload.ts || Date.now() / 1000) * 1000);
            };
            this.eventSource.onerror = () => {
                // EventSource reconecta sozinho — sem lógica extra aqui, só evita
                // poluir o console a cada instabilidade de rede.
            };
        }

        _disconnectStream() {
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
        }

        // --------------------------------------------------- redimensionar (desktop)

        _restoreWidth() {
            const saved = localStorage.getItem(WIDTH_KEY);
            if (saved) this.panel.style.width = `${saved}px`;
        }

        _bindResize() {
            let dragging = false;
            this.resizeHandle.addEventListener('mousedown', (event) => {
                dragging = true;
                this.resizeHandle.classList.add('dragging');
                event.preventDefault();
            });
            window.addEventListener('mousemove', (event) => {
                if (!dragging) return;
                const width = Math.min(Math.max(window.innerWidth - event.clientX, 300), window.innerWidth * 0.9);
                this.panel.style.width = `${width}px`;
            });
            window.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                this.resizeHandle.classList.remove('dragging');
                localStorage.setItem(WIDTH_KEY, Math.round(this.panel.getBoundingClientRect().width));
            });
        }

        // ----------------------------------------------------- textarea auto-grow

        _autoGrow() {
            this.input.style.height = 'auto';
            this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
        }

        // -------------------------------------------------------------- eventos

        _bindEvents() {
            this._bindResize();

            this.topbarBtn?.addEventListener('click', () => this.toggle());
            this.closeBtn?.addEventListener('click', () => this.close());
            this.minimizeBtn?.addEventListener('click', () => this.minimize());
            this.fab?.addEventListener('click', () => this.open());
            this.sendBtn?.addEventListener('click', () => this._send());

            this.input?.addEventListener('input', () => this._autoGrow());
            this.input?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    this._send();
                }
            });

            // Anexos ainda não processam nada de verdade (SCRUM-26 v1, escopo combinado
            // com o usuário) — só a UI, o resto é feature futura.
            const attachStub = () => {
                this._renderMessage(
                    'assistant',
                    'Envio de arquivos ainda não está pronto — isso é uma feature futura.',
                    'message',
                    Date.now()
                );
            };
            this.attachPhotoBtn?.addEventListener('click', attachStub);
            this.attachFileBtn?.addEventListener('click', attachStub);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.jarvisChat = new JarvisChat();
    });
})();
