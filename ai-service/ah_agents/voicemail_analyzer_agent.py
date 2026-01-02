"""Voicemail Analyzer Agent using OpenAI Agents SDK.

Analyzes Dialpad voicemail transcripts to extract emergency context, severity,
and relevant details for escalation decisions.
"""

import logging
import os
from typing import Dict, Any, Optional

from pydantic import BaseModel, Field

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


_MODEL = "gpt-5.2"  # locked per project requirement


class VoicemailContext(BaseModel):
    """Structured context extracted from voicemail."""
    location: Optional[str] = Field(None, description="Property or location mentioned")
    equipment: Optional[str] = Field(None, description="Equipment or system involved")
    issue_description: str = Field("", description="Brief summary of the issue")
    caller_name: Optional[str] = Field(None, description="Caller name if mentioned")
    callback_number: Optional[str] = Field(None, description="Callback number if provided")
    is_safety_critical: bool = Field(False, description="True if safety/life-threat indicated")
    requires_immediate_response: bool = Field(False, description="True if caller expressed urgency")


class VoicemailAnalysisOutput(BaseModel):
    """Full analysis output for voicemail transcript."""
    emergency_score: float = Field(ge=0.0, le=1.0, description="Score 0-1, higher = more urgent")
    reasoning: str = Field("", description="Brief explanation for the score")
    context: VoicemailContext = Field(default_factory=VoicemailContext)
    recommended_action: str = Field("escalate", description="escalate | monitor | ignore")


