"""Escalation ops wrapper — backend-only.

The SDK ``Agent()`` factory that used to live here has been removed; this
module just exposes the ``EscalationAgent`` class which calls query/tool
functions directly.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from config import get_settings

from ah_agents.queries.escalation import (
    get_escalation_ladder,
    start_escalation,
)

logger = logging.getLogger(__name__)
settings = get_settings()


class EscalationAgent:
    """Backward-compatible wrapper.

    Routes still call this class directly; internally it uses query/tool functions.
    """

    async def get_escalation_ladder(self) -> List[Dict[str, Any]]:
        logger.info("[ESCALATION AGENT] Fetching escalation ladder from backend...")
        output = await get_escalation_ladder()
        contacts = [c.model_dump() for c in output.contacts]
        logger.info("[ESCALATION AGENT] Ladder retrieved: %s contacts", len(contacts))
        return contacts

    async def start_escalation(self, event_id: str) -> Dict[str, Any]:
        logger.info("[ESCALATION AGENT] Starting escalation for event: %s", event_id)
        output = await start_escalation(event_id)
        if output.success and output.data is not None:
            logger.info("[ESCALATION AGENT] Escalation started successfully")
            return output.data
        return {"success": False, "error": output.error or "Failed to start escalation"}
