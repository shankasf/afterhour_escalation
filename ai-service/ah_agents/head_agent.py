"""Head agent for after-hours escalation workflows.

This module provides a single top-level Agent ("HeadAgent") that can hand off to
specialist agents for:
- email triage
- voicemail analysis
- message generation (voice/SMS)
- escalation operations (backend)
- acknowledgment processing (backend)

It does not replace the existing `EscalationOrchestrator` yet; it’s a reusable
handoff graph that routes can adopt incrementally.

Naming conventions used across `ah_agents/*`:
- `*_agent`: an Agents-SDK `Agent` instance focused on an LLM task
    (triage, message drafting, analysis).
- `*_ops_agent`: an Agents-SDK `Agent` instance that primarily uses tools to
    perform backend operations.
- `create_*_agent()`: factory that constructs an Agent (preferred).
- `get_*_agent()`: backward-compatible alias.
- `run_*()`: helper that runs an Agent via `Runner`.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Optional, Any, Dict

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class HeadRoute(str, Enum):
    EMAIL_TRIAGE = "email_triage"
    VOICEMAIL_ANALYSIS = "voicemail_analysis"
    MESSAGE_GENERATION = "message_generation"
    ESCALATION_OPS = "escalation_ops"
    ACKNOWLEDGMENT_OPS = "acknowledgment_ops"


class HeadDecision(BaseModel):
    """Structured output from the head agent.

    The SDK can also do implicit handoffs, but this structured output is useful
    when the caller wants explicit routing.
    """

    route: HeadRoute = Field(description="Which specialist should handle this")
    reason: str = Field(description="Short explanation")
    next_input: str = Field(description="The input to pass to the specialist agent")
    metadata: Dict[str, Any] = Field(default_factory=dict)


def create_head_agent():
    """Create the top-level head agent.

    Returns None if the Agents SDK is unavailable.
    """

    try:
        from agents import Agent
    except Exception:
        logger.warning("Agents SDK unavailable; head agent disabled")
        return None

    # Import specialist agents (declarative Agents SDK objects)
    from ah_agents.email_triage_agent import email_triage_agent
    from ah_agents.voicemail_analyzer_agent import voicemail_analyzer_agent
    from ah_agents.voice_agent import voice_agent
    from ah_agents.sms_agent import sms_agent

    # Ops agents (may be None if SDK unavailable)
    from ah_agents.escalation_agent import escalation_ops_agent
    from ah_agents.ack_monitor_agent import acknowledgment_ops_agent

    handoffs = [
        email_triage_agent,
        voicemail_analyzer_agent,
        voice_agent,
        sms_agent,
    ]

    if escalation_ops_agent is not None:
        handoffs.append(escalation_ops_agent)
    if acknowledgment_ops_agent is not None:
        handoffs.append(acknowledgment_ops_agent)

    return Agent(
        name="AfterHoursHeadAgent",
        model="gpt-5.2",
        output_type=HeadDecision,
        handoffs=handoffs,
        instructions=(
            "You are the head agent for an after-hours escalation system. "
            "Decide which specialist agent should handle the user input and prepare the best input for that agent. "
            "Prefer handing off over answering directly. "
            "Output a JSON object matching the HeadDecision schema." 
        ),
    )


async def run_head_agent_router(user_input: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Convenience helper: run the head agent and return its structured decision.

    This does not force an SDK handoff; it produces an explicit routing decision
    the caller can follow.
    """

    agent = create_head_agent()
    if agent is None:
        return {
            "success": False,
            "error": "Agents SDK not available",
        }

    from agents import Runner

    prompt = user_input
    if metadata:
        prompt = f"METADATA: {metadata}\n\n{user_input}"

    logger.info(
        "[HEAD AGENT] Routing user input",
        extra={"input_len": len(user_input), "has_metadata": bool(metadata)},
    )
    result = await Runner.run(agent, prompt)
    decision: HeadDecision = result.final_output
    logger.info(
        "[HEAD AGENT] Routed",
        extra={"route": decision.route.value, "reason": decision.reason},
    )
    return {
        "success": True,
        "decision": decision.model_dump(),
    }


# Backward-compatible aliases (older imports)
get_head_agent = create_head_agent
route_with_head_agent = run_head_agent_router