class VoicemailAnalyzerAgent:
    """Agent for analyzing Dialpad voicemail transcripts.

    Uses OpenAI Agents SDK (Responses API) to extract structured emergency
    information from voicemail transcripts. Falls back to keyword analysis
    if the LLM is unavailable.
    """

    def __init__(self):
        self.enabled = False
        self._llm_agent = None
        self._initialize()

        # Emergency indicators for fallback scoring
        self.critical_phrases = {
            "fire": 0.95,
            "flood": 0.95,
            "flooding": 0.95,
            "water leak": 0.9,
            "leak": 0.85,
            "no power": 0.9,
            "power out": 0.9,
            "power outage": 0.9,
            "elevator stuck": 0.9,
            "stuck in elevator": 0.95,
            "fire alarm": 0.95,
            "hvac down": 0.85,
            "no heat": 0.85,
            "no ac": 0.8,
            "no cooling": 0.8,
            "emergency": 0.8,
            "urgent": 0.7,
            "help": 0.7,
            "please call": 0.65,
            "call me back": 0.6,
            "immediately": 0.7,
            "right away": 0.7,
            "asap": 0.65,
        }

        # Downgrade indicators
        self.non_urgent_phrases = {
            "when you get a chance": -0.2,
            "no rush": -0.3,
            "not urgent": -0.3,
            "routine": -0.2,
            "scheduled": -0.2,
            "tomorrow": -0.15,
            "next week": -0.2,
            "minor": -0.2,
        }

    def _initialize(self) -> None:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning(
                "OpenAI API key not configured - voicemail analyzer using keyword scoring only"
            )
            self.enabled = False
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        if settings.openai_model and settings.openai_model != _MODEL:
            logger.warning(
                "Ignoring openai_model=%s; enforced model is %s",
                settings.openai_model,
                _MODEL,
            )

        try:
            from agents import Agent, ModelSettings

            self._llm_agent = Agent(
                name="Voicemail analyzer",
                instructions=(
                    "You are an emergency triage specialist analyzing after-hours voicemail transcripts "
                    "for a property management emergency hotline.\n\n"
                    "SCORING GUIDELINES:\n"
                    "- 0.9-1.0: Life safety (fire, flood, elevator entrapment, gas leak)\n"
                    "- 0.7-0.89: Critical systems (power outage, HVAC failure, major leak, security breach)\n"
                    "- 0.5-0.69: Urgent but not critical (equipment malfunction, minor leak, access issue)\n"
                    "- 0.3-0.49: Can wait until morning (routine maintenance, cosmetic issues)\n"
                    "- 0.0-0.29: Non-emergency (general inquiry, scheduled work)\n\n"
                    "DOWNGRADE INDICATORS (reduce score):\n"
                    "- 'No rush', 'when you get a chance', 'not urgent'\n"
                    "- Scheduled maintenance or routine requests\n"
                    "- Cosmetic or minor issues\n\n"
                    "Extract all relevant context from the transcript including location, "
                    "equipment involved, caller details, and callback information."
                ),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.3),
                output_type=VoicemailAnalysisOutput,
            )
            self.enabled = True
            logger.info(
                "Voicemail Analyzer Agent initialized with OpenAI Agents SDK. model=%s",
                _MODEL,
            )
        except Exception as e:
            logger.error(
                f"Failed to initialize OpenAI Agents SDK for Voicemail Analyzer: {str(e)}"
            )
            self.enabled = False

    async def analyze(
        self,
        transcription: str,
        from_number: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Analyze a voicemail transcript and return emergency assessment.

        Args:
            transcription: The voicemail transcript text
            from_number: Optional caller phone number

        Returns:
            Dict with emergency_score, reasoning, context, and recommended_action
        """
        if not transcription or not transcription.strip():
            # No transcript - assume high priority (can't assess, err on caution)
            return {
                "emergency_score": 0.8,
                "reasoning": "No transcript available - defaulting to high priority",
                "context": {
                    "issue_description": "Voicemail received, no transcript available",
                    "callback_number": from_number,
                },
                "recommended_action": "escalate",
            }

        if self.enabled:
            try:
                result = await self._ai_analyze(transcription, from_number)
                return result
            except Exception as e:
                logger.error(f"AI voicemail analysis failed: {str(e)}")

        # Fallback to keyword scoring
        return self._keyword_analyze(transcription, from_number)

    async def _ai_analyze(
        self, transcription: str, from_number: Optional[str]
    ) -> Dict[str, Any]:
        """Use LLM agent to analyze transcript."""
        if not self._llm_agent:
            raise RuntimeError("LLM agent not initialized")

        from agents import Runner

        prompt = (
            f"Analyze this after-hours voicemail transcript and provide an emergency assessment.\n\n"
            f"TRANSCRIPT:\n{transcription}\n\n"
        )
        if from_number:
            prompt += f"CALLER NUMBER: {from_number}\n\n"

        prompt += (
            "Provide:\n"
            "1. emergency_score (0.0-1.0)\n"
            "2. reasoning for the score\n"
            "3. extracted context (location, equipment, issue, caller details)\n"
            "4. recommended_action (escalate/monitor/ignore)\n"
        )

        result = await Runner.run(self._llm_agent, prompt)
        output: VoicemailAnalysisOutput = result.final_output

        return {
            "emergency_score": output.emergency_score,
            "reasoning": output.reasoning,
            "context": output.context.model_dump(),
            "recommended_action": output.recommended_action,
        }

    def _keyword_analyze(
        self, transcription: str, from_number: Optional[str]
    ) -> Dict[str, Any]:
        """Fallback keyword-based analysis."""
        text_lower = transcription.lower()
        score = 0.5  # Default to moderate urgency
        matched_keywords = []

        # Check critical phrases
        for phrase, weight in self.critical_phrases.items():
            if phrase in text_lower:
                if weight > score:
                    score = weight
                matched_keywords.append(phrase)

        # Apply downgrade adjustments
        for phrase, adjustment in self.non_urgent_phrases.items():
            if phrase in text_lower:
                score = max(0.1, score + adjustment)
                matched_keywords.append(f"downgrade:{phrase}")

        # Determine action
        if score >= 0.6:
            action = "escalate"
        elif score >= 0.4:
            action = "monitor"
        else:
            action = "ignore"

        reasoning = (
            f"Keyword analysis: matched [{', '.join(matched_keywords) or 'none'}]"
            if matched_keywords
            else "No significant keywords detected - moderate priority assumed"
        )

        return {
            "emergency_score": round(score, 2),
            "reasoning": reasoning,
            "context": {
                "issue_description": transcription[:200],
                "callback_number": from_number,
            },
            "recommended_action": action,
        }


# Singleton instance
_voicemail_analyzer_agent: Optional[VoicemailAnalyzerAgent] = None


def get_voicemail_analyzer_agent() -> VoicemailAnalyzerAgent:
    """Get or create the singleton VoicemailAnalyzerAgent instance."""
    global _voicemail_analyzer_agent
    if _voicemail_analyzer_agent is None:
        _voicemail_analyzer_agent = VoicemailAnalyzerAgent()
    return _voicemail_analyzer_agent
