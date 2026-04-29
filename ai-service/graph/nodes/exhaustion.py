# All ladder contacts attempted - flag for ops follow-up.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState
from graph.tools import stop_escalation


async def exhaustion(state: IncidentState, config: RunnableConfig) -> dict:
    await stop_escalation(state["event_id"], reason="ladder_exhausted")
    return {"status": "exhausted", "awaiting": None}
