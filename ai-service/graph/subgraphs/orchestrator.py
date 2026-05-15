"""Escalation orchestrator sub-graph.

Replaces ``ah_agents/escalation_orchestrator.py`` with a LangGraph
``StateGraph`` that:

    triage_node -> (generate_content | skip) -> assemble_node

``generate_content`` invokes the voice_script and sms sub-graphs in
parallel via ``asyncio.gather``. ``assemble_node`` applies the
after-hours window gate (``services.after_hours.should_escalate_now``)
identically to the legacy orchestrator.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Literal, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from graph.llm import get_chat_model
from graph.subgraphs.sms import sms_graph
from graph.subgraphs.voice_script import voice_script_graph
from services.after_hours import get_after_hours_status, should_escalate_now


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------


class OrchestratorInput(TypedDict, total=False):
    event_type: str
    content: str
    source: Literal["email", "chat", "manual"]
    metadata: dict


class OrchestratorOutput(BaseModel):
    should_escalate: bool
    triage: dict
    escalation_content: Optional[dict] = None
    audit_notes: str = ""
    after_hours: dict = Field(default_factory=dict)
    after_hours_blocked: bool = False


# Structured-output schema for the orchestrator triage LLM call.
class _TriageOutputSchema(BaseModel):
    decision: Literal["escalate", "monitor", "ignore"]
    priority: Literal["critical", "high", "medium", "low"]
    emergency_score: float = Field(ge=0.0, le=1.0)
    reasoning: str
    issue_summary: str
    location: Optional[str] = None
    equipment: Optional[str] = None
    is_safety_critical: bool = False


# Internal state passed between nodes.
class _OrchestratorState(TypedDict, total=False):
    # inputs
    event_type: str
    content: str
    source: str
    metadata: dict
    # derived
    triage: dict
    should_escalate: bool
    escalation_content: Optional[dict]
    audit_notes: str
    after_hours: dict
    after_hours_blocked: bool
    # tracking
    used_fallback: bool


# ---------------------------------------------------------------------------
# Prompts (from ah_agents/escalation_orchestrator.py)
# ---------------------------------------------------------------------------


_TRIAGE_SYSTEM_PROMPT = """You are an emergency triage specialist for a property management after-hours escalation system.

SCORING GUIDELINES:
- 0.9-1.0 (CRITICAL): Life safety emergencies
  * Fire, active flooding, gas leak, elevator entrapment
  * Medical emergency, security threat

- 0.7-0.89 (HIGH): Critical system failures
  * Complete power outage, HVAC failure in extreme weather
  * Major water leak, building-wide system down
  * Security system failure

- 0.5-0.69 (MEDIUM): Urgent operational issues
  * Partial system failures, equipment malfunction
  * Localized issues affecting operations
  * Access/entry problems after hours

- 0.3-0.49 (LOW): Can wait until business hours
  * Minor issues, cosmetic problems
  * Routine maintenance requests
  * General inquiries

- 0.0-0.29 (IGNORE): Non-emergency, no action needed
  * Marketing emails, spam
  * Already resolved issues
  * Scheduled maintenance confirmations

HIGH-WEIGHT PHRASES (increase score):
"no power", "flood", "leak", "fire alarm", "hvac failure", "elevator stuck", "can't operate", "emergency"

DOWNGRADE INDICATORS (decrease score):
"PM", "preventive maintenance", "scheduled", "routine", "cosmetic", "no rush", "when convenient"

CHAT EVENTS: Inbound chat sessions after hours are HIGH priority by default (someone reached out after hours).

Always provide clear reasoning for your decision."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_triage_user_prompt(
    event_type: str,
    content: str,
    source: str,
    metadata: dict,
) -> str:
    prompt = (
        "Analyze this incoming event and provide triage assessment.\n\n"
        f"EVENT TYPE: {event_type}\n"
        f"SOURCE: {source}\n"
        f"RECEIVED AT: {metadata.get('received_at', 'now')}\n\n"
    )
    if source == "email":
        prompt += f"SUBJECT: {metadata.get('subject', 'N/A')}\n"
        prompt += f"FROM: {metadata.get('sender', 'Unknown')}\n"
        prompt += f"\nEMAIL BODY:\n{content}\n"
    elif source == "chat":
        prompt += (
            f"CUSTOMER: {metadata.get('customer_name') or metadata.get('from_number', 'Unknown')}\n"
            f"\nCHAT TRANSCRIPT:\n{content or 'No transcript available'}\n"
            "\nNOTE: Chat events (inbound customer sessions) are HIGH priority by default.\n"
        )
    else:
        prompt += f"\nCONTENT:\n{content}\n"

    prompt += "\nProvide your triage assessment with score, reasoning, and extracted context."
    return prompt


