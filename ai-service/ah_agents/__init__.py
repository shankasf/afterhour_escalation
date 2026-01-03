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

# Core agents (actively used by routes)
from ah_agents.email_triage_agent import EmailTriageAgent
from ah_agents.voice_agent import VoiceAIAgent, VoiceAgent, get_voice_agent
from ah_agents.sms_agent import SmsAgent
from ah_agents.dialpad_agent import DialpadAgent
from ah_agents.voicemail_analyzer_agent import VoicemailAnalyzerAgent, get_voicemail_analyzer_agent
from ah_agents.ack_monitor_agent import AckMonitorAgent
from ah_agents.escalation_agent import EscalationAgent

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
    # Core Agents
    "EmailTriageAgent",
    "VoiceAIAgent",
    "VoiceAgent",
    "get_voice_agent",
    "SmsAgent",
    "DialpadAgent",
    "VoicemailAnalyzerAgent",
    "get_voicemail_analyzer_agent",
    "AckMonitorAgent",
    "EscalationAgent",
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
