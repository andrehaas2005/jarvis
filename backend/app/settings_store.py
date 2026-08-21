"""Configuração de sistema editável em runtime (SCRUM-23/59) — hoje só o
provedor/modelo/endereço de LLM do orquestrador. Diferente do `.env` (que
exige restart do container), isso é um JSON simples no mesmo volume
persistente do SQLite (`data/`), lido/escrito a cada chamada — não é uma
tabela porque é um único documento pequeno, sem necessidade de query.

Deliberadamente global (não por usuário): o webhook do orquestrador
(`/jarvis/webhook`, chamado pela ElevenLabs) não carrega identidade de
usuário logado — só o `x-jarvis-secret`. Trocar de modelo aqui afeta a
resposta de voz pra todo mundo, então a escrita fica restrita a admin
(ver `main.py`).

`base_url` (SCRUM-59) existe pro provedor `local` — qualquer servidor
compatível com OpenAI (llamafile, Ollama, LM Studio...), rodando no VPS
ou em outra máquina (ex.: Mac do usuário via Tailscale), ou um provedor
hospedado que fale a mesma API (Groq, DeepInfra, Fireworks — a saída real
pro problema de latência do VPS de 2 vCPU, ver ROADMAP_SESSION.md). Trocar
de servidor é só trocar esse endereço salvo, sem editar código.

`llm_api_key` (SCRUM-59, 2ª volta) — chave do provedor `local`, quando ele
exige autenticação (Groq/DeepInfra exigem; o llamafile do próprio VPS não).
Nunca volta em texto puro pelo GET (ver `get_llm_config_public`) — só um
booleano indicando se está configurada. `set_llm_config` com `api_key=""`
preserva a chave já salva (não limpa) — assim o campo pode ficar vazio no
formulário sem apagar o que já estava salvo.
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
        "llm_base_url": "",
        "llm_api_key": "",
    }


def get_llm_config() -> dict[str, str]:
    """Provedor/modelo/endereço/chave efetivos (chave em texto puro) — uso
    interno do orquestrador (`router.py`) só. Nunca expor isso numa
    resposta HTTP; ver `get_llm_config_public`."""
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
            "llm_base_url": data.get("llm_base_url") or defaults["llm_base_url"],
            "llm_api_key": data.get("llm_api_key") or defaults["llm_api_key"],
        }
    except (json.JSONDecodeError, OSError) as error:
        logger.warning(
            "settings_store_read_failed",
            extra={"extra_fields": {"error": str(error)}},
        )
        return _defaults()


def get_llm_config_public() -> dict[str, Any]:
    """Igual a `get_llm_config`, mas troca a chave em texto puro por um
    booleano — versão segura pra devolver na resposta do GET /settings/llm."""
    config = get_llm_config()
    return {
        "llm_provider": config["llm_provider"],
        "llm_model": config["llm_model"],
        "llm_base_url": config["llm_base_url"],
        "llm_api_key_set": bool(config["llm_api_key"]),
    }


def set_llm_config(*, provider: str, model: str, base_url: str = "", api_key: str = "") -> dict[str, str]:
    """Sobrescreve o provedor/modelo/endereço/chave em uso. Aceita qualquer
    string de provedor/modelo/endereço — a validação de "isso existe de
    verdade" acontece na hora de instanciar o provider
    (`providers.get_provider`) e na primeira chamada real, não aqui, pra
    não travar a config de servidores novos que a gente ainda não conhece.

    `api_key=""` preserva a chave já salva (não limpa) — o GET nunca devolve
    a chave em texto puro (ver `get_llm_config_public`), então o formulário
    da Settings Page não tem como reenviá-la; só sobrescreve quando o
    usuário digita uma chave nova de verdade."""
    provider = provider.strip().lower()
    model = model.strip()
    base_url = base_url.strip()
    api_key = api_key.strip()
    if not provider or not model:
        raise ValueError("provider e model são obrigatórios")
    if provider == "local" and not base_url:
        raise ValueError("provider 'local' exige base_url (endereço do servidor)")

    if not api_key:
        api_key = get_llm_config()["llm_api_key"]

    data = {
        "llm_provider": provider,
        "llm_model": model,
        "llm_base_url": base_url,
        "llm_api_key": api_key,
    }
    with _lock:
        _path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(
        "settings_store_llm_updated",
        extra={"extra_fields": {**data, "llm_api_key": "***" if api_key else ""}},
    )
    return data
