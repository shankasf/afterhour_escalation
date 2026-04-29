# Voice script prompt copied from voice_agent.create_voice_script_agent().
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from openai import AsyncOpenAI
from langchain_core.runnables import RunnableConfig

from graph.state import Attempt, IncidentState
from graph.tools import dispatch_call, log_escalation_attempt, start_escalation

_VOICE_INSTRUCTIONS = """Generate voice scripts for after-hours emergency escalation calls.

REQUIREMENTS:
- 35-50 words max (~15-20 seconds spoken)
- Start with 'After-hours emergency' or 'Priority alert'
- Include key issue summary, no jargon
- End with 'Press 1 to acknowledge and take ownership.'
- Natural speech patterns for phone calls
- No emojis or special characters

Return strict JSON: {"script": "..."}.
"""


async def outreach(state: IncidentState, config: RunnableConfig) -> dict:
    ladder = state.get("ladder") or []
    cursor = state.get("cursor", 0)
    if cursor >= len(ladder):
        return {"status": "exhausted"}

    contact = ladder[cursor]
    triage = state.get("triage")
    issue = triage.issue_summary if triage else "after-hours service request"

    client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    resp = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _VOICE_INSTRUCTIONS},
            {"role": "user", "content": json.dumps({
                "issue": issue, "responder": contact.name, "level": contact.level,
                "time": datetime.utcnow().isoformat(),
            })},
        ],
    )
    script = (json.loads(resp.choices[0].message.content or "{}").get("script") or "").strip()

    await start_escalation(state["event_id"])
    log_resp = await log_escalation_attempt(
        event_id=state["event_id"], contact_name=contact.name,
        contact_phone=contact.phone, level=contact.level, method="voice_webrtc",
    )

    if contact.user_id:
        await dispatch_call(user_id=contact.user_id, event_id=state["event_id"],
                            script=script, channel="voice_webrtc")

    attempt = Attempt(
        level=contact.level, contact_name=contact.name,
        contact_user_id=contact.user_id, channel="voice_webrtc",
        outcome="in_progress", transcript_ref=log_resp.escalation_log_id,
    )
    return {
        "attempts": (state.get("attempts") or []) + [attempt],
        "awaiting": "ack",
        "awaiting_deadline": datetime.utcnow() + timedelta(seconds=120),
        "status": "awaiting_ack",
    }
