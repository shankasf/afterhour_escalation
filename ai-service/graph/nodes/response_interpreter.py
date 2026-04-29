# Acknowledgment interpretation prompt synthesized from ack_monitor_agent + acknowledgment.py patterns.
from __future__ import annotations

import json
import os
from openai import AsyncOpenAI
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState
from graph.tools import record_internal_ack

_INTERPRET_INSTRUCTIONS = """Classify the responder's reply during an after-hours escalation call.

Return JSON: {"intent": "ack" | "decline" | "callback" | "no_answer" | "unknown",
              "confidence": 0..1, "notes": "..."}.

ack: clearly accepting ownership ("ack", "I'll handle it", "on it", "taking it", "yes").
decline: refusing or unable ("can't", "not me", "skip me").
callback: asking us to call them back later or wanting more info first.
no_answer: silence / timeout / voicemail.
unknown: anything else."""


async def response_interpreter(state: IncidentState, config: RunnableConfig) -> dict:
    channel_event = state.get("channel_event") or {}
    text = channel_event.get("text") or channel_event.get("transcript") or ""
    kind = channel_event.get("type") or ""

    if kind == "timeout" or not text:
        intent = "no_answer"
        notes = "timeout or empty transcript"
    else:
        client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        resp = await client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _INTERPRET_INSTRUCTIONS},
                {"role": "user", "content": text},
            ],
        )
        parsed = json.loads(resp.choices[0].message.content or "{}")
        intent = parsed.get("intent", "unknown")
        notes = parsed.get("notes", "")

    attempts = list(state.get("attempts") or [])
    if attempts:
        last = attempts[-1].model_copy(update={"outcome": _outcome_for(intent), "notes": notes})
        attempts[-1] = last

    if intent == "ack":
        await record_internal_ack(
            event_id=state["event_id"],
            user_id=attempts[-1].contact_user_id if attempts else None,
            phone_number=None, method="voice_webrtc",
        )
        return {"attempts": attempts, "awaiting": None, "status": "acknowledged"}
    if intent == "callback":
        return {"attempts": attempts, "awaiting": "callback", "status": "awaiting_callback"}
    return {
        "attempts": attempts,
        "cursor": state.get("cursor", 0) + 1,
        "awaiting": None,
        "status": "outreach",
    }


def _outcome_for(intent: str) -> str:
    return {
        "ack": "acked", "decline": "declined", "callback": "callback_requested",
        "no_answer": "no_answer",
    }.get(intent, "no_answer")
