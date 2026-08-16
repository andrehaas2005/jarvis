// JARVIS Interface JavaScript

// ID do agente ElevenLabs Conversational AI (painel da ElevenLabs → seu agente).
const ELEVENLABS_AGENT_ID = 'agent_7001ktkn543wf7t9s7fv643vjm7z';

class JARVISInterface {
    constructor() {
        this.chatMessages = document.getElementById('chatMessages');
        this.voiceButton = document.getElementById('voiceButton');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.voiceIndicator = document.getElementById('voiceIndicator');
        this.logContent = document.getElementById('logContent');
        this.outputBufferContent = document.getElementById('outputBufferContent');
        this.sourcesPanel = document.getElementById('sourcesPanel');
        this.sourcesList = document.getElementById('sourcesList');
        this.seenSourceUrls = new Set();
        this.topbarStatus = document.getElementById('topbarStatus');
        this.topbarStatusText = document.getElementById('topbarStatusText');
        this.topbarSleep = document.getElementById('topbarSleep');
        this.topbarVision = document.getElementById('topbarVision');
        this.visionPreview = document.getElementById('visionPreview');
        this.visionVideo = document.getElementById('visionVideo');
        this.visionLookBtn = document.getElementById('visionLookBtn');
        this.visionCaptureCanvas = document.getElementById('visionCaptureCanvas');
        this.visionStream = null;
        this.topbarGestures = document.getElementById('topbarGestures');
        this.gestureOverlay = document.getElementById('gestureOverlay');
        this.gestureCloseBtn = document.getElementById('gestureCloseBtn');
        this.gestureNewBoxBtn = document.getElementById('gestureNewBoxBtn');
        // GestureCanvas (rastreamento de mão) é definido em gestures.js, carregado como módulo —
        // ver <script type="module"> no index.html. Só é instanciado quando o usuário abre o
        // canvas pela primeira vez (evita pedir câmera/baixar o modelo de mão sem necessidade).
        this.gestureCanvas = null;
        this.conversation = null; // instância retornada por ElevenLabsClient.Conversation.startSession
        this.conversationActive = false;
        this.currentMode = 'listening'; // 'listening' | 'speaking' — espelha onModeChange do SDK
        this.audioLevelLoopId = null;
        this.visualizerModeToggle = document.getElementById('visualizerModeToggle');
        // Visualizer3D (Three.js) é definido em visualizer3d.js, carregado como módulo antes deste
        // script — ver <script type="module"> no index.html.
        this.faceVisualizer = new window.Visualizer3D(document.getElementById('faceCanvas'));
        this.faceVisualizer.start();

        this.initializeInterface();
        this.setupEventListeners();
        this.startSystemAnimations();
        this.syncVisualizerModeButton();
        this.syncTopbarStatus();
    }

    syncVisualizerModeButton() {
        if (!this.visualizerModeToggle) return;
        this.visualizerModeToggle.textContent = this.faceVisualizer.getMode() === 'orb' ? 'ORBE' : 'ROSTO';
    }

    initializeInterface() {
        // Add typing indicator
        this.addTypingIndicator();
        
        // Initialize HUD animations
        this.initializeHUDAnimations();
        
        // Start dynamic data updates
        this.startDynamicUpdates();
    }

    setupEventListeners() {
        // Clique no botão liga/desliga a conversa com o agente ElevenLabs
        this.voiceButton.addEventListener('click', () => {
            this.toggleConversation();
        });

        // Alterna entre as duas variações do visualizador 3D (orbe / rosto wireframe)
        if (this.visualizerModeToggle) {
            this.visualizerModeToggle.addEventListener('click', () => {
                const next = this.faceVisualizer.getMode() === 'orb' ? 'face' : 'orb';
                this.faceVisualizer.setMode(next);
                this.syncVisualizerModeButton();
            });
        }

        // Botão SLEEP da barra superior encerra a conversa (se houver uma ativa)
        if (this.topbarSleep) {
            this.topbarSleep.addEventListener('click', () => {
                if (this.conversationActive) this.stopConversation();
            });
        }

        // SHARE VISION liga/desliga a câmera; OLHAR AGORA manda o frame atual pro Jarvis analisar
        if (this.topbarVision) {
            this.topbarVision.addEventListener('click', () => this.toggleVision());
        }
        if (this.visionLookBtn) {
            this.visionLookBtn.addEventListener('click', () => this.lookAtCamera());
        }

        // GESTOS abre/fecha o canvas de caixas controlado por rastreamento de mão
        if (this.topbarGestures) {
            this.topbarGestures.addEventListener('click', () => this.toggleGestureCanvas());
        }
        if (this.gestureCloseBtn) {
            this.gestureCloseBtn.addEventListener('click', () => this.closeGestureCanvas());
        }
        if (this.gestureNewBoxBtn) {
            this.gestureNewBoxBtn.addEventListener('click', () => {
                if (this.gestureCanvas) this.gestureCanvas.createBox(80, 80);
            });
        }
    }

