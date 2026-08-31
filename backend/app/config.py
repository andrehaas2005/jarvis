"""Configurações do backend JARVIS, carregadas de variáveis de ambiente (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    jarvis_env: str = "development"
    jarvis_log_level: str = "INFO"

    jarvis_api_host: str = "0.0.0.0"
    jarvis_api_port: int = 8000

    gmail_credentials_path: str | None = None
    gmail_token_path: str | None = None

    calendar_credentials_path: str | None = None
    calendar_token_path: str | None = None

    jarvis_retry_max_attempts: int = 3
    jarvis_retry_backoff_seconds: float = 2.0

    elevenlabs_api_key: str | None = None
    elevenlabs_agent_id: str | None = None

    contacts_credentials_path: str | None = None
    contacts_token_path: str | None = None

    # Google Drive/Sheets/Docs (SCRUM-61) — credenciais separadas de Gmail/Calendar/
    # Contacts porque os escopos são bem diferentes (drive.readonly + spreadsheets +
    # documents) e um token combinado evita 3 telas de consentimento pro usuário.
    google_workspace_credentials_path: str | None = None
    google_workspace_token_path: str | None = None

    # Orquestrador (SCRUM-17) — substitui o node "JARVIS" do n8n
    llm_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    # Sonnet 5 por padrão (SCRUM-59): ~5-6x mais barato que Opus 5, qualidade
    # ótima pro caso de uso de voz — Opus continua selecionável na Settings
    # Page pra quem quiser gastar mais por respostas potencialmente melhores.
    anthropic_model: str = "claude-sonnet-5"
    jarvis_webhook_secret: str | None = None

    # Painel de créditos (HUD) — Admin API key, só leitura de uso/custo.
    anthropic_admin_api_key: str | None = None

    # Login do HUD (SCRUM-56) — token assinado (HMAC), sem sessão em memória.
    jarvis_auth_secret: str = "troque-isso-no-.env-em-producao"
    jarvis_db_path: str = "data/jarvis.db"

    # Monitoramento (SCRUM-39) — rastreamento de erro real, sem depender de catar log manual
    # no Web Terminal do VPS toda vez (foi assim que vários bugs desta sessão foram achados).
    # Vazio = Sentry desligado (comportamento de hoje, sem mudança se não configurar).
    sentry_dsn: str | None = None

    # Segundo cérebro (SCRUM-63) — pasta do vault Obsidian (arquivos .md locais), sincronizada
    # entre o Mac do usuário (onde ele edita no app Obsidian) e o VPS via Syncthing (ou
    # equivalente) — o backend só lê/escreve nessa pasta como filesystem comum, sem depender
    # do app Obsidian estar aberto. Vazio = tools de memória desligadas (erro claro ao chamar,
    # não crash no boot).
    obsidian_vault_path: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Retorna a instância cacheada das configurações."""
    return Settings()
