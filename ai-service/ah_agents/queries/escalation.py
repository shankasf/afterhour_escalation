from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional, List

import httpx
from pydantic import BaseModel, Field

from config import get_settings
from logging_setup import with_correlation_header
from . import tool

logger = logging.getLogger(__name__)
settings = get_settings()


class BackendResult(BaseModel):
    success: bool = True
    status_code: Optional[int] = None
    message: Optional[str] = None
    error: Optional[str] = None


class RotationOutput(BackendResult):
    primary_name: str = "On-Call Staff"
    primary_phone: str = ""
    secondary_name: Optional[str] = None
    secondary_phone: Optional[str] = None
    rotation_start: Optional[str] = None
    rotation_end: Optional[str] = None


class EscalationContact(BaseModel):
    level: int = Field(ge=1, le=8)
    role: str
    name: str
    phone: str
    email: Optional[str] = None
    is_available: Optional[bool] = None


class EscalationLadderOutput(BaseModel):
    contacts: List[EscalationContact] = Field(default_factory=list)


class ContactLookupOutput(BackendResult):
    contact: Optional[EscalationContact] = None


class StartEscalationOutput(BackendResult):
    data: Optional[dict[str, Any]] = None


class LogEscalationAttemptOutput(BackendResult):
    escalation_log_id: Optional[str] = None
    timestamp: Optional[str] = None


class EventStatusOutput(BackendResult):
    event_id: str
    status: str = "unknown"
    owner: Optional[Any] = None
    acknowledged: bool = False
    acknowledged_at: Optional[str] = None
    current_level: int = 0
    created_at: Optional[str] = None


class StopEscalationOutput(BackendResult):
    event_id: str
    stopped_at: Optional[str] = None
    reason: Optional[str] = None


@tool
async def get_current_rotation() -> RotationOutput:
    """Get the current on-call rotation contacts from the backend."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.backend_url}/api/escalation/rotation/current",
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json() or {}
                return RotationOutput(
                    success=True,
                    status_code=resp.status_code,
                    primary_name=(data.get("primaryOnCall", {}) or {}).get("name", "Unknown"),
                    primary_phone=(data.get("primaryOnCall", {}) or {}).get("phone", ""),
                    secondary_name=(data.get("secondaryOnCall", {}) or {}).get("name"),
                    secondary_phone=(data.get("secondaryOnCall", {}) or {}).get("phone"),
                    rotation_start=data.get("startDate"),
                    rotation_end=data.get("endDate"),
                )
            return RotationOutput(success=False, status_code=resp.status_code, error=resp.text)
    except Exception as e:
        logger.error("[queries.escalation] get_current_rotation failed: %s", e)
        return RotationOutput(success=False, error=str(e))


@tool
async def get_escalation_contact(role: str, level: int) -> ContactLookupOutput:
    """Look up a single escalation contact by role and/or level."""
    ladder = await get_escalation_ladder()
    for contact in ladder.contacts:
        if contact.level == level or (role and contact.role == role):
            return ContactLookupOutput(success=True, contact=contact)
    return ContactLookupOutput(success=False, error="Contact not found")


@tool
async def get_escalation_ladder() -> EscalationLadderOutput:
    """Fetch the escalation ladder from the backend."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.backend_url}/api/escalation/ladder",
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=10.0,
            )
            if resp.status_code == 200:
                raw = resp.json()
                contacts: list[EscalationContact] = []
                for item in raw or []:
                    contacts.append(
                        EscalationContact(
                            level=int(item.get("level") or 1),
                            role=item.get("role") or "",
                            name=item.get("name") or item.get("role") or "",
                            phone=item.get("phone") or "",
                            email=item.get("email"),
                            is_available=item.get("isAvailable"),
                        )
                    )
                return EscalationLadderOutput(contacts=contacts)
            return EscalationLadderOutput()
    except Exception as e:
        logger.error("[queries.escalation] get_escalation_ladder failed: %s", e)
        return EscalationLadderOutput()


