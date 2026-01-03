"""Agent Tools for Escalation Operations.

This module defines function tools that agents can use during orchestration.
Tools provide access to external services (backend API, Twilio, database)
in a structured way that the LLM agents can invoke.
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

import httpx
from pydantic import BaseModel, Field

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# ============================================================================
# Tool Input/Output Models
# ============================================================================


class GetRotationInput(BaseModel):
    """Input for getting current on-call rotation."""
    pass  # No input needed


class GetRotationOutput(BaseModel):
    """Output from rotation lookup."""
    primary_name: str
    primary_phone: str
    secondary_name: Optional[str] = None
    secondary_phone: Optional[str] = None
    rotation_start: Optional[str] = None
    rotation_end: Optional[str] = None


class GetContactInput(BaseModel):
    """Input for getting contact by role/level."""
    role: str = Field(description="Role name like 'Primary On-Call', 'Matt', etc.")
    level: int = Field(ge=1, le=8, description="Escalation level 1-8")


class GetContactOutput(BaseModel):
    """Output from contact lookup."""
    name: str
    phone: str
    email: Optional[str] = None
    role: str
    level: int
    is_available: bool = True


class LogEscalationInput(BaseModel):
    """Input for logging escalation attempt."""
    event_id: str
    contact_name: str
    contact_phone: str
    level: int
    method: str = Field(description="'call', 'sms', or 'both'")


class LogEscalationOutput(BaseModel):
    """Output from escalation logging."""
    escalation_log_id: str
    timestamp: str


class RecordAckInput(BaseModel):
    """Input for recording acknowledgment."""
    event_id: str
    contact_name: str
    method: str = Field(description="'sms_reply' or 'call_keypress'")


class RecordAckOutput(BaseModel):
    """Output from acknowledgment recording."""
    success: bool
    acknowledged_at: str
    owner_name: str


# ============================================================================
# Tool Functions (used by agents via function_tool decorator)
# ============================================================================


def create_escalation_tools():
    """Create and return escalation tools for use with OpenAI Agents SDK.
    
    Returns a list of function tools that can be added to an Agent's tools list.
    """
    try:
        from agents import function_tool
    except ImportError:
        logger.warning("OpenAI Agents SDK not available - tools disabled")
        return []

    @function_tool
    async def get_current_rotation() -> Dict[str, Any]:
        """Get the current on-call rotation contacts.
        
        Returns the primary and secondary on-call staff for the current rotation period.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.backend_url}/api/escalation/rotation/current",
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "primary_name": data.get("primaryOnCall", {}).get("name", "Unknown"),
                        "primary_phone": data.get("primaryOnCall", {}).get("phone", ""),
                        "secondary_name": data.get("secondaryOnCall", {}).get("name"),
                        "secondary_phone": data.get("secondaryOnCall", {}).get("phone"),
                        "rotation_start": data.get("startDate"),
                        "rotation_end": data.get("endDate"),
                    }
        except Exception as e:
            logger.error(f"Failed to get rotation: {str(e)}")
        
        return {
            "primary_name": "On-Call Staff",
            "primary_phone": "",
            "secondary_name": None,
            "secondary_phone": None,
            "error": "Could not fetch rotation",
        }

    @function_tool
    async def get_escalation_contact(role: str, level: int) -> Dict[str, Any]:
        """Get contact information for a specific escalation level.
        
        Args:
            role: The role name (e.g., 'Primary On-Call', 'Matt', 'Karina')
            level: The escalation level (1-8)
            
        Returns contact details including name, phone, and availability.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.backend_url}/api/escalation/ladder",
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    ladder = response.json()
                    for contact in ladder:
                        if contact.get("level") == level or contact.get("role") == role:
                            return {
                                "name": contact.get("name", role),
                                "phone": contact.get("phone", ""),
                                "email": contact.get("email"),
                                "role": contact.get("role", role),
                                "level": contact.get("level", level),
                                "is_available": contact.get("isAvailable", True),
                            }
        except Exception as e:
            logger.error(f"Failed to get contact for {role}: {str(e)}")
        
        return {
            "name": role,
            "phone": "",
            "role": role,
            "level": level,
            "is_available": False,
            "error": "Contact not found",
        }

    @function_tool
    async def log_escalation_attempt(
        event_id: str,
        contact_name: str,
        contact_phone: str,
        level: int,
        method: str,
    ) -> Dict[str, Any]:
        """Log an escalation attempt to the audit trail.
        
        Args:
            event_id: The event being escalated
            contact_name: Name of the person being contacted
            contact_phone: Phone number contacted
            level: Escalation level (1-8)
            method: Contact method ('call', 'sms', or 'both')
            
        Returns the escalation log ID for tracking.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/escalation/log",
                    json={
                        "eventId": event_id,
                        "contactName": contact_name,
                        "contactPhone": contact_phone,
                        "level": level,
                        "method": method,
                        "timestamp": datetime.now().isoformat(),
                    },
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code in (200, 201):
                    data = response.json()
                    return {
                        "escalation_log_id": data.get("id", ""),
                        "timestamp": data.get("createdAt", datetime.now().isoformat()),
                    }
        except Exception as e:
            logger.error(f"Failed to log escalation: {str(e)}")
        
        return {
            "escalation_log_id": "",
            "timestamp": datetime.now().isoformat(),
            "error": "Failed to log escalation",
        }

    @function_tool
    async def record_acknowledgment(
        event_id: str,
        contact_name: str,
        method: str,
    ) -> Dict[str, Any]:
        """Record that someone acknowledged and took ownership of an event.
        
        Args:
            event_id: The event being acknowledged
            contact_name: Name of the person acknowledging
            method: How they acknowledged ('sms_reply' or 'call_keypress')
            
        Returns confirmation with timestamp and owner assignment.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/acknowledgment",
                    json={
                        "eventId": event_id,
                        "acknowledgedBy": contact_name,
                        "method": method,
                        "timestamp": datetime.now().isoformat(),
                    },
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code in (200, 201):
                    data = response.json()
                    return {
                        "success": True,
                        "acknowledged_at": data.get("acknowledgedAt", datetime.now().isoformat()),
                        "owner_name": data.get("owner", contact_name),
                    }
        except Exception as e:
            logger.error(f"Failed to record acknowledgment: {str(e)}")
        
        return {
            "success": False,
            "acknowledged_at": datetime.now().isoformat(),
            "owner_name": contact_name,
            "error": "Failed to record acknowledgment",
        }

    @function_tool
    async def check_event_status(event_id: str) -> Dict[str, Any]:
        """Check the current status of an escalation event.
        
        Args:
            event_id: The event ID to check
            
        Returns the current status, owner, and escalation history.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.backend_url}/api/events/{event_id}",
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "event_id": event_id,
                        "status": data.get("status", "unknown"),
                        "owner": data.get("owner"),
                        "acknowledged": data.get("acknowledged", False),
                        "acknowledged_at": data.get("acknowledgedAt"),
                        "current_level": data.get("currentEscalationLevel", 0),
                        "created_at": data.get("createdAt"),
                    }
        except Exception as e:
            logger.error(f"Failed to check event status: {str(e)}")
        
        return {
            "event_id": event_id,
            "status": "unknown",
            "error": "Failed to fetch event status",
        }

    @function_tool
    async def stop_escalation(event_id: str, reason: str) -> Dict[str, Any]:
        """Stop an active escalation (e.g., after acknowledgment).
        
        Args:
            event_id: The event to stop escalating
            reason: Why escalation is being stopped
            
        Returns confirmation of escalation stop.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/escalation/{event_id}/stop",
                    json={"reason": reason},
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=10.0,
                )
                if response.status_code in (200, 201):
                    return {
                        "success": True,
                        "event_id": event_id,
                        "stopped_at": datetime.now().isoformat(),
                        "reason": reason,
                    }
        except Exception as e:
            logger.error(f"Failed to stop escalation: {str(e)}")
        
        return {
            "success": False,
            "event_id": event_id,
            "error": "Failed to stop escalation",
        }

    return [
        get_current_rotation,
        get_escalation_contact,
        log_escalation_attempt,
        record_acknowledgment,
        check_event_status,
        stop_escalation,
    ]


# Pre-created tools list
ESCALATION_TOOLS = create_escalation_tools()
