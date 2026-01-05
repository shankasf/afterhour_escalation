"""SMS Agent - Generates SMS messages for escalation."""

import logging
from datetime import datetime

from pydantic import BaseModel, Field
from agents import Agent, Runner

logger = logging.getLogger(__name__)


class SmsOutput(BaseModel):
    """Structured output for SMS generation."""

    message: str = Field(description="Final SMS text (<=160 chars), plain text")


def create_sms_agent() -> Agent:
    """Create the LLM agent that generates escalation SMS messages."""

    return Agent(
        name="SmsAgent",
        model="gpt-5.2",
        output_type=SmsOutput,
        instructions="""Generate concise SMS alerts for after-hours emergencies.

REQUIREMENTS:
- Under 160 characters
- Start with 'After-Hours Emergency'
- Include time received and brief issue
- End with 'Reply ACK to accept.'
- No emojis
- Return a JSON object with a single field: message""",
    )


# Singleton instance (module-level)
sms_agent = create_sms_agent()


# Backward-compatible alias
get_sms_agent = create_sms_agent


async def generate_sms(event_id: str, issue_description: str, received_at: str = "") -> dict:
    """Generate an SMS message for escalation."""
    logger.info("=" * 60)
    logger.info("[SMS AGENT] Generating SMS message")
    logger.info(f"  Event ID: {event_id}")
    logger.info(f"  Issue: {issue_description[:60]}..." if len(issue_description) > 60 else f"  Issue: {issue_description}")

    time_str = _parse_time(received_at)

    try:
        prompt = (
            f"Generate SMS for after-hours emergency:\n"
            f"Issue: {issue_description}\n"
            f"Time: {time_str}\n\n"
            "Start with 'After-Hours Emergency', end with 'Reply ACK to accept.'"
        )
        result = await Runner.run(sms_agent, prompt)
        output: SmsOutput = result.final_output
        message = (output.message or "").strip()

        # Ensure ACK instruction
        if "reply ack" not in message.lower():
            message = message + " Reply ACK to accept."

        # Ensure <= 160 chars
        if len(message) > 160:
            suffix = " Reply ACK to accept."
            if "reply ack" in message.lower():
                message = message[:160].rstrip()
            else:
                room = 160 - len(suffix)
                message = (message[: max(0, room)].rstrip(". -") + suffix).strip()

        logger.info(f"[SMS AGENT] AI Generated message:")
        logger.info(f"  {message}")
        logger.info("=" * 60)

        return {"message": message, "generated_by": "ai"}
    except Exception as e:
        logger.error(f"[SMS AGENT] Message generation failed: {e}")
        return {"message": _template_message(issue_description, time_str), "generated_by": "template"}


def _parse_time(received_at: str) -> str:
    """Parse timestamp to readable time string."""
    try:
        if received_at:
            dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
            return dt.strftime("%I:%M %p")
    except Exception:
        pass
    return datetime.now().strftime("%I:%M %p")


def _template_message(issue: str, time_str: str) -> str:
    """Generate template-based fallback message."""
    short = issue[:60] if issue else "service request"
    return f"After-Hours Emergency - {short} received at {time_str}. Reply ACK to accept."


# Wrapper class for backward compatibility
class SmsAgent:
    """Wrapper for backward compatibility."""

    async def generate_message(self, event_id: str, issue_description: str, received_at: str = "") -> dict:
        return await generate_sms(event_id, issue_description, received_at)
