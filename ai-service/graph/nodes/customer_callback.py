# Caller asked to be called back later - park until their inbound event resumes the graph.
from __future__ import annotations

from datetime import datetime, timedelta
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState


async def customer_callback(state: IncidentState, config: RunnableConfig) -> dict:
    return {
        "awaiting": "callback",
        "awaiting_deadline": datetime.utcnow() + timedelta(minutes=15),
        "status": "awaiting_callback",
    }
