# Closes the loop once acknowledged - notifies customer + stops backend escalation.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState
from graph.tools import stop_escalation


async def resolution(state: IncidentState, config: RunnableConfig) -> dict:
    await stop_escalation(state["event_id"], reason="acknowledged_by_responder")
    return {"status": "resolved", "awaiting": None}
