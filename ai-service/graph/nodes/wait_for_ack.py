# Suspendable park - real interrupt is configured on the graph edge.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState


async def wait_for_ack(state: IncidentState, config: RunnableConfig) -> dict:
    return {"status": "awaiting_ack"}
