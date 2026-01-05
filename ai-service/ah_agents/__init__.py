"""After-hours escalation agents using OpenAI Agents SDK.

This package provides AI agents for:
- Email triage and classification
- Voice script generation for Twilio calls
- SMS message generation
- Voicemail analysis
- Acknowledgment monitoring
- Escalation orchestration

All agents use the OpenAI Agents SDK pattern:
    from agents import Agent, Runner

    agent = Agent(name="...", instructions="...")
    result = await Runner.run(agent, input="...")
"""

# Core agents (declarative pattern)
from ah_agents.email_triage_agent import (
    create_email_triage_agent,
    get_email_triage_agent,
    email_triage_agent,
    classify_email,
    EmailTriageAgent,
)
from ah_agents.voice_agent import (
    create_voice_script_agent,
    get_voice_script_agent,
    voice_agent,
    generate_voice_script,
    VoiceAIAgent,
    VoiceAgent,
    get_voice_agent,
)
from ah_agents.sms_agent import (
    create_sms_agent,
    get_sms_agent,
    sms_agent,
    generate_sms,
    SmsAgent,
)
from ah_agents.dialpad_agent import DialpadAgent, create_dialpad_ops_agent, get_dialpad_ops_agent, dialpad_ops_agent
from ah_agents.voicemail_analyzer_agent import (
    create_voicemail_analyzer_agent,
    get_voicemail_analyzer_llm_agent,
    voicemail_analyzer_agent,
    analyze_voicemail,
    VoicemailAnalyzerAgent,
    get_voicemail_analyzer_agent,
)
from ah_agents.ack_monitor_agent import (
    AckMonitorAgent,
    create_acknowledgment_ops_agent,
    get_acknowledgment_ops_agent,
    acknowledgment_ops_agent,
)
from ah_agents.escalation_agent import (
    EscalationAgent,
    create_escalation_ops_agent,
    get_escalation_ops_agent,
    escalation_ops_agent,
)
from ah_agents.head_agent import (
    create_head_agent,
    run_head_agent_router,
    get_head_agent,
    route_with_head_agent,
)

# Orchestrator (coordinates multi-agent workflow)
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

# Tools for agent function calls
from ah_agents.agent_tools import ESCALATION_TOOLS, create_escalation_tools

__all__ = [
    # Agent instances (declarative pattern)
    "create_email_triage_agent",
    "get_email_triage_agent",
    "email_triage_agent",
    "create_voice_script_agent",
    "get_voice_script_agent",
    "voice_agent",
    "create_sms_agent",
    "get_sms_agent",
    "sms_agent",
    "create_voicemail_analyzer_agent",
    "get_voicemail_analyzer_llm_agent",
    "voicemail_analyzer_agent",
    # Agent functions
    "classify_email",
    "generate_voice_script",
    "generate_sms",
    "analyze_voicemail",
    # Wrapper classes (backward compatibility)
    "EmailTriageAgent",
    "VoiceAIAgent",
    "VoiceAgent",
    "get_voice_agent",
    "SmsAgent",
    "DialpadAgent",
    "create_dialpad_ops_agent",
    "get_dialpad_ops_agent",
    "dialpad_ops_agent",
    "VoicemailAnalyzerAgent",
    "get_voicemail_analyzer_agent",
    "AckMonitorAgent",
    "create_acknowledgment_ops_agent",
    "get_acknowledgment_ops_agent",
    "acknowledgment_ops_agent",
    "EscalationAgent",
    "create_escalation_ops_agent",
    "get_escalation_ops_agent",
    "escalation_ops_agent",
    # Head agent
    "create_head_agent",
    "run_head_agent_router",
    "get_head_agent",
    "route_with_head_agent",
    # Orchestrator
    "EscalationOrchestrator",
    "get_escalation_orchestrator",
    # Models
    "EventSource",
    "TriageDecision",
    "EscalationPriority",
    "TriageOutput",
    "EscalationContent",
    "OrchestratorDecision",
    "ESCALATION_LADDER",
    # Tools
    "ESCALATION_TOOLS",
    "create_escalation_tools",
]