@tool
async def start_escalation(event_id: str) -> StartEscalationOutput:
    """Start escalation in the backend for a specific event."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.backend_url}/api/escalation/start/{event_id}",
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=30.0,
            )
            if resp.status_code in (200, 201):
                return StartEscalationOutput(
                    success=True,
                    status_code=resp.status_code,
                    data=resp.json(),
                )
            return StartEscalationOutput(
                success=False,
                status_code=resp.status_code,
                error=resp.text,
            )
    except Exception as e:
        logger.error("[queries.escalation] start_escalation failed: %s", e)
        return StartEscalationOutput(success=False, error=str(e))


@tool
async def log_escalation_attempt(
    event_id: str,
    contact_name: str,
    contact_phone: str,
    level: int,
    method: str,
) -> LogEscalationAttemptOutput:
    """Log an escalation attempt to the backend audit trail."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.backend_url}/api/escalation/log",
                json={
                    "eventId": event_id,
                    "contactName": contact_name,
                    "contactPhone": contact_phone,
                    "level": level,
                    "method": method,
                    "timestamp": datetime.now().isoformat(),
                },
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=10.0,
            )
            if resp.status_code in (200, 201):
                data = resp.json() or {}
                return LogEscalationAttemptOutput(
                    success=True,
                    status_code=resp.status_code,
                    escalation_log_id=data.get("id") or data.get("escalationLogId"),
                    timestamp=data.get("createdAt") or datetime.now().isoformat(),
                )
            return LogEscalationAttemptOutput(success=False, status_code=resp.status_code, error=resp.text)
    except Exception as e:
        logger.error("[queries.escalation] log_escalation_attempt failed: %s", e)
        return LogEscalationAttemptOutput(success=False, error=str(e), timestamp=datetime.now().isoformat())


@tool
async def check_event_status(event_id: str) -> EventStatusOutput:
    """Fetch current event status from the backend."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.backend_url}/api/events/{event_id}",
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json() or {}
                status_val = (data.get("status") or "unknown")
                status_norm = str(status_val).strip().lower()

                # Backend Event schema uses `acknowledgedBy` + `acknowledgedAt`.
                acknowledged_at = data.get("acknowledgedAt")
                acknowledged_by = data.get("acknowledgedBy")

                # Derive current escalation level from latest escalation log attemptNumber.
                logs = (data.get("escalationLogs") or [])
                current_level = 0
                if isinstance(logs, list) and logs:
                    last_log = logs[-1]
                    if isinstance(last_log, dict):
                        try:
                            current_level = int(last_log.get("attemptNumber") or 0)
                        except Exception:
                            current_level = 0

                # Best-effort current owner/target: acknowledgedBy if present; otherwise current escalation log user.
                owner = acknowledged_by
                if not owner and isinstance(logs, list) and logs:
                    last_log = logs[-1]
                    if isinstance(last_log, dict):
                        owner = last_log.get("user")

                return EventStatusOutput(
                    success=True,
                    status_code=resp.status_code,
                    event_id=event_id,
                    status=str(status_val),
                    owner=owner,
                    acknowledged=bool(acknowledged_at or acknowledged_by or status_norm == "acknowledged"),
                    acknowledged_at=acknowledged_at,
                    current_level=current_level,
                    created_at=data.get("createdAt"),
                )

            return EventStatusOutput(
                success=False,
                status_code=resp.status_code,
                event_id=event_id,
                error=resp.text,
            )
    except Exception as e:
        logger.error("[queries.escalation] check_event_status failed: %s", e)
        return EventStatusOutput(success=False, event_id=event_id, error=str(e))


@tool
async def stop_escalation(event_id: str, reason: str) -> StopEscalationOutput:
    """Stop an active escalation in the backend."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.backend_url}/api/escalation/{event_id}/stop",
                json={"reason": reason},
                headers=with_correlation_header({"x-internal-key": settings.internal_api_key}),
                timeout=10.0,
            )
            if resp.status_code in (200, 201):
                return StopEscalationOutput(
                    success=True,
                    status_code=resp.status_code,
                    event_id=event_id,
                    stopped_at=datetime.now().isoformat(),
                    reason=reason,
                )
            return StopEscalationOutput(
                success=False,
                status_code=resp.status_code,
                event_id=event_id,
                error=resp.text,
            )
    except Exception as e:
        logger.error("[queries.escalation] stop_escalation failed: %s", e)
        return StopEscalationOutput(success=False, event_id=event_id, error=str(e))
