from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from graph.events import post_event

logger = logging.getLogger(__name__)
router = APIRouter()


class GraphEventBody(BaseModel):
    event_id: str
    channel_event: dict[str, Any]


@router.post("/event")
async def push_event(body: GraphEventBody) -> dict[str, Any]:
    return await post_event(body.event_id, body.channel_event)
