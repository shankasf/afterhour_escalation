"""LangGraph sub-graphs replacing the legacy ``ah_agents`` modules.

Each sub-graph is a compiled ``StateGraph`` invoked via
``await graph.ainvoke({...}, config={"callbacks": default_callbacks(), "tags": [...]})``.

Agent 2 imports these via the public names defined below.
"""

from graph.subgraphs.orchestrator import (
    OrchestratorInput,
    OrchestratorOutput,
    orchestrator_graph,
)
from graph.subgraphs.sms import SmsInput, SmsOutput, sms_graph
from graph.subgraphs.triage import (
    EmailTriageInput,
    EmailTriageOutput,
    triage_graph,
)
from graph.subgraphs.voice_script import (
    VoiceScriptInput,
    VoiceScriptOutput,
    voice_script_graph,
)
from graph.subgraphs.voicemail import (
    VoicemailInput,
    VoicemailOutput,
    voicemail_graph,
)


__all__ = [
    "triage_graph",
    "EmailTriageInput",
    "EmailTriageOutput",
    "voice_script_graph",
    "VoiceScriptInput",
    "VoiceScriptOutput",
    "sms_graph",
    "SmsInput",
    "SmsOutput",
    "voicemail_graph",
    "VoicemailInput",
    "VoicemailOutput",
    "orchestrator_graph",
    "OrchestratorInput",
    "OrchestratorOutput",
]
