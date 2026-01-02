"""After-hours escalation application agents.

Note: This package is intentionally NOT named `agents` to avoid clashing with the
OpenAI Agents SDK Python package (imported as `agents`).
"""

from ah_agents.email_triage_agent import EmailTriageAgent
from ah_agents.sms_agent import SmsAgent
from ah_agents.voice_agent import VoiceAgent
from ah_agents.dialpad_agent import DialpadAgent
from ah_agents.escalation_agent import EscalationAgent
from ah_agents.ack_monitor_agent import AckMonitorAgent
from ah_agents.voicemail_analyzer_agent import (
    VoicemailAnalyzerAgent,
    get_voicemail_analyzer_agent,
)
from ah_agents.escalation_orchestrator import (
    EscalationOrchestrator,
    get_escalation_orchestrator,
    EventSource,
    TriageDecision,
    EscalationPriority,
    ESCALATION_LADDER,
)
from ah_agents.agent_tools import ESCALATION_TOOLS, create_escalation_tools

__all__ = [
    # Original agents
    "EmailTriageAgent",
    "SmsAgent",
    "VoiceAgent",
    "DialpadAgent",
    "EscalationAgent",
    "AckMonitorAgent",
    # New multi-agent components
    "VoicemailAnalyzerAgent",
    "get_voicemail_analyzer_agent",
    "EscalationOrchestrator",
    "get_escalation_orchestrator",
    "EventSource",
    "TriageDecision",
    "EscalationPriority",
    "ESCALATION_LADDER",
    # Tools
    "ESCALATION_TOOLS",
    "create_escalation_tools",
]
