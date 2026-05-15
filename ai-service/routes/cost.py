"""Cost ledger query endpoints powering the admin Cost dashboard.

All endpoints read from the ``llm_cost_events`` table in Postgres. The
ai-service is the canonical writer (see ``graph/cost_ledger.py``); the
Nest backend proxies these endpoints behind ``/api/cost/*`` so the
React admin app can authenticate the same way it does for every other
admin route.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter()


_POOL: Any = None


async def _pool() -> Any:
    global _POOL
    if _POOL is not None:
        return _POOL
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        return None
    try:
        from psycopg_pool import AsyncConnectionPool
        _POOL = AsyncConnectionPool(conninfo=url, min_size=1, max_size=4, open=False)
        await _POOL.open()
    except Exception as exc:
        logger.warning("cost route pool init failed: %s", exc)
        _POOL = None
    return _POOL


def _parse_window(window: str) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    mapping = {
        "1h": timedelta(hours=1),
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "90d": timedelta(days=90),
    }
    delta = mapping.get(window, timedelta(hours=24))
    return now - delta, now


async def _fetch(query: str, params: tuple) -> list[dict[str, Any]]:
    pool = await _pool()
    if pool is None:
        return []
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params)
            cols = [d.name for d in (cur.description or [])]
            rows = await cur.fetchall()
            return [dict(zip(cols, r)) for r in rows]


def _to_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


@router.get("/summary")
async def cost_summary(window: str = Query("24h", description="1h|24h|7d|30d|90d")) -> dict:
    """Top-line totals + breakdowns for the dashboard's hero cards."""
    start, end = _parse_window(window)
    rows = await _fetch(
        """
        SELECT
          COUNT(*)             AS calls,
          COALESCE(SUM(cost_usd), 0)        AS total_cost,
          COALESCE(SUM(tokens_in), 0)       AS tokens_in,
          COALESCE(SUM(cached_tokens), 0)   AS cached_tokens,
          COALESCE(SUM(tokens_out), 0)      AS tokens_out,
          COALESCE(SUM(audio_tokens_in), 0)        AS audio_tokens_in,
          COALESCE(SUM(audio_cached_tokens), 0)    AS audio_cached_tokens,
          COALESCE(SUM(audio_tokens_out), 0)       AS audio_tokens_out,
          COALESCE(AVG(latency_ms), 0)::int        AS avg_latency_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95_latency_ms
        FROM llm_cost_events
        WHERE created_at >= %s AND created_at < %s
        """,
        (start, end),
    )
    row = rows[0] if rows else {}
    return {
        "window": window,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "calls": int(row.get("calls") or 0),
        "total_cost_usd": _to_float(row.get("total_cost")),
        "tokens_in": int(row.get("tokens_in") or 0),
        "cached_tokens": int(row.get("cached_tokens") or 0),
        "tokens_out": int(row.get("tokens_out") or 0),
        "audio_tokens_in": int(row.get("audio_tokens_in") or 0),
        "audio_cached_tokens": int(row.get("audio_cached_tokens") or 0),
        "audio_tokens_out": int(row.get("audio_tokens_out") or 0),
        "avg_latency_ms": int(row.get("avg_latency_ms") or 0),
        "p95_latency_ms": int(row.get("p95_latency_ms") or 0),
        "cache_hit_rate": (
            _to_float(row.get("cached_tokens")) / max(1, _to_float(row.get("tokens_in")))
            if row.get("tokens_in") else 0.0
        ),
    }


