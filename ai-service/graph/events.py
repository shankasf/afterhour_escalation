from __future__ import annotations

import logging
import os
from contextlib import nullcontext
from datetime import timezone
from typing import Any

from graph.graph import get_graph
from services.agent_tracking import graph_spans_from_state, isoformat, publish_agent_trace, utc_now

try:
    import langsmith as ls
    from langsmith.run_helpers import get_current_run_tree
except Exception:  # pragma: no cover - tracing package is optional at import time
    ls = None
    get_current_run_tree = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _tracing_enabled() -> bool:
    raw = os.environ.get("LANGSMITH_TRACING", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _project_name() -> str:
    return os.environ.get("LANGSMITH_PROJECT", "after-hours-agent")


async def post_event(event_id: str, channel_event: dict[str, Any]) -> dict[str, Any]:
    """Push an external event into the graph - resumes from any wait_* park."""
    graph = get_graph()
    trace_id = f"langgraph_{event_id}"
    started_at = utc_now()
    final: dict[str, Any] = {}
    error: str | None = None
    source = channel_event.get("source") or channel_event.get("type") or "graph"
    project = _project_name()
    metadata = {
        "event_id": event_id,
        "thread_id": event_id,
        "session_id": event_id,
        "source": source,
        "environment": channel_event.get("environment", "production"),
        "graph_version": "after-hours-v1",
    }
    tags = ["production", project, "langgraph", str(source)]
    config = {
        "configurable": {"thread_id": event_id},
        "metadata": metadata,
        "tags": tags,
        "run_name": f"after-hours.post_event.{source}",
    }

    tracing_active = ls is not None and _tracing_enabled()
    tracing_context = (
        ls.tracing_context(
            project_name=project,
            tags=tags,
            metadata=metadata,
        )
        if tracing_active
        else nullcontext()
    )

    external_run_id: str | None = None

    try:
        with tracing_context:
            final = await graph.ainvoke(
                {"channel_event": channel_event, "event_id": event_id},
                config=config,
            )
            if tracing_active and get_current_run_tree is not None:
                try:
                    run_tree = get_current_run_tree()
                    if run_tree is not None and getattr(run_tree, "id", None):
                        external_run_id = str(run_tree.id)
                except Exception as run_tree_error:
                    logger.debug("Could not capture LangSmith run id: %s", run_tree_error)
        return {
            "event_id": event_id,
            "status": final.get("status"),
            "awaiting": final.get("awaiting"),
            "cursor": final.get("cursor"),
        }
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        ended_at = utc_now()
        latency_ms = int((ended_at - started_at).total_seconds() * 1000)
        triage = final.get("triage") if isinstance(final, dict) else None
        triage_payload = triage.model_dump() if hasattr(triage, "model_dump") else (triage or {})
        conversation_log = final.get("conversation_log") if isinstance(final, dict) else None
        dialog_turns: list[dict[str, Any]] = []
        if conversation_log:
            for turn in conversation_log:
                payload = turn.model_dump() if hasattr(turn, "model_dump") else dict(turn)
                dialog_turns.append({
                    "role": payload.get("role"),
                    "text": (payload.get("text") or "")[:500],
                })
        trace_metadata: dict[str, Any] = dict(metadata)
        if dialog_turns:
            trace_metadata["conversation_log"] = dialog_turns
        await publish_agent_trace(
            {
                "traceId": trace_id,
                "externalRunId": external_run_id,
                "eventId": event_id,
                "threadId": event_id,
                "project": project,
                "title": f"LangGraph escalation {event_id}",
                "source": source,
                "status": "error" if error else ("running" if final.get("awaiting") else "success"),
                "latencyMs": latency_ms,
                "errorMessage": error,
                "emergencyScore": triage_payload.get("emergency_score"),
                "metadata": trace_metadata,
                "tags": tags,
                "startedAt": isoformat(started_at.astimezone(timezone.utc)),
                "endedAt": isoformat(ended_at.astimezone(timezone.utc)),
                "spans": graph_spans_from_state(trace_id, final, started_at, ended_at, error),
            }
        )
