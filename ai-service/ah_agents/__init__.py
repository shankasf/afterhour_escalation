"""After-hours escalation agent façades.

All AI logic now lives in LangGraph sub-graphs under ``graph/subgraphs.py``.
The modules in this package are thin façades that preserve the public API
expected by ``routes/*`` and ``services/email_poller`` while delegating the
actual work to sub-graphs.

Exports:
    Wrapper classes (used by routes/services):
        EmailTriageAgent, VoiceAIAgent, VoiceAgent, SmsAgent,
        VoicemailAnalyzerAgent, AckMonitorAgent, EscalationAgent,
        EscalationOrchestrator

    Module-level functions:
        classify_email, generate_voice_script, generate_sms,
        analyze_voicemail

    Factories / singletons:
        get_voice_agent, get_voicemail_analyzer_agent,
        get_escalation_orchestrator

    Models / enums (still imported by routes for typing):
        EventSource, TriageDecision, EscalationPriority,
        TriageOutput, EscalationContent, OrchestratorDecision,
        ESCALATION_LADDER
"""

from ah_agents.email_triage_agent import (
    EmailTriageAgent,
    classify_email,
)
from ah_agents.voice_agent import (
    VoiceAIAgent,
    VoiceAgent,
    get_voice_agent,
    generate_voice_script,
)
from ah_agents.sms_agent import (
    SmsAgent,
    generate_sms,
)
from ah_agents.voicemail_analyzer_agent import (
    VoicemailAnalyzerAgent,
    get_voicemail_analyzer_agent,
    analyze_voicemail,
)
from ah_agents.ack_monitor_agent import AckMonitorAgent
from ah_agents.escalation_agent import EscalationAgent

from ah_agents.escalation_orchestrator import (
    EscalationOrchestrator,
    get_escalation_orchestrator,
    EventSource,
    TriageDecision,
    EscalationPriority,
    TriageOutput,
    EscalationContent,
    OrchestratorDecision,
    ESCALATION_LADDER,
)

__all__ = [
    # Wrapper classes
    "EmailTriageAgent",
    "VoiceAIAgent",
    "VoiceAgent",
    "SmsAgent",
    "VoicemailAnalyzerAgent",
    "AckMonitorAgent",
    "EscalationAgent",
    "EscalationOrchestrator",
    # Module-level functions
    "classify_email",
    "generate_voice_script",
    "generate_sms",
    "analyze_voicemail",
    # Factories / singletons
    "get_voice_agent",
    "get_voicemail_analyzer_agent",
    "get_escalation_orchestrator",
    # Models / enums
    "EventSource",
    "TriageDecision",
    "EscalationPriority",
    "TriageOutput",
    "EscalationContent",
    "OrchestratorDecision",
    "ESCALATION_LADDER",
]
