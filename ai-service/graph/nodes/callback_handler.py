# Callback path - records the request and parks until the caller rings back.
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState


async def callback_handler(state: IncidentState, config: RunnableConfig) -> dict:
    return {
        "awaiting": "callback",
        "awaiting_deadline": datetime.now(timezone.utc) + timedelta(minutes=10),
        "status": "awaiting_callback",
    }
