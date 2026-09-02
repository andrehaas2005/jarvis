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
            this.fileInput = document.getElementById('jarvisChatFileInput');
            this.attachmentPreview = document.getElementById('jarvisChatAttachmentPreview');
            this.attachmentThumb = document.getElementById('jarvisChatAttachmentThumb');
            this.attachmentIcon = document.getElementById('jarvisChatAttachmentIcon');
            this.attachmentName = document.getElementById('jarvisChatAttachmentName');
            this.attachmentRemoveBtn = document.getElementById('jarvisChatAttachmentRemove');
            this.topbarBtn = document.getElementById('topbarChat');

            if (!this.panel) return; // login.html/terms.html etc. não têm o painel

            this.pendingAttachment = null;
            this.db = null;
            this.eventSource = null;
            this.currentSessionId = null;
            // client_msg_id dos envios em andamento desta aba — o backend ecoa esse id de
            // volta no SSE pra mensagens vindas de /chat/message; usamos isso (não o texto)
            // pra filtrar o próprio eco, porque o publish() do backend acontece ANTES da
            // resposta HTTP voltar — o SSE pode chegar antes do fetch() resolver aqui.
            this._ownRequestIds = new Set();
            // Sessão de EXIBIÇÃO — sempre a mesma, pra sempre (persistida no localStorage),
            // não muda com ligação de voz ativa/inativa. Diferente da sessão de API (ver
            // getSessionId()), que pode ser a da ligação de voz em andamento — usada só pra
            // falar com o backend/assinar o SSE certo. Bug real visto em produção: sem essa
            // separação, o painel mostrava histórico vazio quando aberto pelo botão depois
            // de ter sido usado durante uma ligação de voz (sessões diferentes = IndexedDB
            // diferente). Com isso, o histórico visível é sempre contínuo, não importa por
            // onde a mensagem entrou.
            this.displaySessionId = this._getOrCreateTextSessionId();

            this._initDb();
            this._bindEvents();
            this._restoreWidth();
            this._publishWidthVar();
            // Conecta ao SSE já na carga da página, independente do painel estar aberto —
            // sem isso, "abre sozinho quando tem algo novo" não funcionaria: com o painel
            // fechado a stream ficava desconectada, e o publish() do backend descarta
            // silenciosamente mensagens sem ninguém assinando no momento (ver chat_stream.py).
            this._switchSession(this.getSessionId());
        }

        // ---------------------------------------------------------------- sessão

        _getOrCreateTextSessionId() {
            let id = localStorage.getItem(TEXT_SESSION_KEY);
            if (!id) {
                id = `text-${crypto.randomUUID()}`;
                localStorage.setItem(TEXT_SESSION_KEY, id);
            }
            return id;
        }

        // Sessão de API/SSE — a da ligação de voz ativa, se houver uma agora; senão, a
        // sessão de texto persistente. É essa que o backend usa pra decidir o que "lembra"
        // (SessionMemory por session_id, ver router.py) — diferente de displaySessionId,
        // que é só sobre o que aparece na tela.
        getSessionId() {
            const activeVoiceId = window.jarvisInterface && window.jarvisInterface.activeConversationId;
            return activeVoiceId || this.displaySessionId;
        }

        // Troca só a stream/assinatura SSE — o histórico exibido (displaySessionId) nunca
        // muda. Chamado na carga da página, ao abrir o painel, e quando uma ligação de voz
        // começa/termina (ver resubscribe(), chamado por script.js).
        _switchSession(sessionId) {
            if (sessionId === this.currentSessionId) return;
            this.currentSessionId = sessionId;
            this._connectStream(sessionId);
        }

        // Chamado por script.js quando uma ligação de voz conecta/desconecta — a sessão
        // de API/SSE "certa" pra ouvir muda entre a sessão de texto e a da ligação ativa.
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
                this._loadHistory(this.displaySessionId);
            };
            request.onerror = () => {
                console.warn('[CHAT] Não consegui abrir o IndexedDB — histórico não vai persistir nesta sessão.');
            };
        }

        _saveMessage(sessionId, role, text, kind, attachmentThumb) {
            if (!this.db) return;
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).add({
                session_id: sessionId,
                role,
                text,
                kind: kind || 'message',
                ts: Date.now(),
                // Miniatura JÁ REDUZIDA (ver _makeThumbnail) — nunca a imagem em
                // resolução cheia, pra não inchar o IndexedDB local (SCRUM-69/Fase 1).
                attachment_thumb: attachmentThumb || null,
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
                rows.forEach((row) => this._renderMessage(row.role, row.text, row.kind, row.ts, row.attachment_thumb));
                this._scrollToBottom();
            };
        }

        // ---------------------------------------------------------------- render

        _renderMessage(role, text, kind, ts, attachmentThumb) {
            const bubble = document.createElement('div');
            bubble.className = `jarvis-chat-msg ${role}`;
            if (kind && kind !== 'message') bubble.dataset.kind = kind;

            if (attachmentThumb) {
                const img = document.createElement('img');
                img.className = 'jarvis-chat-msg-thumb';
                img.src = attachmentThumb;
                img.alt = 'Anexo enviado';
                bubble.appendChild(img);
            }

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
            // Bug real relatado em produção: abrir o chat posicionava na PRIMEIRA
            // mensagem, não na última. Causa: o histórico é carregado uma vez, no
            // carregamento da página (_initDb -> _loadHistory), com o painel ainda
            // escondido (hidden) — nesse estado scrollHeight é 0, então o
            // scrollTop=scrollHeight de _scrollToBottom() não tem efeito nenhum, e a
            // rolagem nunca é refeita depois que o painel fica visível. requestAnimationFrame
            // garante que isso roda só depois do navegador aplicar o layout do painel
            // agora visível (scrollHeight já correto nesse ponto).
            requestAnimationFrame(() => this._scrollToBottom());
            this._publishWidthVar();
        }

        // Só esconde visualmente — a stream SSE continua ligada em segundo plano (ver
        // construtor) pra "abre sozinho quando tem algo novo" funcionar mesmo fechado.
        close() {
            this.panel.hidden = true;
            this.fab.hidden = true;
            this._publishWidthVar();
        }

        // Mobile: mesma ideia do close() — esconde o painel, vira uma bolha flutuante —
        // dá pra espiar o HUD sem perder o lugar na conversa.
        minimize() {
            this.panel.hidden = true;
            this.fab.hidden = false;
            this._publishWidthVar();
        }

        // Publica a largura atual do chat numa CSS var global (--jarvis-chat-width,
        // 0px quando fechado) — outros painéis flutuantes (ex.: navegador interno,
        // SCRUM-69) leem essa var pra encolher a própria largura em vez de ficar
        // por baixo do chat. Desacoplado de propósito: chat.js não precisa saber
        // que o navegador existe, só publica seu próprio estado; qualquer painel
        // futuro pode reagir do mesmo jeito só lendo a var no CSS.
        _publishWidthVar() {
            const width = this.panel.hidden ? 0 : this.panel.getBoundingClientRect().width;
            document.documentElement.style.setProperty('--jarvis-chat-width', `${width}px`);
        }

        toggle() {
            if (this.panel.hidden) this.open();
            else this.close();
        }

        // -------------------------------------------------------------- envio

        async _send() {
            const text = this.input.value.trim();
            const attachment = this.pendingAttachment;
            if (!text && !attachment) return;
            const sessionId = this.getSessionId();
            const clientMsgId = crypto.randomUUID();
            this.input.value = '';
            this._autoGrow();
            this.sendBtn.disabled = true;

            const displayText = text || `[enviou ${attachment.file.name}]`;
            this._renderMessage('user', displayText, 'message', Date.now(), attachment?.thumbDataUrl);
            this._saveMessage(this.displaySessionId, 'user', displayText, 'message', attachment?.thumbDataUrl);
            // Some da UI otimisticamente (igual ao texto) — se der erro, o catch abaixo
            // devolve o anexo E o texto pro usuário, pra não ter que escolher o arquivo
            // de novo nem reescrever a pergunta.
            this._clearAttachment();
            this._ownRequestIds.add(clientMsgId);
            // Rede de segurança: se o eco do SSE nunca chegar (stream caiu, proxy
            // bufferizando), não queremos vazar memória guardando o id pra sempre.
            setTimeout(() => this._ownRequestIds.delete(clientMsgId), 30000);

            const token = localStorage.getItem('jarvis-auth-token');
            try {
                let response;
                if (attachment) {
                    // Fotos de celular em resolução alta passam do limite de 10MB (em
                    // base64) que a API da Anthropic aceita por imagem — achado real em
                    // produção: virava erro 500 cru, o Jarvis nunca chegava a "ver" a
                    // imagem. Reduz ANTES de enviar quando o arquivo é grande; PDF e
                    // imagens já pequenas passam direto, sem perda de qualidade à toa.
                    const uploadFile = await this._prepareImageForUpload(attachment.file);
                    const formData = new FormData();
                    formData.append('file', uploadFile);
                    formData.append('message', text);
                    formData.append('session_id', sessionId);
                    formData.append('client_msg_id', clientMsgId);
                    response = await fetch(`${CHAT_BACKEND_URL}/chat/upload`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                        body: formData,
                    });
                } else {
                    response = await fetch(`${CHAT_BACKEND_URL}/chat/message`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ message: text, session_id: sessionId, client_msg_id: clientMsgId }),
                    });
                }
                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    throw new Error(errBody.detail || `HTTP ${response.status}`);
                }
                const data = await response.json();
                this._renderMessage('assistant', data.reply, 'message', Date.now());
                this._saveMessage(this.displaySessionId, 'assistant', data.reply);
            } catch (error) {
                this._ownRequestIds.delete(clientMsgId);
                this._renderMessage(
                    'assistant',
                    `⚠️ Não consegui falar com o backend agora (${error.message}). ` +
                        (attachment ? 'Deixei o anexo pronto de novo pra você tentar reenviar.' : ''),
                    'message',
                    Date.now()
                );
                // Devolve o anexo (e o texto) pro usuário poder só apertar enviar de novo,
                // em vez de escolher o arquivo outra vez — achado real em produção: sem
                // isso, um reenvio manual ia sem anexo nenhum, e o Jarvis respondia "você
                // não me enviou nada", confundindo ainda mais quem já tinha visto um erro.
                if (attachment) {
                    this.pendingAttachment = attachment;
                    this._showAttachmentPreview(attachment);
                    this.input.value = text;
                    this._autoGrow();
                }
            } finally {
                this.sendBtn.disabled = false;
            }
        }

        // ----------------------------------------------------- anexo (SCRUM-69, Fase 1)

        async _onFileSelected() {
            const file = this.fileInput.files?.[0];
            this.fileInput.value = ''; // permite escolher o mesmo arquivo de novo depois
            if (!file) return;
            const MAX_BYTES = 15 * 1024 * 1024;
            if (file.size > MAX_BYTES) {
                this._renderMessage(
                    'assistant',
                    '⚠️ Esse arquivo é grande demais (máx. 15MB). Tenta um menor?',
                    'message',
                    Date.now()
                );
                return;
            }
            const isImage = file.type.startsWith('image/');
            const thumbDataUrl = isImage ? await this._makeThumbnail(file) : null;
            const attachment = { file, thumbDataUrl };
            this.pendingAttachment = attachment;
            this._showAttachmentPreview(attachment);
        }

        _showAttachmentPreview(attachment) {
            this.attachmentPreview.hidden = false;
            this.attachmentName.textContent = attachment.file.name;
            if (attachment.thumbDataUrl) {
                this.attachmentThumb.src = attachment.thumbDataUrl;
                this.attachmentThumb.hidden = false;
                this.attachmentIcon.hidden = true;
            } else {
                this.attachmentThumb.hidden = true;
                this.attachmentIcon.hidden = false;
            }
        }

        // Reduz uma foto grande antes de enviar (canvas, máx. 2000px no lado maior,
        // JPEG 85%) — o texto de um comprovante continua perfeitamente legível nesse
        // tamanho, e o arquivo final fica bem abaixo do limite de 10MB (em base64) da
        // API por imagem. PDF passa direto (a Anthropic lê o PDF original). Se o
        // arquivo já é pequeno, não mexe (evita perda de qualidade à toa).
        _prepareImageForUpload(file, maxDim = 2000, maxBytes = 6 * 1024 * 1024) {
            if (!file.type.startsWith('image/') || file.size <= maxBytes) return file;
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(img.width * scale);
                        canvas.height = Math.round(img.height * scale);
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        canvas.toBlob(
                            (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
                            'image/jpeg',
                            0.85
                        );
                    };
                    img.onerror = () => resolve(file);
                    img.src = reader.result;
                };
                reader.onerror = () => resolve(file);
                reader.readAsDataURL(file);
            });
        }

        // Miniatura reduzida (canvas, máx. 200px, JPEG 60%) pra exibir/guardar local —
        // o arquivo original em resolução cheia é o que vai pro backend/Claude.
        _makeThumbnail(file, maxDim = 200) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(img.width * scale);
                        canvas.height = Math.round(img.height * scale);
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        resolve(canvas.toDataURL('image/jpeg', 0.6));
                    };
                    img.onerror = () => resolve(null);
                    img.src = reader.result;
                };
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(file);
            });
        }

        _clearAttachment() {
            this.pendingAttachment = null;
            this.attachmentPreview.hidden = true;
            this.attachmentThumb.src = '';
            this.attachmentThumb.hidden = true;
            this.attachmentIcon.hidden = true;
            this.attachmentName.textContent = '';
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
                this._saveMessage(this.displaySessionId, payload.role, payload.text, payload.kind);
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
                this._publishWidthVar();
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

            // Envio de imagem/PDF (SCRUM-69, Fase 1) — mesmo <input type="file"> pros dois
            // botões, só troca o "accept" antes de abrir o seletor.
            this.attachPhotoBtn?.addEventListener('click', () => {
                if (!this.fileInput) return;
                this.fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
                this.fileInput.click();
            });
            this.attachFileBtn?.addEventListener('click', () => {
                if (!this.fileInput) return;
                this.fileInput.accept = 'application/pdf';
                this.fileInput.click();
            });
            this.fileInput?.addEventListener('change', () => this._onFileSelected());
            this.attachmentRemoveBtn?.addEventListener('click', () => this._clearAttachment());
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.jarvisChat = new JarvisChat();
    });
})();
