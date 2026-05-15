"""Voice script sub-graph.

Generates TTS-ready scripts for outbound escalation calls and
voicemail drops, replacing ``ah_agents/voice_agent.py``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from graph.llm import get_chat_model


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------


class VoiceScriptInput(TypedDict, total=False):
    event_id: str
    issue_description: str
    received_at: str
    responder_name: Optional[str]
    escalation_level: int
    source_type: str
    mode: Literal["call", "voicemail"]
    # When True, the node will use ``astream()`` and emit per-token log lines
    # (event ``voice_script:token``) so a downstream consumer subscribed via
    # the WebSocket log handler can render the script as it is produced.
    # The final ``script`` field in the output is the joined buffer.
    stream: bool


class VoiceScriptOutput(BaseModel):
    script: str
    urgency_level: Literal["critical", "high", "medium"] = "high"
    estimated_duration_seconds: int = 15
    generated_by: Literal["ai", "template"] = "ai"


# Internal Pydantic schema used by the LLM (no `generated_by` — we attach that ourselves).
class _LLMScript(BaseModel):
    script: str = Field(description="Voice script for TTS")
    urgency_level: Literal["critical", "high", "medium"] = Field(default="high")
    estimated_duration_seconds: int = Field(default=15, ge=1, le=120)


class _VoiceState(TypedDict, total=False):
    # inputs
    event_id: str
    issue_description: str
    received_at: str
    responder_name: Optional[str]
    escalation_level: int
    source_type: str
    mode: Literal["call", "voicemail"]
    stream: bool
    # outputs
    script: str
    urgency_level: str
    estimated_duration_seconds: int
    generated_by: str


# ---------------------------------------------------------------------------
# Prompts (copied verbatim from ah_agents/voice_agent.py)
# ---------------------------------------------------------------------------


_CALL_SYSTEM_PROMPT = """Generate voice scripts for after-hours emergency escalation calls.

REQUIREMENTS:
- 35-50 words max (~15-20 seconds spoken)
- Start with 'After-hours emergency' or 'Priority alert'
- Include key issue summary, no jargon
- End with 'Press 1 to acknowledge and take ownership.'
- Natural speech patterns for phone calls
- No emojis or special characters"""


_VOICEMAIL_SYSTEM_PROMPT = """Generate a brief voicemail (~25 words, 10 seconds):

