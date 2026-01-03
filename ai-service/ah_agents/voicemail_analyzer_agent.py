"""Voicemail Analyzer Agent - Analyzes Dialpad voicemail transcripts.

Uses OpenAI Agents SDK pattern from instruction.txt:
    from agents import Agent, Runner
    agent = Agent(name="...", instructions="...")
    result = await Runner.run(agent, input="...")
"""

import logging
import os
from typing import Dict, Any, Optional

from pydantic import BaseModel, Field
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_MODEL = "gpt-5.2"


class VoicemailContext(BaseModel):
    """Context extracted from voicemail."""
    location: Optional[str] = None
    equipment: Optional[str] = None
    issue_description: str = ""
    caller_name: Optional[str] = None
    callback_number: Optional[str] = None
    is_safety_critical: bool = False


class VoicemailOutput(BaseModel):
    """Structured output for voicemail analysis."""
    emergency_score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    context: VoicemailContext = Field(default_factory=VoicemailContext)
    recommended_action: str = "escalate"


# Keywords for fallback scoring
CRITICAL_PHRASES = {
    "fire": 0.95, "flood": 0.95, "flooding": 0.95, "water leak": 0.9, "leak": 0.85,
    "no power": 0.9, "power out": 0.9, "power outage": 0.9, "elevator stuck": 0.9,
    "stuck in elevator": 0.95, "fire alarm": 0.95, "hvac down": 0.85, "no heat": 0.85,
    "no ac": 0.8, "no cooling": 0.8, "emergency": 0.8, "urgent": 0.7, "help": 0.7,
    "please call": 0.65, "call me back": 0.6, "immediately": 0.7, "asap": 0.65,
}

NON_URGENT_PHRASES = {
    "when you get a chance": -0.2, "no rush": -0.3, "not urgent": -0.3,
    "routine": -0.2, "scheduled": -0.2, "tomorrow": -0.15, "next week": -0.2,
}


class VoicemailAnalyzerAgent:
    """Agent for analyzing Dialpad voicemail transcripts."""

    def __init__(self):
        self._agent = None
        self._init_agent()

    def _init_agent(self):
        """Initialize the OpenAI Agent following instruction.txt pattern."""
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using keyword scoring")
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        try:
            from agents import Agent

            self._agent = Agent(
                name="Voicemail Analyzer",
                instructions=(
                    "Analyze after-hours voicemail transcripts for emergency triage.\n\n"
                    "SCORING:\n"
                    "- 0.9-1.0: Life safety (fire, flood, entrapment)\n"
                    "- 0.7-0.9: Critical systems (power outage, HVAC failure)\n"
                    "- 0.5-0.7: Urgent but not critical (equipment issues)\n"
                    "- 0.3-0.5: Can wait until morning\n"
                    "- 0.0-0.3: Non-emergency\n\n"
                    "Extract location, equipment, caller details, and callback info."
                ),
                model=_MODEL,
                output_type=VoicemailOutput,
            )
            logger.info(f"Voicemail Analyzer initialized with model={_MODEL}")
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")

    async def analyze(self, transcription: str, from_number: Optional[str] = None) -> Dict[str, Any]:
        """Analyze a voicemail transcript and return emergency assessment."""
        logger.info("="*60)
        logger.info("[VOICEMAIL ANALYZER] Starting analysis")
        logger.info(f"  From Number: {from_number}")
        logger.info(f"  Transcript Length: {len(transcription) if transcription else 0} chars")
        
        if not transcription or not transcription.strip():
            logger.info("[VOICEMAIL ANALYZER] No transcript - defaulting to high priority")
            logger.info("="*60)
            return {
                "emergency_score": 0.8,
                "reasoning": "No transcript available - defaulting to high priority",
                "context": {"issue_description": "Voicemail received, no transcript", "callback_number": from_number},
                "recommended_action": "escalate",
            }

        if self._agent:
            try:
                from agents import Runner

                prompt = f"Analyze this voicemail transcript:\n\n{transcription}"
                if from_number:
                    prompt += f"\n\nCaller: {from_number}"

                logger.info("[VOICEMAIL ANALYZER] Sending to AI for analysis...")
                result = await Runner.run(self._agent, prompt)
                output: VoicemailOutput = result.final_output
                
                logger.info("[VOICEMAIL ANALYZER] AI Analysis complete:")
                logger.info(f"  Emergency Score: {output.emergency_score:.2f}")
                logger.info(f"  Reasoning: {output.reasoning[:80]}..." if len(output.reasoning) > 80 else f"  Reasoning: {output.reasoning}")
                logger.info(f"  Recommended Action: {output.recommended_action}")
                logger.info("="*60)

                return {
                    "emergency_score": output.emergency_score,
                    "reasoning": output.reasoning,
                    "context": output.context.model_dump(),
                    "recommended_action": output.recommended_action,
                }
            except Exception as e:
                logger.error(f"[VOICEMAIL ANALYZER] AI analysis failed: {e}")
                logger.info("[VOICEMAIL ANALYZER] Falling back to keyword analysis")

        # Fallback to keyword scoring
        return self._keyword_analyze(transcription, from_number)

    def _keyword_analyze(self, transcription: str, from_number: Optional[str]) -> Dict[str, Any]:
        """Fallback keyword-based analysis."""
        text = transcription.lower()
        score = 0.5
        matched = []

        for phrase, weight in CRITICAL_PHRASES.items():
            if phrase in text:
                if weight > score:
                    score = weight
                matched.append(phrase)

        for phrase, adj in NON_URGENT_PHRASES.items():
            if phrase in text:
                score = max(0.1, score + adj)
                matched.append(f"downgrade:{phrase}")

        action = "escalate" if score >= 0.6 else ("monitor" if score >= 0.4 else "ignore")
        reasoning = f"Keyword matches: [{', '.join(matched)}]" if matched else "No keywords - moderate priority"

        return {
            "emergency_score": round(score, 2),
            "reasoning": reasoning,
            "context": {"issue_description": transcription[:200], "callback_number": from_number},
            "recommended_action": action,
        }


_instance: Optional[VoicemailAnalyzerAgent] = None


def get_voicemail_analyzer_agent() -> VoicemailAnalyzerAgent:
    """Get singleton VoicemailAnalyzerAgent instance."""
    global _instance
    if _instance is None:
        _instance = VoicemailAnalyzerAgent()
    return _instance
