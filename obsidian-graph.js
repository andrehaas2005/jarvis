/**
 * Visualização em grafo do vault Obsidian (SCRUM-63) no painel top-right do HUD —
 * troca de lugar com o radar via um botão de alternância (ver setupObsidianGraph()
 * em script.js). Layout força-dirigida simples (repulsão entre nós + mola nas
 * arestas), calculado uma vez por atualização — sem física contínua, pra não gastar
 * CPU/bateria à toa numa tela que já tem bastante coisa animada.
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

class ObsidianGraphView {
    constructor(canvas, emptyEl, countEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.emptyEl = emptyEl;
        this.countEl = countEl;
        this.nodes = [];
        this.edges = [];
        this.hoveredNode = null;

        this.canvas.addEventListener('mousemove', (e) => this._onHover(e));
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredNode = null;
            this._draw();
        });

        this._resizeObserver = new ResizeObserver(() => this._resizeAndDraw());
        this._resizeObserver.observe(canvas.parentElement);
    }

    setData(graph) {
        const { nodes, edges } = graph;
        if (this.countEl) this.countEl.textContent = nodes.length ? `(${nodes.length})` : '';
        if (this.emptyEl) this.emptyEl.hidden = nodes.length > 0;
        this.canvas.hidden = nodes.length === 0;
        if (!nodes.length) return;

        // Posição inicial em círculo — evita que a simulação comece com todo
        // mundo empilhado no centro (converge mais rápido e sem NaN por divisão
        // por distância zero).
        const angleStep = (Math.PI * 2) / nodes.length;
        this.nodes = nodes.map((n, i) => ({
            ...n,
            x: Math.cos(i * angleStep) * 100,
            y: Math.sin(i * angleStep) * 100,
            vx: 0,
            vy: 0,
        }));
        const byId = new Map(this.nodes.map((n) => [n.id, n]));
        this.edges = edges
            .map((e) => ({ source: byId.get(e.source), target: byId.get(e.target) }))
            .filter((e) => e.source && e.target);

        this._simulate();
        this._resizeAndDraw();
    }

    // Fruchterman-Reingold simplificado: nós se repelem, arestas puxam como mola.
    // Poucas iterações (isto não é uma tela de física em tempo real, é só um
    // layout calculado uma vez por refresh).
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

    _resizeAndDraw() {
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
        this._draw();
    }

    _toGraphCoords(px, py, rect) {
        // Inversa da transformação usada em _draw(): origem no centro, escala fixa.
        const scale = this._scale || 1;
        return { x: (px - rect.width / 2) / scale, y: (py - rect.height / 2) / scale };
    }

    _draw() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        if (!this.nodes.length) return;

        const xs = this.nodes.map((n) => n.x);
        const ys = this.nodes.map((n) => n.y);
        const spanX = Math.max(...xs) - Math.min(...xs) || 1;
        const spanY = Math.max(...ys) - Math.min(...ys) || 1;
        const scale = Math.min((rect.width - 60) / spanX, (rect.height - 60) / spanY, 6);
        this._scale = scale;

        ctx.save();
        ctx.translate(rect.width / 2, rect.height / 2);
        ctx.scale(scale, scale);

        ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
        ctx.lineWidth = 1 / scale;
        for (const e of this.edges) {
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
        }

        for (const n of this.nodes) {
            const color = OBSIDIAN_GRAPH_COLORS[n.folder] || '#00d4ff';
            const isHovered = this.hoveredNode === n;
            ctx.beginPath();
            ctx.arc(n.x, n.y, isHovered ? 5 / scale : 3.2 / scale, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = isHovered ? 12 : 4;
            ctx.fill();
        }
        ctx.restore();
        ctx.shadowBlur = 0;

        if (this.hoveredNode) {
            const n = this.hoveredNode;
            const screenX = rect.width / 2 + n.x * scale;
            const screenY = rect.height / 2 + n.y * scale;
            ctx.font = '11px Roboto, sans-serif';
            const label = n.title;
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(0, 8, 20, 0.9)';
            ctx.fillRect(screenX + 8, screenY - 10, textWidth + 10, 18);
            ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
            ctx.strokeRect(screenX + 8, screenY - 10, textWidth + 10, 18);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, screenX + 13, screenY + 3);
        }
    }
}

// Instância única, criada sob demanda quando o painel é aberto pela primeira vez
// (setupObsidianGraph() em script.js) — não custa nada enquanto ninguém troca pro grafo.
window.ObsidianGraphView = ObsidianGraphView;