def _parse_time(received_at: str | None) -> str:
    try:
        if received_at and received_at != "now":
            dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
            return dt.strftime("%I:%M %p")
    except Exception:
        pass
    return datetime.now().strftime("%I:%M %p")


def _keyword_score(content: str) -> tuple[float, str]:
    """Rule-based fallback identical to escalation_orchestrator._keyword_score."""
    text_lower = (content or "").lower()
    score = 0.5
    matches: list[str] = []

    critical = {
        "fire": 0.95, "flood": 0.95, "no power": 0.9, "power outage": 0.9,
        "leak": 0.85, "elevator stuck": 0.9, "fire alarm": 0.95,
        "hvac failure": 0.85, "emergency": 0.75,
    }
    downgrades = {
        "pm": -0.2, "scheduled": -0.15, "routine": -0.15, "no rush": -0.2,
    }

    for kw, weight in critical.items():
        if kw in text_lower:
            if weight > score:
                score = weight
            matches.append(kw)

    for kw, adj in downgrades.items():
        if kw in text_lower:
            score = max(0.1, score + adj)
            matches.append(f"downgrade:{kw}")

    reasoning = f"Keyword matches: {matches}" if matches else "No keywords matched"
    return round(score, 2), reasoning


def _generate_fallback_content(issue_summary: str, received_at: Optional[str]) -> dict:
    """Generate fallback escalation content (mirrors orchestrator's _generate_fallback_content)."""
    time_str = _parse_time(received_at)
    short_issue = issue_summary[:60] if issue_summary else "service request"

    return {
        "voice_script": (
            f"After-hours emergency received at {time_str}. "
            f"{short_issue}. "
            "Press 1 to acknowledge and take ownership."
        ),
        "sms_message": (
            f"After-Hours Emergency - {short_issue} at {time_str}. Reply ACK to accept."
        ),
        "email_subject": f"After-Hours Emergency: {short_issue}",
    }


def _fallback_triage(content: str, source: str) -> dict:
    """Rule-based triage when the LLM is unavailable."""
    if source == "chat":
        score = 0.8
        decision = "escalate"
        priority = "high"
        reasoning = "Chat event - automatic high priority"
    else:
        score, reasoning = _keyword_score(content)
        if score >= 0.6:
            decision = "escalate"
            priority = "high" if score >= 0.8 else "medium"
        elif score >= 0.4:
            decision = "monitor"
            priority = "medium"
        else:
            decision = "ignore"
            priority = "low"

    issue_summary = (content[:100] + "...") if content and len(content) > 100 else (content or "")

    return {
        "decision": decision,
        "priority": priority,
        "emergency_score": score,
        "reasoning": reasoning,
        "issue_summary": issue_summary,
        "location": None,
        "equipment": None,
        "is_safety_critical": score >= 0.9,
    }


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


