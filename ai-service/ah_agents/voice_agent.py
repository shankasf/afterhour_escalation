"""Voice Agent — façade that delegates to the voice-script LangGraph sub-graph.

Two modes are exposed:
    - ``mode='call'``: full outbound emergency call script (with DTMF prompt)
    - ``mode='voicemail'``: shorter voicemail script (no DTMF prompt)

Public API preserved for routes/escalate.py:
    - ``VoiceAIAgent.generate_message(...)``
    - ``VoiceAIAgent.generate_voicemail_script(...)``
    - ``generate_voice_script(...)`` module function
    - ``get_voice_agent()`` factory and ``VoiceAgent`` alias
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, Field

from services.agent_tracking import isoformat, publish_agent_trace, utc_now

# Sub-graph contract owned by Agent 1.
from graph.subgraphs import voice_script_graph
from graph.callbacks import default_callbacks

logger = logging.getLogger(__name__)


class VoiceScriptOutput(BaseModel):
    """Kept for any external consumer that still imports it."""

    script: str = Field(description="Voice script for TTS (35-50 words)")
    urgency_level: str = Field(default="high", description="critical, high, medium")
    estimated_duration_seconds: int = Field(default=15, description="Seconds to speak")


async def generate_voice_script(
    event_id: str,
    issue_description: str,
    received_at: str = "",
    responder_name: Optional[str] = None,
    escalation_level: int = 1,
    source_type: str = "email",
) -> dict:
    """Generate a voice script for an outbound escalation call.

    Delegates to ``voice_script_graph`` in ``mode='call'``. The keyword/template
    fallback that used to live here is dropped — the sub-graph returns a safe
    default script on LLM failure.
    """

    started_at = utc_now()
    logger.info("=" * 60)
    logger.info("[VOICE AGENT] Generating voice script")
    logger.info(f"  Event ID: {event_id}")
    logger.info(
        f"  Issue: {issue_description[:60]}..."
        if len(issue_description or "") > 60
        else f"  Issue: {issue_description}"
    )
    logger.info(f"  Escalation Level: {escalation_level}")
    logger.info(f"  Source Type: {source_type}")

    try:
        result = await voice_script_graph.ainvoke(
            {
                "event_id": event_id,
                "issue_description": issue_description,
                "received_at": received_at,
                "responder_name": responder_name,
                "escalation_level": escalation_level,
                "source_type": source_type,
                "mode": "call",
            },
            config={
                "callbacks": default_callbacks(),
                "tags": ["voice_script", "after-hours-agent", "voice"],
                "metadata": {
                    "event_id": event_id,
                    "escalation_level": escalation_level,
                    "source_type": source_type,
                },
                "run_name": "voice_script",
            },
        )

        script = result["script"]
        urgency_level = result.get("urgency_level", "high")
        estimated_duration = int(result.get("estimated_duration_seconds", 15))
        generated_by = result.get("generated_by", "ai")

        logger.info(f"[VOICE AGENT] Generated script ({estimated_duration}s):")
        logger.info(
            f"  {script[:100]}..." if len(script) > 100 else f"  {script}"
        )
        logger.info(f"  Urgency Level: {urgency_level}")
        logger.info("=" * 60)

        await publish_agent_trace(
            {
                "traceId": f"voice_script_{event_id}",
                "eventId": event_id,
                "threadId": event_id,
                "project": "after-hours-agent",
                "title": "Voice escalation script",
                "source": source_type,
                "status": "success",
                "latencyMs": int((utc_now() - started_at).total_seconds() * 1000),
                "metadata": {
                    "event_id": event_id,
                    "thread_id": event_id,
                    "session_id": event_id,
                    "agent": "VoiceScriptAgent",
                    "escalation_level": escalation_level,
                },
                "tags": ["production", "after-hours-agent", "voice", "llm"],
                "startedAt": isoformat(started_at),
                "endedAt": isoformat(utc_now()),
                "spans": [
                    {
                        "spanId": f"voice_script_{event_id}_llm",
                        "name": "voice_script_generation",
                        "runType": "llm",
                        "status": "success",
                        "inputs": {
                            "issue_description": issue_description,
                            "source_type": source_type,
                        },
                        "outputs": {
                            "urgency_level": urgency_level,
                            "estimated_duration": estimated_duration,
                        },
                    }
                ],
            }
        )

        return {
            "script": script,
            "audio_url": None,
            "generated_by": generated_by,
            "urgency_level": urgency_level,
            "estimated_duration": estimated_duration,
        }
    except Exception as e:
        logger.error(f"[VOICE AGENT] Script generation failed: {e}")
        await publish_agent_trace(
            {
                "traceId": f"voice_script_{event_id}",
                "eventId": event_id,
                "threadId": event_id,
                "project": "after-hours-agent",
                "title": "Voice escalation script",
                "source": source_type,
                "status": "error",
                "latencyMs": int((utc_now() - started_at).total_seconds() * 1000),
                "errorMessage": str(e),
                "metadata": {
                    "event_id": event_id,
                    "thread_id": event_id,
                    "session_id": event_id,
                    "agent": "VoiceScriptAgent",
                },
                "tags": ["production", "after-hours-agent", "voice", "error"],
                "startedAt": isoformat(started_at),
                "endedAt": isoformat(utc_now()),
                "spans": [
                    {
                        "spanId": f"voice_script_{event_id}_error",
                        "name": "voice_script_generation",
                        "runType": "llm",
                        "status": "error",
                        "inputs": {
                            "issue_description": issue_description,
                            "source_type": source_type,
                        },
                        "outputs": {"error": str(e)},
                    }
                ],
            }
        )
        raise


async def generate_voicemail_script(
    event_id: str, issue_description: str, escalation_level: int = 1
) -> str:
    """Generate a shorter script for voicemail (no DTMF instruction).

    Delegates to ``voice_script_graph`` in ``mode='voicemail'``.
    """

    logger.info("=" * 60)
    logger.info("[VOICE AGENT] Generating voicemail script")
    logger.info(f"  Event ID: {event_id}")
    logger.info(f"  Escalation Level: {escalation_level}")

    try:
        result = await voice_script_graph.ainvoke(
            {
                "event_id": event_id,
                "issue_description": issue_description,
                "received_at": "",
                "responder_name": None,
                "escalation_level": escalation_level,
                "source_type": "voicemail",
                "mode": "voicemail",
            },
            config={
                "callbacks": default_callbacks(),
                "tags": ["voicemail_script", "after-hours-agent", "voice"],
                "metadata": {
                    "event_id": event_id,
                    "escalation_level": escalation_level,
                },
                "run_name": "voicemail_script",
            },
        )
        return result["script"]
    except Exception as e:
        logger.error(f"[VOICE AGENT] Voicemail script failed: {e}")
        # Minimal in-process safety net so the caller never crashes the call flow.
        short = (issue_description or "urgent matter")[:60]
        return (
            f"Urgent message from after-hours support. {short}. "
            "Please call back immediately."
        )


class VoiceAIAgent:
    """Backward-compatible wrapper used by routes/escalate.py."""

    async def generate_message(
        self,
        event_id: str,
        issue_description: str,
        received_at: str = "",
        responder_name: Optional[str] = None,
        escalation_level: int = 1,
        source_type: str = "email",
    ) -> dict:
        return await generate_voice_script(
            event_id,
            issue_description,
            received_at,
            responder_name,
            escalation_level,
            source_type,
        )

    async def generate_voicemail_script(
        self, event_id: str, issue_description: str, escalation_level: int = 1
    ) -> str:
        return await generate_voicemail_script(event_id, issue_description, escalation_level)


# Aliases
VoiceAgent = VoiceAIAgent


def get_voice_agent() -> VoiceAIAgent:
    """Get a VoiceAIAgent instance."""
    return VoiceAIAgent()
