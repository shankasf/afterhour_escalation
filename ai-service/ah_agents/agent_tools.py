"""Legacy adapter for escalation tools.

Canonical tool implementations live in `ah_agents/queries/*`.
This module exists to keep older imports working while ensuring there is only
one tool contract layer (queries + Pydantic outputs).
"""

from __future__ import annotations

import logging

from ah_agents.queries.escalation import (
    get_current_rotation,
    get_escalation_contact,
    get_escalation_ladder,
    log_escalation_attempt,
    check_event_status,
    stop_escalation,
    start_escalation,
)

logger = logging.getLogger(__name__)


def create_escalation_tools():
    logger.info(
        "agent_tools: assembling escalation tool list",
        extra={"tool_count": 7},
    )
    return [
        get_current_rotation,
        get_escalation_contact,
        get_escalation_ladder,
        start_escalation,
        log_escalation_attempt,
        check_event_status,
        stop_escalation,
    ]


ESCALATION_TOOLS = create_escalation_tools()
