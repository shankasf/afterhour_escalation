"""Legacy adapter for escalation tools.

Canonical tool implementations live in `ah_agents/queries/*`.
This module exists to keep older imports working while ensuring there is only
one tool contract layer (queries + Pydantic outputs).
"""

from __future__ import annotations

from ah_agents.queries.escalation import (
    get_current_rotation,
    get_escalation_contact,
    get_escalation_ladder,
    log_escalation_attempt,
    check_event_status,
    stop_escalation,
    start_escalation,
    notify_call_status,
    notify_sms_status,
)


def create_escalation_tools():
    return [
        get_current_rotation,
        get_escalation_contact,
        get_escalation_ladder,
        start_escalation,
        notify_call_status,
        notify_sms_status,
        log_escalation_attempt,
        check_event_status,
        stop_escalation,
    ]


ESCALATION_TOOLS = create_escalation_tools()
