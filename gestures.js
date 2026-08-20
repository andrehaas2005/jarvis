// ============================================================================
// JARVIS — controle por gestos + canvas de caixas (inspirado na segunda demo do
// vídeo de referência do usuário). Rastreamento de mão via MediaPipe Tasks Vision
// (Google, CDN), rodando 100% no navegador — nenhuma imagem sai da máquina.
//
// Gestos reconhecidos (heurística simples a partir dos 21 pontos da mão):
//   mão aberta        → move o cursor virtual livremente
//   beliscar           → "clica e segura": arrasta caixa (solte sobre a lixeira
//                        pra apagar) ou puxa uma conexão a partir da alcinha
//   punho fechado      → modo ditado: cria uma caixa no cursor e transcreve sua
//                        fala nela via Web Speech API do navegador (separado da
//                        conversa do Jarvis — é um ditado local simples)
//   duas mãos, afastar/aproximar → zoom no canvas
//
// Escopo: cobre "mover/criar/conectar/apagar caixas por gesto", que foi o pedido
// específico. Os modos "AI"/"Imagem" do vídeo (geração de conteúdo dentro da
// caixa) ficam de fora por enquanto — dependeriam de outra API além da ElevenLabs.
// ============================================================================
import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

// Margem da câmera ignorada em cada lado ao mapear a posição da mão pra tela — sem isso, alcançar
// os cantos/bordas da tela exigiria esticar a mão até a borda física do campo de visão da câmera,
// o que é desconfortável. Usando só a região central (1 - 2*margem) e esticando ela pra 0..1,
// um movimento de mão bem menor já cobre a tela inteira.
const EDGE_MARGIN = 0.18;

