import logging
from typing import Dict, Any, Optional
import httpx
import re

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class AckMonitorAgent:
    """Agent for monitoring and processing acknowledgments.

    Handles both SMS and voice (DTMF) acknowledgments.
    """

    def __init__(self):
        self.backend_url = settings.backend_url
        self.internal_api_key = settings.internal_api_key or "internal-service-key"

        # Patterns that indicate an acknowledgment
        self.ack_patterns = [
            r"\back\b",
            r"\backnowledge\b",
            r"\baccepted?\b",
            r"\byes\b",
            r"\bconfirm\b",
            r"\btaking\s+it\b",
            r"\bi.?ll\s+handle\b",
            r"\bon\s+it\b",
        ]

    async def is_acknowledgment(self, message: str) -> bool:
        """Check if a message is an acknowledgment."""
        message_lower = message.lower().strip()

        # Check for exact "ACK" (most common)
        if message_lower == "ack":
            return True

        for pattern in self.ack_patterns:
            if re.search(pattern, message_lower):
                return True

        return False

    async def process_sms_ack(self, phone_number: str, message: str) -> Dict[str, Any]:
        """Process an SMS acknowledgment."""
        logger.info(f"Processing SMS ACK from {phone_number}")

        try:
            async with httpx.AsyncClient() as client:
                user_response = await client.get(
                    f"{self.backend_url}/api/users",
                    params={"phone": phone_number},
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if user_response.status_code != 200:
                    logger.error("Failed to find user by phone")
                    return {"success": False, "error": "User not found"}

                users = user_response.json()
                user = None
                for u in users:
                    if u.get("phoneNumber") == phone_number:
                        user = u
                        break

                if not user:
                    return {"success": False, "error": "User not found"}

                events_response = await client.get(
                    f"{self.backend_url}/api/events/active-escalations",
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if events_response.status_code != 200:
                    return {"success": False, "error": "Could not check escalations"}

                events = events_response.json()

                target_event = None
                for event in events:
                    logs = event.get("escalationLogs", [])
                    if logs:
                        latest_log = logs[-1]
                        if latest_log.get("userId") == user["id"]:
                            target_event = event
                            break

                if not target_event:
                    return {"success": False, "error": "No active escalation found"}

                ack_response = await client.post(
                    f"{self.backend_url}/api/acknowledgments/internal",
                    json={
                        "eventId": target_event["id"],
                        "userId": user["id"],
                        "phoneNumber": phone_number,
                        "method": "sms",
                    },
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if ack_response.status_code == 200:
                    logger.info(f"ACK processed for event {target_event['id']}")
                    return {"success": True, "eventId": target_event["id"], "userId": user["id"]}

                return {"success": False, "error": "Failed to process ACK"}

        except Exception as e:
            logger.error(f"Error processing SMS ACK: {str(e)}")
            return {"success": False, "error": str(e)}

    async def process_voice_ack(self, event_id: str, phone_number: Optional[str] = None) -> Dict[str, Any]:
        """Process a voice (DTMF) acknowledgment."""
        logger.info(f"Processing voice ACK for event {event_id}")

        try:
            async with httpx.AsyncClient() as client:
                user_id = None
                if phone_number:
                    user_response = await client.get(
                        f"{self.backend_url}/api/users",
                        headers={"x-internal-key": self.internal_api_key},
                        timeout=10.0,
                    )
                    if user_response.status_code == 200:
                        users = user_response.json()
                        for u in users:
                            if u.get("phoneNumber") == phone_number:
                                user_id = u["id"]
                                break

                # Note: method must be "call" (not "dtmf") to match backend AckMethod enum
                ack_response = await client.post(
                    f"{self.backend_url}/api/acknowledgments/internal",
                    json={
                        "eventId": event_id,
                        "userId": user_id,
                        "phoneNumber": phone_number,
                        "method": "call",
                    },
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if ack_response.status_code in (200, 201):
                    return {"success": True, "eventId": event_id}

                logger.error(f"ACK failed: {ack_response.status_code} - {ack_response.text}")
                return {"success": False, "error": "Failed to process ACK"}

        except Exception as e:
            logger.error(f"Error processing voice ACK: {str(e)}")
            return {"success": False, "error": str(e)}

    async def process_downgrade(self, phone_number: str) -> Dict[str, Any]:
        """Process a downgrade request from SMS.
        
        Per design doc: After acknowledgment, on-call person can downgrade 
        the event to non-emergency status.
        """
        logger.info(f"Processing downgrade request from {phone_number}")
        try:
            async with httpx.AsyncClient() as client:
                # First find the user
                user_response = await client.get(
                    f"{self.backend_url}/api/users",
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if user_response.status_code != 200:
                    return {"success": False, "error": "User lookup failed"}

                users = user_response.json()
                user = None
                for u in users:
                    if u.get("phoneNumber") == phone_number:
                        user = u
                        break

                if not user:
                    return {"success": False, "error": "User not found"}

                # Find acknowledged events owned by this user
                events_response = await client.get(
                    f"{self.backend_url}/api/events/acknowledged",
                    params={"ownerId": user["id"]},
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if events_response.status_code != 200:
                    return {"success": False, "error": "Could not check acknowledged events"}

                events = events_response.json()
                if not events:
                    return {"success": False, "error": "No acknowledged events found to downgrade"}

                # Downgrade the most recent acknowledged event
                latest_event = events[0]
                downgrade_response = await client.post(
                    f"{self.backend_url}/api/events/{latest_event['id']}/downgrade",
                    json={"userId": user["id"], "reason": "Downgraded via SMS by owner"},
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0,
                )

                if downgrade_response.status_code in (200, 201):
                    logger.info(f"Event {latest_event['id']} downgraded by {user['id']}")
                    return {"success": True, "eventId": latest_event["id"]}

                return {"success": False, "error": "Failed to downgrade event"}

        except Exception as e:
            logger.error(f"Error processing downgrade: {str(e)}")
            return {"success": False, "error": str(e)}
