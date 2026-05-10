"""Publish AI-service traces to the backend tracking API.

LangSmith remains the external trace viewer when LANGSMITH_TRACING is enabled.
This module stores the operational subset the admin dashboard needs locally:
trace rows, spans, evaluator inputs, and dataset queue candidates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from config import get_settings
from services.http_client import get_http_client

logger = logging.getLogger(__name__)
settings = get_settings()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(dt: datetime | None = None) -> str:
    value = dt or utc_now()
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


async def publish_agent_trace(payload: dict[str, Any]) -> None:
    """Best-effort trace ingestion; never break the live escalation path."""
    if not payload.get("traceId"):
        logger.debug("Skipping agent trace publish without traceId")
        return

    try:
        http_client = get_http_client()
        response = await http_client.post(
            f"{settings.backend_url}/api/agent-tracking/traces",
            json=payload,
            headers={"x-internal-key": settings.internal_api_key},
            timeout=8.0,
            retry=False,
        )
        if response.status_code not in (200, 201):
            logger.warning(
                "Agent trace ingest returned %s: %s",
                response.status_code,
                response.text[:300],
            )
    except Exception as exc:
        logger.warning("Agent trace ingest failed: %s", exc)


def graph_spans_from_state(
    trace_id: str,
    final_state: dict[str, Any] | None,
    started_at: datetime,
    ended_at: datetime,
    error: str | None = None,
) -> list[dict[str, Any]]:
    """Build dashboard spans from the LangGraph state.

    LangSmith stores the full execution tree. These spans intentionally keep
    only the stable operational path needed for local dashboard filters.
    """
    state = final_state or {}
    status = state.get("status") or ("error" if error else "success")
    triage = state.get("triage")
    ladder = state.get("ladder") or []
    attempts = state.get("attempts") or []
    nodes: list[dict[str, Any]] = [
        {
            "spanId": "intake",
            "name": "intake",
            "runType": "chain",
            "status": "success" if not error else "error",
            "inputs": {"event_id": state.get("event_id"), "source": state.get("source")},
        },
    ]

    if triage is not None:
        triage_payload = triage.model_dump() if hasattr(triage, "model_dump") else dict(triage)
        nodes.append(
            {
                "spanId": "triage",
                "name": "triage",
                "runType": "llm",
                "status": "success",
                "outputs": {
                    "decision": triage_payload.get("decision"),
                    "priority": triage_payload.get("priority"),
                    "emergency_score": triage_payload.get("emergency_score"),
                },
            }
        )

    nodes.append(
        {
            "spanId": "after_hours_gate",
            "name": "after_hours_gate",
            "runType": "chain",
            "status": "success" if status != "after_hours_blocked" else "blocked",
        }
    )

    if ladder:
        nodes.append(
            {
                "spanId": "rotation_planner",
                "name": "rotation_planner",
                "runType": "tool",
                "status": "success",
                "outputs": {"contacts": len(ladder)},
            }
        )

    if attempts:
        nodes.append(
            {
                "spanId": "outreach",
                "name": "outreach",
                "runType": "tool",
                "status": "error" if status == "exhausted" else "success",
                "outputs": {"attempts": len(attempts)},
            }
        )

    if state.get("awaiting"):
        nodes.append(
            {
                "spanId": "wait_for_ack",
                "name": "wait_for_ack",
                "runType": "chain",
                "status": "running",
                "outputs": {"awaiting": state.get("awaiting")},
            }
        )

    terminal_name = "exhaustion" if status == "exhausted" else "resolution"
    nodes.append(
        {
            "spanId": terminal_name,
            "name": terminal_name,
            "runType": "chain",
            "status": "error" if error or status == "exhausted" else "success",
            "outputs": {"status": status, "error": error},
        }
    )

    total_ms = max(1, int((ended_at - started_at).total_seconds() * 1000))
    per_node_ms = max(1, total_ms // max(1, len(nodes)))
    for index, node in enumerate(nodes):
        node.setdefault("startedAt", isoformat(started_at))
        node.setdefault("endedAt", isoformat(ended_at))
        node.setdefault("latencyMs", per_node_ms if index < len(nodes) - 1 else total_ms)
        node["spanId"] = f"{trace_id}_{node['spanId']}"
    return nodes
