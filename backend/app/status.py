"""Status das capacidades (check-in) e consumo/créditos das APIs pagas —
consumido pelo painel lateral do HUD (SCRUM-52 / painel de créditos).

Dois conceitos diferentes, propositalmente separados:
- **Check-in**: Email/Calendar/Contacts respondem de verdade? Dado real de
  uso (ver `app/orchestrator/status_tracker.py`), não um ping sintético.
- **Créditos**: quanto já foi consumido nas APIs pagas (ElevenLabs,
  Anthropic) neste período — pra não levar surpresa de fatura.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.logging_config import get_logger
from app.orchestrator.status_tracker import get_status_tracker
from app.settings_store import get_llm_config

logger = get_logger("jarvis.status")

_ELEVENLABS_SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription"
_ANTHROPIC_COST_REPORT_URL = "https://api.anthropic.com/v1/organizations/cost_report"


def get_checkin() -> dict[str, Any]:
    """Estado atual de Email/Calendar/Contacts, a partir do uso real
    rastreado pelo orquestrador — não um ping sintético."""
    return get_status_tracker().snapshot()


async def _get_elevenlabs_credits() -> dict[str, Any]:
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        return {"available": False, "reason": "ELEVENLABS_API_KEY não configurada"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _ELEVENLABS_SUBSCRIPTION_URL,
                headers={"xi-api-key": settings.elevenlabs_api_key},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        logger.warning("elevenlabs_credits_fetch_failed", extra={"extra_fields": {"error": str(exc)}})
        return {"available": False, "reason": f"erro ao consultar ElevenLabs: {exc}"}

    used = data.get("character_count", 0)
    limit = data.get("character_limit", 0)
    return {
        "available": True,
        "tier": data.get("tier"),
        "characters_used": used,
        "characters_limit": limit,
        "percent_used": round(used / limit * 100, 1) if limit else None,
        "next_reset_unix": data.get("next_character_count_reset_unix"),
    }


async def _get_anthropic_credits() -> dict[str, Any]:
    settings = get_settings()
    if not settings.anthropic_admin_api_key:
        return {"available": False, "reason": "ANTHROPIC_ADMIN_API_KEY não configurada"}

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _ANTHROPIC_COST_REPORT_URL,
                headers={
                    "x-api-key": settings.anthropic_admin_api_key,
                    "anthropic-version": "2023-06-01",
                },
                params={
                    "starting_at": month_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "ending_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        logger.warning("anthropic_credits_fetch_failed", extra={"extra_fields": {"error": str(exc)}})
        return {"available": False, "reason": f"erro ao consultar Anthropic: {exc}"}

    # `amount` vem em centavos, como string decimal (ver docs da Cost API).
    total_cents = 0.0
    for bucket in data.get("data", []):
        for item in bucket.get("results", []):
            total_cents += float(item.get("amount", 0))

    return {
        "available": True,
        "period": "mês atual",
        "spend_usd": round(total_cents / 100, 4),
        "currency": "USD",
    }


async def get_credits() -> dict[str, Any]:
    # Modelo de IA ativo (SCRUM-23/58) — o usuário pediu pra aparecer aqui direto, sem precisar
    # abrir a Settings Page pra saber se uma troca foi salva de verdade.
    llm_config = get_llm_config()
    return {
        "elevenlabs": await _get_elevenlabs_credits(),
        "anthropic": await _get_anthropic_credits(),
        "llm": {"provider": llm_config["llm_provider"], "model": llm_config["llm_model"]},
    }
