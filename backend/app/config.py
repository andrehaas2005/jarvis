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

    # Orquestrador (SCRUM-17) — substitui o node "JARVIS" do n8n
    llm_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"
    jarvis_webhook_secret: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Retorna a instância cacheada das configurações."""
    return Settings()
