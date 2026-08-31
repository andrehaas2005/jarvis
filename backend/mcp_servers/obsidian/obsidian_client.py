"""Cliente de baixo nível do vault Obsidian (SCRUM-63) — "segundo cérebro" do Jarvis.

Filesystem puro (arquivos .md comuns), sem depender do app Obsidian estar aberto — o
vault é sincronizado entre o Mac do usuário (onde ele edita normalmente no app) e o
VPS via Syncthing (ou equivalente), e este módulo só lê/escreve nessa pasta como
qualquer outro diretório.

Escrita via arquivo temporário + rename atômico: evita corromper a nota se o Syncthing
ou o app Obsidian estiverem com a pasta aberta/sincronizando no mesmo instante.

Frontmatter: parser mínimo próprio (não puxa PyYAML como dependência nova) — cobre só
o formato simples que o próprio Jarvis gera (`chave: valor` e `chave: [a, b, c]`),
suficiente pro caso de uso; não é um parser YAML genérico.

Este módulo não sabe nada sobre MCP — só encapsula o filesystem. Quem expõe isso como
ferramentas MCP é o `server.py` deste mesmo pacote.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)


@dataclass
class Note:
    path: str  # relativo ao vault, ex.: "Fatos/comida-favorita.md"
    title: str
    content: str  # corpo, sem o frontmatter
    tags: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)  # títulos de outras notas citadas via [[...]]
    frontmatter: dict[str, Any] = field(default_factory=dict)


class ObsidianClient:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path).expanduser().resolve()

    def _resolve(self, rel_path: str) -> Path:
        """Resolve um path relativo ao vault, garantindo que não escapa dele
        (proteção contra path traversal — `../../etc/passwd` etc.)."""
        if not rel_path.endswith(".md"):
            rel_path = f"{rel_path}.md"
        full = (self.vault_path / rel_path).resolve()
        if self.vault_path not in full.parents and full != self.vault_path:
            raise ValueError(f"Path fora do vault: {rel_path}")
        return full

    def ensure_vault_ok(self) -> None:
        """Levanta erro claro se o vault não existe ou não é gravável — usado tanto
        no dispatch das tools quanto no connection_check (SCRUM-60)."""
        if not self.vault_path.exists():
            raise RuntimeError(f"Vault Obsidian não encontrado em {self.vault_path}")
        if not os.access(self.vault_path, os.W_OK):
            raise RuntimeError(f"Vault Obsidian sem permissão de escrita em {self.vault_path}")

    @staticmethod
    def _parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
        match = _FRONTMATTER_RE.match(raw)
        if not match:
            return {}, raw
        fm_block, body = match.groups()
        fm: dict[str, Any] = {}
        for line in fm_block.splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                items = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
                fm[key] = items
            else:
                fm[key] = value.strip("'\"")
        return fm, body.lstrip("\n")

    @staticmethod
    def _render_frontmatter(frontmatter: dict[str, Any]) -> str:
        lines = ["---"]
        for key, value in frontmatter.items():
            if isinstance(value, list):
                lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
            else:
                lines.append(f"{key}: {value}")
        lines.append("---")
        return "\n".join(lines)

    def _load_note(self, rel_path: str) -> Note:
        full = self._resolve(rel_path)
        raw = full.read_text(encoding="utf-8")
        frontmatter, body = self._parse_frontmatter(raw)
        tags = frontmatter.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        links = sorted(set(_WIKILINK_RE.findall(body)))
        rel = str(full.relative_to(self.vault_path))
        return Note(
            path=rel,
            title=full.stem,
            content=body,
            tags=tags,
            links=links,
            frontmatter=frontmatter,
        )

    def list_notes(self, folder: str = "") -> list[str]:
        self.ensure_vault_ok()
        base = self._resolve_dir(folder)
        return sorted(
            str(p.relative_to(self.vault_path)) for p in base.rglob("*.md") if p.is_file()
        )

    def _resolve_dir(self, folder: str) -> Path:
        full = (self.vault_path / folder).resolve() if folder else self.vault_path
        if self.vault_path not in full.parents and full != self.vault_path:
            raise ValueError(f"Pasta fora do vault: {folder}")
        return full

    def read_note(self, rel_path: str) -> Note:
        self.ensure_vault_ok()
        return self._load_note(rel_path)

    def write_note(self, rel_path: str, content: str, tags: list[str] | None = None) -> Note:
        """Cria ou sobrescreve uma nota por completo. Escrita atômica: escreve num
        arquivo temporário na mesma pasta e faz `rename` (operação atômica no mesmo
        filesystem) — nunca deixa a nota pela metade se algo falhar no meio."""
        self.ensure_vault_ok()
        full = self._resolve(rel_path)
        full.parent.mkdir(parents=True, exist_ok=True)

        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        existing_fm: dict[str, Any] = {}
        if full.exists():
            existing_fm, _ = self._parse_frontmatter(full.read_text(encoding="utf-8"))

        frontmatter = {
            "tags": tags if tags is not None else existing_fm.get("tags", []),
            "created": existing_fm.get("created", now),
            "updated": now,
        }
        raw = f"{self._render_frontmatter(frontmatter)}\n\n{content.strip()}\n"

        fd, tmp_path = tempfile.mkstemp(dir=full.parent, prefix=f".{full.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(raw)
            os.replace(tmp_path, full)
        except Exception:
            Path(tmp_path).unlink(missing_ok=True)
            raise
        return self._load_note(str(full.relative_to(self.vault_path)))

    def append_note(self, rel_path: str, content: str) -> Note:
        """Acrescenta conteúdo ao final de uma nota existente (cria se não existir)."""
        self.ensure_vault_ok()
        full = self._resolve(rel_path)
        if full.exists():
            existing = self._load_note(str(full.relative_to(self.vault_path)))
            new_content = f"{existing.content.rstrip()}\n\n{content.strip()}"
            return self.write_note(rel_path, new_content, tags=existing.tags)
        return self.write_note(rel_path, content)

    def search_notes(self, query: str, max_results: int = 10) -> list[Note]:
        """Busca simples por substring (case-insensitive) no título, tags e conteúdo —
        suficiente pro caso de uso pessoal; busca semântica via embeddings fica pra uma
        fase 2, se algum dia for necessária (ver SCRUM-63)."""
        self.ensure_vault_ok()
        query_lower = query.lower()
        matches: list[Note] = []
        for rel_path in self.list_notes():
            note = self._load_note(rel_path)
            haystack = f"{note.title} {' '.join(note.tags)} {note.content}".lower()
            if query_lower in haystack:
                matches.append(note)
            if len(matches) >= max_results:
                break
        return matches

    def build_graph(self) -> dict[str, Any]:
        """Monta o grafo do vault inteiro (nós = notas, arestas = wikilinks [[...]] entre
        elas) — consumido pelo painel de visualização do HUD (GET /obsidian/graph)."""
        self.ensure_vault_ok()
        notes = [self._load_note(p) for p in self.list_notes()]
        title_to_path = {n.title: n.path for n in notes}
        nodes = [
            {
                "id": n.path,
                "title": n.title,
                "folder": str(Path(n.path).parent) if Path(n.path).parent != Path(".") else "",
                "tags": n.tags,
            }
            for n in notes
        ]
        edges = []
        for n in notes:
            for linked_title in n.links:
                target = title_to_path.get(linked_title)
                if target and target != n.path:
                    edges.append({"source": n.path, "target": target})
        return {"nodes": nodes, "edges": edges}
