// JARVIS Interface JavaScript

// ID do agente ElevenLabs Conversational AI (painel da ElevenLabs → seu agente).
const ELEVENLABS_AGENT_ID = 'agent_0401ktc7pg1xev08smgfd1t20m52';

// Música de fundo tocada durante a conversa, a 25% do volume. O arquivo em si NÃO fica no git
// (ver .gitignore — é conteúdo com direitos autorais, só existe na sua máquina). Pra trocar a
// faixa padrão, é só substituir o arquivo em assets/music/background.mp3 por outro mp3/wav
// (mesmo nome). Pra testar uma faixa diferente sem mexer em arquivo nenhum, ou desligar a música,
// use o botão "MÚSICA" na barra superior do HUD.
const BACKGROUND_MUSIC_SRC = 'assets/music/background.mp3';
const BACKGROUND_MUSIC_VOLUME = 0.25;

// Frases de ativação por voz — diga qualquer uma delas com o microfone liberado (fora de uma
// conversa) que o Jarvis inicia a conversa sozinho, sem precisar clicar em "Sistema Ativo".
const WAKE_PHRASES = [
    'jarvis ativar',
    'e ai jarvis',
    'e aí jarvis',
    'jarvis esta me ouvindo',
    'jarvis está me ouvindo',
    'jarvis podemos conversar',
    'jarvis vamos conversar',
    'jarvis voce esta pronto',
    'jarvis você está pronto',
];

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

        // Widgets com dados reais (nada de números aleatórios — ver openGestureCanvas... digo,
        // startConversation() e startAudioLevelLoop() mais abaixo).
        this.statDuration = document.getElementById('statDuration');
        this.statMessages = document.getElementById('statMessages');
        this.statLatency = document.getElementById('statLatency');
        this.statCamera = document.getElementById('statCamera');
        this.vuInput = document.getElementById('vuInput');
        this.vuOutput = document.getElementById('vuOutput');
        this.weatherValue = document.getElementById('weatherValue');
        this.clockSP = document.getElementById('clockSP');
        this.clockNY = document.getElementById('clockNY');
        this.clockLON = document.getElementById('clockLON');
        this.conversationStartedAt = null;
        this.messageCount = 0;
        this.durationTimerId = null;

        // Ativação por voz (wake word) — reconhecimento contínuo rodando em segundo plano,
        // pausado durante a conversa e com o canvas de gestos aberto (os dois usam o mesmo
        // SpeechRecognition do navegador, que só roda uma instância por vez).
        this.topbarWake = document.getElementById('topbarWake');
        this.wakeRecognizer = null;
        this.wakeListening = false; // reflete se o reconhecimento está de fato rodando agora
        this.wakeEnabled = true; // liga/desliga a funcionalidade (botão da topbar)

        // Música de fundo (ver BACKGROUND_MUSIC_SRC no topo do arquivo)
        this.bgMusic = document.getElementById('bgMusicPlayer');
        this.topbarMusic = document.getElementById('topbarMusic');
        this.topbarMusicSwap = document.getElementById('topbarMusicSwap');
        this.musicFileInput = document.getElementById('musicFileInput');
        this.musicEnabled = localStorage.getItem('jarvis-music-enabled') !== 'false'; // ligada por padrão
        this.customMusicObjectUrl = null; // faixa trocada pelo botão 📁 — só dura a sessão atual
        this.musicFileMissing = false; // evita spam de aviso se o mp3 não existir

        // Rotina do primeiro contato do dia (clima + previsão de chuva + agenda) — injetada via
        // dynamicVariables do SDK da ElevenLabs, referenciada como {{daily_briefing}} na primeira
        // mensagem do agente (configurado no painel da ElevenLabs).
        this.dailyBriefingText = '';

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

        this.updateWorldClocks();
        setInterval(() => this.updateWorldClocks(), 30000);
        this.loadWeather();

        this.setupBackgroundMusic();
        this.setupWakeWordListener();
    }

    // ------------------------------------------------------------------
    // Música de fundo
    // ------------------------------------------------------------------

    setupBackgroundMusic() {
        if (!this.bgMusic) return;

        this.bgMusic.src = this.customMusicObjectUrl || BACKGROUND_MUSIC_SRC;
        this.bgMusic.volume = 0;
        this.bgMusic.onerror = () => {
            if (this.musicFileMissing) return;
            this.musicFileMissing = true;
            this.pushLog('[MÚSICA] Nenhum arquivo encontrado em assets/music/background.mp3');
        };

        // Botão MÚSICA liga/desliga (preferência salva — persiste entre sessões)
        this.syncMusicButton();
        if (this.topbarMusic) {
            this.topbarMusic.addEventListener('click', () => {
                this.musicEnabled = !this.musicEnabled;
                localStorage.setItem('jarvis-music-enabled', String(this.musicEnabled));
                this.syncMusicButton();
                if (this.musicEnabled && this.conversationActive) this.playBackgroundMusic();
                if (!this.musicEnabled) this.stopBackgroundMusic();
            });
        }

        // Botão 📁 troca a faixa por qualquer arquivo local — só durante esta sessão (o navegador
        // não guarda o arquivo entre recarregamentos; pra trocar a faixa padrão de vez, substitua
        // assets/music/background.mp3).
        if (this.topbarMusicSwap && this.musicFileInput) {
            this.topbarMusicSwap.addEventListener('click', () => this.musicFileInput.click());
            this.musicFileInput.addEventListener('change', () => {
                const file = this.musicFileInput.files?.[0];
                if (!file) return;
                if (this.customMusicObjectUrl) URL.revokeObjectURL(this.customMusicObjectUrl);
                this.customMusicObjectUrl = URL.createObjectURL(file);
                this.musicFileMissing = false;
                this.bgMusic.src = this.customMusicObjectUrl;
                this.pushLog(`[MÚSICA] Faixa trocada para "${file.name}" (só nesta sessão)`);
                if (this.musicEnabled && this.conversationActive) this.playBackgroundMusic();
            });
        }
    }

    syncMusicButton() {
        if (!this.topbarMusic) return;
        this.topbarMusic.classList.toggle('muted', !this.musicEnabled);
    }

    // Toca a música de fundo com um fade-in suave até 25% do volume máximo. Não faz nada se a
    // música estiver desligada no botão, ou se não houver arquivo configurado/carregado.
    playBackgroundMusic() {
        if (!this.bgMusic || !this.musicEnabled || this.musicFileMissing) return;
        if (!this.bgMusic.src) return;
        this.bgMusic.currentTime = 0;
        this.bgMusic.volume = 0;
        this.bgMusic.play().catch((error) => {
            console.warn('Não foi possível tocar a música de fundo:', error.message);
        });
        const fadeStep = () => {
            if (!this.bgMusic || this.bgMusic.paused) return;
            const target = BACKGROUND_MUSIC_VOLUME;
            if (this.bgMusic.volume < target) {
                this.bgMusic.volume = Math.min(target, this.bgMusic.volume + 0.02);
                requestAnimationFrame(fadeStep);
            }
        };
        requestAnimationFrame(fadeStep);
    }

    // Fade-out e pausa (ao fim da conversa, ou se a música for desligada no meio dela).
    stopBackgroundMusic() {
        if (!this.bgMusic) return;
        const fadeStep = () => {
            if (!this.bgMusic) return;
            if (this.bgMusic.volume > 0.02) {
                this.bgMusic.volume = Math.max(0, this.bgMusic.volume - 0.02);
                requestAnimationFrame(fadeStep);
            } else {
                this.bgMusic.pause();
                this.bgMusic.volume = 0;
            }
        };
        requestAnimationFrame(fadeStep);
    }

    // ------------------------------------------------------------------
    // Ativação por voz (wake word)
    // ------------------------------------------------------------------

    // Normaliza acentos/pontuação pra comparar com WAKE_PHRASES sem depender de o reconhecedor
    // acertar acentuação exata (ex.: "esta"/"está" viram a mesma coisa).
    static normalizeSpeech(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // remove acentos
            .replace(/[^\w\s]/g, '') // remove pontuação
            .replace(/\s+/g, ' ')
            .trim();
    }

    setupWakeWordListener() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('SpeechRecognition não suportado neste navegador — ativação por voz desativada.');
            if (this.topbarWake) {
                this.topbarWake.disabled = true;
                this.topbarWake.title = 'Ativação por voz não suportada neste navegador';
            }
            return;
        }

        if (this.topbarWake) {
            this.topbarWake.addEventListener('click', () => {
                this.wakeEnabled = !this.wakeEnabled;
                this.topbarWake.classList.toggle('active', this.wakeEnabled);
                if (this.wakeEnabled) {
                    this.pushLog('[VOZ] Ativação por voz ligada — diga uma frase de ativação');
                    this.startWakeWordListener();
                } else {
                    this.pushLog('[VOZ] Ativação por voz desligada');
                    this.stopWakeWordListener();
                }
            });
            this.topbarWake.classList.add('active');
        }

        this.startWakeWordListener();
    }

    startWakeWordListener() {
        if (!this.wakeEnabled || this.wakeListening) return;
        // Não roda ao mesmo tempo que uma conversa ativa ou o canvas de gestos (ambos usam o
        // reconhecimento de voz do navegador, que só permite uma instância por vez).
        if (this.conversationActive) return;
        if (this.gestureOverlay && !this.gestureOverlay.hidden) return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognizer = new SpeechRecognition();
        recognizer.lang = 'pt-BR';
        recognizer.continuous = true;
        recognizer.interimResults = false;

        recognizer.onresult = (event) => {
            const lastResult = event.results[event.results.length - 1];
            if (!lastResult || !lastResult.isFinal) return;
            const heard = JARVISInterface.normalizeSpeech(lastResult[0].transcript);
            const matched = WAKE_PHRASES.some((phrase) => heard.includes(JARVISInterface.normalizeSpeech(phrase)));
            if (matched) {
                this.pushLog(`[VOZ] Frase de ativação reconhecida: "${lastResult[0].transcript.trim()}"`);
                this.stopWakeWordListener();
                this.startConversation();
            }
        };

        recognizer.onerror = (event) => {
            // 'no-speech' e 'aborted' são normais (silêncio prolongado, ou nós mesmos paramos) —
            // não vale poluir o log com isso.
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                console.warn('Erro no reconhecimento de ativação por voz:', event.error);
            }
            // Permissão de microfone negada (ou bloqueada pelo navegador/sandbox): tentar de novo
            // não vai resolver sozinho, então desligamos a funcionalidade em vez de martelar
            // reconexões infinitas — o usuário pode religar pelo botão depois de liberar o mic.
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                this.wakeEnabled = false;
                if (this.topbarWake) this.topbarWake.classList.remove('active');
                this.pushLog('[VOZ] Ativação por voz desligada — permissão de microfone negada');
            }
        };

        recognizer.onend = () => {
            this.wakeListening = false;
            // Reinicia sozinho enquanto a funcionalidade estiver ligada e nada estiver ocupando o
            // reconhecimento de voz (Chrome encerra a sessão sozinho de tempos em tempos).
            if (this.wakeEnabled && !this.conversationActive && (!this.gestureOverlay || this.gestureOverlay.hidden)) {
                setTimeout(() => this.startWakeWordListener(), 300);
            }
        };

        try {
            recognizer.start();
            this.wakeRecognizer = recognizer;
            this.wakeListening = true;
        } catch (error) {
            console.warn('Não foi possível iniciar a ativação por voz:', error.message);
        }
    }

    stopWakeWordListener() {
        if (this.wakeRecognizer) {
            this.wakeRecognizer.onend = null; // evita reiniciar sozinho ao pararmos de propósito
            try {
                this.wakeRecognizer.stop();
            } catch (error) {
                // ignora — já pode estar parado
            }
            this.wakeRecognizer = null;
        }
        this.wakeListening = false;
    }

    // Hora real de 3 cidades — Intl.DateTimeFormat com timeZone já dá o horário certo sem
    // precisar de nenhuma API.
    updateWorldClocks() {
        const format = (tz) =>
            new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
        if (this.clockSP) this.clockSP.textContent = format('America/Sao_Paulo');
        if (this.clockNY) this.clockNY.textContent = format('America/New_York');
        if (this.clockLON) this.clockLON.textContent = format('Europe/London');
    }

    // Clima real via Open-Meteo (sem precisar de chave de API). Pede sua localização; se você
    // negar ou o navegador não suportar, cai pra São Paulo como padrão.
    async loadWeather() {
        const fallback = { lat: -23.5505, lon: -46.6333, label: 'São Paulo' };
        let coords = fallback;

        if (navigator.geolocation) {
            try {
                const position = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }),
                );
                coords = { lat: position.coords.latitude, lon: position.coords.longitude, label: 'sua localização' };
            } catch (error) {
                console.warn('Geolocalização indisponível, usando São Paulo como padrão:', error.message);
            }
        }

        try {
            // "daily=precipitation_probability_max" traz a chance de chuva do dia inteiro — usada
            // tanto no widget de clima quanto na rotina de primeiro contato do dia (ver
            // buildDailyBriefingText()).
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&daily=precipitation_probability_max&timezone=auto`;
            const response = await fetch(url);
            const data = await response.json();
            const temp = Math.round(data.current.temperature_2m);
            const condition = this.weatherCodeToText(data.current.weather_code);
            this.weatherValue.textContent = `${temp}°C ${condition}`;

            const rainChance = data.daily?.precipitation_probability_max?.[0];
            this.lastWeather = { temp, condition, rainChance };
        } catch (error) {
            console.error('Falha ao buscar clima real:', error);
            this.weatherValue.textContent = 'indisponível';
            this.lastWeather = null;
        }
    }

    // ------------------------------------------------------------------
    // Rotina do primeiro contato do dia (clima + previsão de chuva + agenda)
    // ------------------------------------------------------------------

    // Monta o texto do briefing (clima real + previsão de chuva + agenda) e devolve pronto pra
    // virar a variável dinâmica {{daily_briefing}} — vazio se já foi dado hoje, ou se o clima
    // ainda não carregou a tempo (nesse caso o agente cumprimenta normalmente, sem briefing).
    getDailyBriefingVariable() {
        const today = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD, estável p/ comparação
        const lastBriefingDate = localStorage.getItem('jarvis-last-briefing-date');
        if (lastBriefingDate === today) return '';

        const text = this.buildDailyBriefingText();
        if (!text) return ''; // clima ainda não carregou — não marca o dia como "já avisado"

        localStorage.setItem('jarvis-last-briefing-date', today);
        return text;
    }

    // IMPORTANTE: esta variável é usada na "Primeira mensagem" do agente (painel da ElevenLabs),
    // que faz substituição literal de {{daily_briefing}} — NÃO passa pelo LLM. Por isso o texto
    // aqui já precisa ser a fala pronta (não uma instrução), com um "espaço" de sobra no fim pra
    // encadear com o resto da primeira mensagem configurada lá.
    buildDailyBriefingText() {
        if (!this.lastWeather) return '';
        const { temp, condition, rainChance } = this.lastWeather;
        const chuvaTexto = typeof rainChance === 'number'
            ? `${rainChance}% de chance de chuva`
            : 'previsão de chuva indisponível no momento';

        // Agenda real depende do Agent Tool de calendário do n8n, que ainda está pendente de
        // configuração (ver PLANO_EVOLUCAO.md) — por ora avisamos isso de forma transparente em
        // vez de inventar compromissos.
        return `Antes de mais nada, Senhor: agora está ${temp}°C, ${condition}, com ${chuvaTexto} hoje. ` +
            `Quanto à sua agenda, ainda não tenho acesso a ela — o calendário do Senhor segue um ` +
            `mistério que pretendo resolver em breve. `;
    }

    // Tradução simplificada dos códigos WMO que a Open-Meteo usa (docs: open-meteo.com/en/docs)
    weatherCodeToText(code) {
        if (code === 0) return 'céu limpo';
        if (code <= 2) return 'poucas nuvens';
        if (code === 3) return 'nublado';
        if (code <= 48) return 'neblina';
        if (code <= 57) return 'garoa';
        if (code <= 67) return 'chuva';
        if (code <= 77) return 'neve';
        if (code <= 82) return 'pancadas de chuva';
        if (code <= 99) return 'tempestade';
        return '';
    }

    syncVisualizerModeButton() {
        if (!this.visualizerModeToggle) return;
        const labels = { orb: 'ORBE', face: 'ROSTO', ring: 'ANEL' };
        this.visualizerModeToggle.textContent = labels[this.faceVisualizer.getMode()] || 'ORBE';
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

        // Alterna entre as três variações do visualizador 3D (orbe / rosto / anel)
        if (this.visualizerModeToggle) {
            const order = ['orb', 'face', 'ring'];
            this.visualizerModeToggle.addEventListener('click', () => {
                const current = order.indexOf(this.faceVisualizer.getMode());
                const next = order[(current + 1) % order.length];
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
        this.stopWakeWordListener(); // libera o SpeechRecognition do navegador pro ditado de gestos

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
        this.startWakeWordListener(); // retoma a escuta da frase de ativação
    }

    // Espelha o estado real da conexão no pill "CONECTADO/DESCONECTADO" da barra superior.
    syncTopbarStatus() {
        if (!this.topbarStatus) return;
        this.topbarStatus.classList.toggle('connected', this.conversationActive);
        this.topbarStatusText.textContent = this.conversationActive ? 'CONECTADO' : 'DESCONECTADO';
        if (this.topbarSleep) this.topbarSleep.disabled = !this.conversationActive;
        // "Olhar" só faz sentido com câmera ligada E conversa ativa (precisa de conversation.uploadFile)
        if (this.visionLookBtn) this.visionLookBtn.disabled = !this.conversationActive || !this.visionStream;
        if (this.statCamera) this.statCamera.textContent = this.visionStream ? 'ON' : 'OFF';
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

        this.stopWakeWordListener(); // libera o SpeechRecognition do navegador pra conversa em si

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
                // Rotina do primeiro contato do dia: clima real + previsão de chuva + agenda,
                // injetada como variável dinâmica {{daily_briefing}} — usada na primeira mensagem
                // do agente (configurada no painel da ElevenLabs). Nas próximas conversas do mesmo
                // dia, vem vazia e o agente cumprimenta normalmente. Ver getDailyBriefingVariable().
                dynamicVariables: {
                    daily_briefing: this.getDailyBriefingVariable(),
                },
                onConnect: ({ conversationId }) => {
                    this.conversationActive = true;
                    this.updateVoiceButtonState('listening');
                    this.updateVoiceStatus('JARVIS CONECTADO');
                    this.pushLog(`[REDE] Conectado — sessão ${conversationId.slice(0, 8)}…`);
                    this.faceVisualizer.setActive(true);
                    this.startAudioLevelLoop();
                    this.syncTopbarStatus();
                    this.conversationStartedAt = Date.now();
                    this.messageCount = 0;
                    this.updateStatMessages();
                    this.startDurationTimer();
                    this.playBackgroundMusic();
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
                    this.stopDurationTimer();
                    this.stopBackgroundMusic();
                    this.startWakeWordListener(); // volta a escutar a frase de ativação
                },
                onError: (message) => {
                    this.pushLog(`[ERRO] ${message}`);
                    this.updateVoiceStatus('[ERRO] FALHA NA CONEXÃO');
                },
                onMessage: ({ message, role }) => {
                    const quem = role === 'user' ? 'VOCÊ' : 'JARVIS';
                    this.pushLog(`[FALA] ${quem}: ${message}`);
                    if (role === 'user') this.maybeAutoLook(message);
                    this.messageCount++;
                    this.updateStatMessages();
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
                // Ping real do SDK — usado no widget de LATÊNCIA (nada de número aleatório)
                onPing: ({ ping_ms }) => {
                    if (this.statLatency && typeof ping_ms === 'number') {
                        this.statLatency.textContent = `${Math.round(ping_ms)}`;
                    }
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
            this.startWakeWordListener();
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
        this.stopDurationTimer();
        this.stopBackgroundMusic();
        this.startWakeWordListener();
    }

    // Lê o volume real de entrada/saída da conversa (dados de frequência do próprio SDK da
    // ElevenLabs) a cada quadro e alimenta o rosto animado — é o que faz ele reagir à fala de
    // verdade, tanto a sua quanto a do Jarvis.
    // Média 0..1 de um array de frequência do SDK — usada tanto pro visualizador 3D quanto pro
    // medidor de volume (VU-meter) real do painel lateral.
    averageLevel(getData) {
        try {
            const data = getData();
            if (!data || !data.length) return 0;
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            return sum / data.length / 255;
        } catch (error) {
            // Método pode não estar disponível dependendo do estado da sessão — ignora e tenta
            // de novo no próximo quadro.
            return 0;
        }
    }

    startAudioLevelLoop() {
        if (this.audioLevelLoopId) return;
        const step = () => {
            if (!this.conversation) {
                this.audioLevelLoopId = null;
                return;
            }

            // Pro visualizador 3D (orbe/rosto/anel): usa o canal relevante ao modo atual
            const combinedLevel = this.currentMode === 'speaking'
                ? this.averageLevel(() => this.conversation.getOutputByteFrequencyData())
                : this.averageLevel(() => this.conversation.getInputByteFrequencyData());
            this.faceVisualizer.setLevel(combinedLevel);

            // Pro VU-meter: os dois canais lidos sempre, independente do modo — o que não está
            // ativo naturalmente fica perto de zero, que é o comportamento certo de um medidor real
            const inputLevel = this.averageLevel(() => this.conversation.getInputByteFrequencyData());
            const outputLevel = this.averageLevel(() => this.conversation.getOutputByteFrequencyData());
            if (this.vuInput) this.vuInput.style.width = `${Math.min(100, inputLevel * 130)}%`;
            if (this.vuOutput) this.vuOutput.style.width = `${Math.min(100, outputLevel * 130)}%`;

            this.audioLevelLoopId = requestAnimationFrame(step);
        };
        this.audioLevelLoopId = requestAnimationFrame(step);
    }

    stopAudioLevelLoop() {
        if (this.audioLevelLoopId) {
            cancelAnimationFrame(this.audioLevelLoopId);
            this.audioLevelLoopId = null;
        }
        if (this.vuInput) this.vuInput.style.width = '0%';
        if (this.vuOutput) this.vuOutput.style.width = '0%';
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

    updateStatMessages() {
        if (this.statMessages) this.statMessages.textContent = String(this.messageCount);
    }

    startDurationTimer() {
        this.stopDurationTimer();
        this.updateStatDuration();
        this.durationTimerId = setInterval(() => this.updateStatDuration(), 1000);
    }

    stopDurationTimer() {
        if (this.durationTimerId) {
            clearInterval(this.durationTimerId);
            this.durationTimerId = null;
        }
        if (this.statDuration) this.statDuration.textContent = '0:00';
        if (this.statLatency) this.statLatency.textContent = '--';
    }

    updateStatDuration() {
        if (!this.statDuration || !this.conversationStartedAt) return;
        const elapsedSec = Math.floor((Date.now() - this.conversationStartedAt) / 1000);
        const minutes = Math.floor(elapsedSec / 60);
        const seconds = String(elapsedSec % 60).padStart(2, '0');
        this.statDuration.textContent = `${minutes}:${seconds}`;
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
