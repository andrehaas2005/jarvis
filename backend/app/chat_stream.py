"""Pub/sub em memória para o Server-Sent Events do chat de texto (SCRUM-26).

Mesmo padrão de memory.py/status_tracker.py: estado em processo, sem Redis —
suficiente pro uso atual (single-instance, single-user). Cada sessão pode ter
múltiplos assinantes (ex.: várias abas do HUD abertas ao mesmo tempo ouvindo
a mesma conversa). Sem fila persistente: se ninguém está ouvindo agora, a
mensagem é descartada — o histórico "de verdade" já fica salvo no IndexedDB
do navegador que mandou/recebeu.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any

_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe(session_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers[session_id].append(queue)
    return queue


def unsubscribe(session_id: str, queue: asyncio.Queue) -> None:
    subs = _subscribers.get(session_id)
    if subs and queue in subs:
        subs.remove(queue)
    if subs is not None and not subs:
        _subscribers.pop(session_id, None)


def publish(
    session_id: str, *, role: str, text: str, kind: str = "message", client_msg_id: str = ""
) -> None:
    """Publica uma mensagem pros assinantes SSE da sessão. `kind` distingue
    uma mensagem normal ('message') de um rascunho pra revisão ('draft').

    `client_msg_id`: quando a mensagem se origina de um POST /chat/message,
    o frontend manda esse id e o ecoa aqui — serve pro remetente original
    filtrar o próprio eco (ele já renderizou a mensagem localmente, na hora
    da resposta HTTP) sem depender de comparar texto, que quebra numa corrida
    onde o SSE chega antes da resposta HTTP (publish acontece durante o
    handler, antes do `return`)."""
    subs = _subscribers.get(session_id)
    if not subs:
        return
    message: dict[str, Any] = {
        "role": role,
        "text": text,
        "kind": kind,
        "client_msg_id": client_msg_id,
        "ts": time.time(),
    }
    for queue in list(subs):
        queue.put_nowait(message)
