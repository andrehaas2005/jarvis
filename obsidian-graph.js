/**
 * Visualização em grafo do vault Obsidian (SCRUM-63) no painel top-right do HUD —
 * troca de lugar com o radar via um botão de alternância (ver setupObsidianGraph()
 * em script.js). Visual inspirado no grafo nativo do app Obsidian (setas indicando
 * direção do link + animação de fluxo nas linhas), pedido explícito do usuário.
 *
 * Layout força-dirigida simples (repulsão entre nós + mola nas arestas), calculado
 * uma vez por atualização de dados — a ANIMAÇÃO em si (setas "fluindo" nas linhas,
 * pulso sutil nos nós) roda à parte, via requestAnimationFrame, só enquanto o painel
 * está visível (para/começa junto com o toggle radar↔grafo, sem gastar CPU à toa).
 *
 * Cores por pasta, no mesmo espírito da paleta do HUD (--hud-blue/--hud-cyan/etc.).
 */

const OBSIDIAN_GRAPH_COLORS = {
    Fatos: '#00d4ff',
    Pessoas: '#ff6b35',
    Projetos: '#00ff88',
    Diario: '#ffaa00',
    '': '#ffffff', // raiz do vault (ex.: _index.md)
};

const NODE_RADIUS = 3.4;
const ARROW_LENGTH = 2.2;
const ARROW_WIDTH = 1.6;
// Velocidade do "fluxo" animado nas linhas (dash marchando do nó de origem pro
// destino) — pixels de espaço-do-grafo por segundo.
const DASH_FLOW_SPEED = 6;

