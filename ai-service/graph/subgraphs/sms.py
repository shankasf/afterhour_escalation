"""SMS sub-graph.

Generates ≤160-char escalation SMS messages, replacing
``ah_agents/sms_agent.py``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from graph.llm import get_chat_model


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------


class SmsInput(TypedDict, total=False):
    event_id: str
    issue_description: str
    received_at: str


class SmsOutput(BaseModel):
    message: str
    generated_by: Literal["ai", "template"] = "ai"


class _LLMSms(BaseModel):
    message: str = Field(description="Final SMS text, plain text")


class _SmsState(TypedDict, total=False):
    event_id: str
    issue_description: str
    received_at: str
    # outputs
    message: str
    generated_by: str


# ---------------------------------------------------------------------------
# Prompts (from ah_agents/sms_agent.py)
# ---------------------------------------------------------------------------


_SYSTEM_PROMPT = """Generate concise SMS alerts for after-hours emergencies.

REQUIREMENTS:
- Under 160 characters
- Start with 'After-Hours Emergency'
- Include time received and brief issue
- End with 'Reply ACK to accept.'
- No emojis
- Return a JSON object with a single field: message"""


_SUFFIX = " Reply ACK to accept."


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_time(received_at: str | None) -> str:
    try:
        if received_at:
            dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
            return dt.strftime("%I:%M %p")
    except Exception:
        pass
    return datetime.now().strftime("%I:%M %p")


def _normalize(message: str) -> str:
    """Strip any existing ACK suffix, truncate to fit 160 chars, re-append canonical suffix."""
    message = (message or "").strip()
    idx = message.lower().rfind("reply ack")
    if idx >= 0:
        message = message[:idx].rstrip(". -")

    if len(message) + len(_SUFFIX) > 160:
        room = 160 - len(_SUFFIX)
        message = message[: max(0, room)].rstrip(". -")
    return (message + _SUFFIX).strip()


def _template_message(issue: str, time_str: str) -> str:
    short = issue[:60] if issue else "service request"
    return f"After-Hours Emergency - {short} received at {time_str}." + _SUFFIX


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


async def sms_node(state: _SmsState) -> dict:
    issue = state.get("issue_description", "") or ""
    received_at = state.get("received_at", "") or ""
    time_str = _parse_time(received_at)

    user_prompt = (
        "Generate SMS for after-hours emergency:\n"
        f"Issue: {issue}\n"
        f"Time: {time_str}\n\n"
        "Start with 'After-Hours Emergency', end with 'Reply ACK to accept.'"
    )

    try:
        model = get_chat_model("sms").with_structured_output(_LLMSms)
        result: _LLMSms = await model.ainvoke(
            [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        )
        return {
            "message": _normalize(result.message or ""),
            "generated_by": "ai",
        }
    except Exception as e:
        logger.error(
            "sms_node LLM failed; using template",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        return {
            "message": _template_message(issue, time_str),
            "generated_by": "template",
        }


# ---------------------------------------------------------------------------
# Compiled graph
# ---------------------------------------------------------------------------


_builder = StateGraph(_SmsState)
_builder.add_node("sms", sms_node)
_builder.add_edge(START, "sms")
_builder.add_edge("sms", END)
sms_graph = _builder.compile(name="sms_graph")


__all__ = ["sms_graph", "SmsInput", "SmsOutput"]