function mapToScreen(v) {
    const stretched = (v - EDGE_MARGIN) / (1 - EDGE_MARGIN * 2);
    return Math.min(1, Math.max(0, stretched));
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function isFingerExtended(landmarks, tipIdx, mcpIdx) {
    const wrist = landmarks[0];
    return dist(landmarks[tipIdx], wrist) > dist(landmarks[mcpIdx], wrist) * 1.15;
}

// Classifica o gesto de UMA mão a partir dos seus 21 pontos (formato do MediaPipe
// HandLandmarker, coordenadas normalizadas 0..1).
function classifyGesture(landmarks) {
    const pinchDist = dist(landmarks[4], landmarks[8]);
    if (pinchDist < 0.055) return 'pinch';

    const extended = [
        isFingerExtended(landmarks, 8, 5),
        isFingerExtended(landmarks, 12, 9),
        isFingerExtended(landmarks, 16, 13),
        isFingerExtended(landmarks, 20, 17),
    ].filter(Boolean).length;

    if (extended >= 3) return 'open';
    if (extended === 0) return 'fist';
    return 'neutro';
}

export class GestureCanvas {
    constructor({ overlay, canvasArea, worldEl, cursorEl, svgEl, trashEl, video, statusEl, boxCountEl, log }) {
        this.overlay = overlay;
        this.canvasArea = canvasArea;
        this.worldEl = worldEl;
        this.cursorEl = cursorEl;
        this.svgEl = svgEl;
        this.trashEl = trashEl;
        this.video = video;
        this.statusEl = statusEl;
        this.boxCountEl = boxCountEl;
        this.log = log || (() => {});

        this.landmarker = null;
        this.stream = null;
        this.running = false;
        this.rafId = null;

        this.boxes = []; // {id, el, x, y}
        this.connections = []; // {fromId, toId, lineEl}
        this.nextBoxId = 1;

        this.gesture = 'neutro';
        this.cursorX = 0.5;
        this.cursorY = 0.5;
        this.pixelX = 0;
        this.pixelY = 0;

        this.zoom = 1;
        this.twoHandBaseline = null; // distância normalizada entre as duas mãos no início do zoom

        this.draggingBox = null; // { box, offsetX, offsetY } — offsets em coordenadas de mundo
        this.linkingFrom = null; // { box }
        this.dictationBox = null;
        this.recognizer = null;
    }

    async init() {
        this.statusEl.textContent = 'CARREGANDO RASTREAMENTO DE MÃO...';
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
        });
    }

    async start() {
        if (this.running) return;
        if (!this.landmarker) await this.init();

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        } catch (error) {
            console.error('Camera permission error (gestures):', error);
            this.statusEl.textContent = 'PERMISSÃO DE CÂMERA NEGADA';
            this.log('[ERRO] Permissão de câmera negada (gestos)');
            return;
        }

        this.video.srcObject = this.stream;
        await this.video.play();

        this.running = true;
        this.statusEl.textContent = 'MÃO NÃO DETECTADA';
        this.log('[GESTOS] Rastreamento de mão iniciado');
        this.loop();
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
        }
        if (this.recognizer) {
            this.recognizer.stop();
            this.recognizer = null;
        }
        this.log('[GESTOS] Rastreamento de mão encerrado');
    }

    // Converte um ponto em pixels de tela (relativo ao canvasArea) pra coordenadas de mundo
    // (o sistema onde box.x/box.y vivem, antes do zoom ser aplicado).
    toWorld(screenX, screenY) {
        return { x: screenX / this.zoom, y: screenY / this.zoom };
    }

    loop() {
        if (!this.running) return;
        this.rafId = requestAnimationFrame(() => this.loop());

        if (this.video.readyState < 2) return;
        const now = performance.now();
        const result = this.landmarker.detectForVideo(this.video, now);
        const hands = result.landmarks || [];

        if (hands.length === 2) {
            this.handleTwoHandZoom(hands);
            return;
        }
        this.twoHandBaseline = null;

        if (hands.length === 0) {
            this.statusEl.textContent = 'MÃO NÃO DETECTADA';
            return;
        }

        const landmarks = hands[0];
        // Espelha o x (mesma lógica da visão por câmera) e mapeia só a região central da câmera
        // pra tela inteira, pra dar pra alcançar os cantos sem esticar o braço até a borda real
        // do campo de visão.
        this.cursorX = mapToScreen(1 - landmarks[8].x);
        this.cursorY = mapToScreen(landmarks[8].y);

        const gesture = classifyGesture(landmarks);
        this.updateCursorPixels();

        if (gesture !== this.gesture) this.onGestureChange(this.gesture, gesture);
        this.gesture = gesture;

        if (gesture === 'pinch') this.onPinchMove();

        this.statusEl.textContent = {
            open: 'MÃO ABERTA — MOVENDO CURSOR',
            pinch: 'BELISCANDO — ARRASTANDO',
            fist: 'PUNHO FECHADO — DITANDO',
            neutro: 'MÃO DETECTADA',
        }[gesture];
    }

    // Duas mãos na tela: a distância entre elas controla o zoom. Guarda uma distância de
    // referência ao entrar em modo de duas mãos e escala de forma incremental a cada quadro,
    // pra não dar salto quando a segunda mão aparece.
    handleTwoHandZoom(hands) {
        // Cancela qualquer arraste/conexão em andamento — zoom tem prioridade com duas mãos.
        if (this.draggingBox) this.onPinchEnd();
        if (this.linkingFrom) this.onPinchEnd();
        this.gesture = 'neutro';

        const bothPinching = classifyGesture(hands[0]) === 'pinch' && classifyGesture(hands[1]) === 'pinch';
        if (!bothPinching) {
            // Só reseta a referência quando NÃO está beliscando — assim, ao voltar a beliscar,
            // o zoom recomeça do zero (sem salto) em vez de guardar uma distância antiga.
            this.twoHandBaseline = null;
            this.statusEl.textContent = 'DUAS MÃOS DETECTADAS — BELISQUE AS DUAS PRA DAR ZOOM';
            this.cursorEl.className = 'gesture-cursor gesture-cursor--zoom-wait';
            return;
        }

        // Usa a ponta do polegar de cada mão (landmark 4) como referência da distância — mais
        // preciso que o pulso pra um gesto de pinça feito com as duas mãos.
        const centerA = hands[0][4];
        const centerB = hands[1][4];
        const currentDist = dist(centerA, centerB);

        if (this.twoHandBaseline === null) {
            this.twoHandBaseline = currentDist;
        } else if (this.twoHandBaseline > 0.0001) {
            const factor = currentDist / this.twoHandBaseline;
            this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
            this.worldEl.style.transform = `scale(${this.zoom})`;
            this.twoHandBaseline = currentDist;
            this.redrawConnections();
        }

        this.statusEl.textContent = `BELISCANDO COM DUAS MÃOS — ZOOM ${Math.round(this.zoom * 100)}%`;
        this.cursorEl.className = 'gesture-cursor gesture-cursor--zoom';
    }

    updateCursorPixels() {
        const rect = this.canvasArea.getBoundingClientRect();
        this.pixelX = this.cursorX * rect.width;
        this.pixelY = this.cursorY * rect.height;
        this.cursorEl.style.left = `${this.pixelX}px`;
        this.cursorEl.style.top = `${this.pixelY}px`;
        this.cursorEl.className = `gesture-cursor gesture-cursor--${this.gesture}`;
    }

    onGestureChange(prev, next) {
        if (next === 'pinch') this.onPinchStart();
        if (prev === 'pinch' && next !== 'pinch') this.onPinchEnd();
        if (next === 'fist') this.startDictation();
        if (prev === 'fist' && next !== 'fist') this.stopDictation();
    }

    hitTestBox(px, py) {
        const areaRect = this.canvasArea.getBoundingClientRect();
        for (let i = this.boxes.length - 1; i >= 0; i--) {
            const b = this.boxes[i];
            const r = b.el.getBoundingClientRect();
            const left = r.left - areaRect.left;
            const top = r.top - areaRect.top;
            if (px >= left && px <= left + r.width && py >= top && py <= top + r.height) return b;
        }
        return null;
    }

    isOverTrash() {
        if (!this.trashEl) return false;
        const r = this.trashEl.getBoundingClientRect();
        const areaRect = this.canvasArea.getBoundingClientRect();
        const left = r.left - areaRect.left;
        const top = r.top - areaRect.top;
        return this.pixelX >= left && this.pixelX <= left + r.width && this.pixelY >= top && this.pixelY <= top + r.height;
    }

    onPinchStart() {
        const box = this.hitTestBox(this.pixelX, this.pixelY);
        if (!box) return;

        const handleRect = box.linkHandle.getBoundingClientRect();
        const areaRect = this.canvasArea.getBoundingClientRect();
        const handleCx = handleRect.left - areaRect.left + handleRect.width / 2;
        const handleCy = handleRect.top - areaRect.top + handleRect.height / 2;
        const overHandle = Math.hypot(this.pixelX - handleCx, this.pixelY - handleCy) < 16;

        if (overHandle) {
            this.linkingFrom = { box };
            return;
        }

        const world = this.toWorld(this.pixelX, this.pixelY);
        this.draggingBox = {
            box,
            offsetX: world.x - box.x,
            offsetY: world.y - box.y,
        };
        box.el.classList.add('gesture-box--dragging');
    }

    onPinchMove() {
        if (this.draggingBox) {
            const { box, offsetX, offsetY } = this.draggingBox;
            const world = this.toWorld(this.pixelX, this.pixelY);
            box.x = world.x - offsetX;
            box.y = world.y - offsetY;
            box.el.style.left = `${box.x}px`;
            box.el.style.top = `${box.y}px`;
            this.redrawConnections();

            const overTrash = this.isOverTrash();
            this.trashEl.classList.toggle('gesture-trash--armed', overTrash);
            box.el.classList.toggle('gesture-box--doomed', overTrash);
        } else if (this.linkingFrom) {
            this.drawTempLine(this.linkingFrom.box, this.pixelX, this.pixelY);
        }
    }

    onPinchEnd() {
        if (this.draggingBox) {
            const { box } = this.draggingBox;
            box.el.classList.remove('gesture-box--dragging');
            const overTrash = this.isOverTrash();
            this.trashEl.classList.remove('gesture-trash--armed');
            box.el.classList.remove('gesture-box--doomed');
            this.draggingBox = null;
            if (overTrash) this.deleteBox(box.id);
        }
        if (this.linkingFrom) {
            const target = this.hitTestBox(this.pixelX, this.pixelY);
            this.clearTempLine();
            if (target && target !== this.linkingFrom.box) {
                this.connectBoxes(this.linkingFrom.box, target);
            }
            this.linkingFrom = null;
        }
    }

    // x/y aqui são coordenadas de MUNDO (não pixels de tela) — quem chama já deve converter com
    // toWorld() se estiver partindo de uma posição de cursor/tela.
    createBox(x, y, text = '', source = 'manual') {
        const id = this.nextBoxId++;
        const el = document.createElement('div');
        el.className = `gesture-box gesture-box--${source}`;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;

        const label = document.createElement('div');
        label.className = 'gesture-box-label';
        label.textContent = source === 'jarvis' ? 'JARVIS' : 'NOTA';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'gesture-box-close';
        closeBtn.textContent = '×';
        closeBtn.title = 'Excluir';
        closeBtn.addEventListener('click', () => this.deleteBox(id));

        const content = document.createElement('div');
        content.className = 'gesture-box-content';
        content.contentEditable = 'true';
        content.textContent = text;

        const linkHandle = document.createElement('div');
        linkHandle.className = 'gesture-box-handle';
        linkHandle.title = 'Arraste (beliscando) até outra caixa pra conectar';

        el.append(label, closeBtn, content, linkHandle);
        this.worldEl.appendChild(el);

        const box = { id, el, x, y, content, linkHandle };
        this.boxes.push(box);
        this.log(`[GESTOS] Caixa #${id} criada`);
        this.updateBoxCount();
        return box;
    }

    updateBoxCount() {
        if (!this.boxCountEl) return;
        const n = this.boxes.length;
        this.boxCountEl.textContent = `${n} ${n === 1 ? 'CAIXA' : 'CAIXAS'}`;
    }

    // Chamado de fora (script.js) toda vez que o Jarvis responde algo na conversa de voz
    // principal, enquanto o canvas de gestos está aberto — a resposta vira uma caixa nova, que
    // você pode arrastar/conectar/apagar com a mão como qualquer outra.
    addResponseBox(text) {
        const areaRect = this.canvasArea.getBoundingClientRect();
        const cascade = this.boxes.length % 6;
        const world = this.toWorld(areaRect.width, areaRect.height);
        const x = 40 + cascade * 30;
        const y = 40 + cascade * 30;
        return this.createBox(
            Math.min(x, Math.max(0, world.x - 240)),
            Math.min(y, Math.max(0, world.y - 140)),
            text,
            'jarvis',
        );
    }

    deleteBox(id) {
        const box = this.boxes.find((b) => b.id === id);
        if (!box) return;
        this.connections = this.connections.filter((c) => {
            if (c.fromId === id || c.toId === id) {
                c.lineEl.remove();
                return false;
            }
            return true;
        });
        box.el.remove();
        this.boxes = this.boxes.filter((b) => b.id !== id);
        this.log(`[GESTOS] Caixa #${id} excluída`);
        this.updateBoxCount();
    }

    connectBoxes(fromBox, toBox) {
        const exists = this.connections.some(
            (c) => (c.fromId === fromBox.id && c.toId === toBox.id) || (c.fromId === toBox.id && c.toId === fromBox.id),
        );
        if (exists) return;
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        lineEl.setAttribute('class', 'gesture-connection');
        this.svgEl.appendChild(lineEl);
        this.connections.push({ fromId: fromBox.id, toId: toBox.id, lineEl });
        this.redrawConnections();
        this.log(`[GESTOS] Caixa #${fromBox.id} conectada à #${toBox.id}`);
    }

    // Centro da caixa em coordenadas de TELA (não de mundo) — usa o retângulo real já renderizado
    // (que reflete o zoom atual automaticamente), por isso as linhas do SVG (não escalado) ficam
    // sempre corretas sem eu precisar multiplicar nada manualmente pelo zoom.
    boxCenter(box) {
        const r = box.el.getBoundingClientRect();
        const areaRect = this.canvasArea.getBoundingClientRect();
        return {
            x: r.left - areaRect.left + r.width / 2,
            y: r.top - areaRect.top + r.height / 2,
        };
    }

    redrawConnections() {
        this.connections.forEach((c) => {
            const from = this.boxes.find((b) => b.id === c.fromId);
            const to = this.boxes.find((b) => b.id === c.toId);
            if (!from || !to) return;
            const p1 = this.boxCenter(from);
            const p2 = this.boxCenter(to);
            c.lineEl.setAttribute('x1', p1.x);
            c.lineEl.setAttribute('y1', p1.y);
            c.lineEl.setAttribute('x2', p2.x);
            c.lineEl.setAttribute('y2', p2.y);
        });
    }

    drawTempLine(fromBox, px, py) {
        if (!this.tempLine) {
            this.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            this.tempLine.setAttribute('class', 'gesture-connection gesture-connection--temp');
            this.svgEl.appendChild(this.tempLine);
        }
        const p1 = this.boxCenter(fromBox);
        this.tempLine.setAttribute('x1', p1.x);
        this.tempLine.setAttribute('y1', p1.y);
        this.tempLine.setAttribute('x2', px);
        this.tempLine.setAttribute('y2', py);
    }

    clearTempLine() {
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
    }

    // Punho fechado → cria uma caixa no cursor e dita sua fala nela (Web Speech API do
    // navegador — reconhecimento local do Chrome, não passa pela conversa do Jarvis).
    startDictation() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.log('[ERRO] Ditado por voz não suportado neste navegador');
            return;
        }
        const world = this.toWorld(this.pixelX - 70, this.pixelY - 40);
        this.dictationBox = this.createBox(world.x, world.y);
        this.dictationBox.content.classList.add('gesture-box-content--dictating');

        this.recognizer = new SpeechRecognition();
        this.recognizer.lang = 'pt-BR';
        this.recognizer.continuous = true;
        this.recognizer.interimResults = true;
        this.recognizer.onresult = (event) => {
            // Resultados chegam de forma assíncrona — pode acontecer de um resultado atrasado
            // chegar depois que a mão já saiu do punho fechado e a caixa foi "solta" (dictationBox
            // volta a null). Sem essa checagem, isso quebrava com TypeError.
            if (!this.dictationBox) return;
            let text = '';
            for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
            this.dictationBox.content.textContent = text;
        };
        this.recognizer.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
        this.recognizer.start();
        this.log('[GESTOS] Ditado iniciado');
    }

    stopDictation() {
        if (this.recognizer) {
            this.recognizer.stop();
            this.recognizer = null;
        }
        if (this.dictationBox) {
            this.dictationBox.content.classList.remove('gesture-box-content--dictating');
            this.log('[GESTOS] Ditado encerrado');
        }
        this.dictationBox = null;
    }
}

window.GestureCanvas = GestureCanvas;
