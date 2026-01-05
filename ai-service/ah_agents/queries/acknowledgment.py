from __future__ import annotations

import logging
import re
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from config import get_settings
from . import function_tool

logger = logging.getLogger(__name__)
settings = get_settings()


class AckCheckOutput(BaseModel):
    is_ack: bool
    matched_pattern: Optional[str] = None


class UserLookupOutput(BaseModel):
    found: bool
    user_id: Optional[str] = None
    name: Optional[str] = None
    raw: Optional[dict[str, Any]] = None


class ActiveEscalationLookupOutput(BaseModel):
    found: bool
    event_id: Optional[str] = None
    escalation_log_id: Optional[str] = None
    raw: Optional[dict[str, Any]] = None


class ProcessAckOutput(BaseModel):
    success: bool
    event_id: Optional[str] = None
    user_id: Optional[str] = None
    error: Optional[str] = None


_ACK_PATTERNS = [
    r"\back\b",
    r"\backnowledge\b",
    r"\baccepted?\b",
    r"\byes\b",
    r"\bconfirm\b",
    r"\btaking\s+it\b",
    r"\bi.?ll\s+handle\b",
    r"\bon\s+it\b",
]


@function_tool
async def is_ack_message(message: str) -> AckCheckOutput:
    """Detect whether an inbound SMS looks like an acknowledgment."""
    msg = (message or "").lower().strip()
    if msg == "ack":
        return AckCheckOutput(is_ack=True, matched_pattern="exact:ack")

    for pattern in _ACK_PATTERNS:
        if re.search(pattern, msg):
            return AckCheckOutput(is_ack=True, matched_pattern=pattern)

    return AckCheckOutput(is_ack=False)


@function_tool
async def lookup_user_by_phone(phone_number: str) -> UserLookupOutput:
    """Look up a user in the backend by phone number."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.backend_url}/api/users",
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )
            if resp.status_code != 200:
                return UserLookupOutput(found=False)

            users = resp.json() or []
            for user in users:
                if user.get("phoneNumber") == phone_number:
                    return UserLookupOutput(
                        found=True,
                        user_id=user.get("id"),
                        name=user.get("name"),
                        raw=user,
                    )

            return UserLookupOutput(found=False)
    except Exception as e:
        logger.error("[queries.acknowledgment] lookup_user_by_phone failed: %s", e)
        return UserLookupOutput(found=False)


@function_tool
async def find_active_escalation_for_user(user_id: str) -> ActiveEscalationLookupOutput:
    """Find the active escalation where the latest escalation log targets this user."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.backend_url}/api/events/active-escalations",
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )
            if resp.status_code != 200:
                return ActiveEscalationLookupOutput(found=False)

            events = resp.json() or []
            for event in events:
                logs = event.get("escalationLogs", []) or []
                if not logs:
                    continue
                # Backend returns logs ordered by attemptNumber desc, so first item is latest
                latest = logs[0]
                if latest.get("userId") == user_id:
                    return ActiveEscalationLookupOutput(
                        found=True,
                        event_id=event.get("id"),
                        escalation_log_id=latest.get("id"),
                        raw=event,
                    )

            return ActiveEscalationLookupOutput(found=False)
    except Exception as e:
        logger.error("[queries.acknowledgment] find_active_escalation_for_user failed: %s", e)
        return ActiveEscalationLookupOutput(found=False)


@function_tool
async def record_internal_ack(event_id: str, user_id: Optional[str], phone_number: Optional[str], method: str) -> ProcessAckOutput:
    """Record an internal acknowledgment in the backend."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.backend_url}/api/acknowledgments/internal",
                json={
                    "eventId": event_id,
                    "userId": user_id,
                    "phoneNumber": phone_number,
                    "method": method,
                },
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )

            if resp.status_code in (200, 201):
                return ProcessAckOutput(success=True, event_id=event_id, user_id=user_id)

            return ProcessAckOutput(success=False, event_id=event_id, user_id=user_id, error=resp.text)
    except Exception as e:
        logger.error("[queries.acknowledgment] record_internal_ack failed: %s", e)
        return ProcessAckOutput(success=False, event_id=event_id, user_id=user_id, error=str(e))


@function_tool
async def downgrade_latest_owned_event(user_id: str, reason: str = "Downgraded via SMS by owner") -> ProcessAckOutput:
    """Downgrade the most recent acknowledged event for a user."""
    try:
        async with httpx.AsyncClient() as client:
            events_resp = await client.get(
                f"{settings.backend_url}/api/events/acknowledged",
                params={"ownerId": user_id},
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )
            if events_resp.status_code != 200:
                return ProcessAckOutput(success=False, error="Could not fetch acknowledged events")

            events = events_resp.json() or []
            if not events:
                return ProcessAckOutput(success=False, error="No acknowledged events found to downgrade")

            latest_event = events[0]
            event_id = latest_event.get("id")
            if not event_id:
                return ProcessAckOutput(success=False, error="Malformed event payload")

            resp = await client.post(
                f"{settings.backend_url}/api/events/{event_id}/downgrade",
                json={"userId": user_id, "reason": reason},
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )

            if resp.status_code in (200, 201):
                return ProcessAckOutput(success=True, event_id=event_id, user_id=user_id)

            return ProcessAckOutput(success=False, event_id=event_id, user_id=user_id, error=resp.text)

    except Exception as e:
        logger.error("[queries.acknowledgment] downgrade_latest_owned_event failed: %s", e)
        return ProcessAckOutput(success=False, error=str(e))
