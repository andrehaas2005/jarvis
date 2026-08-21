// JARVIS Interface JavaScript

// ID do agente ElevenLabs Conversational AI (painel da ElevenLabs → seu agente).
const ELEVENLABS_AGENT_ID = 'agent_0401ktc7pg1xev08smgfd1t20m52';

// Backend orquestrador (SCRUM-16). Usado para pedir a signed URL da ElevenLabs — ver
// getElevenLabsSignedUrl() logo abaixo. Detecta automaticamente local vs. produção pelo
// hostname da página, então o mesmo script.js funciona sem editar nada nos dois ambientes.
const JARVIS_BACKEND_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8000'
    : 'https://jarvis-api.andre.haas.nom.br';

// Música de fundo tocada durante a conversa. O arquivo em si NÃO fica no git (ver .gitignore —
// é conteúdo com direitos autorais, só existe na sua máquina). Pra trocar a faixa padrão, é só
// substituir o arquivo em assets/music/background.mp3 por outro mp3/wav (mesmo nome). Pra testar
// uma faixa diferente sem mexer em arquivo nenhum, ou desligar a música, use o botão "MÚSICA" na
// barra superior do HUD.
const BACKGROUND_MUSIC_SRC = 'assets/music/background.mp3';
// Volume inicial do slider "VOLUME" — é um valor REAL (10 no slider = 10% de volume de verdade,
// sem multiplicar por nada). A faixa padrão é "pesada", então começa baixo pra não encobrir a
// voz do Jarvis nem a sua.
const BACKGROUND_MUSIC_DEFAULT_VOLUME = 0.1;

