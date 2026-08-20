"""Retry com backoff e idempotência.

Existe para resolver diretamente os bugs SCRUM-45 (email disparando 8x) e
SCRUM-46 (falta de atomicidade no envio): toda ação sensível (enviar email,
criar evento) passa por aqui com uma idempotency_key. Se a mesma chave já
foi concluída com sucesso, a ação não roda de novo — só devolve o resultado
anterior.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.logging_config import get_logger

logger = get_logger("jarvis.retry")


class IdempotencyStore:
    """Registro em memória de execuções por idempotency_key.

    Nível 1 (Sprint 1): em memória, suficiente para um único processo.
    Evolução planejada: mover para SQLite (SCRUM-24/25) para sobreviver a
    restarts do backend.
    """

    def __init__(self) -> None:
        self._done: dict[str, Any] = {}
        self._in_flight: set[str] = set()
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> tuple[bool, Any]:
        async with self._lock:
            if key in self._done:
                return True, self._done[key]
            return False, None

    async def mark_in_flight(self, key: str) -> bool:
        """Retorna False se a chave já está em execução (chamada concorrente duplicada)."""
        async with self._lock:
            if key in self._in_flight or key in self._done:
                return False
            self._in_flight.add(key)
            return True

    async def mark_done(self, key: str, result: Any) -> None:
        async with self._lock:
            self._in_flight.discard(key)
            self._done[key] = result

    async def mark_failed(self, key: str) -> None:
        async with self._lock:
            self._in_flight.discard(key)


idempotency_store = IdempotencyStore()


@dataclass
class RetryConfig:
    max_attempts: int = 3
    backoff_seconds: float = 2.0
    backoff_multiplier: float = 2.0
    retry_on: tuple[type[BaseException], ...] = field(default=(Exception,))


async def run_idempotent(
    idempotency_key: str,
    action: Callable[[], Awaitable[Any]],
    config: RetryConfig | None = None,
) -> Any:
    """Executa `action` no máximo uma vez por idempotency_key, com retry em falhas.

    Chamadas concorrentes com a mesma chave não duplicam a ação: a segunda
    chamada recebe imediatamente o resultado já registrado (ou é rejeitada
    se a primeira ainda estiver em andamento).
    """
    cfg = config or RetryConfig()

    already_done, cached_result = await idempotency_store.get(idempotency_key)
    if already_done:
        logger.info(
            "idempotent_hit",
            extra={"extra_fields": {"idempotency_key": idempotency_key}},
        )
        return cached_result

    acquired = await idempotency_store.mark_in_flight(idempotency_key)
    if not acquired:
        raise RuntimeError(
            f"Ação com idempotency_key={idempotency_key!r} já está em execução "
            "(chamada duplicada/concorrente bloqueada)."
        )

    delay = cfg.backoff_seconds
    last_error: BaseException | None = None

    try:
        for attempt in range(1, cfg.max_attempts + 1):
            try:
                result = await action()
                await idempotency_store.mark_done(idempotency_key, result)
                logger.info(
                    "action_succeeded",
                    extra={
                        "extra_fields": {
                            "idempotency_key": idempotency_key,
                            "attempt": attempt,
                        }
                    },
                )
                return result
            except cfg.retry_on as exc:  # type: ignore[misc]
                last_error = exc
                logger.warning(
                    "action_attempt_failed",
                    extra={
                        "extra_fields": {
                            "idempotency_key": idempotency_key,
                            "attempt": attempt,
                            "max_attempts": cfg.max_attempts,
                            "error": str(exc),
                        }
                    },
                )
                if attempt < cfg.max_attempts:
                    await asyncio.sleep(delay)
                    delay *= cfg.backoff_multiplier

        await idempotency_store.mark_failed(idempotency_key)
        assert last_error is not None
        raise last_error
    except BaseException:
        await idempotency_store.mark_failed(idempotency_key)
        raise


def make_idempotency_key(*parts: str) -> str:
    """Gera uma chave determinística a partir de partes (ex.: user_id, action, payload_hash)."""
    return ":".join(str(p) for p in parts)
