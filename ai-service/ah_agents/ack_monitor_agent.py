"""Acknowledgment monitor — backend-only wrapper used by FastAPI routes.

The SDK ``Agent()`` factory that used to live here has been removed; this
module just exposes the ``AckMonitorAgent`` class which calls query/tool
functions directly.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ah_agents.queries.acknowledgment import (
    downgrade_latest_owned_event,
    find_active_escalation_for_user,
    is_ack_message,
    lookup_user_by_phone,
    record_internal_ack,
)

logger = logging.getLogger(__name__)


class AckMonitorAgent:
    """Backward-compatible wrapper.

    Keeps the FastAPI routes stable while moving network calls into tools/queries.
    """

    async def is_acknowledgment(self, message: str) -> bool:
        return (await is_ack_message(message)).is_ack

    async def process_sms_ack(self, phone_number: str, message: str) -> Dict[str, Any]:
        logger.info("Processing SMS ACK from %s", phone_number)

        user = await lookup_user_by_phone(phone_number)
        if not user.found or not user.user_id:
            return {"success": False, "error": "User not found"}

        escalation = await find_active_escalation_for_user(user.user_id)
        if not escalation.found or not escalation.event_id:
            return {"success": False, "error": "No active escalation found"}

        ack = await record_internal_ack(
            event_id=escalation.event_id,
            user_id=user.user_id,
            phone_number=phone_number,
            method="sms",
        )
        if ack.success:
            logger.info("ACK processed for event %s", escalation.event_id)
            return {"success": True, "eventId": escalation.event_id, "userId": user.user_id}

        return {"success": False, "error": ack.error or "Failed to process ACK"}

    async def process_voice_ack(self, event_id: str, phone_number: Optional[str] = None) -> Dict[str, Any]:
        logger.info("Processing voice ACK for event %s", event_id)

        user_id: Optional[str] = None
        if phone_number:
            user = await lookup_user_by_phone(phone_number)
            user_id = user.user_id

        # Note: method must be "call" (not "dtmf") to match backend AckMethod enum
        ack = await record_internal_ack(
            event_id=event_id,
            user_id=user_id,
            phone_number=phone_number,
            method="call",
        )

        if ack.success:
            return {"success": True, "eventId": event_id}

        return {"success": False, "error": ack.error or "Failed to process ACK"}

    async def process_downgrade(self, phone_number: str) -> Dict[str, Any]:
        logger.info("Processing downgrade request from %s", phone_number)

        user = await lookup_user_by_phone(phone_number)
        if not user.found or not user.user_id:
            return {"success": False, "error": "User not found"}

        result = await downgrade_latest_owned_event(user_id=user.user_id)
        if result.success:
            return {"success": True, "eventId": result.event_id}

        return {"success": False, "error": result.error or "Failed to downgrade event"}
