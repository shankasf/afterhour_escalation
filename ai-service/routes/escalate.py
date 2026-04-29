from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import logging

from ah_agents.voice_agent import VoiceAIAgent, get_voice_agent
from ah_agents.sms_agent import SmsAgent
from ah_agents.escalation_orchestrator import (
    get_escalation_orchestrator,
    EventSource,
    ESCALATION_LADDER,
)
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

voice_agent = get_voice_agent()  # Use singleton VoiceAIAgent
sms_agent = SmsAgent()
orchestrator = get_escalation_orchestrator()


class VoiceGenerateRequest(BaseModel):
    eventId: str
    issueDescription: str
    receivedAt: str


class SmsGenerateRequest(BaseModel):
    eventId: str
    issueDescription: str
    receivedAt: str


class OrchestratedTriageRequest(BaseModel):
    """Request to run multi-agent orchestrator triage and content generation."""
    eventId: str
    issueDescription: str
    receivedAt: Optional[str] = None
    source: Optional[str] = "email"  # email, chat, manual


@router.post("/orchestrated")
async def orchestrated_triage(request: OrchestratedTriageRequest):
    """
    Run multi-agent orchestrator triage + content generation for an event.

    Returns the orchestrator decision (should_escalate, triage, escalation_content).
    Outreach is dispatched by the LangGraph workflow, not from this endpoint.
    """
    try:
        source_map = {
            "email": EventSource.EMAIL,
            "chat": EventSource.CHAT,
            "manual": EventSource.MANUAL,
        }
        source = source_map.get(request.source, EventSource.EMAIL)

        result = await orchestrator.process_event(
            event_type="escalation",
            content=request.issueDescription,
            source=source,
            metadata={"received_at": request.receivedAt},
        )
        return result
    except Exception as e:
        logger.error(f"Orchestrated triage failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ladder")
async def get_escalation_ladder():
    """
    Get the current escalation ladder configuration.

    Returns the ordered list of escalation levels with roles and timeouts.
    """
    return {
        "ladder": ESCALATION_LADDER,
        "description": "Escalation proceeds through levels in order until acknowledged",
    }


class EnhancedVoiceRequest(BaseModel):
    """Enhanced voice generation request with escalation context."""
    eventId: str
    issueDescription: str
    receivedAt: Optional[str] = None
    responderName: Optional[str] = None
    escalationLevel: int = 1
    sourceType: str = "email"


@router.post("/voice/generate")
async def generate_voice_message(request: VoiceGenerateRequest):
    """
    Generate voice message for an escalation.
    """
    try:
        result = await voice_agent.generate_message(
            event_id=request.eventId,
            issue_description=request.issueDescription,
            received_at=request.receivedAt
        )

        return {
            "script": result["script"],
            "audioUrl": result.get("audio_url"),
            "generatedBy": result.get("generated_by", "template"),
            "urgencyLevel": result.get("urgency_level", "high"),
        }

    except Exception as e:
        logger.error(f"Voice generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/voice/generate-enhanced")
async def generate_enhanced_voice_message(request: EnhancedVoiceRequest):
    """
    Generate enhanced voice message with full escalation context.

    This endpoint uses the full VoiceAIAgent capabilities including:
    - Responder name personalization
    - Escalation level awareness
    - Source-specific messaging (email, chat)
    """
    try:
        result = await voice_agent.generate_message(
            event_id=request.eventId,
            issue_description=request.issueDescription,
            received_at=request.receivedAt or "",
            responder_name=request.responderName,
            escalation_level=request.escalationLevel,
            source_type=request.sourceType,
        )

        return {
            "script": result["script"],
            "audioUrl": result.get("audio_url"),
            "generatedBy": result.get("generated_by", "template"),
            "urgencyLevel": result.get("urgency_level", "high"),
            "estimatedDuration": result.get("estimated_duration", 15),
        }

    except Exception as e:
        logger.error(f"Enhanced voice generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/voice/voicemail")
async def generate_voicemail_script(request: VoiceGenerateRequest):
    """
    Generate a voicemail-specific script (shorter, no DTMF instruction).
    """
    try:
        escalation_level = 1  # Default

        script = await voice_agent.generate_voicemail_script(
            event_id=request.eventId,
            issue_description=request.issueDescription,
            escalation_level=escalation_level,
        )

        return {"script": script}

    except Exception as e:
        logger.error(f"Voicemail script generation failed: {str(e)}")
        return {
            "script": f"Urgent message from after-hours support. {request.issueDescription[:60]}. Please call back immediately."
        }


@router.post("/sms/generate")
async def generate_sms_message(request: SmsGenerateRequest):
    """
    Generate SMS message for an escalation.
    """
    try:
        result = await sms_agent.generate_message(
            event_id=request.eventId,
            issue_description=request.issueDescription,
            received_at=request.receivedAt
        )

        return {"message": result["message"]}

    except Exception as e:
        logger.error(f"SMS generation failed: {str(e)}")
        return {
            "message": f"After-Hours Emergency – service request received. Reply ACK to accept."
        }