async def triage_node(state: _OrchestratorState) -> dict:
    event_type = state.get("event_type", "") or ""
    content = state.get("content", "") or ""
    source = state.get("source", "email") or "email"
    metadata = state.get("metadata") or {}

    user_prompt = _build_triage_user_prompt(event_type, content, source, metadata)

    try:
        model = get_chat_model("orchestrator", temperature=0.2).with_structured_output(
            _TriageOutputSchema
        )
        result: _TriageOutputSchema = await model.ainvoke(
            [SystemMessage(content=_TRIAGE_SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        )
        return {
            "triage": result.model_dump(),
            "used_fallback": False,
        }
    except Exception as e:
        logger.error(
            "orchestrator triage_node LLM failed; using keyword fallback",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        return {
            "triage": _fallback_triage(content, source),
            "used_fallback": True,
        }


def _should_generate(state: _OrchestratorState) -> str:
    """Conditional edge router."""
    source = state.get("source") or ""
    triage = state.get("triage") or {}
    decision = triage.get("decision")
    score = float(triage.get("emergency_score") or 0.0)

    if source == "chat" or decision == "escalate" or score >= 0.6:
        return "generate_content"
    return "assemble"


async def generate_content_node(state: _OrchestratorState) -> dict:
    triage = state.get("triage") or {}
    metadata = state.get("metadata") or {}
    issue_summary = triage.get("issue_summary") or ""
    received_at = metadata.get("received_at") or ""
    event_id = metadata.get("event_id") or "orchestrator"
    source_type = state.get("source") or "email"
    used_fallback = bool(state.get("used_fallback"))

    if used_fallback:
        # Skip the LLM sub-graphs entirely when the parent triage failed —
        # use the same template content the legacy orchestrator emitted.
        return {
            "escalation_content": _generate_fallback_content(issue_summary, received_at),
        }

    voice_input = {
        "event_id": event_id,
        "issue_description": issue_summary,
        "received_at": received_at,
        "responder_name": None,
        "escalation_level": 1,
        "source_type": source_type,
        "mode": "call",
    }
    sms_input = {
        "event_id": event_id,
        "issue_description": issue_summary,
        "received_at": received_at,
    }

    try:
        voice_result, sms_result = await asyncio.gather(
            voice_script_graph.ainvoke(voice_input),
            sms_graph.ainvoke(sms_input),
        )
        return {
            "escalation_content": {
                "voice_script": voice_result.get("script", ""),
                "sms_message": sms_result.get("message", ""),
                "email_subject": f"After-Hours Emergency: {issue_summary[:60]}"
                if issue_summary
                else "After-Hours Emergency",
            }
        }
    except Exception as e:
        logger.error(
            "generate_content_node sub-graph failed; using templates",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        return {
            "escalation_content": _generate_fallback_content(issue_summary, received_at),
        }


async def assemble_node(state: _OrchestratorState) -> dict:
    triage = state.get("triage") or {}
    source = state.get("source") or ""
    metadata = state.get("metadata") or {}
    used_fallback = bool(state.get("used_fallback"))
    escalation_content = state.get("escalation_content")

    decision = triage.get("decision")
    score = float(triage.get("emergency_score") or 0.0)

    should_escalate = (
        source == "chat"
        or decision == "escalate"
        or score >= 0.6
    )

    force_escalate = bool(metadata.get("force_escalate", False))
    can_escalate, window_reason = should_escalate_now(force_escalate)
    after_hours_status = get_after_hours_status()

    audit_notes = (
        "Processed via fallback rules (AI unavailable)"
        if used_fallback
        else f"Processed via AI orchestrator. Source: {source}"
    )

    after_hours_blocked = False
    if should_escalate and not can_escalate:
        should_escalate = False
        after_hours_blocked = True
        audit_notes = f"{audit_notes} | Escalation blocked: {window_reason}. Event logged for business hours review."

    out: dict[str, Any] = {
        "should_escalate": should_escalate,
        "triage": triage,
        "escalation_content": escalation_content if should_escalate else None,
        "audit_notes": audit_notes,
        "after_hours": after_hours_status,
        "after_hours_blocked": after_hours_blocked,
    }
    return out


# ---------------------------------------------------------------------------
# Compiled graph
# ---------------------------------------------------------------------------


_builder = StateGraph(_OrchestratorState)
_builder.add_node("triage", triage_node)
_builder.add_node("generate_content", generate_content_node)
_builder.add_node("assemble", assemble_node)
_builder.add_edge(START, "triage")
_builder.add_conditional_edges(
    "triage",
    _should_generate,
    {"generate_content": "generate_content", "assemble": "assemble"},
)
_builder.add_edge("generate_content", "assemble")
_builder.add_edge("assemble", END)
orchestrator_graph = _builder.compile(name="orchestrator_graph")


__all__ = ["orchestrator_graph", "OrchestratorInput", "OrchestratorOutput"]
