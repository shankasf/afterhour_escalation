"""Voice Agent - Generates voice scripts for Twilio outbound calls.

Uses OpenAI Agents SDK pattern from instruction.txt:
    from agents import Agent, Runner
    agent = Agent(name="...", instructions="...")
    result = await Runner.run(agent, input="...")
"""

import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional

from pydantic import BaseModel, Field
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_MODEL = "gpt-5.2"


class VoiceScriptOutput(BaseModel):
    """Structured output for voice script generation."""
    script: str = Field(description="Voice script for TTS (35-50 words)")
    urgency_level: str = Field(default="high", description="critical, high, medium")
    estimated_duration_seconds: int = Field(default=15, description="Seconds to speak")


class VoiceAIAgent:
    """Agent for generating voice scripts for Twilio escalation calls."""

    def __init__(self):
        self._agent = None
        self._init_agent()

    def _init_agent(self):
        """Initialize the OpenAI Agent following instruction.txt pattern."""
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using template scripts")
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        try:
            from agents import Agent

            self._agent = Agent(
                name="Voice Script Generator",
                instructions=(
                    "Generate voice scripts for after-hours emergency escalation calls.\n\n"
                    "REQUIREMENTS:\n"
                    "- 35-50 words max (~15-20 seconds spoken)\n"
                    "- Start with 'After-hours emergency' or 'Priority alert'\n"
                    "- Include key issue summary, no jargon\n"
                    "- End with 'Press 1 to acknowledge and take ownership.'\n"
                    "- Natural speech patterns for phone calls\n"
                    "- No emojis or special characters"
                ),
                model=_MODEL,
                output_type=VoiceScriptOutput,
            )
            logger.info(f"Voice Agent initialized with model={_MODEL}")
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")

    async def generate_message(
        self,
        event_id: str,
        issue_description: str,
        received_at: str = "",
        responder_name: Optional[str] = None,
        escalation_level: int = 1,
        source_type: str = "email",
    ) -> Dict[str, Any]:
        """Generate a voice script for an outbound escalation call."""
        logger.info("="*60)
        logger.info("[VOICE AGENT] Generating voice script")
        logger.info(f"  Event ID: {event_id}")
        logger.info(f"  Issue: {issue_description[:60]}..." if len(issue_description) > 60 else f"  Issue: {issue_description}")
        logger.info(f"  Escalation Level: {escalation_level}")
        logger.info(f"  Source Type: {source_type}")
        
        time_str = self._parse_time(received_at)

        if self._agent:
            try:
                from agents import Runner

                prompt = self._build_prompt(
                    issue_description, time_str, responder_name, escalation_level, source_type
                )
                result = await Runner.run(self._agent, prompt)
                output: VoiceScriptOutput = result.final_output

                # Ensure call-to-action
                script = output.script
                if "press 1" not in script.lower():
                    script = script.rstrip(". ") + ". Press 1 to acknowledge and take ownership."
                
                logger.info(f"[VOICE AGENT] AI Generated script ({output.estimated_duration_seconds}s):")
                logger.info(f"  {script[:100]}..." if len(script) > 100 else f"  {script}")
                logger.info(f"  Urgency Level: {output.urgency_level}")
                logger.info("="*60)

                return {
                    "script": script,
                    "audio_url": None,
                    "generated_by": "ai",
                    "urgency_level": output.urgency_level,
                    "estimated_duration": output.estimated_duration_seconds,
                }
            except Exception as e:
                logger.error(f"AI script generation failed: {e}")

        # Template fallback
        return {
            "script": self._template_script(issue_description, time_str, responder_name, escalation_level),
            "audio_url": None,
            "generated_by": "template",
            "urgency_level": "high",
            "estimated_duration": 15,
        }

    async def generate_voicemail_script(
        self, event_id: str, issue_description: str, escalation_level: int = 1
    ) -> str:
        """Generate a shorter script for voicemail (no DTMF instruction)."""
        if self._agent:
            try:
                from agents import Runner

                prompt = (
                    f"Generate a brief voicemail (~25 words, 10 seconds):\n"
                    f"Issue: {issue_description}\n"
                    f"Level: {escalation_level}\n\n"
                    "Start with 'Urgent message from after-hours support'\n"
                    "Include callback instruction. No DTMF."
                )
                result = await Runner.run(self._agent, prompt)
                return result.final_output.script
            except Exception as e:
                logger.error(f"Voicemail script failed: {e}")

        short = issue_description[:60] if issue_description else "urgent matter"
        return f"Urgent message from after-hours support. {short}. Please call back immediately."

    def _parse_time(self, received_at: str) -> str:
        """Parse timestamp to readable time string."""
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                return dt.strftime("%I:%M %p")
        except Exception:
            pass
        return datetime.now().strftime("%I:%M %p")

    def _build_prompt(
        self, issue: str, time_str: str, name: Optional[str], level: int, source: str
    ) -> str:
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

    def _template_script(self, issue: str, time_str: str, name: Optional[str], level: int) -> str:
        """Generate template-based fallback script."""
        short = issue[:80] if issue else "service request"
        greeting = f"Hello {name}. " if name else ""
        level_note = f"This is escalation level {level}. " if level > 1 else ""

        return (
            f"{greeting}After-hours emergency received at {time_str}. "
            f"{level_note}{short}. Press 1 to acknowledge and take ownership."
        )


# Aliases for backward compatibility
VoiceAgent = VoiceAIAgent

_instance: Optional[VoiceAIAgent] = None


def get_voice_agent() -> VoiceAIAgent:
    """Get singleton VoiceAIAgent instance."""
    global _instance
    if _instance is None:
        _instance = VoiceAIAgent()
    return _instance
