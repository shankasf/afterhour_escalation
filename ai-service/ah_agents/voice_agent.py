"""Voice Agent - Generates voice scripts for Twilio outbound calls."""

import logging
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from agents import Agent, Runner

logger = logging.getLogger(__name__)


class VoiceScriptOutput(BaseModel):
    """Structured output for voice script generation."""
    script: str = Field(description="Voice script for TTS (35-50 words)")
    urgency_level: str = Field(default="high", description="critical, high, medium")
    estimated_duration_seconds: int = Field(default=15, description="Seconds to speak")


def create_voice_script_agent() -> Agent:
    """Create the LLM agent that generates voice scripts for calls."""

    return Agent(
        name="VoiceScriptAgent",
        model="gpt-5.2",
        output_type=VoiceScriptOutput,
        instructions="""Generate voice scripts for after-hours emergency escalation calls.

REQUIREMENTS:
- 35-50 words max (~15-20 seconds spoken)
- Start with 'After-hours emergency' or 'Priority alert'
- Include key issue summary, no jargon
- End with 'Press 1 to acknowledge and take ownership.'
- Natural speech patterns for phone calls
- No emojis or special characters""",
    )


# Singleton instance (module-level)
voice_agent = create_voice_script_agent()


# Backward-compatible alias
get_voice_script_agent = create_voice_script_agent


async def generate_voice_script(
    event_id: str,
    issue_description: str,
    received_at: str = "",
    responder_name: Optional[str] = None,
    escalation_level: int = 1,
    source_type: str = "email",
) -> dict:
    """Generate a voice script for an outbound escalation call."""
    logger.info("=" * 60)
    logger.info("[VOICE AGENT] Generating voice script")
    logger.info(f"  Event ID: {event_id}")
    logger.info(f"  Issue: {issue_description[:60]}..." if len(issue_description) > 60 else f"  Issue: {issue_description}")
    logger.info(f"  Escalation Level: {escalation_level}")
    logger.info(f"  Source Type: {source_type}")

    time_str = _parse_time(received_at)

    try:
        prompt = _build_prompt(issue_description, time_str, responder_name, escalation_level, source_type)
        result = await Runner.run(voice_agent, prompt)
        output: VoiceScriptOutput = result.final_output

        # Ensure call-to-action
        script = output.script
        if "press 1" not in script.lower():
            script = script.rstrip(". ") + ". Press 1 to acknowledge and take ownership."

        logger.info(f"[VOICE AGENT] AI Generated script ({output.estimated_duration_seconds}s):")
        logger.info(f"  {script[:100]}..." if len(script) > 100 else f"  {script}")
        logger.info(f"  Urgency Level: {output.urgency_level}")
        logger.info("=" * 60)

        return {
            "script": script,
            "audio_url": None,
            "generated_by": "ai",
            "urgency_level": output.urgency_level,
            "estimated_duration": output.estimated_duration_seconds,
        }
    except Exception as e:
        logger.error(f"[VOICE AGENT] Script generation failed: {e}")
        return {
            "script": _template_script(issue_description, time_str, responder_name, escalation_level),
            "audio_url": None,
            "generated_by": "template",
            "urgency_level": "high",
            "estimated_duration": 15,
        }


async def generate_voicemail_script(event_id: str, issue_description: str, escalation_level: int = 1) -> str:
    """Generate a shorter script for voicemail (no DTMF instruction)."""
    try:
        prompt = (
            f"Generate a brief voicemail (~25 words, 10 seconds):\n"
            f"Issue: {issue_description}\n"
            f"Level: {escalation_level}\n\n"
            "Start with 'Urgent message from after-hours support'\n"
            "Include callback instruction. No DTMF."
        )
        result = await Runner.run(voice_agent, prompt)
        return result.final_output.script
    except Exception as e:
        logger.error(f"[VOICE AGENT] Voicemail script failed: {e}")
        short = issue_description[:60] if issue_description else "urgent matter"
        return f"Urgent message from after-hours support. {short}. Please call back immediately."


def _parse_time(received_at: str) -> str:
    """Parse timestamp to readable time string."""
    try:
        if received_at:
            dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
            return dt.strftime("%I:%M %p")
    except Exception:
        pass
    return datetime.now().strftime("%I:%M %p")


def _build_prompt(issue: str, time_str: str, name: Optional[str], level: int, source: str) -> str:
    """Build the prompt for script generation."""
    parts = [f"Generate a voice script for an outbound emergency call.\n\nIssue: {issue}\nTime: {time_str}"]

    if level > 1:
        parts.append(f"\nEscalation level {level} - previous responders didn't acknowledge.")
    if name:
        parts.append(f"\nAddress responder as: {name}")
    if source == "dialpad":
        parts.append("\nOriginated from a missed call/voicemail.")

    parts.append("\n\nMUST end with: 'Press 1 to acknowledge and take ownership.'")
    return "".join(parts)


def _template_script(issue: str, time_str: str, name: Optional[str], level: int) -> str:
    """Generate template-based fallback script."""
    short = issue[:80] if issue else "service request"
    greeting = f"Hello {name}. " if name else ""
    level_note = f"This is escalation level {level}. " if level > 1 else ""

    return (
        f"{greeting}After-hours emergency received at {time_str}. "
        f"{level_note}{short}. Press 1 to acknowledge and take ownership."
    )


# Wrapper class for backward compatibility
class VoiceAIAgent:
    """Wrapper for backward compatibility."""

    async def generate_message(self, event_id: str, issue_description: str, received_at: str = "",
                               responder_name: Optional[str] = None, escalation_level: int = 1,
                               source_type: str = "email") -> dict:
        return await generate_voice_script(event_id, issue_description, received_at,
                                          responder_name, escalation_level, source_type)

    async def generate_voicemail_script(self, event_id: str, issue_description: str,
                                        escalation_level: int = 1) -> str:
        return await generate_voicemail_script(event_id, issue_description, escalation_level)


# Aliases
VoiceAgent = VoiceAIAgent


def get_voice_agent() -> VoiceAIAgent:
    """Get VoiceAIAgent instance."""
    return VoiceAIAgent()