// Frases de ativação por voz — diga qualquer uma delas com o microfone liberado (fora de uma
// conversa) que o Jarvis inicia a conversa sozinho, sem precisar clicar em "Sistema Ativo". Esta
// é só a lista PADRÃO (SCRUM-21: a Settings Page permite adicionar/remover frases próprias, salvas
// em localStorage — ver loadWakePhrases()/this.wakePhrases, a fonte que realmente importa agora).
const DEFAULT_WAKE_PHRASES = [
    'Jarvis, ativar',
    'E aí, Jarvis',
    'Jarvis, está me ouvindo?',
    'Jarvis, podemos conversar?',
    'Jarvis, vamos conversar?',
    'Jarvis, você está pronto?',
];
const WAKE_PHRASES_STORAGE_KEY = 'jarvis-wake-phrases';

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
        this.visionLookBusy = false; // trava contra chamadas sobrepostas de lookAtCamera()
        this.topbarFullscreen = document.getElementById('topbarFullscreen');
        this.topbarFullscreenIcon = document.getElementById('topbarFullscreenIcon');
        this.topbarFullscreenLabel = document.getElementById('topbarFullscreenLabel');
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
        // Guarda síncrona contra chamadas duplicadas a startConversation(): conversationActive só
        // vira true dentro do onConnect (assíncrono), então sem isso duas chamadas próximas (ex.:
        // frase de ativação + clique quase simultâneo) passam pela checagem antes da primeira
        // terminar de conectar, abrindo DUAS sessões ao mesmo tempo — daí a voz saindo duplicada.
        this.conversationStarting = false;
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

        // Check-in (Email/Calendar/Contacts) + Créditos (ElevenLabs/Anthropic) — painel
        // lateral esquerdo, ver getStatusCheckin()/getStatusCredits() mais abaixo.
        this.checkinCapabilities = ['email', 'calendar', 'contacts'];
        this.creditsValueEleven = document.getElementById('creditsValueEleven');
        this.creditsFillEleven = document.getElementById('creditsFillEleven');
        this.creditsValueAnthropic = document.getElementById('creditsValueAnthropic');
        this.creditsValueModel = document.getElementById('creditsValueModel');

        // Presença — um ID por aba (não por pessoa: sem login, não dá pra saber quem é quem,
        // só quantas abas/dispositivos distintos têm o HUD aberto agora). Persistido em
        // sessionStorage pra sobreviver a re-render sem virar uma sessão nova a cada heartbeat.
        this.presenceSessionId = sessionStorage.getItem('jarvis-presence-id')
            || crypto.randomUUID();
        sessionStorage.setItem('jarvis-presence-id', this.presenceSessionId);
        this.presenceValue = document.getElementById('presenceValue');

        // Quem está logado (SCRUM-56) — ver checkAuthSession()/renderLoggedInUser() mais abaixo.
        this.topbarUserName = document.getElementById('topbarUserName');
        this.topbarLogout = document.getElementById('topbarLogout');

        // Settings Page (SCRUM-20/21/22/23) — ver setupSettingsModal() mais abaixo.
        this.topbarSettings = document.getElementById('topbarSettings');
        this.settingsOverlay = document.getElementById('settingsOverlay');
        this.settingsClose = document.getElementById('settingsClose');
        this.settingsPhraseList = document.getElementById('settingsPhraseList');
        this.settingsPhraseInput = document.getElementById('settingsPhraseInput');
        this.settingsPhraseAdd = document.getElementById('settingsPhraseAdd');
        this.settingsPhraseReset = document.getElementById('settingsPhraseReset');
        this.settingsPlaylist = document.getElementById('settingsPlaylist');
        this.settingsMusicInput = document.getElementById('settingsMusicInput');
        this.settingsMusicAdd = document.getElementById('settingsMusicAdd');
        this.settingsLLMProvider = document.getElementById('settingsLLMProvider');
        this.settingsLLMModel = document.getElementById('settingsLLMModel');
        this.settingsLLMBaseUrlRow = document.getElementById('settingsLLMBaseUrlRow');
        this.settingsLLMBaseUrlPreset = document.getElementById('settingsLLMBaseUrlPreset');
        this.settingsLLMBaseUrlCustomRow = document.getElementById('settingsLLMBaseUrlCustomRow');
        this.settingsLLMBaseUrl = document.getElementById('settingsLLMBaseUrl');
        this.settingsLLMSave = document.getElementById('settingsLLMSave');
        this.settingsLLMStatus = document.getElementById('settingsLLMStatus');

        this.conversationStartedAt = null;
        this.messageCount = 0;
        this.durationTimerId = null;

        // Ativação por voz (wake word) — reconhecimento contínuo rodando em segundo plano,
        // pausado durante a conversa e com o canvas de gestos aberto (os dois usam o mesmo
        // SpeechRecognition do navegador, que só roda uma instância por vez).
        this.topbarWake = document.getElementById('topbarWake');
        this.topbarWakeInfo = document.getElementById('topbarWakeInfo');
        this.wakePhrasesPopover = document.getElementById('wakePhrasesPopover');
        this.wakePhrasesList = document.getElementById('wakePhrasesList');
        this.wakeRecognizer = null;
        this.wakeListening = false; // reflete se o reconhecimento está de fato rodando agora
        this.wakeEnabled = true; // liga/desliga a funcionalidade (botão da topbar)
        this.wakePhrases = this.loadWakePhrases(); // SCRUM-21 — customizável na Settings Page

        // Música de fundo (ver BACKGROUND_MUSIC_SRC no topo do arquivo)
        this.bgMusic = document.getElementById('bgMusicPlayer');
        this.topbarMusic = document.getElementById('topbarMusic');
        this.topbarMusicSwap = document.getElementById('topbarMusicSwap');
        this.musicFileInput = document.getElementById('musicFileInput');
        this.musicEnabled = localStorage.getItem('jarvis-music-enabled') !== 'false'; // ligada por padrão
        this.customMusicObjectUrl = null; // faixa trocada pelo botão 📁 — só dura a sessão atual
        this.musicFileMissing = false; // evita spam de aviso se o mp3 não existir
        // Playlist (Settings Page, SCRUM-22) — { name, url } por faixa adicionada; só dura a
        // sessão atual (arquivos locais, não ficam salvos no navegador entre recarregamentos).
        this.musicPlaylist = [];
        this.musicPlaylistIndex = -1;
        this.vuMusic = document.getElementById('vuMusic');
        this.musicVolumeSlider = document.getElementById('musicVolumeSlider');
        this.musicVolumeValue = document.getElementById('musicVolumeValue');
        this.musicMuteBtn = document.getElementById('musicMuteBtn');
        // Volume REAL (0..1) da música — o que o slider "VOLUME" mostra é exatamente o que toca,
        // sem multiplicar por nada. Começa em BACKGROUND_MUSIC_DEFAULT_VOLUME (40%) e fica salvo
        // entre sessões a partir da primeira vez que você mexer no slider.
        const savedVolume = parseInt(localStorage.getItem('jarvis-music-volume'), 10);
        this.musicVolume = Number.isFinite(savedVolume) ? savedVolume / 100 : BACKGROUND_MUSIC_DEFAULT_VOLUME;
        this.musicMuted = localStorage.getItem('jarvis-music-muted') === 'true';
        this.musicAudioContext = null; // Web Audio API — só pro VU-meter da música
        this.musicAnalyser = null;
        this.musicAnalyserData = null;

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

        // Login (SCRUM-56) — o guard em <head> do index.html já garantiu que existe algum
        // token salvo antes de chegar aqui; isso só confirma que ele ainda é válido (não
        // expirou) e mostra o nome de quem está logado.
        this.renderLoggedInUser();
        this.checkAuthSession();

        this.updateWorldClocks();
        setInterval(() => this.updateWorldClocks(), 30000);
        this.loadWeather();

        // Check-in real das capacidades — atualiza rápido (dado local no backend, sem custo).
        this.loadStatusCheckin();
        setInterval(() => this.loadStatusCheckin(), 20000);
        // Créditos — chama APIs pagas de terceiros (ElevenLabs/Anthropic), atualiza mais devagar
        // pra não gerar tráfego desnecessário nelas.
        this.loadStatusCredits();
        setInterval(() => this.loadStatusCredits(), 5 * 60000);

        // Heartbeat de presença — a cada 20s enquanto a aba está aberta (ver GET/POST
        // /status/presence no backend). Um heartbeat perdido não faz a sessão sumir da
        // contagem (janela de 45s no backend), mas evita mandar quando a aba está em segundo
        // plano (economiza sem afetar a contagem real, já que quem está mesmo interagindo
        // costuma estar com a aba em foco).
        this.loadPresenceHeartbeat();
        setInterval(() => this.loadPresenceHeartbeat(), 20000);

        this.setupBackgroundMusic();
        this.setupWakeWordListener();
        this.setupVisionPreviewDrag();
        this.setupSettingsModal();
    }

    // ------------------------------------------------------------------
    // "OPTICAL FEED" arrastável — segura pela label e solta em qualquer lugar da tela; se soltar
    // sobre o quadro inferior esquerdo (.left-side), fixa numa posição pré-definida ali (dock).
    // Posição fica salva entre sessões.
    // ------------------------------------------------------------------

    setupVisionPreviewDrag() {
        if (!this.visionPreview) return;
        const handle = this.visionPreview.querySelector('.vision-preview-label');
        const dockZone = document.querySelector('.hud-panel.left-side');
        if (!handle) return;

        // Onde o box se fixa dentro do quadro inferior esquerdo, ao ser solto ali — ajuste aqui
        // se quiser noutro canto.
        const DOCK_MARGIN_RIGHT = 12;
        const DOCK_MARGIN_TOP = 12;

        const applyDockedPosition = () => {
            if (!dockZone) return;
            const zoneRect = dockZone.getBoundingClientRect();
            const left = zoneRect.right - this.visionPreview.offsetWidth - DOCK_MARGIN_RIGHT;
            const top = zoneRect.top + DOCK_MARGIN_TOP;
            this.visionPreview.style.left = `${left}px`;
            this.visionPreview.style.top = `${top}px`;
        };

        const saved = JSON.parse(localStorage.getItem('jarvis-vision-preview-pos') || 'null');
        if (saved?.docked) {
            this.visionPreview.classList.add('docked');
            // Recalcula contra o quadro atual (a tela pode ter outro tamanho desde a última vez)
            requestAnimationFrame(applyDockedPosition);
        } else if (saved) {
            this.visionPreview.style.left = `${saved.left}px`;
            this.visionPreview.style.top = `${saved.top}px`;
        } else {
            // Sem preferência salva: cai no mesmo lugar visual de antes (canto superior esquerdo
            // do visualizador central), calculado uma vez no carregamento.
            const centerPanel = document.querySelector('.hud-panel.center');
            if (centerPanel) {
                const rect = centerPanel.getBoundingClientRect();
                this.visionPreview.style.left = `${rect.left + 6}px`;
                this.visionPreview.style.top = `${rect.top + 6}px`;
            }
        }

        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const isOverDockZone = (clientX, clientY) => {
            if (!dockZone) return false;
            const zoneRect = dockZone.getBoundingClientRect();
            return clientX >= zoneRect.left && clientX <= zoneRect.right
                && clientY >= zoneRect.top && clientY <= zoneRect.bottom;
        };

        const onPointerMove = (event) => {
            if (!dragging) return;
            const maxLeft = window.innerWidth - this.visionPreview.offsetWidth;
            const maxTop = window.innerHeight - this.visionPreview.offsetHeight;
            const left = Math.max(0, Math.min(maxLeft, event.clientX - offsetX));
            const top = Math.max(0, Math.min(maxTop, event.clientY - offsetY));
            this.visionPreview.style.left = `${left}px`;
            this.visionPreview.style.top = `${top}px`;

            if (dockZone) {
                dockZone.classList.toggle('drop-target-active', isOverDockZone(event.clientX, event.clientY));
            }
        };

        const onPointerUp = (event) => {
            if (!dragging) return;
            dragging = false;
            this.visionPreview.classList.remove('dragging');
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);

            const docked = isOverDockZone(event.clientX, event.clientY);
            if (dockZone) dockZone.classList.remove('drop-target-active');

            this.visionPreview.classList.toggle('docked', docked);
            if (docked) {
                applyDockedPosition();
                this.pushLog('[VISÃO] OPTICAL FEED fixado no quadro');
            }

            localStorage.setItem('jarvis-vision-preview-pos', JSON.stringify({
                left: parseFloat(this.visionPreview.style.left),
                top: parseFloat(this.visionPreview.style.top),
                docked,
            }));
        };

        handle.addEventListener('pointerdown', (event) => {
            dragging = true;
            const rect = this.visionPreview.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            this.visionPreview.classList.add('dragging');
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            event.preventDefault();
        });

        // Se a janela for redimensionada (maximizar/restaurar, trocar de monitor), reancora: preso
        // no quadro continua preso (o quadro pode ter mudado de lugar), e solto livre só é mantido
        // dentro da tela (evita ficar preso fora da área visível).
        window.addEventListener('resize', () => {
            if (this.visionPreview.classList.contains('docked')) {
                applyDockedPosition();
                return;
            }
            const maxLeft = Math.max(0, window.innerWidth - this.visionPreview.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - this.visionPreview.offsetHeight);
            const left = Math.min(maxLeft, parseFloat(this.visionPreview.style.left) || 0);
            const top = Math.min(maxTop, parseFloat(this.visionPreview.style.top) || 0);
            this.visionPreview.style.left = `${left}px`;
            this.visionPreview.style.top = `${top}px`;
        });
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
        // Com playlist (2+ faixas via Settings Page), cada faixa toca uma vez e passa pra
        // próxima ao terminar — sem playlist, mantém o comportamento original (loop na mesma
        // faixa, `loop` já está no <audio> do index.html).
        this.bgMusic.addEventListener('ended', () => {
            if (this.musicPlaylist.length < 2) return;
            this.playPlaylistTrack((this.musicPlaylistIndex + 1) % this.musicPlaylist.length);
        });

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

        // Slider de volume — o valor mostrado É o volume real (40% no slider = 40% de volume).
        // Aplica na hora, mesmo com a música já tocando (sem esperar a próxima conversa).
        if (this.musicVolumeSlider) {
            this.musicVolumeSlider.value = String(Math.round(this.musicVolume * 100));
            this.updateMusicVolumeLabel();
            this.musicVolumeSlider.addEventListener('input', () => {
                const percent = Number(this.musicVolumeSlider.value);
                this.musicVolume = percent / 100;
                localStorage.setItem('jarvis-music-volume', String(percent));
                // Mexer no slider manualmente desmuta — comportamento padrão de qualquer player
                if (this.musicMuted) this.setMusicMuted(false);
                this.updateMusicVolumeLabel();
                if (this.bgMusic && !this.bgMusic.paused) {
                    this.bgMusic.volume = this.targetMusicVolume();
                }
            });
        }

        // Botão de mute — silencia sem perder o valor do slider, pra restaurar depois
        this.syncMuteButton();
        if (this.musicMuteBtn) {
            this.musicMuteBtn.addEventListener('click', () => this.setMusicMuted(!this.musicMuted));
        }
    }

    setMusicMuted(muted) {
        this.musicMuted = muted;
        localStorage.setItem('jarvis-music-muted', String(muted));
        this.syncMuteButton();
        if (this.bgMusic && !this.bgMusic.paused) {
            this.bgMusic.volume = this.targetMusicVolume();
        }
    }

    syncMuteButton() {
        if (!this.musicMuteBtn) return;
        this.musicMuteBtn.classList.toggle('muted', this.musicMuted);
        this.musicMuteBtn.innerHTML = this.musicMuted ? '&#128263;' : '&#128266;';
    }

    updateMusicVolumeLabel() {
        if (this.musicVolumeValue) {
            this.musicVolumeValue.textContent = `${Math.round(this.musicVolume * 100)}%`;
        }
    }

    // Volume real de reprodução — exatamente o que o slider "VOLUME" mostra, sem multiplicar por
    // nada (assim dá pra saber, olhando o slider, o volume de verdade que está tocando). Zero se
    // mutado, sem alterar o valor salvo do slider.
    targetMusicVolume() {
        return this.musicMuted ? 0 : this.musicVolume;
    }

    syncMusicButton() {
        if (!this.topbarMusic) return;
        this.topbarMusic.classList.toggle('muted', !this.musicEnabled);
    }

    // Liga o Web Audio API só pra alimentar o VU-meter da música (getByteFrequencyData) — o
    // elemento <audio> continua tocando normalmente, o analyser só "escuta" o mesmo sinal.
    // Precisa ser criado depois de um gesto do usuário (autoplay policy), então é chamado de
    // dentro de playBackgroundMusic() na primeira vez que a música toca.
    ensureMusicAnalyser() {
        if (this.musicAnalyser || !this.bgMusic) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.musicAudioContext = new AudioContextClass();
            const source = this.musicAudioContext.createMediaElementSource(this.bgMusic);
            this.musicAnalyser = this.musicAudioContext.createAnalyser();
            this.musicAnalyser.fftSize = 256;
            this.musicAnalyserData = new Uint8Array(this.musicAnalyser.frequencyBinCount);
            // O analyser só "escuta" o sinal — precisa continuar até o destination, senão a
            // música fica muda (createMediaElementSource desvia o áudio do output padrão).
            source.connect(this.musicAnalyser);
            this.musicAnalyser.connect(this.musicAudioContext.destination);
        } catch (error) {
            console.warn('VU-meter da música indisponível:', error.message);
        }
    }

    // Toca a música de fundo com um fade-in suave até o volume alvo (25% × slider). Não faz nada
    // se a música estiver desligada no botão, ou se não houver arquivo configurado/carregado.
    playBackgroundMusic() {
        if (!this.bgMusic || !this.musicEnabled || this.musicFileMissing) return;
        if (!this.bgMusic.src) return;
        this.ensureMusicAnalyser();
        if (this.musicAudioContext?.state === 'suspended') this.musicAudioContext.resume();
        this.bgMusic.currentTime = 0;
        this.bgMusic.volume = 0;
        this.bgMusic.play().catch((error) => {
            console.warn('Não foi possível tocar a música de fundo:', error.message);
        });
        const fadeStep = () => {
            if (!this.bgMusic || this.bgMusic.paused) return;
            const target = this.targetMusicVolume();
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
        if (this.vuMusic) this.vuMusic.style.width = '0%';
    }

    // ------------------------------------------------------------------
    // Playlist de música (Settings Page, SCRUM-22)
    // ------------------------------------------------------------------

    // Acrescenta arquivos locais escolhidos à playlist (não substitui — cada chamada soma).
    addMusicFiles(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        files.forEach((file) => {
            this.musicPlaylist.push({ name: file.name, url: URL.createObjectURL(file) });
        });
        this.renderSettingsPlaylist();
        this.pushLog(`[MÚSICA] ${files.length} faixa(s) adicionada(s) à playlist`);
        // Primeira faixa adicionada nesta sessão (playlist estava vazia): já toca ela.
        if (this.musicPlaylistIndex === -1) this.playPlaylistTrack(0);
    }

    playPlaylistTrack(index) {
        const track = this.musicPlaylist[index];
        if (!track || !this.bgMusic) return;
        if (this.customMusicObjectUrl && this.customMusicObjectUrl !== track.url) {
            URL.revokeObjectURL(this.customMusicObjectUrl);
        }
        this.musicPlaylistIndex = index;
        this.customMusicObjectUrl = track.url;
        this.musicFileMissing = false;
        // 2+ faixas: cada uma toca uma vez e passa pra próxima (ver listener 'ended' em
        // setupBackgroundMusic). Só 1 faixa: comportamento original, fica em loop.
        this.bgMusic.loop = this.musicPlaylist.length < 2;
        this.bgMusic.src = track.url;
        this.pushLog(`[MÚSICA] Tocando "${track.name}"`);
        this.renderSettingsPlaylist();
        if (this.musicEnabled && this.conversationActive) this.playBackgroundMusic();
    }

    removeMusicTrack(index) {
        const track = this.musicPlaylist[index];
        if (!track) return;
        URL.revokeObjectURL(track.url);
        this.musicPlaylist.splice(index, 1);
        if (this.musicPlaylistIndex === index) {
            this.musicPlaylistIndex = -1;
            this.customMusicObjectUrl = null;
            this.bgMusic.loop = true;
            this.bgMusic.src = BACKGROUND_MUSIC_SRC;
            this.stopBackgroundMusic();
        } else if (this.musicPlaylistIndex > index) {
            this.musicPlaylistIndex -= 1;
        }
        this.renderSettingsPlaylist();
    }

    renderSettingsPlaylist() {
        if (!this.settingsPlaylist) return;
        if (this.musicPlaylist.length === 0) {
            this.settingsPlaylist.innerHTML = '<li style="opacity:0.5">Nenhuma faixa adicionada — usando a faixa padrão.</li>';
            return;
        }
        this.settingsPlaylist.innerHTML = this.musicPlaylist
            .map((track, index) => `
                <li class="${index === this.musicPlaylistIndex ? 'playing' : ''}" data-index="${index}">
                    <span class="settings-playlist-name" data-play="${index}">${index === this.musicPlaylistIndex ? '▶ ' : ''}${this.escapeHtml(track.name)}</span>
                    <button class="settings-item-remove" data-remove="${index}" title="Remover">&times;</button>
                </li>
            `)
            .join('');
    }

    // ------------------------------------------------------------------
    // Settings Page (SCRUM-20/21/22/23) — modal com 3 seções independentes:
    // frases de ativação, playlist de música, modelo de IA do orquestrador.
    // ------------------------------------------------------------------

    setupSettingsModal() {
        this.renderSettingsPhrases();
        this.renderSettingsPlaylist();

        if (this.topbarSettings) {
            this.topbarSettings.addEventListener('click', () => this.openSettingsModal());
        }
        if (this.settingsClose) {
            this.settingsClose.addEventListener('click', () => this.closeSettingsModal());
        }
        if (this.settingsOverlay) {
            // Clique fora do card fecha (mesmo padrão de outros overlays do HUD).
            this.settingsOverlay.addEventListener('click', (event) => {
                if (event.target === this.settingsOverlay) this.closeSettingsModal();
            });
        }
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.settingsOverlay && !this.settingsOverlay.hidden) {
                this.closeSettingsModal();
            }
        });

        // Seção 1: frases de ativação
        if (this.settingsPhraseAdd && this.settingsPhraseInput) {
            const addPhrase = () => {
                const phrase = this.settingsPhraseInput.value.trim();
                if (!phrase) return;
                if (this.wakePhrases.some((p) => p.toLowerCase() === phrase.toLowerCase())) {
                    this.settingsPhraseInput.value = '';
                    return;
                }
                this.wakePhrases.push(phrase);
                this.saveWakePhrases();
                this.renderSettingsPhrases();
                this.renderWakePhrasesPopover();
                this.settingsPhraseInput.value = '';
                this.pushLog(`[CONFIG] Frase de ativação adicionada: "${phrase}"`);
            };
            this.settingsPhraseAdd.addEventListener('click', addPhrase);
            this.settingsPhraseInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') addPhrase();
            });
        }
        if (this.settingsPhraseList) {
            this.settingsPhraseList.addEventListener('click', (event) => {
                const index = event.target.getAttribute('data-remove');
                if (index === null) return;
                this.wakePhrases.splice(Number(index), 1);
                this.saveWakePhrases();
                this.renderSettingsPhrases();
                this.renderWakePhrasesPopover();
            });
        }
        if (this.settingsPhraseReset) {
            this.settingsPhraseReset.addEventListener('click', () => {
                this.wakePhrases = [...DEFAULT_WAKE_PHRASES];
                this.saveWakePhrases();
                this.renderSettingsPhrases();
                this.renderWakePhrasesPopover();
                this.pushLog('[CONFIG] Frases de ativação restauradas para o padrão');
            });
        }

        // Seção 2: playlist de música
        if (this.settingsMusicAdd && this.settingsMusicInput) {
            this.settingsMusicAdd.addEventListener('click', () => this.settingsMusicInput.click());
            this.settingsMusicInput.addEventListener('change', () => {
                this.addMusicFiles(this.settingsMusicInput.files);
                this.settingsMusicInput.value = ''; // permite re-adicionar o mesmo arquivo depois
            });
        }
        if (this.settingsPlaylist) {
            this.settingsPlaylist.addEventListener('click', (event) => {
                const playIndex = event.target.getAttribute('data-play');
                const removeIndex = event.target.getAttribute('data-remove');
                if (playIndex !== null) this.playPlaylistTrack(Number(playIndex));
                if (removeIndex !== null) this.removeMusicTrack(Number(removeIndex));
            });
        }

        // Seção 3: modelo de IA — só carrega quando o modal abre (evita chamada à toa).
        // Trocar o provedor sozinho, sem atualizar o campo de modelo, permite salvar uma
        // combinação inválida (ex.: provedor "local" com o campo ainda em "claude-opus-5")
        // — foi exatamente isso que aconteceu em produção e derrubou TODAS as tools (Gmail,
        // Calendar, Contacts) com 500, porque não havia servidor local nenhum. Preenche um
        // modelo padrão sensato pro provedor escolhido sempre que o select mudar — o campo
        // continua editável livremente, só evita salvar por engano com o valor errado.
        this.syncLLMProviderUI();
        if (this.settingsLLMProvider && this.settingsLLMModel) {
            this.settingsLLMProvider.addEventListener('change', () => {
                const defaults = { anthropic: 'claude-opus-5', local: 'qwen3-4b-thinking' };
                this.settingsLLMModel.value = defaults[this.settingsLLMProvider.value] || '';
                this.syncLLMProviderUI();
            });
        }
        // Preset de servidor (SCRUM-59): escolher um endereço conhecido preenche o campo de
        // texto direto; "Personalizado..." libera o campo pra digitar (ex.: Tailscale do Mac).
        if (this.settingsLLMBaseUrlPreset && this.settingsLLMBaseUrl) {
            this.settingsLLMBaseUrlPreset.addEventListener('change', () => {
                const value = this.settingsLLMBaseUrlPreset.value;
                if (value) {
                    this.settingsLLMBaseUrl.value = value;
                    this.settingsLLMBaseUrlCustomRow.hidden = true;
                } else {
                    this.settingsLLMBaseUrlCustomRow.hidden = false;
                    this.settingsLLMBaseUrl.value = '';
                    this.settingsLLMBaseUrl.focus();
                }
            });
        }
    }

    // Mostra/esconde a linha de "Servidor" e o aviso de risco conforme o provedor escolhido —
    // chamado tanto ao trocar o select quanto ao carregar o valor salvo (loadLLMSettings).
    syncLLMProviderUI() {
        const isLocal = this.settingsLLMProvider?.value === 'local';
        if (this.settingsLLMBaseUrlRow) this.settingsLLMBaseUrlRow.hidden = !isLocal;
        const warning = document.getElementById('settingsLLMLocalWarning');
        if (warning) warning.hidden = !isLocal;
    }

    renderSettingsPhrases() {
        if (!this.settingsPhraseList) return;
        this.settingsPhraseList.innerHTML = this.wakePhrases
            .map((phrase, index) => `
                <li>
                    <span>"${this.escapeHtml(phrase)}"</span>
                    <button class="settings-item-remove" data-remove="${index}" title="Remover">&times;</button>
                </li>
            `)
            .join('');
    }

    openSettingsModal() {
        if (!this.settingsOverlay) return;
        this.settingsOverlay.hidden = false;
        this.loadLLMSettings();
    }

    closeSettingsModal() {
        if (this.settingsOverlay) this.settingsOverlay.hidden = true;
    }

    // Modelo de IA do orquestrador (SCRUM-23) — GET/PUT /settings/llm no backend, protegido pelo
    // mesmo token do login (SCRUM-56). Qualquer usuário logado vê o modelo atual; só admin pode
    // trocar (o campo/botão ficam desabilitados pros demais, com aviso no lugar da dica).
    async loadLLMSettings() {
        if (!this.settingsLLMProvider || !this.settingsLLMModel) return;
        const token = localStorage.getItem('jarvis-auth-token');
        let isAdmin = false;
        try {
            const user = JSON.parse(localStorage.getItem('jarvis-auth-user') || '{}');
            isAdmin = user.role === 'admin';
        } catch (error) {
            // ignora — trata como não-admin
        }

        this.settingsLLMProvider.disabled = !isAdmin;
        this.settingsLLMModel.disabled = !isAdmin;
        if (this.settingsLLMBaseUrlPreset) this.settingsLLMBaseUrlPreset.disabled = !isAdmin;
        if (this.settingsLLMBaseUrl) this.settingsLLMBaseUrl.disabled = !isAdmin;
        if (this.settingsLLMSave) this.settingsLLMSave.disabled = !isAdmin;
        const hint = document.getElementById('settingsLLMHint');
        if (hint && !isAdmin) {
            hint.textContent = 'Só o administrador pode trocar o modelo de IA — você pode ver qual está ativo.';
        }

        if (this.settingsLLMStatus) this.settingsLLMStatus.textContent = '';
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/settings/llm`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.settingsLLMProvider.value = data.llm_provider;
            this.settingsLLMModel.value = data.llm_model;
            if (this.settingsLLMBaseUrl) this.settingsLLMBaseUrl.value = data.llm_base_url || '';
            if (this.settingsLLMBaseUrlPreset) {
                // Se o endereço salvo bater com um preset conhecido, seleciona ele; senão cai
                // em "Personalizado..." com o campo de texto já preenchido.
                const matchesPreset = Array.from(this.settingsLLMBaseUrlPreset.options)
                    .some((opt) => opt.value && opt.value === data.llm_base_url);
                this.settingsLLMBaseUrlPreset.value = matchesPreset ? data.llm_base_url : '';
                if (this.settingsLLMBaseUrlCustomRow) this.settingsLLMBaseUrlCustomRow.hidden = matchesPreset;
            }
            this.syncLLMProviderUI();
        } catch (error) {
            console.warn('Não deu pra carregar o modelo de IA atual:', error.message);
            if (this.settingsLLMStatus) {
                this.settingsLLMStatus.textContent = 'Não foi possível carregar';
                this.settingsLLMStatus.classList.add('error');
            }
        }

        if (this.settingsLLMSave && isAdmin) {
            this.settingsLLMSave.onclick = () => this.saveLLMSettings();
        }
    }

    async saveLLMSettings() {
        const token = localStorage.getItem('jarvis-auth-token');
        const provider = this.settingsLLMProvider.value;
        const model = this.settingsLLMModel.value.trim();
        const baseUrl = provider === 'local' ? (this.settingsLLMBaseUrl?.value.trim() || '') : '';
        if (!model) return;
        if (provider === 'local' && !baseUrl) {
            if (this.settingsLLMStatus) {
                this.settingsLLMStatus.textContent = 'Informe o endereço do servidor';
                this.settingsLLMStatus.classList.add('error');
            }
            return;
        }

        this.settingsLLMSave.disabled = true;
        if (this.settingsLLMStatus) {
            this.settingsLLMStatus.textContent = 'Salvando...';
            this.settingsLLMStatus.classList.remove('error');
        }
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/settings/llm`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ provider, model, base_url: baseUrl }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || `HTTP ${response.status}`);
            }
            if (this.settingsLLMStatus) this.settingsLLMStatus.textContent = 'Salvo ✓';
            this.pushLog(`[CONFIG] Modelo de IA trocado para ${provider}/${model}`);
            // Reflete na hora no painel de créditos (SCRUM-58) — sem esperar o polling de 5min,
            // pra confirmar visualmente que a troca pegou de verdade.
            this.loadStatusCredits();
        } catch (error) {
            if (this.settingsLLMStatus) {
                this.settingsLLMStatus.textContent = error.message || 'Falha ao salvar';
                this.settingsLLMStatus.classList.add('error');
            }
        } finally {
            this.settingsLLMSave.disabled = false;
        }
    }

    // Frase falada pra abrir a Settings Page — mesmo padrão de maybeHandleFullscreenCommand.
    static SETTINGS_OPEN_REGEX = /abrir\s*(as\s*)?configura[çc][õo]es|abre\s*(as\s*)?configura[çc][õo]es|mostrar\s*(as\s*)?configura[çc][õo]es/i;

    maybeHandleSettingsCommand(message) {
        if (JARVISInterface.SETTINGS_OPEN_REGEX.test(message)) this.openSettingsModal();
    }

    // ------------------------------------------------------------------
    // Ativação por voz (wake word)
    // ------------------------------------------------------------------

    // Normaliza acentos/pontuação pra comparar com this.wakePhrases sem depender de o reconhecedor
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

    // Carrega as frases de ativação salvas (Settings Page, SCRUM-21) ou a lista padrão se o
    // usuário nunca customizou nada. this.wakePhrases é a fonte única a partir daqui — tanto pro
    // reconhecimento (startWakeWordListener) quanto pra exibição (popover e Settings Page).
    loadWakePhrases() {
        try {
            const saved = JSON.parse(localStorage.getItem(WAKE_PHRASES_STORAGE_KEY));
            if (Array.isArray(saved) && saved.length > 0) return saved;
        } catch (error) {
            console.warn('Não deu pra ler as frases de ativação salvas:', error.message);
        }
        return [...DEFAULT_WAKE_PHRASES];
    }

    saveWakePhrases() {
        localStorage.setItem(WAKE_PHRASES_STORAGE_KEY, JSON.stringify(this.wakePhrases));
    }

    // Popover com a lista de frases — reflete this.wakePhrases, então nunca fica desatualizada
    // em relação ao que a Settings Page salvou. Funciona independente de o navegador suportar
    // ativação por voz, já que é só informativo.
    renderWakePhrasesPopover() {
        if (!this.wakePhrasesList) return;
        this.wakePhrasesList.innerHTML = this.wakePhrases
            .map((phrase) => `<li>"${this.escapeHtml(phrase)}"</li>`)
            .join('');
    }

    setupWakePhrasesPopover() {
        this.renderWakePhrasesPopover();
        if (!this.topbarWakeInfo || !this.wakePhrasesPopover) return;
        this.topbarWakeInfo.addEventListener('click', (event) => {
            event.stopPropagation();
            this.wakePhrasesPopover.hidden = !this.wakePhrasesPopover.hidden;
        });
        document.addEventListener('click', (event) => {
            if (this.wakePhrasesPopover.hidden) return;
            if (this.wakePhrasesPopover.contains(event.target)) return;
            this.wakePhrasesPopover.hidden = true;
        });
    }

    setupWakeWordListener() {
        this.setupWakePhrasesPopover();

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
        // interimResults ligado: o Chrome costuma "fechar" (isFinal) um resultado no meio da frase
        // quando você faz uma pausa natural depois da vírgula — ex.: "Jarvis," [pausa] "ativar"
        // vira DOIS resultados finais separados, e nenhum deles sozinho batia com a frase completa.
        // Por isso mantemos um buffer contínuo (finais + o interino mais recente) e comparamos a
        // frase contra esse buffer inteiro, não só contra o último resultado.
        recognizer.interimResults = true;
        this.wakeTranscriptBuffer = '';

        recognizer.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    this.wakeTranscriptBuffer += ` ${result[0].transcript}`;
                    // Buffer não cresce pra sempre — só precisamos do suficiente pra caber a
                    // maior frase configurada, com folga.
                    if (this.wakeTranscriptBuffer.length > 200) {
                        this.wakeTranscriptBuffer = this.wakeTranscriptBuffer.slice(-200);
                    }
                }
            }

            // Texto interino do resultado ainda não fechado (se houver) — dá pra casar a frase
            // mesmo antes do Chrome "fechar" esse trecho como final.
            const interim = Array.from(event.results)
                .filter((result) => !result.isFinal)
                .map((result) => result[0].transcript)
                .join(' ');

            const rawHeard = `${this.wakeTranscriptBuffer} ${interim}`;
            const heard = JARVISInterface.normalizeSpeech(rawHeard);
            const matchedPhrase = this.wakePhrases.find((phrase) => heard.includes(JARVISInterface.normalizeSpeech(phrase)));
            if (matchedPhrase) {
                this.pushLog(`[VOZ] Frase de ativação reconhecida: "${matchedPhrase}"`);
                this.wakeTranscriptBuffer = '';
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

    // Check-in real de Email/Calendar/Contacts (GET /status/checkin) — dado de uso real
    // rastreado no backend (não um ping sintético), ver status_tracker.py. Nasceu do SCRUM-52:
    // o Jarvis dizia "não tenho acesso" por voz sem dar nenhum jeito de confirmar rápido se
    // era bug de verdade ou o modelo alucinando.
    async loadStatusCheckin() {
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/status/checkin`);
            const data = await response.json();
            for (const capability of this.checkinCapabilities) {
                const info = data[capability];
                const dot = document.getElementById(`checkinDot-${capability}`);
                const detail = document.getElementById(`checkinDetail-${capability}`);
                if (!dot || !detail || !info) continue;

                dot.classList.remove('status-ok', 'status-erro');
                if (info.status === 'ok') {
                    dot.classList.add('status-ok');
                    detail.textContent = `${Math.round(info.success_rate * 100)}% ok`;
                } else if (info.status === 'erro') {
                    dot.classList.add('status-erro');
                    detail.textContent = 'falhou';
                } else {
                    detail.textContent = 'sem dados';
                }
            }
        } catch (error) {
            console.warn('Falha ao buscar check-in do backend:', error.message);
        }
    }

    // Consumo das APIs pagas (GET /status/credits) — ElevenLabs (uso real via API) e Anthropic
    // (gasto do mês via Admin API, se configurada no backend).
    async loadStatusCredits() {
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/status/credits`);
            const data = await response.json();

            const eleven = data.elevenlabs;
            if (eleven?.available) {
                this.creditsValueEleven.textContent = `${eleven.percent_used}%`;
                this.creditsFillEleven.style.width = `${Math.min(eleven.percent_used, 100)}%`;
                this.creditsFillEleven.classList.toggle('credits-warning', eleven.percent_used >= 80);
            } else {
                this.creditsValueEleven.textContent = 'indisponível';
            }

            const anthropic = data.anthropic;
            if (anthropic?.available) {
                this.creditsValueAnthropic.textContent = `US$ ${anthropic.spend_usd.toFixed(2)}`;
            } else {
                this.creditsValueAnthropic.textContent = 'indisponível';
            }

            if (this.creditsValueModel && data.llm) {
                this.creditsValueModel.textContent = data.llm.model;
                this.creditsValueModel.title = `Provedor: ${data.llm.provider}`;
            }
        } catch (error) {
            console.warn('Falha ao buscar créditos do backend:', error.message);
        }
    }

    // Heartbeat de presença — só manda com a aba em foco (visibilityState 'visible'), pra não
    // contar abas esquecidas em segundo plano como "sessão ativa" à toa. Não identifica a
    // pessoa (sem login) — só quantas abas/dispositivos distintos estão realmente com o HUD
    // na tela agora.
    async loadPresenceHeartbeat() {
        if (document.visibilityState !== 'visible') return;
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/status/presence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: this.presenceSessionId }),
            });
            const data = await response.json();
            if (this.presenceValue) this.presenceValue.textContent = data.active_sessions;
        } catch (error) {
            console.warn('Falha ao enviar heartbeat de presença:', error.message);
        }
    }

    // Mostra o nome de quem logou (salvo no login, ver login.js) — sem chamada ao backend,
    // só lê o que já foi guardado no localStorage.
    renderLoggedInUser() {
        const raw = localStorage.getItem('jarvis-auth-user');
        if (!raw || !this.topbarUserName) return;
        try {
            const user = JSON.parse(raw);
            this.topbarUserName.textContent = user.name || user.username || '';
        } catch (error) {
            console.warn('Não deu pra ler o usuário logado:', error.message);
        }
    }

    // Confirma que o token salvo ainda é válido (não expirou) — se não for, limpa a sessão e
    // manda pra login.html. O guard síncrono em <head> do index.html só checa "existe token
    // salvo", não se ele ainda vale; essa checagem completa. Roda em segundo plano, não trava
    // o carregamento do HUD.
    async checkAuthSession() {
        const token = localStorage.getItem('jarvis-auth-token');
        if (!token) {
            window.location.replace('login.html');
            return;
        }
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) this.logout();
        } catch (error) {
            // Backend fora do ar não é motivo pra deslogar — só loga o aviso e segue.
            console.warn('Não deu pra validar a sessão agora:', error.message);
        }
    }

    logout() {
        localStorage.removeItem('jarvis-auth-token');
        localStorage.removeItem('jarvis-auth-user');
        window.location.replace('login.html');
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
            ? `A chance de chuva hoje é de ${rainChance}%. `
            : 'A previsão de chuva está indisponível no momento. ';

        // Este texto é injetado como fala LITERAL (substituição de {{daily_briefing}} na
        // "Primeira mensagem" do agente, feita pelo SDK — não passa pelo LLM, então a
        // pontuação aqui É a prosódia final). Achado real: a versão antiga ("agora está
        // 23°C, céu limpo, com 40% de chance de chuva hoje") empilhava 3 vírgulas logo depois
        // do símbolo de grau — o TTS engasgava bem no início, exatamente ao falar a
        // temperatura. Frases curtas, "graus" por extenso (sem o símbolo °) e sem vírgulas
        // grudadas no número resolvem — mesma informação, só mais fácil de sintetizar.
        // Também removida a menção a "ainda não tenho acesso à agenda": ficou desatualizada
        // depois da migração do Calendar pro MCP (SCRUM-18) — o Jarvis já acessa a agenda.
        return `Antes de mais nada, Senhor. Agora está ${temp} graus, com ${condition}. ` + chuvaTexto;
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
        // Sair (SCRUM-56) — limpa a sessão salva e volta pro login.
        if (this.topbarLogout) {
            this.topbarLogout.addEventListener('click', () => this.logout());
        }

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

        // TELA CHEIA: botão na topbar + reage a ESC/F11 (o navegador sai do fullscreen sozinho
        // nesses casos, então escutamos o evento em vez de confiar só no estado que setamos).
        if (this.topbarFullscreen) {
            this.topbarFullscreen.addEventListener('click', () => this.toggleFullscreen());
        }
        document.addEventListener('fullscreenchange', () => this.syncFullscreenButton());
        this.syncFullscreenButton();
    }

    async toggleGestureCanvas() {
        if (this.gestureOverlay.hidden) await this.openGestureCanvas();
        else this.closeGestureCanvas();
    }

    // Entra/sai da tela cheia do navegador. Chamado pelo botão da topbar e pelo comando de voz
    // (ver maybeHandleFullscreenCommand, disparado a partir da sua própria fala transcrita).
    async setFullscreen(shouldBeFullscreen) {
        try {
            if (shouldBeFullscreen && !document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
                this.pushLog('[SISTEMA] Tela cheia ativada');
            } else if (!shouldBeFullscreen && document.fullscreenElement) {
                await document.exitFullscreen();
                this.pushLog('[SISTEMA] Tela cheia desativada');
            }
        } catch (error) {
            console.error('Erro ao alternar tela cheia:', error);
            this.pushLog('[ERRO] Não consegui alternar a tela cheia (o navegador pode ter bloqueado)');
        }
    }

    toggleFullscreen() {
        this.setFullscreen(!document.fullscreenElement);
    }

    // Mantém o botão (ícone/rótulo/estado "active") sincronizado com o estado real do navegador,
    // já que ESC ou F11 saem do fullscreen sem passar pelo nosso botão.
    syncFullscreenButton() {
        if (!this.topbarFullscreen) return;
        const isFullscreen = !!document.fullscreenElement;
        this.topbarFullscreen.classList.toggle('active', isFullscreen);
        if (this.topbarFullscreenIcon) this.topbarFullscreenIcon.textContent = isFullscreen ? '⛶' : '⛶';
        if (this.topbarFullscreenLabel) this.topbarFullscreenLabel.textContent = isFullscreen ? 'TELA NORMAL' : 'TELA CHEIA';
        this.topbarFullscreen.title = isFullscreen
            ? "Voltar ao tamanho normal (ou diga 'Jarvis, sair da tela cheia')"
            : "Tela cheia (ou diga 'Jarvis, tela cheia')";
    }

    // Frases faladas por você que pedem pra entrar ou sair da tela cheia. Chamado a cada
    // transcrição sua (mesmo padrão do maybeAutoLook) — nada aqui depende de uma ferramenta do
    // agente, é reconhecido localmente no navegador.
    static FULLSCREEN_ON_REGEX = /tela\s*cheia|modo\s*tela\s*cheia|fullscreen/i;
    static FULLSCREEN_OFF_REGEX = /(sair|sai|tirar|voltar)\s*(da|de)?\s*tela\s*cheia|tela\s*normal|modo\s*normal/i;

    maybeHandleFullscreenCommand(message) {
        if (JARVISInterface.FULLSCREEN_OFF_REGEX.test(message)) {
            this.setFullscreen(false);
        } else if (JARVISInterface.FULLSCREEN_ON_REGEX.test(message)) {
            this.setFullscreen(true);
        }
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
        // Guarda de diagnóstico (achado real: 1ª chamada de uma conversa funciona, chamadas
        // seguintes silenciosamente não faziam nada — sem log nenhum, nem no console nem no
        // painel). Cada saída antecipada agora deixa rastro, pra não repetir a investigação às
        // cegas da próxima vez.
        if (!this.visionStream || !this.conversation) {
            console.warn('lookAtCamera: abortado — sem stream de câmera ou conversa ativa', {
                hasStream: !!this.visionStream,
                hasConversation: !!this.conversation,
            });
            return;
        }
        // Trava simples: se uma captura anterior ainda está em voo (upload/análise em
        // andamento) e o gatilho de voz disparar de novo antes dela terminar, a segunda chamada
        // era descartada silenciosamente ao mexer no mesmo <canvas> no meio do processo. Agora
        // ela só avisa e sai, em vez de tentar (e falhar sem log) por cima da primeira.
        if (this.visionLookBusy) {
            console.warn('lookAtCamera: ignorado — já existe uma captura em andamento');
            this.pushLog('[VISÃO] Ainda processando a imagem anterior, aguarde...');
            return;
        }
        this.visionLookBusy = true;

        try {
            const video = this.visionVideo;
            const track = this.visionStream.getVideoTracks()[0];
            if (track && track.readyState !== 'live') {
                console.warn('lookAtCamera: abortado — track de vídeo não está mais "live"', {
                    readyState: track.readyState,
                });
                this.pushLog('[ERRO] Câmera parou de transmitir — reative o SHARE VISION');
                return;
            }

            const canvas = this.visionCaptureCanvas;
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            // Espelha a captura pra bater com a visualização (senão a mão esquerda de quem está
            // na câmera aparece do lado direito da imagem, e o Jarvis descreve o lado errado).
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            if (!blob) {
                console.warn('lookAtCamera: canvas.toBlob() retornou null — imagem não capturada');
                this.pushLog('[ERRO] Não consegui capturar a imagem da câmera');
                return;
            }

            this.pushLog('[VISÃO] Enviando imagem da câmera para o Jarvis...');
            const { fileId } = await this.conversation.uploadFile(blob);
            await this.conversation.sendMultimodalMessage({ text: promptText, fileId });
            this.pushLog('[VISÃO] Imagem enviada — aguardando análise');
        } catch (error) {
            console.error('Error sending camera frame:', error);
            this.pushLog(`[ERRO] Falha ao enviar imagem: ${error.message || error}`);
        } finally {
            this.visionLookBusy = false;
        }
    }

    // Frases que indicam que você quer que o Jarvis veja algo agora. Como a fala por voz vai
    // direto pro SDK (a gente só recebe a transcrição DEPOIS, via onMessage), não dá pra grudar a
    // imagem no mesmo turno de voz — em vez disso, ao detectar uma dessas frases na sua fala,
    // mandamos a imagem logo em seguida como uma segunda mensagem, com a mesma pergunta.
    static VISION_TRIGGER_REGEX =
        /o que (você|voce|vc) (est[áa]|t[áa]) vendo|o que (eu )?tenho na(s)? (minhas? )?m[ãa]os?|consegue me ver|voc[êe] me v[êe]|voc[êe] (me )?enxerga|d[áa] uma olhada|olh[ae] (agora|a c[âa]mera|pra mim|para mim)|identifica (isso|esse objeto|este objeto)|que objeto [ée] esse|o que (você|voce|vc) enxerga/i;

    // Chamado a cada transcrição de fala sua (onMessage, role 'user'). Se a câmera estiver
    // compartilhada e a frase bater com um gatilho de visão, dispara lookAtCamera() sozinho.
    maybeAutoLook(message) {
        if (!this.visionStream || !this.conversation) return;
        if (!JARVISInterface.VISION_TRIGGER_REGEX.test(message)) return;
        this.pushLog('[VISÃO] Pergunta sobre a câmera detectada — olhando automaticamente...');
        this.lookAtCamera(message);
    }

    // Frases pra ligar/desligar o compartilhamento da câmera (SHARE VISION) por voz — mesma ideia
    // do comando de tela cheia: reconhecido localmente na sua fala transcrita, sem passar por
    // nenhuma ferramenta do agente.
    static VISION_ON_REGEX = /liga(r)?\s*(a\s*)?c[âa]mera|ativa(r)?\s*(a\s*)?c[âa]mera|compartilh(a|ar)\s*(a\s*)?(vis[ãa]o|c[âa]mera)|share\s*vision/i;
    static VISION_OFF_REGEX = /desliga(r)?\s*(a\s*)?c[âa]mera|desativa(r)?\s*(a\s*)?c[âa]mera|para(r)?\s*de\s*compartilhar\s*(a\s*)?(vis[ãa]o|c[âa]mera)/i;

    maybeHandleVisionCommand(message) {
        if (JARVISInterface.VISION_OFF_REGEX.test(message)) {
            if (this.visionStream) this.stopVision();
        } else if (JARVISInterface.VISION_ON_REGEX.test(message)) {
            if (!this.visionStream) this.startVision();
        }
    }

    toggleConversation() {
        if (this.conversationActive) {
            this.stopConversation();
        } else {
            this.startConversation();
        }
    }

    // Quando a conexão com o agente ElevenLabs cai por erro (rede, falha no n8n, no modelo etc.),
    // o SDK simplesmente encerra a sessão — sem isso, o Jarvis "para de falar do nada" e você não
    // sabe se foi um bug, se ele te ignorou, ou o quê. Aqui usamos a síntese de voz nativa do
    // navegador (não a voz real da ElevenLabs, que já caiu junto com a conexão) só pra avisar em
    // voz alta que algo quebrou, e o painel de log já mostra o motivo técnico de qualquer forma.
    speakFallbackError(reason) {
        this.pushLog(`[ERRO] Conexão caiu (${reason}) — avisando por voz de reserva`);
        if (!('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel(); // não empilha por cima de um aviso anterior
            const utterance = new SpeechSynthesisUtterance(
                'Desculpe, tive um erro interno e perdi a conexão. Pode tentar de novo.'
            );
            utterance.lang = 'pt-BR';
            window.speechSynthesis.speak(utterance);
        } catch (error) {
            console.error('Falha na síntese de voz de reserva:', error);
        }
    }

    // Pede ao backend (SCRUM-16) uma signed URL autenticada da ElevenLabs. Conectar direto com
    // agentId funciona para voz/texto (agente público), mas conversation.uploadFile() — usado pela
    // visão da câmera — respondia 403 nesse modo anônimo (fix SCRUM-48). Se o backend não estiver
    // no ar, cai em `null`: a conversa continua funcionando normalmente por agentId, só a visão por
    // câmera que não vai funcionar até o backend subir.
    async getElevenLabsSignedUrl() {
        try {
            const response = await fetch(`${JARVIS_BACKEND_URL}/elevenlabs/signed-url`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const { signed_url } = await response.json();
            return signed_url;
        } catch (error) {
            console.warn('Não foi possível obter signed URL do backend, usando agentId direto:', error);
            this.pushLog('[AVISO] Backend indisponível — visão por câmera pode falhar (403)');
            return null;
        }
    }

    // Inicia uma conversa real com o agente ElevenLabs via SDK (@elevenlabs/client).
    // Cada callback abaixo alimenta o painel lateral (.log-content) e o texto de status com o que
    // está realmente acontecendo — nada aqui é simulado.
    async startConversation() {
        if (this.conversationActive || this.conversationStarting || !window.ElevenLabsClient) {
            if (!window.ElevenLabsClient) {
                this.pushLog('[ERRO] SDK da ElevenLabs ainda não carregou');
            }
            return;
        }
        this.conversationStarting = true;

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
            this.conversationStarting = false;
            return;
        }

        this.pushLog('[REDE] Conectando ao agente JARVIS (ElevenLabs)...');
        this.updateVoiceStatus('CONECTANDO...');

        // Signed URL autenticada quando o backend está disponível (habilita upload de imagem pela
        // câmera — fix SCRUM-48); cai para agentId puro se o backend estiver fora do ar.
        const signedUrl = await this.getElevenLabsSignedUrl();
        const sessionTarget = signedUrl ? { signedUrl } : { agentId: ELEVENLABS_AGENT_ID };

        try {
            this.conversation = await window.ElevenLabsClient.Conversation.startSession({
                ...sessionTarget,
                // Rotina do primeiro contato do dia: clima real + previsão de chuva + agenda,
                // injetada como variável dinâmica {{daily_briefing}} — usada na primeira mensagem
                // do agente (configurada no painel da ElevenLabs). Nas próximas conversas do mesmo
                // dia, vem vazia e o agente cumprimenta normalmente. Ver getDailyBriefingVariable().
                dynamicVariables: {
                    daily_briefing: this.getDailyBriefingVariable(),
                },
                onConnect: ({ conversationId }) => {
                    this.conversationStarting = false;
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
                    // Se caiu por erro (não porque você ou o agente encerraram normalmente), o
                    // Jarvis "simplesmente parou de falar" do seu ponto de vista — avisamos em voz
                    // alta em vez de deixar isso só no painel de log.
                    if (details?.reason === 'error') {
                        this.speakFallbackError(details.message || 'motivo desconhecido');
                        // Achado real (log do console): depois de um erro, religar a escuta de
                        // ativação NA HORA abriu um loop de reconexão — provavelmente o próprio
                        // alto-falante (aviso de erro falado acima, ou eco do ambiente) sendo
                        // captado pelo microfone e "reconhecido" como frase de ativação, iniciando
                        // outra conversa que falha de novo, repetindo. Damos uma folga aqui pra
                        // esse eco esvaziar antes de voltar a escutar.
                        setTimeout(() => this.startWakeWordListener(), 4000);
                    } else {
                        this.startWakeWordListener(); // volta a escutar a frase de ativação
                    }
                },
                onError: (message) => {
                    this.pushLog(`[ERRO] ${message}`);
                    this.updateVoiceStatus('[ERRO] FALHA NA CONEXÃO');
                },
                onMessage: ({ message, role }) => {
                    const quem = role === 'user' ? 'VOCÊ' : 'JARVIS';
                    this.pushLog(`[FALA] ${quem}: ${message}`);
                    if (role === 'user') {
                        this.maybeHandleVisionCommand(message);
                        this.maybeAutoLook(message);
                        this.maybeHandleFullscreenCommand(message);
                        this.maybeHandleSettingsCommand(message);
                    }
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
            this.conversationStarting = false;
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
        this.conversationStarting = false;
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

            // VU-meter da música — lê o mesmo sinal real que está tocando (ver ensureMusicAnalyser)
            if (this.vuMusic && this.musicAnalyser && !this.bgMusic.paused) {
                const musicLevel = this.averageLevel(() => {
                    this.musicAnalyser.getByteFrequencyData(this.musicAnalyserData);
                    return this.musicAnalyserData;
                });
                this.vuMusic.style.width = `${Math.min(100, musicLevel * 160)}%`;
            } else if (this.vuMusic) {
                this.vuMusic.style.width = '0%';
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
