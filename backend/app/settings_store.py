"""Configuração de sistema editável em runtime (SCRUM-23) — hoje só o
provedor/modelo de LLM do orquestrador. Diferente do `.env` (que exige
restart do container), isso é um JSON simples no mesmo volume persistente
do SQLite (`data/`), lido/escrito a cada chamada — não é uma tabela porque
é um único documento pequeno, sem necessidade de query.

Deliberadamente global (não por usuário): o webhook do orquestrador
(`/jarvis/webhook`, chamado pela ElevenLabs) não carrega identidade de
usuário logado — só o `x-jarvis-secret`. Trocar de modelo aqui afeta a
resposta de voz pra todo mundo, então a escrita fica restrita a admin
(ver `main.py`).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.logging_config import get_logger

logger = get_logger("jarvis.settings_store")

_lock = threading.Lock()


def _path() -> Path:
    settings = get_settings()
    # Mesmo diretório do jarvis.db (data/) — já montado como volume persistente
    # no docker-compose de produção (ver ROADMAP_SESSION.md, SCRUM-56).
    path = Path(settings.jarvis_db_path).parent / "system_settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _defaults() -> dict[str, Any]:
    settings = get_settings()
    return {
        "llm_provider": settings.llm_provider,
        "llm_model": settings.anthropic_model,
    }


def get_llm_config() -> dict[str, str]:
    """Provedor/modelo efetivos: override salvo, ou o default do `.env`."""
    path = _path()
    if not path.exists():
        return _defaults()
    try:
        with _lock:
            data = json.loads(path.read_text(encoding="utf-8"))
        defaults = _defaults()
        return {
            "llm_provider": data.get("llm_provider") or defaults["llm_provider"],
            "llm_model": data.get("llm_model") or defaults["llm_model"],
        }
    except (json.JSONDecodeError, OSError) as error:
        logger.warning(
            "settings_store_read_failed",
            extra={"extra_fields": {"error": str(error)}},
        )
        return _defaults()


def set_llm_config(*, provider: str, model: str) -> dict[str, str]:
    """Sobrescreve o provedor/modelo em uso. Aceita qualquer string de
    provedor/modelo — a validação de "isso existe de verdade" acontece na
    hora de instanciar o provider (`providers.get_provider`), não aqui,
    pra não travar a config de modelos novos que a gente ainda não conhece."""
    provider = provider.strip().lower()
    model = model.strip()
    if not provider or not model:
        raise ValueError("provider e model são obrigatórios")

    data = {"llm_provider": provider, "llm_model": model}
    with _lock:
        _path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("settings_store_llm_updated", extra={"extra_fields": data})
    return data