REQUIREMENTS:
- Start with 'Urgent message from after-hours support'
- Include the issue summary and a callback instruction
- No DTMF (no 'press 1' etc.)
- Natural phone speech, no emojis or markdown"""


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


def _build_call_prompt(
    issue: str,
    time_str: str,
    name: Optional[str],
    level: int,
    source: str,
) -> str:
    parts = [
        "Generate a voice script for an outbound emergency call.",
        f"\n\nIssue: {issue}",
        f"\nTime: {time_str}",
    ]
    if level > 1:
        parts.append(f"\nEscalation level {level} - previous responders didn't acknowledge.")
    if name:
        parts.append(f"\nAddress responder as: {name}")
    if source == "chat":
        parts.append("\nOriginated from an inbound customer chat session.")
    parts.append("\n\nMUST end with: 'Press 1 to acknowledge and take ownership.'")
    return "".join(parts)


def _build_voicemail_prompt(issue: str, level: int) -> str:
    return (
        "Generate a brief voicemail (~25 words, 10 seconds):\n"
        f"Issue: {issue}\n"
        f"Level: {level}\n\n"
        "Start with 'Urgent message from after-hours support'\n"
        "Include callback instruction. No DTMF."
    )


def _template_script(
    issue: str,
    time_str: str,
    name: Optional[str],
    level: int,
) -> str:
    short = issue[:80] if issue else "service request"
    greeting = f"Hello {name}. " if name else ""
    level_note = f"This is escalation level {level}. " if level > 1 else ""
    return (
        f"{greeting}After-hours emergency received at {time_str}. "
        f"{level_note}{short}. Press 1 to acknowledge and take ownership."
    )


def _template_voicemail(issue: str) -> str:
    short = issue[:60] if issue else "urgent matter"
    return f"Urgent message from after-hours support. {short}. Please call back immediately."


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


async def _astream_plain_script(system: str, user: str) -> str:
    """Stream a plain-text script token-by-token and log incrementals.

    Uses a non-structured ``ChatOpenAI`` so we can ``astream()`` raw tokens
    (``with_structured_output`` swallows streaming). Each chunk is emitted
    as a ``voice_script:token`` info log so downstream subscribers (e.g.
    the WebSocketLogHandler) can render the script progressively.
    """
    from uuid import uuid4

    model = get_chat_model("voice", streaming=True)
    buf: list[str] = []
    stream_id = uuid4().hex
    async for chunk in model.astream(
        [SystemMessage(content=system), HumanMessage(content=user)]
    ):
        tok = getattr(chunk, "content", "") or ""
        if not tok:
            continue
        buf.append(tok)
        logger.info(
            "voice_script:token",
            extra={"token": tok, "run_id": stream_id},
        )
    return "".join(buf).strip()


async def voice_script_node(state: _VoiceState) -> dict:
    issue = state.get("issue_description", "") or ""
    received_at = state.get("received_at", "") or ""
    name = state.get("responder_name")
    level = int(state.get("escalation_level") or 1)
    source = state.get("source_type") or "email"
    mode = state.get("mode") or "call"
    stream_mode = bool(state.get("stream") or False)

    time_str = _parse_time(received_at)

    if mode == "voicemail":
        system = _VOICEMAIL_SYSTEM_PROMPT
        user = _build_voicemail_prompt(issue, level)
    else:
        system = _CALL_SYSTEM_PROMPT
        user = _build_call_prompt(issue, time_str, name, level, source)

    try:
        if stream_mode:
            # Streaming path: collect tokens via astream(), emit live logs,
            # then post-hoc fill the urgency/duration fields with sensible
            # defaults (structured output is incompatible with token-level
            # streaming).
            script = await _astream_plain_script(system, user)
            urgency_level: Literal["critical", "high", "medium"] = (
                "critical" if level >= 3 else "high"
            )
            estimated_duration_seconds = 10 if mode == "voicemail" else 15
        else:
            model = get_chat_model("voice").with_structured_output(_LLMScript)
            result: _LLMScript = await model.ainvoke(
                [SystemMessage(content=system), HumanMessage(content=user)]
            )
            script = (result.script or "").strip()
            urgency_level = result.urgency_level
            estimated_duration_seconds = result.estimated_duration_seconds

        # Ensure call-to-action for call mode (matches voice_agent.py:73-75).
        if mode == "call" and "press 1" not in script.lower():
            script = script.rstrip(". ") + ". Press 1 to acknowledge and take ownership."

        return {
            "script": script,
            "urgency_level": urgency_level,
            "estimated_duration_seconds": estimated_duration_seconds,
            "generated_by": "ai",
        }
    except Exception as e:
        logger.error(
            "voice_script_node LLM failed; using template",
            extra={"error_type": type(e).__name__, "error_message": str(e)},
        )
        if mode == "voicemail":
            return {
                "script": _template_voicemail(issue),
                "urgency_level": "high",
                "estimated_duration_seconds": 10,
                "generated_by": "template",
            }
        return {
            "script": _template_script(issue, time_str, name, level),
            "urgency_level": "high",
            "estimated_duration_seconds": 15,
            "generated_by": "template",
        }


# ---------------------------------------------------------------------------
# Compiled graph
# ---------------------------------------------------------------------------


_builder = StateGraph(_VoiceState)
_builder.add_node("voice_script", voice_script_node)
_builder.add_edge(START, "voice_script")
_builder.add_edge("voice_script", END)
voice_script_graph = _builder.compile(name="voice_script_graph")


__all__ = ["voice_script_graph", "VoiceScriptInput", "VoiceScriptOutput"]
