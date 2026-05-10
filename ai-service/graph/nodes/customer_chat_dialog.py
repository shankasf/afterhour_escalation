# Customer-facing chat. Once the dialog has gathered enough info it transitions
# to triage so the escalation flow can take over.
from __future__ import annotations

import json
import logging

from langchain_core.runnables import RunnableConfig
from pydantic import ValidationError

from graph.nodes.triage import _normalize_triage_payload
from graph.openai_client import get_openai_client, get_openai_model
from graph.state import IncidentState, TriageOutput, Turn
from graph.tools import customer_send

logger = logging.getLogger(__name__)

_DIALOG_INSTRUCTIONS = """You are the after-hours intake assistant for a property management company.
Be concise, calm, and gather: caller name, callback number, building/unit, issue, safety concerns.
Once you have all five (name, callback number, location, issue, safety), set "done": true and your reply MUST acknowledge the report ("Got it, our on-call team has been paged.") - do NOT ask another question.
After done is true, do not respond again - the escalation flow will take over.

Return strict JSON: {"reply": "...", "done": bool, "summary": "..."}.
"""

_TRIAGE_FROM_CHAT_INSTRUCTIONS = """You are an emergency triage specialist analyzing a completed customer chat transcript for a property management after-hours escalation system.

Return strict JSON with EXACT lowercase enum values:
- decision: "escalate" | "monitor" | "ignore"
- priority: "critical" | "high" | "medium" | "low"
- emergency_score: number between 0.0 and 1.0
- reasoning: short explanation
- issue_summary: one sentence
- location: optional string
- equipment: optional string
- is_safety_critical: boolean

SCORING:
- 0.90-1.00 -> "critical": fire, flood, gas leak, elevator entrapment, medical, security threat
- 0.70-0.89 -> "high": power outage, HVAC failure in extreme weather, major leak
- 0.50-0.69 -> "medium": partial system failure, equipment malfunction, access issue
- 0.30-0.49 -> "low": minor / cosmetic / routine
- 0.00-0.29 -> "low" + decision "ignore"

CHAT EVENTS: After-hours customer chat is HIGH priority by default unless clearly non-emergency.
"""


async def _triage_from_transcript(transcript: list[Turn], summary: str) -> TriageOutput | None:
    """Run a one-shot triage over the full chat transcript when the dialog completes."""
    client = get_openai_client()
    user_payload = json.dumps(
        {
            "summary": summary,
            "transcript": [
                {"role": t.role, "text": t.text} for t in transcript if t.role in ("user", "assistant")
            ],
        },
        default=str,
    )
    try:
        resp = await client.chat.completions.create(
            model=get_openai_model(),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _TRIAGE_FROM_CHAT_INSTRUCTIONS},
                {"role": "user", "content": user_payload},
            ],
        )
        parsed = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, Exception) as exc:
        logger.warning("Chat triage LLM call failed: %s", exc)
        return None

    normalized = _normalize_triage_payload(parsed if isinstance(parsed, dict) else {})
    try:
        return TriageOutput.model_validate(normalized)
    except ValidationError as exc:
        logger.warning("Chat triage validation failed: %s", exc)
        return None


async def customer_chat_dialog(state: IncidentState, config: RunnableConfig) -> dict:
    channel_event = state.get("channel_event") or {}
    user_text = channel_event.get("text") or ""
    modality = channel_event.get("modality", "text")
    session_token = channel_event.get("session_token") or (state.get("raw") or {}).get("session_token")
    log = list(state.get("conversation_log") or [])
    existing_triage = state.get("triage")

    if user_text:
        log.append(Turn(role="user", text=user_text, modality=modality))

    # Short-circuit: dialog already concluded; do not generate further bot replies.
    if existing_triage is not None:
        return {"conversation_log": log}

    client = get_openai_client()
    history = [{"role": t.role, "content": t.text} for t in log if t.role in ("user", "assistant")]
    resp = await client.chat.completions.create(
        model=get_openai_model(),
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": _DIALOG_INSTRUCTIONS}, *history],
    )
    try:
        parsed = json.loads(resp.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        parsed = {}

    reply = (parsed.get("reply") or "").strip()
    done = bool(parsed.get("done"))
    new_summary = parsed.get("summary") or state.get("customer_summary") or ""

    if reply:
        log.append(Turn(role="assistant", text=reply, modality=modality))
        if session_token and modality == "text":
            await customer_send(session_token=session_token, role="assistant", text=reply, modality="text")

    update: dict = {"conversation_log": log, "customer_summary": new_summary}

    if done:
        triage_out = await _triage_from_transcript(log, new_summary)
        if triage_out is not None:
            update["triage"] = triage_out
            update["status"] = "triaged"

    return update
