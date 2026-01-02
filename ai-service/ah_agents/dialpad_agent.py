import logging
from typing import Dict, Any, Optional
import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class DialpadAgent:
    """Agent for processing Dialpad missed calls and voicemails.

    Dialpad integration is optional - all Dialpad events are treated as high-priority.
    """

    def __init__(self):
        self.enabled = False
        self._initialize()

    def _initialize(self):
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
        voicemail_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        logger.info(f"Processing Dialpad event: {event_type} from {from_number}")

        context = {
            "event_type": event_type,
            "from_number": from_number,
            "source": "dialpad",
            "priority": "high",
        }

        if transcription:
            context["transcription"] = transcription
            context["issue_description"] = transcription[:200]

        if voicemail_url:
            context["voicemail_url"] = voicemail_url

        if not transcription and voicemail_url and self.enabled:
            try:
                transcription = await self._fetch_transcription(voicemail_url)
                if transcription:
                    context["transcription"] = transcription
                    context["issue_description"] = transcription[:200]
            except Exception as e:
                logger.error(f"Failed to fetch transcription: {str(e)}")

        event_id = await self._create_event(context)

        return {
            "event_id": event_id,
            "should_escalate": True,
            "context": context,
            "confidence": 1.0,
        }

    async def _fetch_transcription(self, voicemail_url: str) -> Optional[str]:
        if not self.enabled:
            return None

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    voicemail_url,
                    headers={"Authorization": f"Bearer {settings.dialpad_api_key}"},
                    timeout=10.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return data.get("transcription")

        except Exception as e:
            logger.error(f"Failed to fetch Dialpad transcription: {str(e)}")

        return None

    async def _create_event(self, context: Dict[str, Any]) -> Optional[str]:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/events/dialpad",
                    json={
                        "senderPhone": context.get("from_number"),
                        "voicemailTranscription": context.get("transcription"),
                        "voicemailUrl": context.get("voicemail_url"),
                        "receivedAt": context.get("timestamp") or "now",
                    },
                    timeout=10.0,
                )

                if response.status_code in (200, 201):
                    data = response.json()
                    return data.get("id")

        except Exception as e:
            logger.error(f"Failed to create Dialpad event in backend: {str(e)}")

        return None

    def is_enabled(self) -> bool:
        return self.enabled
