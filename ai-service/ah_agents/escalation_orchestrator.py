"""Escalation Orchestrator - Multi-Agent System using OpenAI Agents SDK.

This module implements the core multi-agent orchestration for the after-hours
escalation system. It coordinates between specialized agents (triage, voicemail
analysis, message generation) and manages the escalation workflow.

Architecture:
- OrchestratorAgent: Main coordinator that decides workflow and delegates
- TriageAgent: Classifies incoming events and scores urgency
- MessageAgent: Generates voice/SMS content for escalation
- The orchestrator can hand off to specialized agents based on event type

Coverage Window: 12:00 AM – 7:00 AM EST (per design document)
"""

import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional, List
from enum import Enum

from pydantic import BaseModel, Field
import httpx

from config import get_settings
from services.after_hours import is_after_hours, should_escalate_now, get_after_hours_status

logger = logging.getLogger(__name__)
settings = get_settings()


_MODEL = "gpt-5.2"  # locked per project requirement


# ============================================================================
# Pydantic Models for Structured Outputs
# ============================================================================


class EventSource(str, Enum):
    EMAIL = "email"
    DIALPAD = "dialpad"
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
# Multi-Agent Orchestrator
# ============================================================================


class EscalationOrchestrator:
    """Multi-agent orchestrator for escalation workflow.

    Coordinates between specialized agents using OpenAI Agents SDK handoffs:
    1. Receives incoming event (email, dialpad, manual)
    2. Routes to appropriate triage agent
    3. If escalation needed, generates messaging content
    4. Returns complete decision with audit trail

    Uses gpt-5.2 model exclusively per project requirements.
    """

    def __init__(self):
        self.enabled = False
        self._orchestrator_agent = None
        self._triage_agent = None
        self._message_agent = None
        self._initialize()

    def _initialize(self) -> None:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning(
                "OpenAI API key not configured - orchestrator using fallback logic"
            )
            self.enabled = False
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        try:
            from agents import Agent, ModelSettings

            # Triage Agent - Analyzes and scores events
            self._triage_agent = Agent(
                name="Triage Specialist",
                instructions=self._get_triage_instructions(),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.2),
                output_type=TriageOutput,
            )

            # Message Generation Agent - Creates voice/SMS content
            self._message_agent = Agent(
                name="Message Generator",
                instructions=self._get_message_instructions(),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.5),
                output_type=EscalationContent,
            )

            # Main Orchestrator - Coordinates the workflow
            self._orchestrator_agent = Agent(
                name="Escalation Orchestrator",
                instructions=self._get_orchestrator_instructions(),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.3),
                handoffs=[self._triage_agent, self._message_agent],
            )

            self.enabled = True
            logger.info(
                "Escalation Orchestrator initialized with multi-agent system. model=%s",
                _MODEL,
            )

        except Exception as e:
            logger.error(f"Failed to initialize multi-agent orchestrator: {str(e)}")
            self.enabled = False

    def _get_triage_instructions(self) -> str:
        return """You are an emergency triage specialist for a property management after-hours escalation system.

SCORING GUIDELINES:
- 0.9-1.0 (CRITICAL): Life safety emergencies
  * Fire, active flooding, gas leak, elevator entrapment
  * Medical emergency, security threat
  
- 0.7-0.89 (HIGH): Critical system failures
  * Complete power outage, HVAC failure in extreme weather
  * Major water leak, building-wide system down
  * Security system failure
  
- 0.5-0.69 (MEDIUM): Urgent operational issues
  * Partial system failures, equipment malfunction
  * Localized issues affecting operations
  * Access/entry problems after hours
  
- 0.3-0.49 (LOW): Can wait until business hours
  * Minor issues, cosmetic problems
  * Routine maintenance requests
  * General inquiries
  
- 0.0-0.29 (IGNORE): Non-emergency, no action needed
  * Marketing emails, spam
  * Already resolved issues
  * Scheduled maintenance confirmations

HIGH-WEIGHT PHRASES (increase score):
"no power", "flood", "leak", "fire alarm", "hvac failure", "elevator stuck", "can't operate", "emergency"

DOWNGRADE INDICATORS (decrease score):
"PM", "preventive maintenance", "scheduled", "routine", "cosmetic", "no rush", "when convenient"

DIALPAD EVENTS: Missed calls and voicemails are HIGH priority by default (someone called after hours).

Always provide clear reasoning for your decision."""

    def _get_message_instructions(self) -> str:
        return """You generate urgent but professional notifications for after-hours emergencies.

VOICE SCRIPT REQUIREMENTS:
- Must be 35-40 words maximum (under 15 seconds spoken)
- MUST start with "After-hours emergency"
- Include brief description of issue
- MUST end with "Press 1 to acknowledge and take ownership."
- Professional and clear, no jargon
- No emojis or special characters

SMS MESSAGE REQUIREMENTS:
- Under 160 characters
- MUST start with "After-Hours Emergency"
- Include time received
- Brief issue description
- MUST end with "Reply ACK to accept."
- No emojis

Return only the plain text content, no quotes or markdown formatting."""

    def _get_orchestrator_instructions(self) -> str:
        return """You are the main coordinator for an after-hours emergency escalation system.

YOUR WORKFLOW:
1. Receive incoming event (email, voicemail, or manual trigger)
2. Hand off to Triage Specialist for analysis and scoring
3. If decision is ESCALATE, hand off to Message Generator for content
4. Compile final decision with all details for audit trail

ESCALATION RULES:
- Score >= 0.6 OR dialpad events → ESCALATE
- Score 0.4-0.59 → MONITOR (log but don't wake anyone)
- Score < 0.4 → IGNORE (non-emergency)

DIALPAD EVENTS (missed calls/voicemails) ALWAYS ESCALATE - someone called after hours for a reason.

Provide complete audit trail including reasoning at each step."""

    async def process_event(
        self,
        event_type: str,
        content: str,
        source: EventSource,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Process an incoming event through the multi-agent system.

        Args:
            event_type: Type of event (email, voicemail, missed_call, manual)
            content: The main content to analyze (email body, transcript, etc.)
            source: Origin of the event (email, dialpad, manual)
            metadata: Additional context (sender, timestamp, etc.)

        Returns:
            Complete decision dict with should_escalate, triage results, content, audit
        """
        metadata = metadata or {}
        received_at = metadata.get("received_at", datetime.now().isoformat())
        force_escalate = metadata.get("force_escalate", False)

        # Check after-hours window
        can_escalate, window_reason = should_escalate_now(force_escalate)
        after_hours_status = get_after_hours_status()

        if self.enabled:
            try:
                result = await self._ai_process(event_type, content, source, metadata)
                
                # If outside after-hours window and not forced, don't escalate
                if not can_escalate and result.get("should_escalate"):
                    result["should_escalate"] = False
                    result["audit_notes"] = (
                        f"{result.get('audit_notes', '')} | "
                        f"Escalation blocked: {window_reason}. Event logged for business hours review."
                    )
                    result["after_hours_blocked"] = True
                
                result["after_hours"] = after_hours_status
                return result
            except Exception as e:
                logger.error(f"AI orchestration failed: {str(e)}")

        # Fallback to rule-based processing
        return self._fallback_process(event_type, content, source, metadata)

    async def _ai_process(
        self,
        event_type: str,
        content: str,
        source: EventSource,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Process event using multi-agent AI system."""
        from agents import Runner

        # Step 1: Triage the event
        triage_prompt = self._build_triage_prompt(event_type, content, source, metadata)
        triage_result = await Runner.run(self._triage_agent, triage_prompt)
        triage_output: TriageOutput = triage_result.final_output

        # Dialpad events always escalate regardless of content
        should_escalate = (
            source == EventSource.DIALPAD
            or triage_output.decision == TriageDecision.ESCALATE
            or triage_output.emergency_score >= 0.6
        )

        result = {
            "should_escalate": should_escalate,
            "triage": {
                "decision": triage_output.decision.value,
                "priority": triage_output.priority.value,
                "emergency_score": triage_output.emergency_score,
                "reasoning": triage_output.reasoning,
                "issue_summary": triage_output.issue_summary,
                "location": triage_output.location,
                "equipment": triage_output.equipment,
                "is_safety_critical": triage_output.is_safety_critical,
            },
            "escalation_content": None,
            "audit_notes": f"Processed via AI orchestrator. Source: {source.value}",
        }

        # Step 2: Generate escalation content if needed
        if should_escalate:
            try:
                content_prompt = self._build_content_prompt(
                    triage_output.issue_summary,
                    metadata.get("received_at", "now"),
                    triage_output.priority,
                )
                content_result = await Runner.run(self._message_agent, content_prompt)
                content_output: EscalationContent = content_result.final_output

                result["escalation_content"] = {
                    "voice_script": content_output.voice_script,
                    "sms_message": content_output.sms_message,
                    "email_subject": content_output.email_subject,
                }
            except Exception as e:
                logger.error(f"Message generation failed: {str(e)}")
                # Use fallback templates
                result["escalation_content"] = self._generate_fallback_content(
                    triage_output.issue_summary, metadata.get("received_at")
                )

        return result

    def _build_triage_prompt(
        self,
        event_type: str,
        content: str,
        source: EventSource,
        metadata: Dict[str, Any],
    ) -> str:
        prompt = f"""Analyze this incoming event and provide triage assessment.

EVENT TYPE: {event_type}
SOURCE: {source.value}
RECEIVED AT: {metadata.get('received_at', 'now')}

"""
        if source == EventSource.EMAIL:
            prompt += f"SUBJECT: {metadata.get('subject', 'N/A')}\n"
            prompt += f"FROM: {metadata.get('sender', 'Unknown')}\n"
            prompt += f"\nEMAIL BODY:\n{content}\n"
        elif source == EventSource.DIALPAD:
            prompt += f"CALLER: {metadata.get('from_number', 'Unknown')}\n"
            prompt += f"\nVOICEMAIL TRANSCRIPT:\n{content or 'No transcript available'}\n"
            prompt += "\nNOTE: Dialpad events (missed calls/voicemails) are HIGH priority by default.\n"
        else:
            prompt += f"\nCONTENT:\n{content}\n"

        prompt += "\nProvide your triage assessment with score, reasoning, and extracted context."
        return prompt

    def _build_content_prompt(
        self, issue_summary: str, received_at: str, priority: EscalationPriority
    ) -> str:
        try:
            if received_at and received_at != "now":
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except Exception:
            time_str = "now"

        return f"""Generate escalation notification content for this emergency.

ISSUE: {issue_summary}
PRIORITY: {priority.value}
TIME RECEIVED: {time_str}

Generate both voice script and SMS message following the requirements."""

    def _fallback_process(
        self,
        event_type: str,
        content: str,
        source: EventSource,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Rule-based fallback when AI is unavailable."""
        # Dialpad always escalates
        if source == EventSource.DIALPAD:
            score = 0.8
            decision = "escalate"
            priority = "high"
            reasoning = "Dialpad event - automatic high priority"
        else:
            score, reasoning = self._keyword_score(content)
            if score >= 0.6:
                decision = "escalate"
                priority = "high" if score >= 0.8 else "medium"
            elif score >= 0.4:
                decision = "monitor"
                priority = "medium"
            else:
                decision = "ignore"
                priority = "low"

        should_escalate = decision == "escalate"
        issue_summary = (content[:100] + "...") if len(content) > 100 else content

        # Check after-hours window for fallback path too
        force_escalate = metadata.get("force_escalate", False)
        can_escalate, window_reason = should_escalate_now(force_escalate)
        after_hours_status = get_after_hours_status()
        
        # Block escalation if outside after-hours window
        if should_escalate and not can_escalate:
            should_escalate = False
            reasoning = f"{reasoning} | Blocked: {window_reason}"

        result = {
            "should_escalate": should_escalate,
            "triage": {
                "decision": decision,
                "priority": priority,
                "emergency_score": score,
                "reasoning": reasoning,
                "issue_summary": issue_summary,
                "location": None,
                "equipment": None,
                "is_safety_critical": score >= 0.9,
            },
            "escalation_content": None,
            "audit_notes": "Processed via fallback rules (AI unavailable)",
            "after_hours": after_hours_status,
            "after_hours_blocked": not can_escalate if decision == "escalate" else False,
        }

        if should_escalate:
            result["escalation_content"] = self._generate_fallback_content(
                issue_summary, metadata.get("received_at")
            )

        return result

    def _keyword_score(self, content: str) -> tuple[float, str]:
        """Simple keyword-based scoring."""
        text_lower = content.lower()
        score = 0.5
        matches = []

        critical = {
            "fire": 0.95, "flood": 0.95, "no power": 0.9, "power outage": 0.9,
            "leak": 0.85, "elevator stuck": 0.9, "fire alarm": 0.95,
            "hvac failure": 0.85, "emergency": 0.75,
        }
        
        downgrades = {
            "pm": -0.2, "scheduled": -0.15, "routine": -0.15, "no rush": -0.2,
        }

        for kw, weight in critical.items():
            if kw in text_lower:
                if weight > score:
                    score = weight
                matches.append(kw)

        for kw, adj in downgrades.items():
            if kw in text_lower:
                score = max(0.1, score + adj)
                matches.append(f"downgrade:{kw}")

        reasoning = f"Keyword matches: {matches}" if matches else "No keywords matched"
        return round(score, 2), reasoning

    def _generate_fallback_content(
        self, issue_summary: str, received_at: Optional[str]
    ) -> Dict[str, str]:
        """Generate fallback escalation content."""
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except Exception:
            time_str = "now"

        short_issue = issue_summary[:60] if issue_summary else "service request"

        return {
            "voice_script": (
                f"After-hours emergency received at {time_str}. "
                f"{short_issue}. "
                "Press 1 to acknowledge and take ownership."
            ),
            "sms_message": (
                f"After-Hours Emergency – {short_issue} at {time_str}. Reply ACK to accept."
            ),
            "email_subject": f"After-Hours Emergency: {short_issue}",
        }

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
