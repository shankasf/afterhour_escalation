import logging
from typing import Dict, Any, List
import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EscalationAgent:
    """
    Agent for managing the escalation process.
    Coordinates contact selection and notification delivery.
    """
    
    def __init__(self):
        self.backend_url = settings.backend_url
    
    async def get_escalation_ladder(self) -> List[Dict[str, Any]]:
        """
        Get the current escalation ladder from the backend.
        
        Returns:
            List of contacts in escalation order
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.backend_url}/api/escalation/ladder",
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    return response.json()
                
        except Exception as e:
            logger.error(f"Failed to get escalation ladder: {str(e)}")
        
        return []
    
    async def start_escalation(self, event_id: str) -> Dict[str, Any]:
        """
        Start escalation for an event.
        
        Args:
            event_id: The event ID to escalate
        
        Returns:
            Dict with escalation status
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.backend_url}/api/escalation/{event_id}/start",
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    return response.json()
                    
        except Exception as e:
            logger.error(f"Failed to start escalation: {str(e)}")
        
        return {"success": False, "error": "Failed to start escalation"}
    
    async def notify_backend_call_status(
        self,
        call_sid: str,
        status: str,
        event_id: str
    ) -> None:
        """Notify backend of call status change."""
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{self.backend_url}/api/escalation/call-status",
                    json={
                        "callSid": call_sid,
                        "status": status,
                        "eventId": event_id
                    },
                    timeout=10.0
                )
        except Exception as e:
            logger.error(f"Failed to notify call status: {str(e)}")
    
    async def notify_backend_sms_status(
        self,
        sms_sid: str,
        status: str,
        event_id: str
    ) -> None:
        """Notify backend of SMS status change."""
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{self.backend_url}/api/escalation/sms-status",
                    json={
                        "smsSid": sms_sid,
                        "status": status,
                        "eventId": event_id
                    },
                    timeout=10.0
                )
        except Exception as e:
            logger.error(f"Failed to notify SMS status: {str(e)}")