    async toggleGestureCanvas() {
        if (this.gestureOverlay.hidden) await this.openGestureCanvas();
        else this.closeGestureCanvas();
    }

    async openGestureCanvas() {
        if (!window.GestureCanvas) {
            this.pushLog('[ERRO] Módulo de gestos ainda não carregou');
            return;
        }
        this.gestureOverlay.hidden = false;
        this.topbarGestures.classList.add('active');

        if (!this.gestureCanvas) {
            this.gestureCanvas = new window.GestureCanvas({
                overlay: this.gestureOverlay,
                canvasArea: document.getElementById('gestureCanvasArea'),
                worldEl: document.getElementById('gestureWorld'),
                cursorEl: document.getElementById('gestureCursor'),
                svgEl: document.getElementById('gestureSvg'),
                trashEl: document.getElementById('gestureTrash'),
                video: document.getElementById('gestureVideo'),
                statusEl: document.getElementById('gestureStatus'),
                boxCountEl: document.getElementById('gestureBoxCount'),
                log: (text) => this.pushLog(text),
            });
        }
        await this.gestureCanvas.start();
    }

    closeGestureCanvas() {
        this.gestureOverlay.hidden = true;
        this.topbarGestures.classList.remove('active');
        if (this.gestureCanvas) this.gestureCanvas.stop();
    }

    // Espelha o estado real da conexão no pill "CONECTADO/DESCONECTADO" da barra superior.
    syncTopbarStatus() {
        if (!this.topbarStatus) return;
        this.topbarStatus.classList.toggle('connected', this.conversationActive);
        this.topbarStatusText.textContent = this.conversationActive ? 'CONECTADO' : 'DESCONECTADO';
        if (this.topbarSleep) this.topbarSleep.disabled = !this.conversationActive;
        // "Olhar" só faz sentido com câmera ligada E conversa ativa (precisa de conversation.uploadFile)
        if (this.visionLookBtn) this.visionLookBtn.disabled = !this.conversationActive || !this.visionStream;
    }

    async toggleVision() {
        if (this.visionStream) {
            this.stopVision();
        } else {
            await this.startVision();
        }
    }

    async startVision() {
        try {
            this.visionStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        } catch (error) {
            console.error('Camera permission error:', error);
            this.pushLog('[ERRO] Permissão de câmera negada');
            return;
        }
        this.visionVideo.srcObject = this.visionStream;
        this.visionPreview.hidden = false;
        this.topbarVision.classList.add('active');
        this.pushLog('[VISÃO] Câmera compartilhada com o Jarvis');
        this.syncTopbarStatus();
    }

    stopVision() {
        if (this.visionStream) {
            this.visionStream.getTracks().forEach((track) => track.stop());
            this.visionStream = null;
        }
        this.visionVideo.srcObject = null;
        this.visionPreview.hidden = true;
        this.topbarVision.classList.remove('active');
        this.pushLog('[VISÃO] Câmera desativada');
        this.syncTopbarStatus();
    }

