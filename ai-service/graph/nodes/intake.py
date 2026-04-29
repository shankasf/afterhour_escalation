# Intake: normalizes the inbound payload into the IncidentState shape.
from __future__ import annotations

from datetime import datetime
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState


async def intake(state: IncidentState, config: RunnableConfig) -> dict:
    raw = state.get("raw") or {}
    channel_event = state.get("channel_event") or {}
    kind = channel_event.get("kind", "")
    if kind.startswith("customer_chat"):
        source = "chat"
    elif kind in ("email_received",):
        source = "email"
    else:
        source = state.get("source") or raw.get("source") or "manual"
    return {
        "event_id": state.get("event_id") or raw.get("event_id") or raw.get("id") or "",
        "source": source,
        "raw": raw,
        "ladder": state.get("ladder") or [],
        "cursor": state.get("cursor") or 0,
        "skip_list": state.get("skip_list") or [],
        "attempts": state.get("attempts") or [],
        "conversation_log": state.get("conversation_log") or [],
        "awaiting": None,
        "awaiting_deadline": None,
        "status": "intake",
        "customer_summary": state.get("customer_summary") or "",
    }
