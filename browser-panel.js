// Navegador interno do JARVIS (SCRUM-69) — painel flutuante com abas e favoritos.
//
// Screenshot real via Chromium headless no backend (não <iframe> — a maioria dos
// sites bloqueia embed, e embutir a página de verdade abriria a porta pra JS de
// terceiros rodar dentro do HUD). Dois jeitos de controlar a mesma aba: o próprio
// Jarvis (tools `browser_*`, ver backend/mcp_servers/browser) e o usuário direto
// aqui (digitar URL, clicar na imagem, favoritar) — mesmos endpoints REST por trás
// dos dois (ver /browser/* em backend/app/main.py).
(function () {
    'use strict';

    const BROWSER_BACKEND_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'http://localhost:8000'
        : 'https://jarvis-api.andre.haas.nom.br';

    const POLL_MS = 1500;
    const WATCH_MS = 3000;

    class JarvisBrowserPanel {
        constructor() {
            this.panel = document.getElementById('browserPanel');
            if (!this.panel) return; // login.html/terms.html etc. não têm o painel

            this.tabsStrip = document.getElementById('browserTabsStrip');
            this.tabNewBtn = document.getElementById('browserTabNew');
            this.closeBtn = document.getElementById('browserPanelClose');
            this.addressInput = document.getElementById('browserAddressInput');
            this.favoriteStar = document.getElementById('browserFavoriteStar');
            this.favoritesToggle = document.getElementById('browserFavoritesToggle');
            this.viewport = document.getElementById('browserViewport');
            this.screenshot = document.getElementById('browserScreenshot');
            this.emptyState = document.getElementById('browserEmpty');
            this.favoritesPanel = document.getElementById('browserFavoritesPanel');
            this.favoritesList = document.getElementById('browserFavoritesList');
            this.typeInput = document.getElementById('browserTypeInput');
            this.typeSend = document.getElementById('browserTypeSend');
            this.topbarBtn = document.getElementById('topbarBrowser');

            this.tabs = [];
            this.activeTabId = null;
            this.favorites = [];
            this.pollTimer = null;

            // Abas que o painel já "viu" (mostrou o painel ou o usuário já sabe que
            // existem) — usado pelo vigia global abaixo pra só abrir o painel sozinho
            // quando surge uma aba REALMENTE nova, nunca de novo pra uma que já foi
            // vista (ex.: o usuário fechou o painel de propósito).
            this.knownTabIds = new Set();
            this.watchTimer = null;

            this._setupEventListeners();
            this._startGlobalWatcher();
        }

        /** Vigia contínuo (roda sempre, painel aberto ou não) que detecta quando o
         * Jarvis abre uma aba por conta própria — via voz ou chat — e mostra o
         * painel sozinho pro usuário. Existe porque, no fluxo de voz, o SDK da
         * ElevenLabs só expõe o nome da ferramenta externa 'jarvis_backend' (o
         * wrapper) — a decisão de chamar `browser_open` acontece escondida DENTRO
         * do backend, então não dá pra saber "abriu uma aba" só escutando o evento
         * de tool-call da voz (achado real em produção: a aba abria de verdade no
         * servidor, mas o painel nunca aparecia, porque esse gatilho por nome de
         * ferramenta nunca disparava). Observar o estado real (`GET /browser/tabs`)
         * em vez de adivinhar por nome de evento funciona pra voz E pra chat, sem
         * precisar que o backend avise de volta. */
        async _startGlobalWatcher() {
            try {
                const data = await this._api('/browser/tabs');
                (data.tabs || []).forEach((t) => this.knownTabIds.add(t.tab_id));
            } catch (error) {
                // sem sessão/login ainda — tenta de novo no próximo tick
            }
            this.watchTimer = setInterval(() => this._checkForNewTabs(), WATCH_MS);
        }

        async _checkForNewTabs() {
            let data;
            try {
                data = await this._api('/browser/tabs');
            } catch (error) {
                return;
            }
            const tabs = data.tabs || [];
            const newTabs = tabs.filter((t) => !this.knownTabIds.has(t.tab_id));
            tabs.forEach((t) => this.knownTabIds.add(t.tab_id));

            if (newTabs.length) {
                this.tabs = tabs;
                const wasHidden = this.panel.hidden;
                if (wasHidden) {
                    this.activeTabId = newTabs[newTabs.length - 1].tab_id;
                    this.open();
                } else {
                    this._renderTabs();
                }
            } else if (!this.panel.hidden) {
                // painel já aberto: mantém a tira de abas atualizada (título/URL podem
                // ter mudado) sem interromper o que o usuário está olhando.
                this.tabs = tabs;
                this._renderTabs();
            }
        }

        _authHeaders() {
            const token = localStorage.getItem('jarvis-auth-token');
            return token ? { Authorization: `Bearer ${token}` } : {};
        }

        async _api(path, options = {}) {
            const response = await fetch(`${BROWSER_BACKEND_URL}${path}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...this._authHeaders(),
                    ...(options.headers || {}),
                },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.detail || `Erro ${response.status}`);
            }
            return response.json();
        }

        open() {
            this.panel.hidden = false;
            this._loadTabs();
            this._loadFavorites();
            this._startPolling();
        }

        close() {
            this.panel.hidden = true;
            this._stopPolling();
        }

        toggle() {
            if (this.panel.hidden) this.open();
            else this.close();
        }

        _startPolling() {
            this._stopPolling();
            this.pollTimer = setInterval(() => {
                if (this.activeTabId) this._loadScreenshot();
            }, POLL_MS);
        }

        _stopPolling() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        async _loadTabs() {
            try {
                const data = await this._api('/browser/tabs');
                this.tabs = data.tabs || [];
                if (!this.tabs.some((t) => t.tab_id === this.activeTabId)) {
                    this.activeTabId = this.tabs.length ? this.tabs[0].tab_id : null;
                }
                this._renderTabs();
                if (this.activeTabId) this._loadScreenshot();
                else this._showEmpty();
            } catch (error) {
                console.warn('Falha ao listar abas do navegador interno:', error.message);
            }
        }

        _renderTabs() {
            this.tabsStrip.innerHTML = '';
            for (const tab of this.tabs) {
                const el = document.createElement('div');
                el.className = `browser-tab${tab.tab_id === this.activeTabId ? ' active' : ''}`;
                el.title = tab.url;
                const titleEl = document.createElement('span');
                titleEl.className = 'browser-tab-title';
                titleEl.textContent = tab.title || tab.url || 'Nova aba';
                const closeEl = document.createElement('button');
                closeEl.className = 'browser-tab-close';
                closeEl.textContent = '×';
                closeEl.title = 'Fechar aba';
                closeEl.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this._closeTab(tab.tab_id);
                });
                el.appendChild(titleEl);
                el.appendChild(closeEl);
                el.addEventListener('click', () => this._selectTab(tab.tab_id));
                this.tabsStrip.appendChild(el);
            }
        }

        _selectTab(tabId) {
            this.activeTabId = tabId;
            const tab = this.tabs.find((t) => t.tab_id === tabId);
            this.addressInput.value = tab ? tab.url : '';
            this._renderTabs();
            this._loadScreenshot();
            this._updateFavoriteStar();
        }

        async _closeTab(tabId) {
            try {
                await this._api(`/browser/tabs/${tabId}`, { method: 'DELETE' });
            } catch (error) {
                console.warn('Falha ao fechar aba:', error.message);
            }
            if (this.activeTabId === tabId) this.activeTabId = null;
            this._loadTabs();
        }

        async _loadScreenshot() {
            if (!this.activeTabId) return;
            try {
                const data = await this._api(`/browser/tabs/${this.activeTabId}/screenshot`);
                this.screenshot.src = `data:image/jpeg;base64,${data.image_b64}`;
                this.screenshot.hidden = false;
                this.emptyState.hidden = true;
                const tab = this.tabs.find((t) => t.tab_id === this.activeTabId);
                if (tab) this.addressInput.value = tab.url;
            } catch (error) {
                console.warn('Falha ao buscar screenshot:', error.message);
            }
        }

        _showEmpty() {
            this.screenshot.hidden = true;
            this.emptyState.hidden = false;
            this.addressInput.value = '';
        }

        async _openUrl(url, tabId) {
            if (!url) return;
            try {
                const tab = await this._api('/browser/tabs', {
                    method: 'POST',
                    body: JSON.stringify({ url, tab_id: tabId || '' }),
                });
                this.activeTabId = tab.tab_id;
                await this._loadTabs();
                this._updateFavoriteStar();
            } catch (error) {
                console.warn('Falha ao abrir URL:', error.message);
                this.emptyState.textContent = `Não consegui abrir: ${error.message}`;
                this._showEmpty();
            }
        }

        _updateFavoriteStar() {
            const tab = this.tabs.find((t) => t.tab_id === this.activeTabId);
            const isFav = tab && this.favorites.some((f) => f.url === tab.url);
            this.favoriteStar.classList.toggle('active', Boolean(isFav));
            this.favoriteStar.textContent = isFav ? '★' : '☆';
        }

        async _loadFavorites() {
            try {
                const data = await this._api('/browser/bookmarks');
                this.favorites = data.bookmarks || [];
                this._renderFavorites();
                this._updateFavoriteStar();
            } catch (error) {
                console.warn('Falha ao buscar favoritos:', error.message);
            }
        }

        _renderFavorites() {
            this.favoritesList.innerHTML = '';
            if (!this.favorites.length) {
                const empty = document.createElement('div');
                empty.className = 'browser-favorites-empty';
                empty.textContent = 'Nenhum favorito salvo ainda.';
                this.favoritesList.appendChild(empty);
                return;
            }
            for (const fav of this.favorites) {
                const item = document.createElement('div');
                item.className = 'browser-favorite-item';
                const info = document.createElement('div');
                info.className = 'browser-favorite-info';
                const title = document.createElement('div');
                title.className = 'browser-favorite-title';
                title.textContent = fav.title || fav.url;
                const url = document.createElement('div');
                url.className = 'browser-favorite-url';
                url.textContent = fav.url;
                info.appendChild(title);
                info.appendChild(url);
                const removeBtn = document.createElement('button');
                removeBtn.className = 'browser-favorite-remove';
                removeBtn.textContent = '✕';
                removeBtn.title = 'Remover favorito';
                removeBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this._removeFavorite(fav.id);
                });
                item.appendChild(info);
                item.appendChild(removeBtn);
                item.addEventListener('click', () => this._openUrl(fav.url, this.activeTabId));
                this.favoritesList.appendChild(item);
            }
        }

        async _toggleCurrentFavorite() {
            const tab = this.tabs.find((t) => t.tab_id === this.activeTabId);
            if (!tab) return;
            const existing = this.favorites.find((f) => f.url === tab.url);
            try {
                if (existing) {
                    await this._api(`/browser/bookmarks/${existing.id}`, { method: 'DELETE' });
                } else {
                    await this._api('/browser/bookmarks', {
                        method: 'POST',
                        body: JSON.stringify({ title: tab.title || tab.url, url: tab.url }),
                    });
                }
                await this._loadFavorites();
            } catch (error) {
                console.warn('Falha ao favoritar:', error.message);
            }
        }

        async _removeFavorite(id) {
            try {
                await this._api(`/browser/bookmarks/${id}`, { method: 'DELETE' });
            } catch (error) {
                console.warn('Falha ao remover favorito:', error.message);
            }
            this._loadFavorites();
        }

        async _onScreenshotClick(event) {
            if (!this.activeTabId) return;
            // Mapeia a posição do clique na imagem exibida (que pode estar redimensionada
            // por CSS) pra coordenadas reais da página (viewport 1280x800 no backend).
            const rect = this.screenshot.getBoundingClientRect();
            const scaleX = this.screenshot.naturalWidth / rect.width;
            const scaleY = this.screenshot.naturalHeight / rect.height;
            const x = (event.clientX - rect.left) * scaleX;
            const y = (event.clientY - rect.top) * scaleY;
            try {
                await this._api(`/browser/tabs/${this.activeTabId}/click`, {
                    method: 'POST',
                    body: JSON.stringify({ x, y }),
                });
                this._loadScreenshot();
            } catch (error) {
                console.warn('Falha ao clicar na página:', error.message);
            }
        }

        async _onScroll(direction) {
            if (!this.activeTabId) return;
            try {
                await this._api(`/browser/tabs/${this.activeTabId}/scroll`, {
                    method: 'POST',
                    body: JSON.stringify({ direction, amount: 700 }),
                });
                this._loadScreenshot();
            } catch (error) {
                console.warn('Falha ao rolar a página:', error.message);
            }
        }

        async _sendType() {
            const text = this.typeInput.value.trim();
            if (!text || !this.activeTabId) return;
            try {
                await this._api(`/browser/tabs/${this.activeTabId}/type`, {
                    method: 'POST',
                    body: JSON.stringify({ text, press_enter: true }),
                });
                this.typeInput.value = '';
                this._loadScreenshot();
            } catch (error) {
                console.warn('Falha ao digitar na página:', error.message);
            }
        }

        /** Chamado de fora (script.js) depois de qualquer resposta do Jarvis — força
         * o vigia contínuo a checar agora em vez de esperar o próximo tick, pra
         * abrir o painel mais rápido quando ele acabou de navegar. */
        checkNow() {
            this._checkForNewTabs();
        }

        _setupEventListeners() {
            this.topbarBtn?.addEventListener('click', () => this.toggle());
            this.closeBtn?.addEventListener('click', () => this.close());
            this.tabNewBtn?.addEventListener('click', () => {
                this.activeTabId = null;
                this._renderTabs();
                this._showEmpty();
                this.addressInput.focus();
            });
            this.addressInput?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._openUrl(this.addressInput.value.trim(), this.activeTabId);
                }
            });
            this.favoriteStar?.addEventListener('click', () => this._toggleCurrentFavorite());
            this.favoritesToggle?.addEventListener('click', () => {
                this.favoritesPanel.hidden = !this.favoritesPanel.hidden;
            });
            this.screenshot?.addEventListener('click', (event) => this._onScreenshotClick(event));
            this.viewport?.addEventListener(
                'wheel',
                (event) => {
                    event.preventDefault();
                    this._onScroll(event.deltaY > 0 ? 'down' : 'up');
                },
                { passive: false }
            );
            this.typeSend?.addEventListener('click', () => this._sendType());
            this.typeInput?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._sendType();
                }
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !this.panel.hidden) this.close();
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.jarvisBrowserPanel = new JarvisBrowserPanel();
    });
})();
