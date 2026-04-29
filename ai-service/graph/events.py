from __future__ import annotations

import logging
from typing import Any

from graph.graph import get_graph

logger = logging.getLogger(__name__)


async def post_event(event_id: str, channel_event: dict[str, Any]) -> dict[str, Any]:
    """Push an external event into the graph - resumes from any wait_* park."""
    graph = get_graph()
    config = {"configurable": {"thread_id": event_id}}
    final = await graph.ainvoke({"channel_event": channel_event, "event_id": event_id}, config=config)
    return {
        "event_id": event_id,
        "status": final.get("status"),
        "awaiting": final.get("awaiting"),
        "cursor": final.get("cursor"),
    }
