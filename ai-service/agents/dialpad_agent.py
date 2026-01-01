import logging
from typing import Dict, Any, Optional
import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class DialpadAgent:
    """
    Agent for processing Dialpad missed calls and voicemails.
    This is optional - all Dialpad events are treated as high-priority.
    """
    
    def __init__(self):
        self.enabled = False
        self._initialize()
    
    def _initialize(self):
        """Initialize Dialpad agent if credentials available."""
        if settings.dialpad_api_key:
            self.enabled = True
            logger.info("Dialpad agent initialized")
        else:
            logger.warning("Dialpad API key not configured - agent disabled (optional)")
            self.enabled = False
    
    async def process_event(
        self,
        event_type: str,
        from_number: Optional[str] = None,
        transcription: Optional[str] = None,
        voicemail_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a Dialpad event.
        
        All Dialpad events (missed calls, voicemails) are treated as high-priority
        emergencies and skip the scoring system.
        
        Args:
            event_type: Type of event (missed_call, voicemail)
            from_number: Caller's phone number
            transcription: Voicemail transcription if available
            voicemail_url: URL to voicemail recording
        
        Returns:
            Dict with event context and recommendation
        """
        logger.info(f"Processing Dialpad event: {event_type} from {from_number}")
        
        context = {
            "event_type": event_type,
            "from_number": from_number,
            "source": "dialpad",
            "priority": "high",  # All Dialpad events are high priority
        }
        
        # If there's a voicemail transcription, include it
        if transcription:
            context["transcription"] = transcription
            context["issue_description"] = transcription[:200]
        
        if voicemail_url:
            context["voicemail_url"] = voicemail_url
        
        # Try to fetch transcription if not provided and API is enabled
        if not transcription and voicemail_url and self.enabled:
            try:
                transcription = await self._fetch_transcription(voicemail_url)
                if transcription:
                    context["transcription"] = transcription
                    context["issue_description"] = transcription[:200]
            except Exception as e:
                logger.error(f"Failed to fetch transcription: {str(e)}")
        
        # Create event in backend
        event_id = await self._create_event(context)
        
        return {
            "event_id": event_id,
            "should_escalate": True,  # Always escalate Dialpad events
            "context": context,
            "confidence": 1.0  # High confidence for phone calls
        }
    
    async def _fetch_transcription(self, voicemail_url: str) -> Optional[str]:
        """Fetch voicemail transcription from Dialpad API."""
        if not self.enabled:
            return None
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    voicemail_url,
                    headers={"Authorization": f"Bearer {settings.dialpad_api_key}"},
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return data.get("transcription")
                
        except Exception as e:
            logger.error(f"Failed to fetch Dialpad transcription: {str(e)}")
        
        return None
    
    async def _create_event(self, context: Dict[str, Any]) -> Optional[str]:
        """Create event in backend."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/events/dialpad",
                    json={
                        "senderPhone": context.get("from_number"),
                        "voicemailTranscription": context.get("transcription"),
                        "voicemailUrl": context.get("voicemail_url"),
                        "receivedAt": context.get("timestamp") or "now"
                    },
                    timeout=10.0
                )
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    return data.get("id")
                    
        except Exception as e:
            logger.error(f"Failed to create Dialpad event in backend: {str(e)}")
        
        return None
    
    def is_enabled(self) -> bool:
        """Check if Dialpad integration is enabled."""
        return self.enabled
