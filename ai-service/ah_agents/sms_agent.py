import logging
import os
from datetime import datetime
from typing import Dict, Any

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


_MODEL = "gpt-5.2"  # locked per project requirement


class SmsAgent:
    """Agent for generating SMS messages for escalation.

    Uses OpenAI Agents SDK (Responses API) when available, otherwise falls back
    to a deterministic template.
    """

    def __init__(self):
        self.enabled = False
        self._llm_agent = None
        self._initialize()

    def _initialize(self) -> None:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using default messages")
            self.enabled = False
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        if settings.openai_model and settings.openai_model != _MODEL:
            logger.warning("Ignoring openai_model=%s; enforced model is %s", settings.openai_model, _MODEL)

        try:
            from agents import Agent, ModelSettings

            self._llm_agent = Agent(
                name="SMS generator",
                instructions=(
                    "Generate a concise SMS alert for an after-hours emergency. "
                    "Return ONLY the SMS text (no quotes, no markdown)."
                ),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.5),
            )
            self.enabled = True
            logger.info("SMS Agent initialized with OpenAI Agents SDK (Responses API). model=%s", _MODEL)
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI Agents SDK for SMS Agent: {str(e)}")
            self.enabled = False

    async def generate_message(self, event_id: str, issue_description: str, received_at: str) -> Dict[str, Any]:
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except Exception:
            time_str = "now"

        if self.enabled:
            try:
                message = await self._ai_generate_message(issue_description, time_str)
                return {"message": message, "generated_by": "ai"}
            except Exception as e:
                logger.error(f"AI message generation failed: {str(e)}")

        return {"message": self._generate_template_message(issue_description, time_str), "generated_by": "template"}

    async def _ai_generate_message(self, issue_description: str, time_str: str) -> str:
        if not self._llm_agent:
            raise RuntimeError("LLM agent not initialized")

        from agents import Runner

        prompt = (
            "Generate a brief SMS message for an after-hours emergency.\n\n"
            f"Issue: {issue_description}\n"
            f"Time received: {time_str}\n\n"
            "Requirements:\n"
            "- MUST start with 'After-Hours Emergency'\n"
            "- Include the time received\n"
            "- Brief description of the issue\n"
            "- MUST end with 'Reply ACK to accept.'\n"
            "- Prefer under 160 characters\n"
            "- No emojis\n"
        )

        result = await Runner.run(self._llm_agent, prompt)
        message = (result.final_output or "").strip()

        if "reply ack" not in message.lower():
            message = (message + " Reply ACK to accept.").strip()
        return message

    def _generate_template_message(self, issue_description: str, time_str: str) -> str:
        short_issue = issue_description[:60] if issue_description else "service request"
        return f"After-Hours Emergency – {short_issue} received at {time_str}. Reply ACK to accept."
