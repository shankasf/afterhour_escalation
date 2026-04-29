# Tells the customer what's happening with their request after triage/outreach changes.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState
from graph.tools import customer_send


async def customer_status_update(state: IncidentState, config: RunnableConfig) -> dict:
    raw = state.get("raw") or {}
    session_token = raw.get("session_token")
    if not session_token:
        return {}

    status = state.get("status", "")
    triage = state.get("triage")
    msg_map = {
        "triaged": f"Got it. We're paging the on-call team now. Priority: {triage.priority if triage else 'high'}.",
        "outreach": "Reaching out to on-call staff now. We'll update you as soon as someone picks up.",
        "acknowledged": "An on-call responder has accepted your request and will follow up shortly.",
        "exhausted": "We weren't able to reach our on-call staff yet. Escalating to backup contacts.",
        "after_hours_blocked": "Your message was logged for first thing in the morning - thanks for reaching out.",
        "resolved": "Your request has been resolved. Reply if anything else comes up.",
    }
    msg = msg_map.get(status)
    if not msg:
        return {}

    await customer_send(session_token=session_token, role="assistant", text=msg, modality="text")
    return {"customer_summary": msg}
