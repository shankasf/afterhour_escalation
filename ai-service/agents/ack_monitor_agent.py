import logging
from typing import Dict, Any, Optional
import httpx
import re

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class AckMonitorAgent:
    """
    Agent for monitoring and processing acknowledgments.
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
        """
        Check if a message is an acknowledgment.
        
        Args:
            message: The SMS message text
        
        Returns:
            True if message appears to be an acknowledgment
        """
        message_lower = message.lower().strip()
        
        # Check for exact "ACK" (most common)
        if message_lower == "ack":
            return True
        
        # Check other patterns
        for pattern in self.ack_patterns:
            if re.search(pattern, message_lower):
                return True
        
        return False
    
    async def process_sms_ack(
        self,
        phone_number: str,
        message: str
    ) -> Dict[str, Any]:
        """
        Process an SMS acknowledgment.
        
        Args:
            phone_number: The phone number that sent the ACK
            message: The SMS message content
        
        Returns:
            Dict with success status and event info
        """
        logger.info(f"Processing SMS ACK from {phone_number}")
        
        try:
            # Find the user by phone number and get their active escalation
            async with httpx.AsyncClient() as client:
                # First, find user by phone
                user_response = await client.get(
                    f"{self.backend_url}/api/users",
                    params={"phone": phone_number},
                    timeout=10.0
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
                
                # Find active escalation for this user
                events_response = await client.get(
                    f"{self.backend_url}/api/events/active-escalations",
                    timeout=10.0
                )
                
                if events_response.status_code != 200:
                    return {"success": False, "error": "Could not check escalations"}
                
                events = events_response.json()
                
                # Find an event being escalated to this user
                target_event = None
                for event in events:
                    # Check if current escalation is to this user
                    logs = event.get("escalationLogs", [])
                    if logs:
                        latest_log = logs[-1]
                        if latest_log.get("userId") == user["id"]:
                            target_event = event
                            break
                
                if not target_event:
                    # Check if any recent escalation went to this user
                    return {"success": False, "error": "No active escalation found"}
                
                # Process the acknowledgment
                ack_response = await client.post(
                    f"{self.backend_url}/api/escalation/acknowledge",
                    json={
                        "eventId": target_event["id"],
                        "userId": user["id"],
                        "method": "sms"
                    },
                    timeout=10.0
                )
                
                if ack_response.status_code == 200:
                    logger.info(f"ACK processed for event {target_event['id']}")
                    return {
                        "success": True,
                        "eventId": target_event["id"],
                        "userId": user["id"]
                    }
                else:
                    return {"success": False, "error": "Failed to process ACK"}
                    
        except Exception as e:
            logger.error(f"Error processing SMS ACK: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def process_voice_ack(
        self,
        event_id: str,
        phone_number: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a voice (DTMF) acknowledgment.
        
        Args:
            event_id: The event ID being acknowledged
            phone_number: The phone number that acknowledged
        
        Returns:
            Dict with success status
        """
        logger.info(f"Processing voice ACK for event {event_id}")
        
        try:
            async with httpx.AsyncClient() as client:
                # Find user by phone if provided
                user_id = None
                if phone_number:
                    user_response = await client.get(
                        f"{self.backend_url}/api/users",
                        timeout=10.0
                    )
                    if user_response.status_code == 200:
                        users = user_response.json()
                        for u in users:
                            if u.get("phoneNumber") == phone_number:
                                user_id = u["id"]
                                break
                
                # Process acknowledgment using internal endpoint
                ack_response = await client.post(
                    f"{self.backend_url}/api/acknowledgments/internal",
                    json={
                        "eventId": event_id,
                        "userId": user_id,
                        "phoneNumber": phone_number,
                        "method": "dtmf"
                    },
                    headers={"x-internal-key": self.internal_api_key},
                    timeout=10.0
                )
                
                if ack_response.status_code == 200 or ack_response.status_code == 201:
                    return {"success": True, "eventId": event_id}
                else:
                    logger.error(f"ACK failed: {ack_response.status_code} - {ack_response.text}")
                    return {"success": False, "error": "Failed to process ACK"}
                    
        except Exception as e:
            logger.error(f"Error processing voice ACK: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def process_downgrade(
        self,
        phone_number: str
    ) -> Dict[str, Any]:
        """
        Process a downgrade request from SMS.
        
        Args:
            phone_number: The phone number requesting downgrade
        
        Returns:
            Dict with success status
        """
        logger.info(f"Processing downgrade request from {phone_number}")
        
        try:
            async with httpx.AsyncClient() as client:
                # Find user
                user_response = await client.get(
                    f"{self.backend_url}/api/users",
                    timeout=10.0
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
                
                # Find their most recently acknowledged event
                # This would need a proper endpoint in the backend
                return {"success": True, "message": "Downgrade request noted"}
                
        except Exception as e:
            logger.error(f"Error processing downgrade: {str(e)}")
            return {"success": False, "error": str(e)}
