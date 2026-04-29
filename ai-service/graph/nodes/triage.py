# Triage prompt copied from escalation_orchestrator._get_triage_instructions().
from __future__ import annotations

import json
import os
from openai import AsyncOpenAI
from langchain_core.runnables import RunnableConfig

from graph.state import IncidentState, TriageOutput

_TRIAGE_INSTRUCTIONS = """You are an emergency triage specialist for a property management after-hours escalation system.

SCORING GUIDELINES:
- 0.9-1.0 (CRITICAL): Life safety emergencies (fire, flood, gas leak, elevator entrapment, medical, security threat)
- 0.7-0.89 (HIGH): Critical system failures (complete power outage, HVAC failure in extreme weather, major leak, building-wide system down)
- 0.5-0.69 (MEDIUM): Urgent operational issues (partial system failures, equipment malfunction, access/entry problems)
- 0.3-0.49 (LOW): Can wait until business hours (minor issues, cosmetic, routine maintenance)
- 0.0-0.29 (IGNORE): Non-emergency, no action needed

HIGH-WEIGHT PHRASES: "no power", "flood", "leak", "fire alarm", "hvac failure", "elevator stuck", "can't operate", "emergency"
DOWNGRADE INDICATORS: "PM", "preventive maintenance", "scheduled", "routine", "cosmetic", "no rush", "when convenient"
CHAT EVENTS: After-hours inbound chat is HIGH priority by default.

Always provide clear reasoning. Return strict JSON with: decision, priority, emergency_score, reasoning, issue_summary, location, equipment, is_safety_critical.
"""


async def triage(state: IncidentState, config: RunnableConfig) -> dict:
    client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    raw = state.get("raw") or {}
    user_payload = json.dumps({"source": state.get("source"), "raw": raw}, default=str)

    resp = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _TRIAGE_INSTRUCTIONS},
            {"role": "user", "content": user_payload},
        ],
    )
    parsed = json.loads(resp.choices[0].message.content or "{}")
    triage_out = TriageOutput.model_validate(parsed)
    summary = (
        f"We received your report at the on-call desk. Issue: {triage_out.issue_summary}. "
        f"Priority: {triage_out.priority}. Someone is being paged now."
    )
    return {"triage": triage_out, "status": "triaged", "customer_summary": summary}
