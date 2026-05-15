"""Persistent per-call LLM cost ledger.

Every text completion, every Realtime audio turn, and every raw OpenAI
SDK call lands here as a single row in ``llm_cost_events``. The admin
``/cost`` dashboard reads aggregates straight off this table — no model
guessing, no log scraping.

Design notes:

* Writes are **fire-and-forget**. Cost telemetry must never block the
  voice hot path or fail a customer-facing graph invocation.
* Writes go through an in-process ``asyncio.Queue`` drained by a single
  background task, so we get backpressure and bounded memory if the DB
  is briefly unreachable.
* The schema lives in ``backend/prisma/schema.prisma`` (``LlmCostEvent``)
  and the migration in ``backend/prisma/migrations/20260513000000_add_llm_cost_events/``.
  Both services point at the same Postgres URL (``DATABASE_URL``).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

logger = logging.getLogger("ai-service.cost_ledger")

# Bounded queue. If the writer falls behind by more than this, we drop
# the oldest events and log a warning. Cost is observability, not state.
_MAX_QUEUE = 5_000

# Module-globals, lazily initialised on first emit.
_QUEUE: asyncio.Queue | None = None
_WRITER_TASK: asyncio.Task | None = None
_LOOP: asyncio.AbstractEventLoop | None = None
_STARTED_LOCK = threading.Lock()
_POOL: Any = None  # psycopg_pool.AsyncConnectionPool


@dataclass(slots=True)
class CostEvent:
    id: str
    run_id: str
    root_run_id: str | None
    correlation_id: str | None
    source: str
    agent: str | None
    model: str
    tokens_in: int
    cached_tokens: int
    tokens_out: int
    audio_tokens_in: int
    audio_cached_tokens: int
    audio_tokens_out: int
    cost_usd: float
    latency_ms: int | None
    finish_reason: str | None
    created_at: datetime


def _database_url() -> str | None:
    return (
        os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or None
    )


async def _ensure_pool() -> Any:
    """Lazily build a small psycopg async pool. Returns None if DB is unconfigured."""
    global _POOL
    if _POOL is not None:
        return _POOL
    url = _database_url()
    if not url:
        return None
    try:
        from psycopg_pool import AsyncConnectionPool
        _POOL = AsyncConnectionPool(conninfo=url, min_size=1, max_size=4, open=False)
        await _POOL.open()
        logger.info("LLM cost ledger pool opened")
    except Exception as exc:
        logger.warning("cost ledger DB pool init failed: %s", exc)
        _POOL = None
    return _POOL


async def _writer_loop() -> None:
    assert _QUEUE is not None
    while True:
        evt: CostEvent = await _QUEUE.get()
        try:
            pool = await _ensure_pool()
            if pool is None:
                continue  # silently drop — DB not configured
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO llm_cost_events (
                            id, run_id, root_run_id, correlation_id, source,
                            agent, model,
                            tokens_in, cached_tokens, tokens_out,
                            audio_tokens_in, audio_cached_tokens, audio_tokens_out,
                            cost_usd, latency_ms, finish_reason, created_at
                        ) VALUES (
                            %s, %s, %s, %s, %s,
                            %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s
                        )
                        """,
                        (
                            evt.id, evt.run_id, evt.root_run_id, evt.correlation_id, evt.source,
                            evt.agent, evt.model,
                            evt.tokens_in, evt.cached_tokens, evt.tokens_out,
                            evt.audio_tokens_in, evt.audio_cached_tokens, evt.audio_tokens_out,
                            evt.cost_usd, evt.latency_ms, evt.finish_reason, evt.created_at,
                        ),
                    )
        except Exception as exc:
            logger.warning("cost ledger write failed: %s", exc)
        finally:
            _QUEUE.task_done()


def _ensure_writer() -> None:
    """Start the background writer once an event loop exists.

    Called both at app startup (from main.py lifespan, with a running
    loop) and lazily from ``emit_cost_event`` (may run in a worker
    thread with no loop — in that case we no-op and trust the startup
    call already scheduled the writer).
    """
    global _QUEUE, _WRITER_TASK, _LOOP
    with _STARTED_LOCK:
        if _QUEUE is None:
            _QUEUE = asyncio.Queue(maxsize=_MAX_QUEUE)
        if _WRITER_TASK is not None and not _WRITER_TASK.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        _LOOP = loop
        _WRITER_TASK = loop.create_task(_writer_loop(), name="cost-ledger-writer")


async def start_ledger() -> None:
    """Eagerly start the writer task during FastAPI lifespan startup.

    Guarantees a single, stable event-loop reference so emits from
    LangChain callback threads (``call_soon_threadsafe``) land in the
    same loop the writer runs on.
    """
    _ensure_writer()


def emit_cost_event(
    *,
    run_id: str,
    root_run_id: str | None = None,
    correlation_id: str | None = None,
    source: str = "langchain",
    agent: str | None = None,
    model: str | None,
    tokens_in: int | None = 0,
    cached_tokens: int | None = 0,
    tokens_out: int | None = 0,
    audio_tokens_in: int | None = 0,
    audio_cached_tokens: int | None = 0,
    audio_tokens_out: int | None = 0,
    cost_usd: float = 0.0,
    latency_ms: int | None = None,
    finish_reason: str | None = None,
) -> None:
    """Enqueue a cost event for persistence. Always returns immediately."""
    if not model:
        return
    _ensure_writer()
    if _QUEUE is None:
        return
    evt = CostEvent(
        id=str(uuid4()),
        run_id=run_id,
        root_run_id=root_run_id,
        correlation_id=correlation_id,
        source=source,
        agent=agent,
        model=model,
        tokens_in=int(tokens_in or 0),
        cached_tokens=int(cached_tokens or 0),
        tokens_out=int(tokens_out or 0),
        audio_tokens_in=int(audio_tokens_in or 0),
        audio_cached_tokens=int(audio_cached_tokens or 0),
        audio_tokens_out=int(audio_tokens_out or 0),
        cost_usd=float(cost_usd or 0.0),
        latency_ms=latency_ms,
        finish_reason=finish_reason,
        created_at=datetime.now(timezone.utc),
    )
    # Use call_soon_threadsafe so emits from LangChain's sync callback
    # thread (or any non-loop thread) still reach the writer's loop.
    def _put() -> None:
        try:
            _QUEUE.put_nowait(evt)
        except asyncio.QueueFull:
            try:
                _QUEUE.get_nowait()
                _QUEUE.task_done()
            except Exception:
                pass
            try:
                _QUEUE.put_nowait(evt)
            except Exception:
                logger.warning("cost ledger queue full; dropping event")

    if _LOOP is not None and not _LOOP.is_closed():
        try:
            _LOOP.call_soon_threadsafe(_put)
            return
        except RuntimeError:
            pass
    # Fallback: best-effort direct put (works if we happen to be on the loop thread)
    _put()


async def close_ledger() -> None:
    global _POOL, _WRITER_TASK
    if _WRITER_TASK and not _WRITER_TASK.done():
        _WRITER_TASK.cancel()
        try:
            await _WRITER_TASK
        except Exception:
            pass
    if _POOL is not None:
        try:
            await _POOL.close()
        except Exception:
            pass
        _POOL = None
