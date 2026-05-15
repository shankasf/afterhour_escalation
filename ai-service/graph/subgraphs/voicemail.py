"""Voicemail analysis sub-graph.

Replaces ``ah_agents/voicemail_analyzer_agent.py``. Returns an emergency
score, reasoning, extracted context, and a recommended action for a
caller-left voicemail transcript.
"""

from __future__ import annotations

import logging
from typing import Literal, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from graph.llm import get_chat_model


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------


class VoicemailInput(TypedDict, total=False):
    transcription: str
    from_number: Optional[str]


class _VoicemailContext(BaseModel):
    location: Optional[str] = None
    equipment: Optional[str] = None
    issue_description: str = ""
    caller_name: Optional[str] = None
    callback_number: Optional[str] = None
    is_safety_critical: bool = False


class VoicemailOutput(BaseModel):
    emergency_score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    context: _VoicemailContext = Field(default_factory=_VoicemailContext)
    recommended_action: Literal["escalate", "monitor", "ignore"] = "escalate"


class _VoicemailState(TypedDict, total=False):
    transcription: str
    from_number: Optional[str]
    # outputs
    emergency_score: float
    reasoning: str
    context: dict
    recommended_action: str


# ---------------------------------------------------------------------------
# Prompt (from ah_agents/voicemail_analyzer_agent.py)
# ---------------------------------------------------------------------------


_SYSTEM_PROMPT = """Analyze after-hours voicemail transcripts for emergency triage.

SCORING:
- 0.9-1.0: Life safety (fire, flood, entrapment)
- 0.7-0.9: Critical systems (power outage, HVAC failure)
- 0.5-0.7: Urgent but not critical (equipment issues)
- 0.3-0.5: Can wait until morning
- 0.0-0.3: Non-emergency

Extract location, equipment, caller details, and callback info."""


# ---------------------------------------------------------------------------
# Keyword fallback (mirrors voicemail_analyzer_agent.py)
# ---------------------------------------------------------------------------


_CRITICAL_PHRASES = {
    "fire": 0.95, "flood": 0.95, "water leak": 0.9, "leak": 0.85,
    "no power": 0.9, "power out": 0.9, "elevator stuck": 0.9,
    "fire alarm": 0.95, "hvac down": 0.85, "no heat": 0.85,
    "emergency": 0.8, "urgent": 0.7, "help": 0.7,
}

_NON_URGENT_PHRASES = {
    "when you get a chance": -0.2, "no rush": -0.3, "not urgent": -0.3,
    "routine": -0.2, "scheduled": -0.2, "tomorrow": -0.15,
}


def _keyword_analyze(transcription: str, from_number: Optional[str]) -> dict:
    text = (transcription or "").lower()
    score = 0.5
    matched: list[str] = []

    for phrase, weight in _CRITICAL_PHRASES.items():
        if phrase in text:
            if weight > score:
                score = weight
            matched.append(phrase)

    for phrase, adj in _NON_URGENT_PHRASES.items():
        if phrase in text:
            score = max(0.1, score + adj)
            matched.append(f"downgrade:{phrase}")

    action = "escalate" if score >= 0.6 else ("monitor" if score >= 0.4 else "ignore")
    reasoning = (
        f"Keyword matches: [{', '.join(matched)}]"
        if matched
        else "No keywords - moderate priority"
    )

    return {
        "emergency_score": round(score, 2),
        "reasoning": reasoning,
        "context": {
            "location": None,
            "equipment": None,
            "issue_description": transcription[:200] if transcription else "",
            "caller_name": None,
            "callback_number": from_number,
            "is_safety_critical": score >= 0.9,
        },
        "recommended_action": action,
    }


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


async def voicemail_node(state: _VoicemailState) -> dict:
    transcription = (state.get("transcription") or "").strip()
    from_number = state.get("from_number")

    # Empty-transcription short-circuit (no LLM call).
    if not transcription:
        return {
            "emergency_score": 0.8,
            "reasoning": "No transcript available - defaulting to high priority",
            "context": {
                "location": None,
                "equipment": None,
                "issue_description": "Voicemail received, no transcript",
                "caller_name": None,
                "callback_number": from_number,
                "is_safety_critical": False,
            },
            "recommended_action": "escalate",
        }

    user_prompt = f"Analyze this voicemail transcript:\n\n{transcription}"
    if from_number:
        user_prompt += f"\n\nCaller: {from_number}"

    try:
        model = get_chat_model("voicemail").with_structured_output(VoicemailOutput)
        result: VoicemailOutput = await model.ainvoke(
            [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        )
        return {
            "emergency_score": result.emergency_score,
            "reasoning": result.reasoning,
            "context": result.context.model_dump(),
            "recommended_action": result.recommended_action,
        }
    except Exception as e:
        logger.error(
            "voicemail_node LLM failed; using keyword fallback",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        return _keyword_analyze(transcription, from_number)


# ---------------------------------------------------------------------------
# Compiled graph
# ---------------------------------------------------------------------------


_builder = StateGraph(_VoicemailState)
_builder.add_node("voicemail", voicemail_node)
_builder.add_edge(START, "voicemail")
_builder.add_edge("voicemail", END)
voicemail_graph = _builder.compile(name="voicemail_graph")


__all__ = ["voicemail_graph", "VoicemailInput", "VoicemailOutput"]
