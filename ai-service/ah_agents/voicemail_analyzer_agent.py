"""Voicemail Analyzer Agent - Analyzes voicemail transcripts."""

import logging
from typing import Optional

from pydantic import BaseModel, Field
from agents import Agent, Runner

logger = logging.getLogger(__name__)


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


def create_voicemail_analyzer_agent() -> Agent:
    """Create the LLM agent that analyzes voicemail transcripts."""

    return Agent(
        name="VoicemailAnalyzerAgent",
        model="gpt-5.2",
        output_type=VoicemailOutput,
        instructions="""Analyze after-hours voicemail transcripts for emergency triage.

SCORING:
- 0.9-1.0: Life safety (fire, flood, entrapment)
- 0.7-0.9: Critical systems (power outage, HVAC failure)
- 0.5-0.7: Urgent but not critical (equipment issues)
- 0.3-0.5: Can wait until morning
- 0.0-0.3: Non-emergency

Extract location, equipment, caller details, and callback info.""",
    )


# Singleton instance (module-level)
voicemail_analyzer_agent = create_voicemail_analyzer_agent()


# Backward-compatible alias
get_voicemail_analyzer_llm_agent = create_voicemail_analyzer_agent


# Keyword scoring fallback
CRITICAL_PHRASES = {
    "fire": 0.95, "flood": 0.95, "water leak": 0.9, "leak": 0.85,
    "no power": 0.9, "power out": 0.9, "elevator stuck": 0.9,
    "fire alarm": 0.95, "hvac down": 0.85, "no heat": 0.85,
    "emergency": 0.8, "urgent": 0.7, "help": 0.7,
}

NON_URGENT_PHRASES = {
    "when you get a chance": -0.2, "no rush": -0.3, "not urgent": -0.3,
    "routine": -0.2, "scheduled": -0.2, "tomorrow": -0.15,
}


async def analyze_voicemail(transcription: str, from_number: Optional[str] = None) -> dict:
    """Analyze a voicemail transcript and return emergency assessment."""
    logger.info("=" * 60)
    logger.info("[VOICEMAIL ANALYZER] Starting analysis")
    logger.info(f"  From Number: {from_number}")
    logger.info(f"  Transcript Length: {len(transcription) if transcription else 0} chars")

    if not transcription or not transcription.strip():
        logger.info("[VOICEMAIL ANALYZER] No transcript - defaulting to high priority")
        logger.info("=" * 60)
        return {
            "emergency_score": 0.8,
            "reasoning": "No transcript available - defaulting to high priority",
            "context": {"issue_description": "Voicemail received, no transcript", "callback_number": from_number},
            "recommended_action": "escalate",
        }

    try:
        prompt = f"Analyze this voicemail transcript:\n\n{transcription}"
        if from_number:
            prompt += f"\n\nCaller: {from_number}"

        logger.info("[VOICEMAIL ANALYZER] Sending to AI for analysis...")
        result = await Runner.run(voicemail_analyzer_agent, prompt)
        output: VoicemailOutput = result.final_output

        logger.info("[VOICEMAIL ANALYZER] AI Analysis complete:")
        logger.info(f"  Emergency Score: {output.emergency_score:.2f}")
        logger.info(f"  Reasoning: {output.reasoning[:80]}..." if len(output.reasoning) > 80 else f"  Reasoning: {output.reasoning}")
        logger.info(f"  Recommended Action: {output.recommended_action}")
        logger.info("=" * 60)

        return {
            "emergency_score": output.emergency_score,
            "reasoning": output.reasoning,
            "context": output.context.model_dump(),
            "recommended_action": output.recommended_action,
        }
    except Exception as e:
        logger.error(f"[VOICEMAIL ANALYZER] AI analysis failed: {e}")
        return _keyword_analyze(transcription, from_number)


def _keyword_analyze(transcription: str, from_number: Optional[str]) -> dict:
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


# Wrapper class for backward compatibility
class VoicemailAnalyzerAgent:
    """Wrapper for backward compatibility."""

    async def analyze(self, transcription: str, from_number: Optional[str] = None) -> dict:
        return await analyze_voicemail(transcription, from_number)


def get_voicemail_analyzer_agent() -> VoicemailAnalyzerAgent:
    """Get VoicemailAnalyzerAgent instance."""
    return VoicemailAnalyzerAgent()
