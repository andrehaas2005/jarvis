// ============================================================================
// JARVIS — visualizador 3D do rosto/voz (substitui o desenho em canvas 2D).
// Três variações selecionáveis em tempo real (ver toggle no HTML):
//   'orb'  → esfera de plasma orgânica, deforma e brilha MUITO com a fala
//   'face' → rosto 3D real (modelo "Face Cap" distribuído nos exemplos oficiais do
//            three.js — github.com/mrdoob/three.js/tree/dev/examples/models/gltf,
//            crédito bannaflak.com/face-cap), com blend shapes de verdade movendo a
//            boca conforme o volume real da fala. Se o modelo não carregar (rede
//            fora do ar etc.), cai de volta pro rosto wireframe simples.
//   'ring' → anel fibroso + relógio central + traços tipo equalizador, no espírito
//            de uma referência visual que o usuário trouxe (vídeo de template de HUD
//            sci-fi). Só os estados genéricos do vídeo foram usados como base — os
//            trechos que mostravam o capacete/armadura do Homem de Ferro (arte de
//            personagem da Marvel) foram propositalmente ignorados; a forma aqui é
//            um design original, desenhado do zero.
// Carregado como módulo ES (ver <script type="importmap"> no index.html); expõe
// window.Visualizer3D pra script.js (script clássico) consumir.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Ativos binários do modelo (glb + transcoder KTX2) não fazem parte do pacote npm do
// three.js — só o código. Vêm direto do repositório, fixados na mesma versão do resto.
const THREE_ASSET_BASE = 'https://raw.githubusercontent.com/mrdoob/three.js/r160';
const FACECAP_URL = `${THREE_ASSET_BASE}/examples/models/gltf/facecap.glb`;
const BASIS_TRANSCODER_PATH = `${THREE_ASSET_BASE}/examples/jsm/libs/basis/`;