    // Captura o frame atual da câmera e manda pro Jarvis analisar de verdade, via
    // conversation.uploadFile() + sendMultimodalMessage() do SDK oficial da ElevenLabs — a
    // resposta dele chega como uma fala normal na conversa (mesmo caminho de qualquer pergunta).
    // `promptText` é o que acompanha a imagem — por padrão um pedido genérico de descrição, mas
    // quando disparado pela sua própria fala (ver maybeAutoLook), usamos a pergunta que você
    // realmente fez, pra resposta ficar mais natural.
    async lookAtCamera(promptText = 'Descreva o que você está vendo agora pela câmera.') {
        if (!this.visionStream || !this.conversation) return;

        const video = this.visionVideo;
        const canvas = this.visionCaptureCanvas;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        // Espelha a captura pra bater com a visualização (senão a mão esquerda de quem está na
        // câmera aparece do lado direito da imagem, e o Jarvis descreve o lado errado).
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (!blob) {
            this.pushLog('[ERRO] Não consegui capturar a imagem da câmera');
            return;
        }

        this.pushLog('[VISÃO] Enviando imagem da câmera para o Jarvis...');
        try {
            const { fileId } = await this.conversation.uploadFile(blob);
            await this.conversation.sendMultimodalMessage({ text: promptText, fileId });
            this.pushLog('[VISÃO] Imagem enviada — aguardando análise');
        } catch (error) {
            console.error('Error sending camera frame:', error);
            this.pushLog(`[ERRO] Falha ao enviar imagem: ${error.message || error}`);
        }
    }

    // Frases que indicam que você quer que o Jarvis veja algo agora. Como a fala por voz vai
    // direto pro SDK (a gente só recebe a transcrição DEPOIS, via onMessage), não dá pra grudar a
    // imagem no mesmo turno de voz — em vez disso, ao detectar uma dessas frases na sua fala,
    // mandamos a imagem logo em seguida como uma segunda mensagem, com a mesma pergunta.
    static VISION_TRIGGER_REGEX =
        /o que (você|voce|vc) (est[áa]|t[áa]) vendo|o que (eu )?tenho na(s)? (minhas? )?m[ãa]os?|consegue me ver|voc[êe] me v[êe]|voc[êe] (me )?enxerga|d[áa] uma olhada|olh[ae] (a c[âa]mera|pra mim|para mim)|identifica (isso|esse objeto|este objeto)|que objeto [ée] esse|o que (você|voce|vc) enxerga/i;

    // Chamado a cada transcrição de fala sua (onMessage, role 'user'). Se a câmera estiver
    // compartilhada e a frase bater com um gatilho de visão, dispara lookAtCamera() sozinho.
    maybeAutoLook(message) {
        if (!this.visionStream || !this.conversation) return;
        if (!JARVISInterface.VISION_TRIGGER_REGEX.test(message)) return;
        this.pushLog('[VISÃO] Pergunta sobre a câmera detectada — olhando automaticamente...');
        this.lookAtCamera(message);
    }

    toggleConversation() {
        if (this.conversationActive) {
            this.stopConversation();
        } else {
            this.startConversation();
        }
    }

    // Inicia uma conversa real com o agente ElevenLabs via SDK (@elevenlabs/client).
    // Cada callback abaixo alimenta o painel lateral (.log-content) e o texto de status com o que
    // está realmente acontecendo — nada aqui é simulado.
    async startConversation() {
        if (this.conversationActive || !window.ElevenLabsClient) {
            if (!window.ElevenLabsClient) {
                this.pushLog('[ERRO] SDK da ElevenLabs ainda não carregou');
            }
            return;
        }

        this.updateVoiceButtonState('listening');
        this.updateVoiceStatus('SOLICITANDO MICROFONE...');
        this.pushLog('[ÁUDIO] Solicitando permissão de microfone...');

        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            console.error('Microphone permission error:', error);
            this.pushLog('[ERRO] Permissão de microfone negada');
            this.updateVoiceStatus('[ERRO] MICROFONE NEGADO');
            this.updateVoiceButtonState('idle');
            return;
        }

        this.pushLog('[REDE] Conectando ao agente JARVIS (ElevenLabs)...');
        this.updateVoiceStatus('CONECTANDO...');

