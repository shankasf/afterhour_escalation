# Uses existing services.after_hours rules - no new prompt.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState
from services.after_hours import should_escalate_now


async def after_hours_gate(state: IncidentState, config: RunnableConfig) -> dict:
    raw = state.get("raw") or {}
    force = bool(raw.get("force_escalate"))
    can_escalate, reason = should_escalate_now(force)
    triage = state.get("triage")

    if not can_escalate or not triage or triage.decision != "escalate":
        return {
            "status": "after_hours_blocked" if not can_escalate else "closed",
            "customer_summary": (
                state.get("customer_summary") or ""
            ) + f" | gate: {reason}",
        }
    return {"status": "outreach"}
