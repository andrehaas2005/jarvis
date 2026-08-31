"""Configuração de sistema editável em runtime (SCRUM-23/59/65) — provedor/
modelo/endereço de LLM do orquestrador, e provedor de busca na web. Diferente
do `.env` (que exige restart do container), isso é um JSON simples no mesmo
volume persistente do SQLite (`data/`), lido/escrito a cada chamada — não é
uma tabela porque é um único documento pequeno, sem necessidade de query.

Deliberadamente global (não por usuário): o webhook do orquestrador
(`/jarvis/webhook`, chamado pela ElevenLabs) não carrega identidade de
usuário logado — só o `x-jarvis-secret`. Trocar de modelo/busca aqui afeta a
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

Busca na web (SCRUM-65): dois provedores configuráveis ao mesmo tempo
(Tavily e Brave, cada um com sua própria chave) — `search_provider` diz
qual tentar primeiro; `mcp_servers/websearch/server.py` cai pro outro
sozinho se o primeiro falhar (erro de rede, chave inválida, etc.) e o outro
tiver uma chave configurada. Mesmo padrão de "preserva a chave se veio
vazia" do LLM local.

Importante: `set_llm_config`/`set_search_config` fazem *merge* com o que já
está salvo (via `_read_raw`/`_write_raw`) — nunca sobrescrevem o documento
inteiro, senão salvar uma config apagaria a outra (mesmo arquivo JSON pra
ambas, de propósito: é um único documento pequeno de configuração global)."""

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


def _read_raw() -> dict[str, Any]:
    """Lê o documento inteiro (todas as seções) do disco, sem aplicar
    defaults — uso interno só, pra permitir merge seguro entre seções
    diferentes (LLM, busca) que dividem o mesmo arquivo."""
    path = _path()
    if not path.exists():
        return {}
    try:
        with _lock:
            return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        logger.warning("settings_store_read_failed", extra={"extra_fields": {"error": str(error)}})
        return {}


def _write_raw(patch: dict[str, Any]) -> None:
    """Aplica `patch` por cima do documento já salvo (merge raso, chave a
    chave) e regrava o arquivo inteiro — preserva seções que este `patch`
    não menciona."""
    with _lock:
        path = _path()
        current = {}
        if path.exists():
            try:
                current = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                current = {}
        current.update(patch)
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")


def _llm_defaults() -> dict[str, Any]:
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
    data = _read_raw()
    defaults = _llm_defaults()
    return {
        "llm_provider": data.get("llm_provider") or defaults["llm_provider"],
        "llm_model": data.get("llm_model") or defaults["llm_model"],
        "llm_base_url": data.get("llm_base_url") or defaults["llm_base_url"],
        "llm_api_key": data.get("llm_api_key") or defaults["llm_api_key"],
    }


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
    _write_raw(data)
    logger.info(
        "settings_store_llm_updated",
        extra={"extra_fields": {**data, "llm_api_key": "***" if api_key else ""}},
    )
    return data


_SEARCH_PROVIDERS = ("tavily", "brave")


def _search_defaults() -> dict[str, Any]:
    return {
        "search_provider": "tavily",
        "tavily_api_key": "",
        "brave_api_key": "",
    }


def get_search_config() -> dict[str, str]:
    """Provedor preferido + as duas chaves em texto puro — uso interno do
    `mcp_servers/websearch/server.py` só. Nunca expor numa resposta HTTP;
    ver `get_search_config_public`."""
    data = _read_raw()
    defaults = _search_defaults()
    return {
        "search_provider": data.get("search_provider") or defaults["search_provider"],
        "tavily_api_key": data.get("tavily_api_key") or defaults["tavily_api_key"],
        "brave_api_key": data.get("brave_api_key") or defaults["brave_api_key"],
    }


def get_search_config_public() -> dict[str, Any]:
    """Igual a `get_search_config`, mas troca as chaves em texto puro por
    booleanos — versão segura pra devolver na resposta do GET /settings/search."""
    config = get_search_config()
    return {
        "search_provider": config["search_provider"],
        "tavily_api_key_set": bool(config["tavily_api_key"]),
        "brave_api_key_set": bool(config["brave_api_key"]),
    }


def set_search_config(*, provider: str, tavily_api_key: str = "", brave_api_key: str = "") -> dict[str, str]:
    """Sobrescreve o provedor preferido + as chaves. Mesma regra do LLM local:
    chave vazia preserva a já salva (não limpa) — o GET nunca devolve texto
    puro, então o formulário não tem como reenviar."""
    provider = provider.strip().lower()
    if provider not in _SEARCH_PROVIDERS:
        raise ValueError(f"provider precisa ser um de {_SEARCH_PROVIDERS}")

    current = get_search_config()
    tavily_api_key = tavily_api_key.strip() or current["tavily_api_key"]
    brave_api_key = brave_api_key.strip() or current["brave_api_key"]

    data = {
        "search_provider": provider,
        "tavily_api_key": tavily_api_key,
        "brave_api_key": brave_api_key,
    }
    _write_raw(data)
    logger.info(
        "settings_store_search_updated",
        extra={
            "extra_fields": {
                "search_provider": provider,
                "tavily_api_key": "***" if tavily_api_key else "",
                "brave_api_key": "***" if brave_api_key else "",
            }
        },
    )
    return data