class ObsidianGraphView {
    constructor(canvas, emptyEl, countEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.emptyEl = emptyEl;
        this.countEl = countEl;
        this.nodes = [];
        this.edges = [];
        this.hoveredNode = null;
        this._animFrame = null;
        this._lastTs = 0;
        this._dashOffset = 0;

        this.canvas.addEventListener('mousemove', (e) => this._onHover(e));
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredNode = null;
        });

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(canvas.parentElement);
    }

    setData(graph) {
        const { nodes, edges } = graph;
        if (this.countEl) this.countEl.textContent = nodes.length ? `(${nodes.length})` : '';
        if (this.emptyEl) this.emptyEl.hidden = nodes.length > 0;
        this.canvas.hidden = nodes.length === 0;
        if (!nodes.length) {
            this.nodes = [];
            this.edges = [];
            return;
        }

        // Posição inicial em círculo — evita que a simulação comece com todo
        // mundo empilhado no centro (converge mais rápido e sem NaN por divisão
        // por distância zero).
        const angleStep = (Math.PI * 2) / nodes.length;
        this.nodes = nodes.map((n, i) => ({
            ...n,
            x: Math.cos(i * angleStep) * 100,
            y: Math.sin(i * angleStep) * 100,
        }));
        const byId = new Map(this.nodes.map((n) => [n.id, n]));
        this.edges = edges
            .map((e) => ({ source: byId.get(e.source), target: byId.get(e.target) }))
            .filter((e) => e.source && e.target);

        this._simulate();
        this._resize();
    }

    // Fruchterman-Reingold simplificado: nós se repelem, arestas puxam como mola.
    // Poucas iterações — layout calculado uma vez por refresh, não física em
    // tempo real (isso fica na animação de linhas, mais barata de rodar sempre).
    _simulate(iterations = 200) {
        const nodes = this.nodes;
        if (!nodes.length) return;
        const area = 260 * 260;
        const k = Math.sqrt(area / nodes.length);

        for (let iter = 0; iter < iterations; iter++) {
            for (const n of nodes) {
                n.fx = 0;
                n.fy = 0;
            }
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i];
                    const b = nodes[j];
                    let dx = a.x - b.x;
                    let dy = a.y - b.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                    const repulse = (k * k) / dist;
                    dx = (dx / dist) * repulse;
                    dy = (dy / dist) * repulse;
                    a.fx += dx;
                    a.fy += dy;
                    b.fx -= dx;
                    b.fy -= dy;
                }
            }
            for (const e of this.edges) {
                let dx = e.source.x - e.target.x;
                let dy = e.source.y - e.target.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                const attract = (dist * dist) / k;
                dx = (dx / dist) * attract;
                dy = (dy / dist) * attract;
                e.source.fx -= dx;
                e.source.fy -= dy;
                e.target.fx += dx;
                e.target.fy += dy;
            }
            const temp = 10 * (1 - iter / iterations);
            for (const n of nodes) {
                const disp = Math.sqrt(n.fx * n.fx + n.fy * n.fy) || 0.01;
                n.x += (n.fx / disp) * Math.min(disp, temp);
                n.y += (n.fy / disp) * Math.min(disp, temp);
            }
        }
    }

    _resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._draw();
    }

    _onHover(event) {
        if (!this.nodes.length) return;
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this._toGraphCoords(event.clientX - rect.left, event.clientY - rect.top, rect);
        let closest = null;
        let closestDist = Infinity;
        for (const n of this.nodes) {
            const d = Math.hypot(n.x - x, n.y - y);
            if (d < closestDist) {
                closestDist = d;
                closest = n;
            }
        }
        this.hoveredNode = closestDist < 18 ? closest : null;
    }

    _toGraphCoords(px, py, rect) {
        const scale = this._scale || 1;
        return { x: (px - rect.width / 2) / scale, y: (py - rect.height / 2) / scale };
    }

    // Início/parada do loop de animação — chamado de fora (setupObsidianGraph() em
    // script.js) junto com o toggle radar↔grafo, pra não gastar CPU com o painel
    // escondido.
    startAnimation() {
        if (this._animFrame) return;
        this._lastTs = performance.now();
        const loop = (ts) => {
            const dt = (ts - this._lastTs) / 1000;
            this._lastTs = ts;
            this._dashOffset -= DASH_FLOW_SPEED * dt;
            this._draw(ts / 1000);
            this._animFrame = requestAnimationFrame(loop);
        };
        this._animFrame = requestAnimationFrame(loop);
    }

    stopAnimation() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
    }

    _draw(t = 0) {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        if (!this.nodes.length) return;

        const xs = this.nodes.map((n) => n.x);
        const ys = this.nodes.map((n) => n.y);
        const spanX = Math.max(...xs) - Math.min(...xs) || 1;
        const spanY = Math.max(...ys) - Math.min(...ys) || 1;
        const scale = Math.min((rect.width - 70) / spanX, (rect.height - 70) / spanY, 6);
        this._scale = scale;

        ctx.save();
        ctx.translate(rect.width / 2, rect.height / 2);
        ctx.scale(scale, scale);

        // Arestas com seta (direção source -> target) e animação de "fluxo" (dash
        // marchando), igual ao pedido — inspirado no grafo nativo do Obsidian.
        ctx.lineWidth = 0.6 / scale;
        ctx.setLineDash([1.5 / scale, 1.5 / scale]);
        for (const e of this.edges) {
            const highlighted =
                this.hoveredNode && (e.source === this.hoveredNode || e.target === this.hoveredNode);
            ctx.strokeStyle = highlighted ? 'rgba(0, 212, 255, 0.9)' : 'rgba(0, 212, 255, 0.35)';
            ctx.lineDashOffset = this._dashOffset;

            const dx = e.target.x - e.source.x;
            const dy = e.target.y - e.source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const ux = dx / dist;
            const uy = dy / dist;
            // Encosta a linha na borda dos círculos, não no centro — e para antes
            // da ponta da seta, senão a linha "vaza" através da seta.
            const startX = e.source.x + ux * NODE_RADIUS;
            const startY = e.source.y + uy * NODE_RADIUS;
            const endX = e.target.x - ux * (NODE_RADIUS + ARROW_LENGTH);
            const endY = e.target.y - uy * (NODE_RADIUS + ARROW_LENGTH);

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // Seta (triângulo) apontando pro nó de destino.
            const tipX = e.target.x - ux * NODE_RADIUS;
            const tipY = e.target.y - uy * NODE_RADIUS;
            const perpX = -uy;
            const perpY = ux;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(endX + perpX * ARROW_WIDTH, endY + perpY * ARROW_WIDTH);
            ctx.lineTo(endX - perpX * ARROW_WIDTH, endY - perpY * ARROW_WIDTH);
            ctx.closePath();
            ctx.fillStyle = highlighted ? 'rgba(0, 212, 255, 0.9)' : 'rgba(0, 212, 255, 0.45)';
            ctx.fill();
            ctx.setLineDash([1.5 / scale, 1.5 / scale]);
        }
        ctx.setLineDash([]);

        // Nós — pulso sutil (respiração) pra dar vida sem exigir física a cada
        // frame; o nó em hover fica maior e brilhante.
        for (const n of this.nodes) {
            const color = OBSIDIAN_GRAPH_COLORS[n.folder] || '#00d4ff';
            const isHovered = this.hoveredNode === n;
            const breathe = 1 + Math.sin(t * 1.6 + (n.x + n.y)) * 0.08;
            ctx.beginPath();
            ctx.arc(n.x, n.y, isHovered ? NODE_RADIUS * 1.5 : NODE_RADIUS * breathe, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = isHovered ? 14 : 5;
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Rótulos sempre visíveis (não só no hover) — igual ao grafo nativo do
        // Obsidian, que o usuário pediu como referência visual.
        ctx.font = `${2.6 / scale}px 'Roboto', sans-serif`;
        ctx.textBaseline = 'middle';
        for (const n of this.nodes) {
            const isHovered = this.hoveredNode === n;
            ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.75)';
            ctx.fillText(n.title, n.x + (NODE_RADIUS + 1.5) / scale, n.y);
        }

        ctx.restore();
    }
}

// Instância única, criada sob demanda quando o painel é aberto pela primeira vez
// (setupObsidianGraph() em script.js) — não custa nada enquanto ninguém troca pro grafo.
window.ObsidianGraphView = ObsidianGraphView;
