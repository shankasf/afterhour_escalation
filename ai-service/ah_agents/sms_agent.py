"""SMS Agent - Generates SMS messages for escalation.

Uses OpenAI Agents SDK pattern from instruction.txt:
    from agents import Agent, Runner
    agent = Agent(name="...", instructions="...")
    result = await Runner.run(agent, input="...")
"""

import logging
import os
from datetime import datetime
from typing import Dict, Any

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_MODEL = "gpt-5.2"


class SmsAgent:
    """Agent for generating SMS messages for escalation."""

    def __init__(self):
        self._agent = None
        self._init_agent()

    def _init_agent(self):
        """Initialize the OpenAI Agent following instruction.txt pattern."""
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using template messages")
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        try:
            from agents import Agent

            self._agent = Agent(
                name="SMS Generator",
                instructions=(
                    "Generate concise SMS alerts for after-hours emergencies.\n\n"
                    "REQUIREMENTS:\n"
                    "- Under 160 characters\n"
                    "- Start with 'After-Hours Emergency'\n"
                    "- Include time received and brief issue\n"
                    "- End with 'Reply ACK to accept.'\n"
                    "- No emojis\n"
                    "- Return ONLY the SMS text"
                ),
                model=_MODEL,
            )
            logger.info(f"SMS Agent initialized with model={_MODEL}")
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")

    async def generate_message(
        self, event_id: str, issue_description: str, received_at: str = ""
    ) -> Dict[str, Any]:
        """Generate an SMS message for escalation."""
        logger.info("="*60)
        logger.info("[SMS AGENT] Generating SMS message")
        logger.info(f"  Event ID: {event_id}")
        logger.info(f"  Issue: {issue_description[:60]}..." if len(issue_description) > 60 else f"  Issue: {issue_description}")
        
        time_str = self._parse_time(received_at)

        if self._agent:
            try:
                from agents import Runner

                prompt = (
                    f"Generate SMS for after-hours emergency:\n"
                    f"Issue: {issue_description}\n"
                    f"Time: {time_str}\n\n"
                    "Start with 'After-Hours Emergency', end with 'Reply ACK to accept.'"
                )
                result = await Runner.run(self._agent, prompt)
                message = (result.final_output or "").strip()

                # Ensure ACK instruction
                if "reply ack" not in message.lower():
                    message = message + " Reply ACK to accept."
                
                logger.info(f"[SMS AGENT] AI Generated message:")
                logger.info(f"  {message}")
                logger.info("="*60)

                return {"message": message, "generated_by": "ai"}
            except Exception as e:
                logger.error(f"AI message generation failed: {e}")

        # Template fallback
        return {"message": self._template_message(issue_description, time_str), "generated_by": "template"}

    def _parse_time(self, received_at: str) -> str:
        """Parse timestamp to readable time string."""
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                return dt.strftime("%I:%M %p")
        except Exception:
            pass
        return datetime.now().strftime("%I:%M %p")

    def _template_message(self, issue: str, time_str: str) -> str:
        """Generate template-based fallback message."""
        short = issue[:60] if issue else "service request"
        return f"After-Hours Emergency – {short} received at {time_str}. Reply ACK to accept."
