import logging
from typing import Any, Dict, List

from config import get_settings

from ah_agents.queries.escalation import (
    get_escalation_ladder,
    start_escalation,
)

logger = logging.getLogger(__name__)
settings = get_settings()


def create_escalation_ops_agent():
    """Create the ops agent that manages escalation backend operations."""

    try:  # pragma: no cover
        from agents import Agent
    except Exception:  # pragma: no cover
        logger.warning("Agents SDK unavailable; escalation ops agent disabled")
        return None

    logger.info("Creating EscalationOpsAgent")

    return Agent(
        name="EscalationOpsAgent",
        instructions=(
            "You manage escalation operations through backend APIs. "
            "Use tools to fetch the escalation ladder and start escalations. "
            "Never guess; rely on tool outputs."
        ),
        tools=[get_escalation_ladder, start_escalation],
    )


# Singleton instance (module-level)
escalation_ops_agent = create_escalation_ops_agent()


# Backward-compatible alias
get_escalation_ops_agent = create_escalation_ops_agent


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
