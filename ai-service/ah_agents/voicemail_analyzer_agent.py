"""Voicemail Analyzer Agent — façade that delegates to the voicemail
analysis LangGraph sub-graph.

Public API preserved:
    - ``VoicemailAnalyzerAgent.analyze(transcription, from_number) -> dict``
    - ``analyze_voicemail(...)`` module function
    - ``get_voicemail_analyzer_agent()`` factory
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, Field

# Sub-graph contract owned by Agent 1.
from graph.subgraphs import voicemail_graph
from graph.callbacks import default_callbacks

logger = logging.getLogger(__name__)


class VoicemailContext(BaseModel):
    """Context extracted from voicemail (kept for external consumers)."""

    location: Optional[str] = None
    equipment: Optional[str] = None
    issue_description: str = ""
    caller_name: Optional[str] = None
    callback_number: Optional[str] = None
    is_safety_critical: bool = False


class VoicemailOutput(BaseModel):
    """Structured output for voicemail analysis (kept for external consumers)."""

    emergency_score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    context: VoicemailContext = Field(default_factory=VoicemailContext)
    recommended_action: str = "escalate"


async def analyze_voicemail(transcription: str, from_number: Optional[str] = None) -> dict:
    """Analyze a voicemail transcript and return an emergency assessment.

    Delegates to ``voicemail_graph``. The keyword-fallback that used to live here
    is dropped — the sub-graph returns a reasonable default on LLM failure.
    """

    logger.info("=" * 60)
    logger.info("[VOICEMAIL ANALYZER] Starting analysis")
    logger.info(f"  From Number: {from_number}")
    logger.info(
        f"  Transcript Length: {len(transcription) if transcription else 0} chars"
    )

    if not transcription or not transcription.strip():
        logger.info("[VOICEMAIL ANALYZER] No transcript - defaulting to high priority")
        logger.info("=" * 60)
        return {
            "emergency_score": 0.8,
            "reasoning": "No transcript available - defaulting to high priority",
            "context": {
                "issue_description": "Voicemail received, no transcript",
                "callback_number": from_number,
            },
            "recommended_action": "escalate",
        }

    result = await voicemail_graph.ainvoke(
        {"transcription": transcription, "from_number": from_number},
        config={
            "callbacks": default_callbacks(),
            "tags": ["voicemail_analysis", "after-hours-agent"],
            "metadata": {"from_number": from_number},
            "run_name": "voicemail_analysis",
        },
    )

    logger.info("[VOICEMAIL ANALYZER] Analysis complete:")
    logger.info(f"  Emergency Score: {float(result.get('emergency_score', 0.0)):.2f}")
    reasoning = result.get("reasoning", "")
    logger.info(
        f"  Reasoning: {reasoning[:80]}..." if len(reasoning) > 80 else f"  Reasoning: {reasoning}"
    )
    logger.info(f"  Recommended Action: {result.get('recommended_action')}")
    logger.info("=" * 60)

    return {
        "emergency_score": result["emergency_score"],
        "reasoning": result["reasoning"],
        "context": result.get("context", {}),
        "recommended_action": result["recommended_action"],
    }


class VoicemailAnalyzerAgent:
    """Backward-compatible wrapper."""

    async def analyze(self, transcription: str, from_number: Optional[str] = None) -> dict:
        return await analyze_voicemail(transcription, from_number)


def get_voicemail_analyzer_agent() -> VoicemailAnalyzerAgent:
    """Get a VoicemailAnalyzerAgent instance."""
    return VoicemailAnalyzerAgent()
