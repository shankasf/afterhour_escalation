# Customer-facing chat. Triage prompt persona reused from escalation_orchestrator triage spec.
from __future__ import annotations

import json
import os
from openai import AsyncOpenAI
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState, Turn
from graph.tools import customer_send

_DIALOG_INSTRUCTIONS = """You are the after-hours intake assistant for a property management company.
Be concise, calm, and gather: caller name, callback number, building/unit, issue, safety concerns.
After enough info, say a human responder is being paged and stop asking questions.
Return JSON: {"reply": "...", "done": bool, "summary": "..."}.
"""


async def customer_chat_dialog(state: IncidentState, config: RunnableConfig) -> dict:
    channel_event = state.get("channel_event") or {}
    user_text = channel_event.get("text") or ""
    session_token = channel_event.get("session_token") or (state.get("raw") or {}).get("session_token")
    log = list(state.get("conversation_log") or [])
    if user_text:
        log.append(Turn(role="user", text=user_text, modality=channel_event.get("modality", "text")))

    client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    history = [{"role": t.role, "content": t.text} for t in log if t.role in ("user", "assistant")]
    resp = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": _DIALOG_INSTRUCTIONS}, *history],
    )
    parsed = json.loads(resp.choices[0].message.content or "{}")
    reply = parsed.get("reply", "")
    log.append(Turn(role="assistant", text=reply, modality=channel_event.get("modality", "text")))

    if session_token and reply and channel_event.get("modality", "text") == "text":
        await customer_send(session_token=session_token, role="assistant", text=reply, modality="text")

    new_summary = parsed.get("summary") or state.get("customer_summary") or ""
    return {"conversation_log": log, "customer_summary": new_summary}
