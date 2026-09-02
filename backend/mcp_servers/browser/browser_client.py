"""Cliente do navegador interno do JARVIS (SCRUM-69) — painel flutuante no HUD
onde o Jarvis navega, lê e mostra páginas de verdade, com abas e favoritos.

Decisão de design: screenshot real via Chromium headless (Playwright), não
extração de texto — pedido explícito do usuário ("navegador interno de
verdade", visual fiel a qualquer site). Trade-off consciente: pesa mais no
VPS (2 vCPUs, ~72% de memória em uso antes disso existir) do que uma
extração de texto leve teria pesado — por isso os limites abaixo
(MAX_TABS baixo, timeout de ociosidade agressivo, 1 browser compartilhado
em vez de 1 processo por aba) não são só otimização, são a diferença entre
essa feature conviver com o resto dos serviços no mesmo VPS ou derrubá-los.

Um `Browser` Chromium só, compartilhado entre todas as abas (contextos/páginas
dentro dele) — abrir um processo Chromium por aba seria ordens de grandeza
mais pesado. Lançado sob demanda na primeira chamada, nunca no boot do
backend (silêncio do resto do tempo = zero custo de memória).
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.logging_config import get_logger

logger = get_logger("jarvis.mcp.browser")

DEFAULT_MAX_TABS = 3
DEFAULT_IDLE_TIMEOUT_SECONDS = 600  # 10min sem uso -> aba fechada sozinha
VIEWPORT = {"width": 1280, "height": 800}


@dataclass
class Tab:
    id: str
    page: Any  # playwright.async_api.Page — tipado como Any pra não forçar import no topo
    title: str = ""
    url: str = ""
    last_used: float = field(default_factory=time.time)


class BrowserManager:
    """Gerencia o Chromium compartilhado e as abas abertas. Uma instância só
    por processo backend (singleton em `_get_manager` no server.py) — este
    é um assistente pessoal de um usuário só, não precisa isolar por sessão."""

    def __init__(self, max_tabs: int = DEFAULT_MAX_TABS, idle_timeout_seconds: int = DEFAULT_IDLE_TIMEOUT_SECONDS):
        self.max_tabs = max_tabs
        self.idle_timeout_seconds = idle_timeout_seconds
        self._playwright = None
        self._browser = None
        self.tabs: dict[str, Tab] = {}

    async def _ensure_browser(self):
        if self._browser is not None:
            return self._browser
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        logger.info("browser_chromium_launched", extra={"extra_fields": {}})
        return self._browser

    async def _evict_idle(self) -> None:
        now = time.time()
        idle_ids = [t.id for t in self.tabs.values() if now - t.last_used > self.idle_timeout_seconds]
        for tab_id in idle_ids:
            await self.close_tab(tab_id)

    async def _evict_oldest_if_full(self) -> None:
        if len(self.tabs) < self.max_tabs:
            return
        oldest = min(self.tabs.values(), key=lambda t: t.last_used)
        await self.close_tab(oldest.id)

    async def list_tabs(self) -> list[dict[str, str]]:
        await self._evict_idle()
        return [{"tab_id": t.id, "title": t.title, "url": t.url} for t in self.tabs.values()]

    async def open(self, url: str, tab_id: str | None = None) -> Tab:
        """Navega numa aba existente (`tab_id`) ou abre uma nova. Sem
        `tab_id` e já no limite de abas, fecha a mais ociosa antes de abrir
        (nunca deixa crescer sem limite)."""
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        browser = await self._ensure_browser()
        await self._evict_idle()

        if tab_id and tab_id in self.tabs:
            tab = self.tabs[tab_id]
        else:
            await self._evict_oldest_if_full()
            page = await browser.new_page(viewport=VIEWPORT)
            tab = Tab(id=str(uuid.uuid4())[:8], page=page)
            self.tabs[tab.id] = tab

        await tab.page.goto(url, wait_until="domcontentloaded", timeout=20_000)
        tab.title = await tab.page.title()
        tab.url = tab.page.url
        tab.last_used = time.time()
        return tab

    def _get(self, tab_id: str) -> Tab:
        tab = self.tabs.get(tab_id)
        if not tab:
            raise ValueError(f"Aba '{tab_id}' não existe (pode ter sido fechada por ociosidade — abra de novo).")
        return tab

    async def screenshot_b64(self, tab_id: str) -> str:
        import base64

        tab = self._get(tab_id)
        tab.last_used = time.time()
        png = await tab.page.screenshot(type="jpeg", quality=65)
        return base64.b64encode(png).decode("ascii")

    async def scroll(self, tab_id: str, direction: str, amount: int = 700) -> Tab:
        tab = self._get(tab_id)
        delta = amount if direction == "down" else -amount
        await tab.page.mouse.wheel(0, delta)
        tab.last_used = time.time()
        return tab

    async def click(self, tab_id: str, x: float, y: float) -> Tab:
        tab = self._get(tab_id)
        await tab.page.mouse.click(x, y)
        await tab.page.wait_for_timeout(300)
        tab.title = await tab.page.title()
        tab.url = tab.page.url
        tab.last_used = time.time()
        return tab

    async def type_text(self, tab_id: str, text: str, press_enter: bool = False) -> Tab:
        tab = self._get(tab_id)
        await tab.page.keyboard.type(text, delay=15)
        if press_enter:
            await tab.page.keyboard.press("Enter")
            await tab.page.wait_for_timeout(500)
        tab.title = await tab.page.title()
        tab.url = tab.page.url
        tab.last_used = time.time()
        return tab

    async def close_tab(self, tab_id: str) -> None:
        tab = self.tabs.pop(tab_id, None)
        if tab:
            await tab.page.close()


class BookmarkStore:
    """Favoritos — lista própria simples (título, URL, data), separada do
    segundo cérebro (Obsidian) de propósito: são coisas rápidas tipo "voltar
    aqui depois", não conhecimento curado. Quando uma página é relevante o
    bastante pra virar conhecimento permanente, isso vira uma nota no vault
    via `write_note` (decisão do modelo, ver regra no system prompt) — não
    uma linha aqui. Arquivo JSON com escrita atômica (mesmo padrão do
    ObsidianClient: tmp file + rename, nunca corrompe se ler e escrever
    coincidirem)."""

    def __init__(self, path: str):
        self.path = Path(path).expanduser()

    def _read_all(self) -> list[dict[str, str]]:
        if not self.path.exists():
            return []
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("browser_bookmarks_read_failed", extra={"extra_fields": {"path": str(self.path)}})
            return []

    def _write_all(self, items: list[dict[str, str]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=self.path.parent, prefix=".bookmarks.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.path)
        except Exception:
            Path(tmp_path).unlink(missing_ok=True)
            raise

    def list(self) -> list[dict[str, str]]:
        return self._read_all()

    def add(self, title: str, url: str) -> dict[str, str]:
        from datetime import datetime, timezone

        items = self._read_all()
        item = {
            "id": str(uuid.uuid4())[:8],
            "title": title,
            "url": url,
            "added_at": datetime.now(timezone.utc).isoformat(),
        }
        items.insert(0, item)
        self._write_all(items)
        return item

    def remove(self, bookmark_id: str) -> bool:
        items = self._read_all()
        remaining = [b for b in items if b["id"] != bookmark_id]
        if len(remaining) == len(items):
            return False
        self._write_all(remaining)
        return True