function buildOrb() {
    const geometry = new THREE.IcosahedronGeometry(1, 48);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uLevel: { value: 0 },
            uColorA: { value: new THREE.Color(0x0a3a55) },
            uColorB: { value: new THREE.Color(0x00eaff) },
        },
        vertexShader: `
            uniform float uTime;
            uniform float uLevel;
            varying vec3 vNormal;
            varying float vColorNoise;

            // Ruído barato (soma de senos em 3D) — evita o snoise clássico, que é
            // fácil de digitar errado; visualmente já dá o efeito de "plasma".
            float fieldNoise(vec3 p, float t) {
                return sin(p.x * 2.2 + t * 0.6)
                     + sin(p.y * 2.6 - t * 0.5)
                     + sin(p.z * 2.0 + t * 0.4)
                     + sin((p.x + p.y + p.z) * 1.4 + t * 0.8);
            }

            void main() {
                vNormal = normalize(normalMatrix * normal);

                float nColor = fieldNoise(position * 1.3, uTime * 0.6); // ~-4..4
                vColorNoise = clamp(nColor / 4.0 * 0.5 + 0.5, 0.0, 1.0);

                // Deslocamento físico bem mais forte com o áudio — é o que faz o orbe
                // "explodir"/pulsar de verdade quando alguém fala, não só brilhar.
                float nDisp = fieldNoise(position, uTime) * 0.25; // ~-1..1
                float disp = nDisp * (0.08 + uLevel * 1.2);
                vec3 newPosition = position + normal * disp;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            uniform float uLevel;
            varying vec3 vNormal;
            varying float vColorNoise;

            void main() {
                vec3 viewDir = vec3(0.0, 0.0, 1.0);
                float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 1.5);
                vec3 base = mix(uColorA, uColorB, vColorNoise);
                vec3 color = base * (0.55 + uLevel * 0.9) + fresnel * (0.8 + uLevel * 1.8);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
    });
    const mesh = new THREE.Mesh(geometry, material);

    const wireMat = new THREE.MeshBasicMaterial({
        color: 0x00eaff,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
    });
    const wireMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 6), wireMat);

    const group = new THREE.Group();
    group.add(mesh, wireMesh);

    return {
        group,
        cameraZ: 6.2,
        update(level, active, time) {
            material.uniforms.uTime.value = time;
            material.uniforms.uLevel.value = level;
            // Gira bem mais rápido quando está "falando" alto, quase parado em repouso
            group.rotation.y += 0.006 + level * 0.05;
            group.rotation.x = Math.sin(time * 0.11) * (0.15 + level * 0.3);
            // Pulso de escala forte — o orbe cresce visivelmente com o volume
            const scale = 1 + level * 0.35;
            group.scale.setScalar(scale);
            wireMat.opacity = 0.08 + level * 0.55;
        },
    };
}

// Anel fibroso + traços tipo equalizador ao redor de um relógio central (o relógio em si é HTML,
// não 3D — ver clockEl/updateClock() na classe principal). O anel externo amassa mais quanto mais
// alto o volume da fala, e os traços ao redor brilham em onda — como um equalizador de áudio.
function buildRing() {
    const group = new THREE.Group();

    const outerMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uLevel: { value: 0 },
            uColor: { value: new THREE.Color(0x1fe8cf) },
        },
        vertexShader: `
            uniform float uTime;
            uniform float uLevel;
            varying float vGlow;

            float fieldNoise(vec3 p, float t) {
                return sin(p.x * 3.0 + t * 0.5)
                     + sin(p.y * 2.4 - t * 0.7)
                     + sin(p.z * 3.6 + t * 0.3);
            }

            void main() {
                // Limita o pico do ruído (a soma de 3 senos raramente, mas eventualmente, bate
                // perto do máximo teórico ±1 ao mesmo tempo) — sem isso, de vez em quando um "bico"
                // do anel passava da borda do quadro justamente nesses picos raros, mesmo em
                // repouso (a respiração do modo parado já soma uLevel até ~0.25 sozinha).
                float n = clamp(fieldNoise(position * 2.0, uTime) / 3.0, -0.72, 0.72);
                float amount = 0.045 + uLevel * 0.32;
                vec3 displaced = position + normal * n * amount;
                vGlow = 0.5 + n * 0.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uLevel;
            varying float vGlow;
            void main() {
                vec3 color = uColor * (0.5 + vGlow * 0.7 + uLevel * 0.6);
                gl_FragColor = vec4(color, 0.92);
            }
        `,
        transparent: true,
    });
    const outerMesh = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.1, 16, 160), outerMat);
    group.add(outerMesh);

    // Anel fino do meio — quase estático, só de referência visual (como na imagem original)
    const midMat = new THREE.MeshBasicMaterial({ color: 0x0f8f80, transparent: true, opacity: 0.35 });
    const midMesh = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.006, 8, 100), midMat);
    group.add(midMesh);

    // Traços em círculo, tipo equalizador — cada um com fase própria pra criar um efeito de onda
    // percorrendo o anel, mais intenso quanto mais alto o volume da fala.
    const dashCount = 48;
    const dashGroup = new THREE.Group();
    const dashes = [];
    for (let i = 0; i < dashCount; i++) {
        const angle = (i / dashCount) * Math.PI * 2;
        const dashMat = new THREE.MeshBasicMaterial({ color: 0x33fbe0, transparent: true, opacity: 0.3 });
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.085), dashMat);
        const radius = 0.66;
        dash.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        dash.rotation.z = angle + Math.PI / 2;
        dashGroup.add(dash);
        dashes.push({ mat: dashMat, mesh: dash, phase: (i / dashCount) * Math.PI * 2 });
    }
    group.add(dashGroup);

    return {
        group,
        // Distância da câmera controla o tamanho aparente do anel. Recuada um pouco (de 5.5 pra
        // 5.8) depois de detectar corte lateral intermitente nos picos raros do ruído em repouso —
        // ver o clamp() no shader acima também.
        cameraZ: 5.8,
        update(level, active, time) {
            outerMat.uniforms.uTime.value = time;
            outerMat.uniforms.uLevel.value = level;
            group.rotation.z = time * 0.015;
            dashGroup.rotation.z = -time * 0.05;

            dashes.forEach((d, i) => {
                const wave = (Math.sin(time * 2.6 + d.phase + i * 0.25) + 1) / 2;
                const glow = active ? level * (0.4 + wave * 0.6) : 0.12 + wave * 0.12;
                d.mat.opacity = 0.18 + glow * 0.82;
                d.mesh.scale.y = 1 + glow * 2.1;
            });
        },
    };
}

// Rosto wireframe simples — usado como fallback enquanto o modelo real carrega, ou se
// o download falhar (sem internet, CDN fora do ar etc.).
function buildFallbackHead() {
    const geometry = new THREE.IcosahedronGeometry(1, 3);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        const taper = 1 - Math.max(0, -y) * 0.38;
        x *= taper;
        z *= taper;
        if (z > 0) z *= 0.7;
        y *= 1.08;
        pos.setXYZ(i, x, y, z);
    }
    geometry.computeVertexNormals();

    const wireMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.75 });
    const wireMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), wireMat);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x041824, transparent: true, opacity: 0.5 });
    const fillMesh = new THREE.Mesh(geometry, fillMat);

    const group = new THREE.Group();
    group.add(fillMesh, wireMesh);
    group.visible = false; // só aparece se o modelo real falhar ao carregar

    return {
        group,
        cameraZ: 6.2,
        update(level, active, time) {
            group.rotation.y = 0;
            wireMat.opacity = 0.5 + level * 0.5;
        },
    };
}

// Rosto 3D real, com blend shapes ARKit (jawOpen, mouthFunnel, eyeBlink...) movidos
// pelo volume real da conversa — não é uma animação enlatada.
function buildRealisticHead(renderer, onReady) {
    const group = new THREE.Group();
    group.visible = false;

    const ktx2Loader = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);

    const state = {
        mesh: null,
        morphDict: null,
        blinkTimer: 2 + Math.random() * 2,
    };

    loader.load(
        FACECAP_URL,
        (gltf) => {
            const root = gltf.scene.children[0];
            const mesh = root.getObjectByName('mesh_2') || root;
            if (!mesh.morphTargetDictionary) {
                console.warn('[JARVIS] facecap.glb carregou mas sem morph targets — usando fallback.');
                return;
            }

            // Enquadramento: THREE.Box3().setFromObject() e até medir a bounding box da malha na
            // mão se mostraram nada confiáveis pra este arquivo específico (mediam de 4x a 40x o
            // tamanho real — provavelmente por causa de algum nó de escala na hierarquia do
            // glTF). Em vez de perseguir isso, os valores abaixo foram calibrados visualmente
            // (testados via captura de canvas) e funcionam bem pro facecap.glb desta versão.
            root.scale.setScalar(4.6);
            root.position.set(0, 0.1, 0.22);

            group.add(root);
            group.visible = false; // aplicado de fora via applyMode()
            state.mesh = mesh;
            state.morphDict = mesh.morphTargetDictionary;
            onReady();
        },
        undefined,
        (error) => {
            console.warn('[JARVIS] Não consegui carregar o rosto 3D real, usando fallback wireframe.', error);
        },
    );

    function setMorph(name, value) {
        const dict = state.morphDict;
        if (!dict || !state.mesh) return;
        const key = Object.keys(dict).find((k) => k.endsWith(name));
        if (key === undefined) return;
        state.mesh.morphTargetInfluences[dict[key]] = value;
    }

    return {
        group,
        cameraZ: 3.4,
        isReady: () => !!state.mesh,
        update(level, active, time) {
            if (!state.mesh) return;

            group.rotation.y = 0; // sempre de frente, sem giro

            // Expressão de repouso "alegre": sorriso permanente + covinhas + leve aperto nas
            // bochechas e nos olhos (sorriso genuíno usa tudo isso junto, não só a boca) —
            // independente de estar falando ou não. mouthSmile sozinho neste modelo é sutil mesmo
            // no máximo (1.0), por isso combinado com os outros shapes.
            setMorph('mouthSmile_L', 0.85);
            setMorph('mouthSmile_R', 0.85);
            setMorph('mouthDimple_L', 0.3);
            setMorph('mouthDimple_R', 0.3);
            setMorph('cheekSquint_L', 0.35);
            setMorph('cheekSquint_R', 0.35);
            setMorph('eyeSquint_L', 0.12);
            setMorph('eyeSquint_R', 0.12);

            // Boca: jawOpen como controle principal, com um pouco de variação em outros
            // shapes pra não parecer um único eixo mecânico abrindo e fechando.
            const talk = active ? level : 0;
            setMorph('jawOpen', Math.min(0.85, talk * 1.6));
            setMorph('mouthFunnel', Math.max(0, Math.sin(time * 9) * 0.5 + 0.5) * talk * 0.35);
            setMorph('mouthLowerDown_L', talk * 0.5);
            setMorph('mouthLowerDown_R', talk * 0.5);

            // Sobrancelhas reagem um pouco ao volume, dão vida mesmo parado
            const idleLift = !active ? level * 0.3 : level * 0.15;
            setMorph('browInnerUp', idleLift);

            // Piscar periódico, independente da fala — só pra não ficar com "olhar morto"
            state.blinkTimer -= 0.016;
            if (state.blinkTimer <= 0) {
                state.blinkTimer = 2.5 + Math.random() * 3;
            }
            const blinkPhase = state.blinkTimer > 2.3 ? 1 - (state.blinkTimer - 2.3) / 0.2 : 0;
            const blink = Math.max(0, Math.min(1, blinkPhase));
            setMorph('eyeBlink_L', blink);
            setMorph('eyeBlink_R', blink);
        },
    };
}

export class Visualizer3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.level = 0;
        this.targetLevel = 0;
        this.active = false;
        this.running = false;
        this.time = 0;
        this.mode = localStorage.getItem('jarvis-visualizer-mode') || 'orb';
        this.clockEl = document.getElementById('ringClock');

        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        this.camera.position.set(0, 0, 6.2);

        this.scene.add(new THREE.AmbientLight(0x88aacc, 2));
        const key = new THREE.PointLight(0x00d4ff, 3, 12);
        key.position.set(1.5, 1.5, 3);
        this.scene.add(key);
        const rim = new THREE.PointLight(0x0077ff, 2, 12);
        rim.position.set(-2, 0.5, -2);
        this.scene.add(rim);

        this.orb = buildOrb();
        this.ring = buildRing();
        this.fallbackHead = buildFallbackHead();
        this.realisticHead = buildRealisticHead(this.renderer, () => this.onHeadReady());
        this.scene.add(this.orb.group, this.ring.group, this.fallbackHead.group, this.realisticHead.group);

        this.applyMode();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    // Quando o modelo real termina de carregar (assíncrono), troca o fallback por ele
    // se o usuário já estiver (ou vier a estar) no modo 'face'.
    onHeadReady() {
        this.fallbackHead.group.visible = false;
        this.applyMode();
    }

    getActiveHead() {
        return this.realisticHead.isReady() ? this.realisticHead : this.fallbackHead;
    }

    setMode(mode) {
        if (!['orb', 'face', 'ring'].includes(mode)) return;
        this.mode = mode;
        localStorage.setItem('jarvis-visualizer-mode', mode);
        this.applyMode();
    }

    getMode() {
        return this.mode;
    }

    applyMode() {
        const head = this.getActiveHead();
        this.orb.group.visible = this.mode === 'orb';
        this.ring.group.visible = this.mode === 'ring';
        this.realisticHead.group.visible = this.mode === 'face' && head === this.realisticHead;
        this.fallbackHead.group.visible = this.mode === 'face' && head === this.fallbackHead;
        const active = this.mode === 'orb' ? this.orb : this.mode === 'ring' ? this.ring : head;
        this.camera.position.z = active.cameraZ;
        if (this.clockEl) this.clockEl.style.display = this.mode === 'ring' ? 'flex' : 'none';
    }

    updateClock() {
        if (!this.clockEl) return;
        const now = new Date();
        const hours12 = now.getHours() % 12 || 12;
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
        this.clockEl.innerHTML = `${hours12}:${minutes}<span class="ring-clock-sub">${ampm}<br>:${seconds}</span>`;
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    setActive(active) {
        this.active = active;
    }

    setLevel(level) {
        this.targetLevel = Math.max(0, Math.min(1, level));
    }

    start() {
        if (this.running) return;
        this.running = true;
        const loop = () => {
            if (!this.running) return;
            this.tick();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
    }

    tick() {
        this.time += 0.016;
        this.level += (this.targetLevel - this.level) * 0.15;
        const idlePulse = !this.active ? ((Math.sin(this.time * 1.4) + 1) / 2) * 0.25 : 0;
        const glow = Math.min(1, this.level + idlePulse);

        if (this.mode === 'orb') {
            this.orb.update(glow, this.active, this.time);
        } else if (this.mode === 'ring') {
            this.ring.update(glow, this.active, this.time);
            this.updateClock();
        } else {
            this.getActiveHead().update(glow, this.active, this.time);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

window.Visualizer3D = Visualizer3D;
