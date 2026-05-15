"""SMS Agent — façade that delegates to the SMS LangGraph sub-graph.

The sub-graph caps the message at 160 chars and re-appends ``Reply ACK to accept.``
so we trust its output and just emit the agent-tracking trace + logs.

Public API preserved for routes/escalate.py:
    - ``SmsAgent.generate_message(event_id, issue_description, received_at) -> dict``
    - ``generate_sms(...)`` module function
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from services.agent_tracking import isoformat, publish_agent_trace, utc_now

# Sub-graph contract owned by Agent 1.
from graph.subgraphs import sms_graph
from graph.callbacks import default_callbacks

logger = logging.getLogger(__name__)


class SmsOutput(BaseModel):
    """Kept for any external consumer that still imports it."""

    message: str = Field(description="Final SMS text (<=160 chars), plain text")


async def generate_sms(event_id: str, issue_description: str, received_at: str = "") -> dict:
    """Generate an SMS message for escalation.

    Delegates to ``sms_graph``. The keyword/template fallback that used to live
    here is dropped — the sub-graph returns a safe default message on LLM failure.
    """

    started_at = utc_now()
    logger.info("=" * 60)
    logger.info("[SMS AGENT] Generating SMS message")
    logger.info(f"  Event ID: {event_id}")
    logger.info(
        f"  Issue: {issue_description[:60]}..."
        if len(issue_description or "") > 60
        else f"  Issue: {issue_description}"
    )

    try:
        result = await sms_graph.ainvoke(
            {
                "event_id": event_id,
                "issue_description": issue_description,
                "received_at": received_at,
            },
            config={
                "callbacks": default_callbacks(),
                "tags": ["sms_message", "after-hours-agent", "sms"],
                "metadata": {"event_id": event_id},
                "run_name": "sms_message",
            },
        )

        message = result["message"]
        generated_by = result.get("generated_by", "ai")

        logger.info("[SMS AGENT] Generated message:")
        logger.info(f"  {message}")
        logger.info("=" * 60)

        await publish_agent_trace(
            {
                "traceId": f"sms_message_{event_id}",
                "eventId": event_id,
                "threadId": event_id,
                "project": "after-hours-agent",
                "title": "SMS escalation message",
                "source": "sms",
                "status": "success",
                "latencyMs": int((utc_now() - started_at).total_seconds() * 1000),
                "metadata": {
                    "event_id": event_id,
                    "thread_id": event_id,
                    "session_id": event_id,
                    "agent": "SmsAgent",
                },
                "tags": ["production", "after-hours-agent", "sms", "llm"],
                "startedAt": isoformat(started_at),
                "endedAt": isoformat(utc_now()),
                "spans": [
                    {
                        "spanId": f"sms_message_{event_id}_llm",
                        "name": "sms_message_generation",
                        "runType": "llm",
                        "status": "success",
                        "inputs": {"issue_description": issue_description},
                        "outputs": {"length": len(message), "generated_by": generated_by},
                    }
                ],
            }
        )

        return {"message": message, "generated_by": generated_by}
    except Exception as e:
        logger.error(f"[SMS AGENT] Message generation failed: {e}")
        await publish_agent_trace(
            {
                "traceId": f"sms_message_{event_id}",
                "eventId": event_id,
                "threadId": event_id,
                "project": "after-hours-agent",
                "title": "SMS escalation message",
                "source": "sms",
                "status": "error",
                "latencyMs": int((utc_now() - started_at).total_seconds() * 1000),
                "errorMessage": str(e),
                "metadata": {
                    "event_id": event_id,
                    "thread_id": event_id,
                    "session_id": event_id,
                    "agent": "SmsAgent",
                },
                "tags": ["production", "after-hours-agent", "sms", "error"],
                "startedAt": isoformat(started_at),
                "endedAt": isoformat(utc_now()),
                "spans": [
                    {
                        "spanId": f"sms_message_{event_id}_error",
                        "name": "sms_message_generation",
                        "runType": "llm",
                        "status": "error",
                        "inputs": {"issue_description": issue_description},
                        "outputs": {"error": str(e)},
                    }
                ],
            }
        )
        raise


class SmsAgent:
    """Backward-compatible wrapper used by routes/escalate.py."""

    async def generate_message(
        self, event_id: str, issue_description: str, received_at: str = ""
    ) -> dict:
        return await generate_sms(event_id, issue_description, received_at)
