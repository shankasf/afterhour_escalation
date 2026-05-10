# Triage prompt copied from escalation_orchestrator._get_triage_instructions().
from __future__ import annotations

import json
from typing import Any

from langchain_core.runnables import RunnableConfig
from pydantic import ValidationError

from graph.openai_client import get_openai_client, get_openai_model
from graph.state import IncidentState, TriageOutput

_TRIAGE_INSTRUCTIONS = """You are an emergency triage specialist for a property management after-hours escalation system.

Return strict JSON with these fields and EXACT lowercase enum values:
- decision: one of "escalate" | "monitor" | "ignore"
- priority: one of "critical" | "high" | "medium" | "low"
- emergency_score: number between 0.0 and 1.0
- reasoning: short explanation
- issue_summary: one sentence
- location: optional string
- equipment: optional string
- is_safety_critical: boolean

SCORING (use the score to derive priority):
- 0.90-1.00 -> priority "critical": life safety (fire, flood, gas leak, elevator entrapment, medical, security threat)
- 0.70-0.89 -> priority "high": critical system failure (power outage, HVAC failure in extreme weather, major leak)
- 0.50-0.69 -> priority "medium": urgent operational (partial system failure, equipment malfunction, access issue)
- 0.30-0.49 -> priority "low": can wait until business hours (minor / cosmetic / routine maintenance)
- 0.00-0.29 -> priority "low" AND decision "ignore": non-emergency, no action needed

DECISION RULES:
- decision "escalate" when emergency_score >= 0.5
- decision "monitor" when emergency_score is between 0.30 and 0.49
- decision "ignore" when emergency_score < 0.30

HIGH-WEIGHT PHRASES: "no power", "flood", "leak", "fire alarm", "hvac failure", "elevator stuck", "can't operate", "emergency"
DOWNGRADE INDICATORS: "PM", "preventive maintenance", "scheduled", "routine", "cosmetic", "no rush", "when convenient"
CHAT EVENTS: After-hours inbound chat is HIGH priority by default.

Return ONLY the JSON object, no prose. All enum values MUST be lowercase.
"""


_VALID_DECISIONS = {"escalate", "monitor", "ignore"}
_VALID_PRIORITIES = {"critical", "high", "medium", "low"}


def _coerce_score(value: Any) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    if score != score:  # NaN
        return 0.0
    return max(0.0, min(1.0, score))


def _priority_from_score(score: float) -> str:
    if score >= 0.90:
        return "critical"
    if score >= 0.70:
        return "high"
    if score >= 0.50:
        return "medium"
    return "low"


def _decision_from_score(score: float) -> str:
    if score >= 0.50:
        return "escalate"
    if score >= 0.30:
        return "monitor"
    return "ignore"


def _normalize_triage_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce common LLM mistakes (uppercase, score-as-priority) into the schema."""
    score = _coerce_score(parsed.get("emergency_score"))

    decision = str(parsed.get("decision", "")).strip().lower()
    if decision not in _VALID_DECISIONS:
        decision = _decision_from_score(score)

    priority_raw = str(parsed.get("priority", "")).strip().lower()
    if priority_raw not in _VALID_PRIORITIES:
        priority_raw = _priority_from_score(score)

    return {
        "decision": decision,
        "priority": priority_raw,
        "emergency_score": score,
        "reasoning": str(parsed.get("reasoning", "") or "")[:2000],
        "issue_summary": str(parsed.get("issue_summary", "") or "")[:500],
        "location": parsed.get("location") or None,
        "equipment": parsed.get("equipment") or None,
        "is_safety_critical": bool(parsed.get("is_safety_critical", False)),
    }


async def triage(state: IncidentState, config: RunnableConfig) -> dict:
    client = get_openai_client()
    raw = state.get("raw") or {}
    user_payload = json.dumps({"source": state.get("source"), "raw": raw}, default=str)

    resp = await client.chat.completions.create(
        model=get_openai_model(),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _TRIAGE_INSTRUCTIONS},
            {"role": "user", "content": user_payload},
        ],
    )
    try:
        parsed = json.loads(resp.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        parsed = {}

    normalized = _normalize_triage_payload(parsed if isinstance(parsed, dict) else {})
    try:
        triage_out = TriageOutput.model_validate(normalized)
    except ValidationError:
        triage_out = TriageOutput(
            decision="monitor",
            priority="low",
            emergency_score=0.0,
            reasoning="Triage output failed schema validation; defaulted to monitor.",
            issue_summary="Triage parse fallback",
        )

    summary = (
        f"We received your report at the on-call desk. Issue: {triage_out.issue_summary}. "
        f"Priority: {triage_out.priority}. Someone is being paged now."
    )
    return {"triage": triage_out, "status": "triaged", "customer_summary": summary}