@router.get("/by-model")
async def cost_by_model(window: str = Query("24h")) -> dict:
    start, end = _parse_window(window)
    rows = await _fetch(
        """
        SELECT model,
               COUNT(*)                       AS calls,
               COALESCE(SUM(cost_usd), 0)     AS total_cost,
               COALESCE(SUM(tokens_in), 0)    AS tokens_in,
               COALESCE(SUM(tokens_out), 0)   AS tokens_out,
               COALESCE(SUM(audio_tokens_in), 0)  AS audio_tokens_in,
               COALESCE(SUM(audio_tokens_out), 0) AS audio_tokens_out
        FROM llm_cost_events
        WHERE created_at >= %s AND created_at < %s
        GROUP BY model
        ORDER BY total_cost DESC
        """,
        (start, end),
    )
    return {"window": window, "items": [
        {
            "model": r["model"],
            "calls": int(r["calls"]),
            "total_cost_usd": _to_float(r["total_cost"]),
            "tokens_in": int(r["tokens_in"]),
            "tokens_out": int(r["tokens_out"]),
            "audio_tokens_in": int(r["audio_tokens_in"]),
            "audio_tokens_out": int(r["audio_tokens_out"]),
        }
        for r in rows
    ]}


@router.get("/by-agent")
async def cost_by_agent(window: str = Query("24h")) -> dict:
    start, end = _parse_window(window)
    rows = await _fetch(
        """
        SELECT COALESCE(agent, 'unattributed') AS agent,
               COUNT(*)                       AS calls,
               COALESCE(SUM(cost_usd), 0)     AS total_cost,
               COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms
        FROM llm_cost_events
        WHERE created_at >= %s AND created_at < %s
        GROUP BY COALESCE(agent, 'unattributed')
        ORDER BY total_cost DESC
        """,
        (start, end),
    )
    return {"window": window, "items": [
        {
            "agent": r["agent"],
            "calls": int(r["calls"]),
            "total_cost_usd": _to_float(r["total_cost"]),
            "avg_latency_ms": int(r["avg_latency_ms"] or 0),
        }
        for r in rows
    ]}


@router.get("/timeseries")
async def cost_timeseries(
    window: str = Query("24h"),
    bucket: str = Query("hour", description="hour|day"),
) -> dict:
    start, end = _parse_window(window)
    if bucket not in ("hour", "day"):
        raise HTTPException(status_code=400, detail="bucket must be hour|day")
    rows = await _fetch(
        f"""
        SELECT date_trunc('{bucket}', created_at) AS ts,
               COUNT(*)                          AS calls,
               COALESCE(SUM(cost_usd), 0)        AS total_cost
        FROM llm_cost_events
        WHERE created_at >= %s AND created_at < %s
        GROUP BY ts
        ORDER BY ts
        """,
        (start, end),
    )
    return {"window": window, "bucket": bucket, "points": [
        {
            "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"]),
            "calls": int(r["calls"]),
            "total_cost_usd": _to_float(r["total_cost"]),
        }
        for r in rows
    ]}


@router.get("/recent")
async def cost_recent(limit: int = Query(50, ge=1, le=500)) -> dict:
    rows = await _fetch(
        """
        SELECT id, run_id, root_run_id, correlation_id, source, agent, model,
               tokens_in, cached_tokens, tokens_out,
               audio_tokens_in, audio_cached_tokens, audio_tokens_out,
               cost_usd, latency_ms, finish_reason, created_at
        FROM llm_cost_events
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return {"items": [
        {
            **r,
            "cost_usd": _to_float(r.get("cost_usd")),
            "created_at": r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else str(r.get("created_at")),
        }
        for r in rows
    ]}


@router.get("/top-calls")
async def cost_top_calls(
    window: str = Query("24h"),
    limit: int = Query(20, ge=1, le=100),
) -> dict:
    start, end = _parse_window(window)
    rows = await _fetch(
        """
        SELECT id, run_id, agent, model,
               tokens_in, tokens_out, audio_tokens_in, audio_tokens_out,
               cost_usd, latency_ms, created_at
        FROM llm_cost_events
        WHERE created_at >= %s AND created_at < %s
        ORDER BY cost_usd DESC
        LIMIT %s
        """,
        (start, end, limit),
    )
    return {"window": window, "items": [
        {
            **r,
            "cost_usd": _to_float(r.get("cost_usd")),
            "created_at": r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else str(r.get("created_at")),
        }
        for r in rows
    ]}
