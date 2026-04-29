from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from logging_setup import with_correlation_header

# Re-export existing query tools so graph nodes have a single import surface.
from ah_agents.queries.escalation import (
    get_current_rotation,
    get_escalation_contact,
    get_escalation_ladder,
    start_escalation,
    log_escalation_attempt,
    check_event_status,
    stop_escalation,
)
from ah_agents.queries.acknowledgment import (
    is_ack_message,
    lookup_user_by_phone,
    find_active_escalation_for_user,
    record_internal_ack,
    downgrade_latest_owned_event,
)

logger = logging.getLogger(__name__)


def _backend_url() -> str:
    return os.environ.get("BACKEND_URL") or os.environ.get("backend_url") or "http://localhost:3004"


def _internal_key() -> str:
    return os.environ.get("INTERNAL_API_KEY") or os.environ.get("internal_api_key") or "internal-service-key"


async def dispatch_call(user_id: str, event_id: str, script: str, channel: str = "voice_webrtc") -> dict[str, Any]:
    """Tell the backend to ring an authenticated employee in their open WS room."""
    payload = {"user_id": user_id, "event_id": event_id, "script": script, "channel": channel}
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_backend_url()}/api/signaling/dispatch",
            json=payload,
            headers=with_correlation_header({"x-internal-key": _internal_key()}),
            timeout=10.0,
        )
        return {"status_code": resp.status_code, "ok": resp.status_code in (200, 201), "body": resp.text}


async def customer_send(session_token: str, role: str, text: str, modality: str = "text") -> dict[str, Any]:
    """Push a message to the customer chat session (text or voice transcript)."""
    payload = {"role": role, "text": text, "modality": modality}
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_backend_url()}/api/customer-chat/{session_token}/message",
            json=payload,
            headers=with_correlation_header({"x-internal-key": _internal_key()}),
            timeout=10.0,
        )
        return {"status_code": resp.status_code, "ok": resp.status_code in (200, 201), "body": resp.text}


__all__ = [
    "get_current_rotation",
    "get_escalation_contact",
    "get_escalation_ladder",
    "start_escalation",
    "log_escalation_attempt",
    "check_event_status",
    "stop_escalation",
    "is_ack_message",
    "lookup_user_by_phone",
    "find_active_escalation_for_user",
    "record_internal_ack",
    "downgrade_latest_owned_event",
    "dispatch_call",
    "customer_send",
]