        try {
            this.conversation = await window.ElevenLabsClient.Conversation.startSession({
                agentId: ELEVENLABS_AGENT_ID,
                onConnect: ({ conversationId }) => {
                    this.conversationActive = true;
                    this.updateVoiceButtonState('listening');
                    this.updateVoiceStatus('JARVIS CONECTADO');
                    this.pushLog(`[REDE] Conectado — sessão ${conversationId.slice(0, 8)}…`);
                    this.faceVisualizer.setActive(true);
                    this.startAudioLevelLoop();
                    this.syncTopbarStatus();
                },
                onDisconnect: (details) => {
                    this.conversationActive = false;
                    this.conversation = null;
                    this.updateVoiceButtonState('idle');
                    this.updateVoiceStatus('SISTEMA ATIVO');
                    const motivo = details?.reason === 'error'
                        ? `erro: ${details.message}`
                        : details?.reason === 'user'
                            ? 'encerrada por você'
                            : 'encerrada pelo agente';
                    this.pushLog(`[REDE] Conversa desconectada (${motivo})`);
                    this.faceVisualizer.setActive(false);
                    this.stopAudioLevelLoop();
                    this.syncTopbarStatus();
                },
                onError: (message) => {
                    this.pushLog(`[ERRO] ${message}`);
                    this.updateVoiceStatus('[ERRO] FALHA NA CONEXÃO');
                },
                onMessage: ({ message, role }) => {
                    const quem = role === 'user' ? 'VOCÊ' : 'JARVIS';
                    this.pushLog(`[FALA] ${quem}: ${message}`);
                    if (role === 'user') this.maybeAutoLook(message);
                    // Com o canvas de gestos aberto, cada resposta do Jarvis também vira uma
                    // caixa nova ali — que você pode arrastar/conectar/apagar com a mão.
                    if (role === 'agent' && this.gestureCanvas && !this.gestureOverlay.hidden) {
                        this.gestureCanvas.addResponseBox(message);
                    }
                },
                // Interrupção natural (barge-in): o SDK já lida com isso sozinho — se você fala
                // por cima do Jarvis, ele para de falar e escuta. Este evento só confirma quando
                // isso acontece, pro painel refletir de verdade.
                onInterruption: () => {
                    this.pushLog('[VOZ] Você interrompeu o Jarvis');
                },
                onAgentToolRequest: ({ tool_name }) => {
                    this.pushLog(`[FERRAMENTA] Chamando ${tool_name}...`);
                },
                onAgentToolResponse: (payload) => {
                    const nome = payload.tool_name || 'ferramenta';
                    if (payload.is_error) {
                        this.pushLog(`[FERRAMENTA] ${nome} falhou`);
                        return;
                    }
                    // O evento "full payload" traz o resultado de verdade em texto — é dele que
                    // extraímos as URLs das fontes. O evento simples (sem full_tool_result) só
                    // avisa que a ferramenta terminou, sem conteúdo.
                    if (payload.full_tool_result) {
                        this.pushLog(`[FERRAMENTA] ${nome} respondeu`);
                        this.addSourcesFromToolResult(payload.full_tool_result);
                        this.updateOutputBuffer(nome, payload.full_tool_result);
                    }
                },
                onModeChange: ({ mode }) => {
                    this.currentMode = mode;
                    if (mode === 'speaking') {
                        this.updateVoiceStatus('JARVIS FALANDO...');
                        this.pushLog('[VOZ] Jarvis está falando');
                    } else {
                        this.updateVoiceStatus('OUVINDO...');
                        this.pushLog('[VOZ] Aguardando sua fala');
                    }
                },
                onStatusChange: ({ status }) => {
                    const traducao = {
                        connecting: 'conectando',
                        connected: 'conectado',
                        disconnecting: 'desconectando',
                        disconnected: 'desconectado',
                    };
                    this.pushLog(`[STATUS] Conexão: ${traducao[status] || status}`);
                },
            });
        } catch (error) {
            console.error('Error starting ElevenLabs conversation:', error);
            this.pushLog(`[ERRO] Falha ao iniciar conversa: ${error.message || error}`);
            this.updateVoiceStatus('[ERRO] FALHA ELEVENLABS');
            this.updateVoiceButtonState('idle');
            this.conversationActive = false;
            this.conversation = null;
            this.faceVisualizer.setActive(false);
            this.syncTopbarStatus();
        }
    }

    async stopConversation() {
        if (!this.conversation) return;
        this.pushLog('[SISTEMA] Encerrando conversa...');
        try {
            await this.conversation.endSession();
        } catch (error) {
            console.error('Error ending conversation:', error);
            this.pushLog(`[ERRO] Falha ao encerrar: ${error.message || error}`);
        }
        // onDisconnect também trata isso, mas garantimos o estado aqui como rede de segurança
        this.conversation = null;
        this.conversationActive = false;
        this.updateVoiceButtonState('idle');
        this.updateVoiceStatus('SISTEMA ATIVO');
        this.faceVisualizer.setActive(false);
        this.stopAudioLevelLoop();
        this.syncTopbarStatus();
    }

    // Lê o volume real de entrada/saída da conversa (dados de frequência do próprio SDK da
    // ElevenLabs) a cada quadro e alimenta o rosto animado — é o que faz ele reagir à fala de
    // verdade, tanto a sua quanto a do Jarvis.
    startAudioLevelLoop() {
        if (this.audioLevelLoopId) return;
        const step = () => {
            if (!this.conversation) {
                this.audioLevelLoopId = null;
                return;
            }
            try {
                const data = this.currentMode === 'speaking'
                    ? this.conversation.getOutputByteFrequencyData()
                    : this.conversation.getInputByteFrequencyData();
                if (data && data.length) {
                    let sum = 0;
                    for (let i = 0; i < data.length; i++) sum += data[i];
                    this.faceVisualizer.setLevel(sum / data.length / 255);
                }
            } catch (error) {
                // Método pode não estar disponível dependendo do estado da sessão — ignora e tenta
                // de novo no próximo quadro.
            }
            this.audioLevelLoopId = requestAnimationFrame(step);
        };
        this.audioLevelLoopId = requestAnimationFrame(step);
    }

    stopAudioLevelLoop() {
        if (this.audioLevelLoopId) {
            cancelAnimationFrame(this.audioLevelLoopId);
            this.audioLevelLoopId = null;
        }
        this.faceVisualizer.setLevel(0);
    }

    updateVoiceButtonState(state) {
        this.voiceButton.className = `voice-button ${state}`;
    }

    updateVoiceStatus(text) {
        const statusText = this.voiceStatus.querySelector('.status-text');
        statusText.textContent = text;
    }

    // As funções addUserMessage/addJARVISResponse/addSystemMessage abaixo são primitivas de UI
    // reutilizáveis. Hoje nada as chama (o painel de chat mostra só a mensagem estática inicial) —
    // ficam reservadas para a Fase 2 do roadmap, que espelha a transcrição real do widget
    // ElevenLabs nesse painel.
    addUserMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message user-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>[USER] ${this.escapeHtml(message)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    addJARVISResponse(response) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message jarvis-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>[JARVIS] ${this.escapeHtml(response)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;

        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${this.escapeHtml(message)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        const typingElement = document.createElement('div');
        typingElement.className = 'message jarvis-message typing-indicator';
        typingElement.id = 'typingIndicator';
        typingElement.innerHTML = `
            <div class="message-avatar">
                <div class="avatar-ring"></div>
            </div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        
        this.chatMessages.appendChild(typingElement);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    addTypingIndicator() {
        const style = document.createElement('style');
        style.textContent = `
            .typing-dots {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            
            .typing-dots span {
                width: 8px;
                height: 8px;
                background: var(--jarvis-blue);
                border-radius: 50%;
                animation: typingPulse 1.4s infinite ease-in-out;
            }
            
            .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
            .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
            
            @keyframes typingPulse {
                0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
                40% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }


    startSystemAnimations() {
        // Add some dynamic visual effects
        this.animateStatusDots();
    }

    initializeHUDAnimations() {
        // Animate loading bars
        this.animateLoadingBars();
        
        // Animate chart bars
        this.animateChartBars();
        
        // Animate data displays
        this.animateDataDisplays();
    }

    startDynamicUpdates() {
        // Update loading progress
        setInterval(() => {
            this.updateLoadingProgress();
        }, 2000);
        
        // Update chart data
        setInterval(() => {
            this.updateChartData();
        }, 3000);
    }

    animateLoadingBars() {
        const progressBars = document.querySelectorAll('.loading-progress');
        progressBars.forEach((bar, index) => {
            const currentWidth = parseInt(bar.style.width);
            const targetWidth = Math.floor(Math.random() * 30) + 70; // 70-100%
            
            let width = currentWidth;
            const interval = setInterval(() => {
                if (width < targetWidth) {
                    width += 2;
                    bar.style.width = width + '%';
                } else {
                    clearInterval(interval);
                }
            }, 100);
        });
    }

    animateChartBars() {
        const bars = document.querySelectorAll('.bar');
        bars.forEach((bar, index) => {
            setInterval(() => {
                const newHeight = Math.floor(Math.random() * 40) + 50; // 50-90%
                bar.style.height = newHeight + '%';
            }, 2000 + (index * 500));
        });
    }

    animateDataDisplays() {
        const circles = document.querySelectorAll('.display-circle .circle-label');
        const labels = ['DY', '53', 'PH', 'KL'];
        
        setInterval(() => {
            circles.forEach((circle, index) => {
                if (Math.random() > 0.7) {
                    circle.textContent = Math.floor(Math.random() * 100).toString();
                }
            });
        }, 3000);
    }

    updateLoadingProgress() {
        const progressBars = document.querySelectorAll('.loading-progress');
        progressBars.forEach(bar => {
            const currentWidth = parseInt(bar.style.width);
            const change = (Math.random() - 0.5) * 10; // -5 to +5
            const newWidth = Math.max(20, Math.min(100, currentWidth + change));
            bar.style.width = newWidth + '%';
        });
    }

    updateChartData() {
        const bars = document.querySelectorAll('.bar');
        const labels = document.querySelectorAll('.chart-labels span');
        
        bars.forEach((bar, index) => {
            const newHeight = Math.floor(Math.random() * 50) + 30; // 30-80%
            bar.style.height = newHeight + '%';
            labels[index].textContent = newHeight;
        });
    }

    // Adiciona uma linha real ao painel de log lateral (nada de dados simulados — cada chamada vem
    // de um evento de verdade da conversa ElevenLabs, ver startConversation()).
    pushLog(text) {
        const timestamp = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const logLine = document.createElement('div');
        logLine.className = 'log-line';
        logLine.textContent = `[${timestamp}] ${text}`;

        this.logContent.appendChild(logLine);

        // Mantém só as últimas 8 entradas
        const entries = this.logContent.querySelectorAll('.log-line');
        if (entries.length > 8) {
            entries[0].remove();
        }
    }

    // Mostra o texto bruto (sem recorte) da última ferramenta chamada — complementa o painel de
    // fontes, que só pega as URLs; aqui é o retorno completo, tipo um terminal de debug real.
    updateOutputBuffer(toolName, fullToolResult) {
        const timestamp = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const truncated = fullToolResult.length > 600
            ? `${fullToolResult.slice(0, 600)}…`
            : fullToolResult;
        this.outputBufferContent.textContent = `[${timestamp}] ${toolName}\n${truncated}`;
    }

    // Extrai URLs de dentro do resultado bruto (texto/JSON) de uma ferramenta chamada pelo agente
    // (ex.: busca do Tavily no n8n) e mostra como fontes reais no painel — nada aqui é inventado,
    // vem direto do que a ferramenta retornou.
    addSourcesFromToolResult(fullToolResult) {
        const urlPattern = /https?:\/\/[^\s"')\]}]+/g;
        const found = fullToolResult.match(urlPattern);
        if (!found) return;

        found.slice(0, 5).forEach((rawUrl) => {
            // Corta pontuação de sobra que às vezes gruda no fim da URL (vírgula, ponto final)
            const url = rawUrl.replace(/[.,;:]+$/, '');
            if (this.seenSourceUrls.has(url)) return;
            this.seenSourceUrls.add(url);
            this.pushSource(url);
        });
    }

    pushSource(url) {
        this.sourcesPanel.hidden = false;

        const link = document.createElement('a');
        link.className = 'source-link';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url.replace(/^https?:\/\//, '');
        link.title = url;

        this.sourcesList.appendChild(link);

        // Mantém só as últimas 6 fontes visíveis
        const entries = this.sourcesList.querySelectorAll('.source-link');
        if (entries.length > 6) {
            entries[0].remove();
        }
    }

    animateStatusDots() {
        const statusDots = document.querySelectorAll('.status-dot');
        statusDots.forEach(dot => {
            setInterval(() => {
                dot.style.boxShadow = `0 0 ${Math.random() * 15 + 5}px var(--jarvis-blue)`;
            }, 2000);
        });
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    getCurrentTime() {
        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.jarvisInterface = new JARVISInterface();
});

// Add some keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Barra de espaço liga/desliga a conversa com o ElevenLabs
    if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (window.jarvisInterface) {
            window.jarvisInterface.toggleConversation();
        }
    }
});
