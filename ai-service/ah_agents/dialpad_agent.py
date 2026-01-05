import logging
from typing import Dict, Any, Optional

from config import get_settings
from ah_agents.queries.dialpad import create_dialpad_event, fetch_dialpad_transcription

logger = logging.getLogger(__name__)
settings = get_settings()


def create_dialpad_ops_agent():
    """Create the ops agent that handles Dialpad backend interactions."""

    try:  # pragma: no cover
        from agents import Agent
    except Exception:  # pragma: no cover
        return None

    return Agent(
        name="DialpadOpsAgent",
        instructions=(
            "You process inbound Dialpad missed calls/voicemails. "
            "Use tools to fetch voicemail transcriptions when needed and create events in the backend."
        ),
        tools=[fetch_dialpad_transcription, create_dialpad_event],
    )


# Singleton instance (module-level)
dialpad_ops_agent = create_dialpad_ops_agent()


# Backward-compatible alias
get_dialpad_ops_agent = create_dialpad_ops_agent


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

        output = await fetch_dialpad_transcription(voicemail_url)
        return output.transcription

    async def _create_event(self, context: Dict[str, Any]) -> Optional[str]:
        output = await create_dialpad_event(
            sender_phone=context.get("from_number"),
            voicemail_transcription=context.get("transcription"),
            voicemail_url=context.get("voicemail_url"),
            received_at=context.get("timestamp") or "now",
        )
        return output.event_id

    def is_enabled(self) -> bool:
        return self.enabled
