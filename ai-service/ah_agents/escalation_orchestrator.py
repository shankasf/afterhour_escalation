"""Escalation Orchestrator — façade that delegates to the LangGraph
``orchestrator_graph`` sub-graph.

This module keeps the public surface previously exposed by the multi-agent
orchestrator (Pydantic models, enums, ladder, singleton helper, and
``process_event`` shape) so that routes and the DI container keep working
without any change.

The orchestrator sub-graph (owned by Agent 1) is responsible for:
- Triage scoring via the triage sub-graph
- After-hours window check + escalation blocking
- Escalation content generation when ``should_escalate`` is true
- Audit notes assembly

Coverage Window: 12:00 AM – 7:00 AM EST (handled inside the sub-graph).
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from config import get_settings

# Sub-graph contract owned by Agent 1.
from graph.subgraphs import orchestrator_graph
from graph.callbacks import default_callbacks

logger = logging.getLogger(__name__)
settings = get_settings()


# ============================================================================
# Pydantic Models for Structured Outputs (kept for routes/import compatibility)
# ============================================================================


class EventSource(str, Enum):
    EMAIL = "email"
    CHAT = "chat"
    MANUAL = "manual"


class TriageDecision(str, Enum):
    ESCALATE = "escalate"
    MONITOR = "monitor"
    IGNORE = "ignore"


class EscalationPriority(str, Enum):
    CRITICAL = "critical"  # Life safety, immediate response
    HIGH = "high"  # System down, major impact
    MEDIUM = "medium"  # Urgent but not critical
    LOW = "low"  # Can wait


class TriageOutput(BaseModel):
    """Output from the triage analysis."""

    decision: TriageDecision = Field(description="Whether to escalate, monitor, or ignore")
    priority: EscalationPriority = Field(description="Priority level for escalation")
    emergency_score: float = Field(ge=0.0, le=1.0, description="Score 0-1")
    reasoning: str = Field(description="Brief explanation for the decision")
    issue_summary: str = Field(description="One-line summary of the issue")
    location: Optional[str] = Field(None, description="Property/location if identified")
    equipment: Optional[str] = Field(None, description="Equipment/system involved")
    is_safety_critical: bool = Field(False, description="True if life/safety threat")


class EscalationContent(BaseModel):
    """Generated content for escalation notifications."""

    voice_script: str = Field(description="Script for voice call (35-40 words)")
    sms_message: str = Field(description="SMS message (under 160 chars)")
    email_subject: Optional[str] = Field(None, description="Email subject if needed")


class OrchestratorDecision(BaseModel):
    """Final orchestrator output for an event."""

    should_escalate: bool = Field(description="Whether to trigger escalation")
    triage: TriageOutput = Field(description="Triage analysis results")
    escalation_content: Optional[EscalationContent] = Field(
        None, description="Generated content if escalating"
    )
    audit_notes: str = Field("", description="Notes for audit trail")


# ============================================================================
# Escalation Ladder Configuration
# ============================================================================


ESCALATION_LADDER = [
    {"level": 1, "role": "Primary On-Call", "timeout_seconds": 120, "is_rotation": True},
    {"level": 2, "role": "Secondary On-Call", "timeout_seconds": 120, "is_rotation": True},
    {"level": 3, "role": "Matt Mehler", "timeout_seconds": 120, "is_rotation": False},
    {"level": 4, "role": "Karina Blondet", "timeout_seconds": 120, "is_rotation": False},
    {"level": 5, "role": "Katelyn Badger", "timeout_seconds": 120, "is_rotation": False},
    {"level": 6, "role": "Stefi", "timeout_seconds": 120, "is_rotation": False},
    {"level": 7, "role": "Eric", "timeout_seconds": 120, "is_rotation": False},
    {"level": 8, "role": "Rocco", "timeout_seconds": 120, "is_rotation": False},
]


# ============================================================================
# Orchestrator Façade
# ============================================================================


class EscalationOrchestrator:
    """Façade over the ``orchestrator_graph`` sub-graph.

    Keeps the ``process_event`` API stable for callers in
    ``routes/classify.py``, ``routes/escalate.py``, and ``container.py``. All
    AI logic, after-hours gating, and content generation live inside the
    sub-graph; we just shape inputs and surface the result.
    """

    def __init__(self) -> None:
        # Kept for callers that might still introspect ``.enabled``.
        self.enabled = True

    async def process_event(
        self,
        event_type: str,
        content: str,
        source: EventSource,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Process an incoming event via the orchestrator sub-graph.

        On graph exception the error is logged and re-raised; the calling
        route's outer try/except handler (which logs and returns a 500) is
        the single source of truth for client error responses.
        """

        metadata = metadata or {}
        source_value = source.value if isinstance(source, EventSource) else str(source)

        logger.info("\n" + "#" * 70)
        logger.info("[ESCALATION ORCHESTRATOR] Processing new event")
        logger.info("#" * 70)
        logger.info(f"  Event Type: {event_type}")
        logger.info(f"  Source: {source_value}")
        logger.info(f"  Content Length: {len(content or '')} chars")
        logger.info(f"  Received At: {metadata.get('received_at')}")
        logger.info(f"  Force Escalate: {metadata.get('force_escalate', False)}")
        logger.info("-" * 70)

        try:
            result = await orchestrator_graph.ainvoke(
                {
                    "event_type": event_type,
                    "content": content,
                    "source": source_value,
                    "metadata": metadata,
                },
                config={
                    "callbacks": default_callbacks(),
                    "tags": ["escalation_orchestrator", "after-hours-agent"],
                    "metadata": {
                        "event_type": event_type,
                        "source": source_value,
                        **{k: v for k, v in metadata.items() if isinstance(v, (str, int, float, bool))},
                    },
                    "run_name": "escalation_orchestrator",
                },
            )

            logger.info(
                f"[ORCHESTRATOR] Result: should_escalate={result.get('should_escalate')}, "
                f"after_hours_blocked={result.get('after_hours_blocked', False)}"
            )
            logger.info("#" * 70 + "\n")
            return result
        except Exception as e:
            logger.error(f"[ORCHESTRATOR] Sub-graph invocation failed: {e}")
            # Re-raise so the calling route's outer try/except logs + returns 500.
            raise

    def get_escalation_ladder(self) -> List[Dict[str, Any]]:
        """Return the configured escalation ladder."""
        return ESCALATION_LADDER.copy()


# Singleton instance
_orchestrator: Optional[EscalationOrchestrator] = None


def get_escalation_orchestrator() -> EscalationOrchestrator:
    """Get or create the singleton orchestrator instance."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = EscalationOrchestrator()
    return _orchestrator
