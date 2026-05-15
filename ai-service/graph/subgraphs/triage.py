"""Email triage sub-graph.

Replicates the behavior of ``ah_agents/email_triage_agent.py`` but
expressed as a compiled LangGraph ``StateGraph`` with structured
output via ``ChatOpenAI.with_structured_output``.
"""

from __future__ import annotations

import logging
from typing import Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from graph.llm import get_chat_model


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Input / output contracts
# ---------------------------------------------------------------------------


class EmailTriageInput(TypedDict, total=False):
    subject: str
    body: str
    sender_domain: str
    keywords: Optional[list[dict]]


class EmailTriageOutput(BaseModel):
    """Output schema returned by the sub-graph (matches the documented keys)."""

    emergency_score: float = Field(ge=0.0, le=1.0)
    is_service_related: bool = False
    summary: str = ""
    reasoning: str = ""
    location: Optional[str] = None
    equipment: Optional[str] = None
    is_safety_critical: bool = False


# ---------------------------------------------------------------------------
# Internal state used by the StateGraph
# ---------------------------------------------------------------------------


class _TriageState(TypedDict, total=False):
    subject: str
    body: str
    sender_domain: str
    keywords: Optional[list[dict]]
    # outputs
    emergency_score: float
    is_service_related: bool
    summary: str
    reasoning: str
    location: Optional[str]
    equipment: Optional[str]
    is_safety_critical: bool


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


_SYSTEM_PROMPT = """You are an emergency triage system for after-hours property maintenance requests.

Your job is to analyze emails and determine:
1. Is this email related to property/building maintenance services?
2. If yes, how urgent is it?

IMPORTANT: Many emails will be spam, promotional, banking notifications, newsletters, etc.
These are NOT service-related and should get a score of 0.0-0.1.

ONLY emails about property maintenance, building issues, or facility emergencies are relevant.

SCORING GUIDELINES:
- 0.0-0.1: NOT service-related (spam, promotions, banking, newsletters, personal emails)
- 0.1-0.3: Service-related but routine/low priority (scheduled maintenance, minor cosmetic)
- 0.3-0.5: Service-related, can wait until business hours (degraded service, non-critical)
- 0.5-0.7: Urgent but not critical (broken equipment affecting operations, offline systems)
- 0.7-0.9: Critical operations impact (power outage, HVAC failure, can't operate)
- 0.9-1.0: Life safety emergency (fire, flood, gas leak, security breach, someone trapped)

EXAMPLES OF NON-SERVICE EMAILS (score 0.0-0.1):
- Bank transaction notifications, UPI/payment confirmations
- Marketing emails, newsletters, social media notifications
- Order confirmations, shipping updates, password resets

EXAMPLES OF SERVICE EMAILS:
- "Fire alarm going off at 123 Main St" -> 0.95
- "No power in building" -> 0.9
- "Water leak in basement" -> 0.85
- "AC not working, it's 95 degrees" -> 0.75
- "Elevator making strange noise" -> 0.5
- "Light bulb out in lobby" -> 0.2

Always provide a one-line summary of the email content."""


def _format_keywords(keywords: list[dict] | None) -> str:
    """Render keyword overrides into a prompt fragment (same shape as the legacy agent)."""
    if not keywords:
        return ""
    lines = ["EMERGENCY KEYWORDS (use for scoring):"]
    for kw in sorted(keywords, key=lambda x: x.get("weight", 0), reverse=True)[:20]:
        keyword = kw.get("keyword", "")
        weight = kw.get("weight", 1.0)
        score = min(1.0, weight / 2.0)
        lines.append(f"  - '{keyword}' -> ~{score:.1f}")
    return "\n".join(lines) + "\n\n"


def _build_user_prompt(
    subject: str,
    body: str,
    sender_domain: str,
    keywords: list[dict] | None,
) -> str:
    truncated_body = body[:3000] if body and len(body) > 3000 else (body or "")
    prompt = (
        "Analyze this email and determine if it's a property/maintenance service request:\n\n"
        f"FROM: {sender_domain}\n"
        f"SUBJECT: {subject}\n\n"
        f"BODY:\n{truncated_body}\n\n"
    )
    prompt += _format_keywords(keywords)
    prompt += "Provide: is_service_related, emergency_score (0-1), summary, reasoning, location, equipment, is_safety_critical."
    return prompt


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


async def triage_node(state: _TriageState) -> dict:
    subject = state.get("subject", "") or ""
    body = state.get("body", "") or ""
    sender_domain = state.get("sender_domain", "") or ""
    keywords = state.get("keywords")

    user_prompt = _build_user_prompt(subject, body, sender_domain, keywords)

    try:
        model = get_chat_model("triage").with_structured_output(EmailTriageOutput)
        result: EmailTriageOutput = await model.ainvoke(
            [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        )
        return result.model_dump()
    except Exception as e:
        logger.error(
            "triage_node LLM failed; using fallback",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        return {
            "emergency_score": 0.1,
            "is_service_related": False,
            "summary": subject[:100],
            "reasoning": f"AI unavailable: {e}",
            "location": None,
            "equipment": None,
            "is_safety_critical": False,
        }


# ---------------------------------------------------------------------------
# Compiled graph
# ---------------------------------------------------------------------------


_builder = StateGraph(_TriageState)
_builder.add_node("triage", triage_node)
_builder.add_edge(START, "triage")
_builder.add_edge("triage", END)
triage_graph = _builder.compile(name="triage_graph")


__all__ = ["triage_graph", "EmailTriageInput", "EmailTriageOutput"]
