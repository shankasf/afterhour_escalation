"""
Voice AI Agent for Twilio Outbound Calls

This agent is responsible for:
1. Generating dynamic voice scripts for outbound escalation calls
2. Processing responses and DTMF input during calls
3. Handling conversation flow for emergency acknowledgment

All outbound calls are powered by Twilio - this agent interfaces with TwiML
to provide voice AI capabilities during escalation calls.
"""

import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


_MODEL = "gpt-5.2"  # locked per project requirement


class VoiceScriptOutput(BaseModel):
    """Structured output for voice script generation."""
    script: str = Field(description="The voice script to be spoken during the call")
    urgency_level: str = Field(description="The urgency level: critical, high, medium")
    estimated_duration_seconds: int = Field(description="Estimated time to speak the script")


class OutboundCallContext(BaseModel):
    """Context for an outbound escalation call."""
    event_id: str
    issue_summary: str
    caller_name: Optional[str] = None
    source_type: str = Field(default="email", description="Source: email, dialpad, direct")
    received_at: Optional[str] = None
    escalation_level: int = Field(default=1)
    responder_name: Optional[str] = None


class VoiceAIAgent:
    """
    Voice AI Agent for Twilio Outbound Escalation Calls.
    
    Uses OpenAI Agents SDK (Responses API) with gpt-5.2 to generate
    dynamic, context-aware voice scripts for emergency escalation.
    
    Design: Twilio handles all outbound calls - this agent generates
    the TwiML voice content and processes call outcomes.
    """

    def __init__(self):
        self.enabled = False
        self._script_agent = None
        self._response_agent = None
        self._initialize()

    def _initialize(self) -> None:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using default scripts")
            self.enabled = False
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        if settings.openai_model and settings.openai_model != _MODEL:
            logger.warning("Ignoring openai_model=%s; enforced model is %s", settings.openai_model, _MODEL)

        try:
            from agents import Agent, ModelSettings

            # Primary agent for generating voice scripts
            self._script_agent = Agent(
                name="Voice Script Generator",
                instructions=(
                    "You are a voice script generator for after-hours emergency escalation calls. "
                    "Generate clear, urgent, professional scripts that will be spoken by Twilio's "
                    "text-to-speech system during outbound calls.\n\n"
                    "Requirements:\n"
                    "- Scripts must be concise (35-50 words max, ~15-20 seconds when spoken)\n"
                    "- Always start with 'After-hours emergency' or 'Priority alert'\n"
                    "- Include the key issue summary without technical jargon\n"
                    "- Always end with a clear call-to-action for acknowledgment\n"
                    "- Use natural speech patterns suitable for phone calls\n"
                    "- No special characters, emojis, or formatting\n"
                ),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.4),
                output_type=VoiceScriptOutput,
            )
            
            # Agent for processing call outcomes and generating follow-up
            self._response_agent = Agent(
                name="Call Response Handler",
                instructions=(
                    "You process outcomes from escalation calls and generate appropriate follow-up "
                    "actions. Analyze call status (answered, voicemail, no-answer) and acknowledgment "
                    "responses to determine next steps in the escalation flow."
                ),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.3),
            )
            
            self.enabled = True
            logger.info("VoiceAIAgent initialized with OpenAI Agents SDK (Responses API). model=%s", _MODEL)
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI Agents SDK for VoiceAIAgent: {str(e)}")
            self.enabled = False

    async def generate_message(
        self,
        event_id: str,
        issue_description: str,
        received_at: str,
        responder_name: Optional[str] = None,
        escalation_level: int = 1,
        source_type: str = "email",
    ) -> Dict[str, Any]:
        """
        Generate a voice script for an outbound escalation call.
        
        Args:
            event_id: The event ID being escalated
            issue_description: Summary of the emergency issue
            received_at: ISO timestamp when the issue was received
            responder_name: Name of the person being called (if known)
            escalation_level: Current level in the escalation ladder (1-8)
            source_type: Source of the event (email, dialpad, direct)
        
        Returns:
            Dict with script, audio_url, generated_by, and urgency_level
        """
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except Exception:
            time_str = "recently"

        context = OutboundCallContext(
            event_id=event_id,
            issue_summary=issue_description,
            received_at=received_at,
            responder_name=responder_name,
            escalation_level=escalation_level,
            source_type=source_type,
        )

        if self.enabled:
            try:
                result = await self._ai_generate_script(context, time_str)
                return {
                    "script": result.script,
                    "audio_url": None,
                    "generated_by": "ai",
                    "urgency_level": result.urgency_level,
                    "estimated_duration": result.estimated_duration_seconds,
                }
            except Exception as e:
                logger.error(f"AI script generation failed: {str(e)}")

        # Fallback to template
        script = self._generate_template_script(context, time_str)
        return {
            "script": script,
            "audio_url": None,
            "generated_by": "template",
            "urgency_level": "high",
            "estimated_duration": 15,
        }

    async def _ai_generate_script(self, context: OutboundCallContext, time_str: str) -> VoiceScriptOutput:
        """Generate script using AI agent."""
        if not self._script_agent:
            raise RuntimeError("Script agent not initialized")

        from agents import Runner

        # Build context-aware prompt
        level_context = ""
        if context.escalation_level > 1:
            level_context = f"\nThis is escalation level {context.escalation_level} - previous responders did not acknowledge."
        
        responder_greeting = ""
        if context.responder_name:
            responder_greeting = f"\nAddress the responder as: {context.responder_name}"
        
        source_context = ""
        if context.source_type == "dialpad":
            source_context = "\nThis originated from a missed call/voicemail on the support line."
        elif context.source_type == "email":
            source_context = "\nThis originated from an urgent email received after hours."

        prompt = (
            f"Generate a voice script for an outbound emergency escalation call.\n\n"
            f"Issue Summary: {context.issue_summary}\n"
            f"Time Received: {time_str}\n"
            f"Event ID: {context.event_id}\n"
            f"{source_context}{level_context}{responder_greeting}\n\n"
            "The script will be spoken by Twilio's text-to-speech during an outbound call.\n"
            "MUST end with: 'Press 1 to acknowledge and take ownership.'\n"
        )

        result = await Runner.run(self._script_agent, prompt)
        output: VoiceScriptOutput = result.final_output

        # Ensure call-to-action is present
        if "press 1" not in output.script.lower():
            output.script = (output.script.rstrip(". ") + ". Press 1 to acknowledge and take ownership.")
        
        return output

    async def process_call_outcome(
        self,
        event_id: str,
        call_status: str,
        acknowledged: bool,
        responder_phone: Optional[str] = None,
        dtmf_input: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process the outcome of an outbound call.
        
        Args:
            event_id: The event ID
            call_status: Twilio call status (completed, busy, no-answer, failed)
            acknowledged: Whether the call was acknowledged (DTMF 1 pressed)
            responder_phone: Phone number that was called
            dtmf_input: DTMF digits received (if any)
        
        Returns:
            Dict with should_escalate, next_action, and message
        """
        logger.info(f"Processing call outcome for event {event_id}: status={call_status}, ack={acknowledged}")
        
        if acknowledged:
            return {
                "should_escalate": False,
                "next_action": "send_details",
                "message": "Call acknowledged - sending event details via SMS",
                "status": "acknowledged",
            }
        
        if call_status in ["no-answer", "busy", "failed"]:
            return {
                "should_escalate": True,
                "next_action": "next_responder",
                "message": f"Call {call_status} - escalating to next responder",
                "status": call_status,
            }
        
        if call_status == "completed" and not acknowledged:
            return {
                "should_escalate": True,
                "next_action": "next_responder",
                "message": "Call completed but not acknowledged - escalating",
                "status": "no_ack",
            }
        
        return {
            "should_escalate": True,
            "next_action": "retry",
            "message": f"Unexpected call status: {call_status}",
            "status": call_status,
        }

    async def generate_voicemail_script(
        self,
        event_id: str,
        issue_description: str,
        escalation_level: int = 1,
    ) -> str:
        """
        Generate a script specifically for voicemail (when machine detected).
        
        This is a shorter version suitable for voicemail systems.
        """
        if self.enabled and self._script_agent:
            try:
                from agents import Runner
                
                prompt = (
                    f"Generate a brief voicemail message for an after-hours emergency.\n\n"
                    f"Issue: {issue_description}\n"
                    f"Escalation Level: {escalation_level}\n\n"
                    "Requirements:\n"
                    "- Maximum 25 words (~10 seconds)\n"
                    "- Start with 'Urgent message from after-hours support'\n"
                    "- Include callback instruction\n"
                    "- No DTMF instruction (this is voicemail)\n"
                )
                
                result = await Runner.run(self._script_agent, prompt)
                output: VoiceScriptOutput = result.final_output
                return output.script
            except Exception as e:
                logger.error(f"AI voicemail script generation failed: {str(e)}")
        
        # Template fallback
        short_issue = issue_description[:60] if issue_description else "urgent matter"
        return (
            f"Urgent message from after-hours support. "
            f"{short_issue}. "
            "Please call back immediately or respond via SMS."
        )

    def _generate_template_script(self, context: OutboundCallContext, time_str: str) -> str:
        """Generate a template-based script as fallback."""
        short_issue = context.issue_summary[:80] if context.issue_summary else "service request"
        
        greeting = ""
        if context.responder_name:
            greeting = f"Hello {context.responder_name}. "
        
        level_note = ""
        if context.escalation_level > 1:
            level_note = f"This is escalation level {context.escalation_level}. "
        
        return (
            f"{greeting}After-hours emergency received at {time_str}. "
            f"{level_note}"
            f"{short_issue}. "
            "Press 1 to acknowledge and take ownership."
        )


# Legacy alias for backward compatibility
VoiceAgent = VoiceAIAgent


# Singleton instance
_voice_agent_instance: Optional[VoiceAIAgent] = None


def get_voice_agent() -> VoiceAIAgent:
    """Get or create the singleton VoiceAIAgent instance."""
    global _voice_agent_instance
    if _voice_agent_instance is None:
        _voice_agent_instance = VoiceAIAgent()
    return _voice_agent_instance
