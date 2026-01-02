from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import logging

from ah_agents.escalation_agent import EscalationAgent
from ah_agents.voice_agent import VoiceAIAgent, get_voice_agent
from ah_agents.sms_agent import SmsAgent
from ah_agents.escalation_orchestrator import (
    get_escalation_orchestrator,
    EventSource,
    ESCALATION_LADDER,
)
from services.twilio_service import TwilioService
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

escalation_agent = EscalationAgent()
voice_agent = get_voice_agent()  # Use singleton VoiceAIAgent
sms_agent = SmsAgent()
twilio_service = TwilioService()
orchestrator = get_escalation_orchestrator()


class EscalateRequest(BaseModel):
    eventId: str
    escalationLogId: str
    contact: Dict[str, str]  # {name, phone}
    event: Dict[str, Any]


class EscalateResponse(BaseModel):
    success: bool
    callSid: Optional[str] = None
    smsSid: Optional[str] = None
    error: Optional[str] = None


class VoiceGenerateRequest(BaseModel):
    eventId: str
    issueDescription: str
    receivedAt: str


class SmsGenerateRequest(BaseModel):
    eventId: str
    issueDescription: str
    receivedAt: str


class OrchestratedEscalateRequest(BaseModel):
    """Request for full orchestrated escalation."""
    eventId: str
    escalationLogId: str
    contact: Dict[str, str]  # {name, phone}
    issueDescription: str
    receivedAt: Optional[str] = None
    source: Optional[str] = "email"  # email, dialpad, manual


@router.post("", response_model=EscalateResponse)
async def send_escalation(request: EscalateRequest):
    """
    Send escalation (call + SMS) to a contact.
    """
    try:
        contact_name = request.contact.get("name", "On-call staff")
        contact_phone = request.contact.get("phone")
        
        if not contact_phone:
            raise HTTPException(status_code=400, detail="Contact phone required")
        
        logger.info(f"Sending escalation to {contact_name} ({contact_phone}) for event {request.eventId}")
        
        # Extract issue description from event
        event = request.event
        issue_description = event.get("subject") or event.get("body") or "After-hours emergency"
        received_at = event.get("receivedAt", "")
        
        # Generate voice message
        voice_result = await voice_agent.generate_message(
            event_id=request.eventId,
            issue_description=issue_description,
            received_at=received_at
        )
        
        # Generate SMS message  
        sms_result = await sms_agent.generate_message(
            event_id=request.eventId,
            issue_description=issue_description,
            received_at=received_at
        )
        
        # Send call and SMS simultaneously
        call_sid = None
        sms_sid = None
        
        try:
            # Make call
            call_result = await twilio_service.make_call(
                to_number=contact_phone,
                event_id=request.eventId,
                escalation_log_id=request.escalationLogId,
                voice_script=voice_result["script"]
            )
            call_sid = call_result.get("sid")
        except Exception as e:
            logger.error(f"Call failed: {str(e)}")
        
        try:
            # Send SMS
            sms_result = await twilio_service.send_sms(
                to_number=contact_phone,
                message=sms_result["message"],
                event_id=request.eventId
            )
            sms_sid = sms_result.get("sid")
        except Exception as e:
            logger.error(f"SMS failed: {str(e)}")
        
        if not call_sid and not sms_sid:
            return EscalateResponse(
                success=False,
                error="Both call and SMS failed"
            )
        
        return EscalateResponse(
            success=True,
            callSid=call_sid,
            smsSid=sms_sid
        )
        
    except Exception as e:
        logger.error(f"Escalation failed: {str(e)}")
        return EscalateResponse(
            success=False,
            error=str(e)
        )


@router.post("/orchestrated", response_model=EscalateResponse)
async def orchestrated_escalation(request: OrchestratedEscalateRequest):
    """
    Send escalation using multi-agent orchestrator for content generation.
    
    This endpoint uses the EscalationOrchestrator to generate optimized
    voice scripts and SMS messages based on the full event context.
    """
    try:
        contact_name = request.contact.get("name", "On-call staff")
        contact_phone = request.contact.get("phone")
        
        if not contact_phone:
            raise HTTPException(status_code=400, detail="Contact phone required")
        
        logger.info(f"Orchestrated escalation to {contact_name} for event {request.eventId}")
        
        # Map source string to EventSource enum
        source_map = {
            "email": EventSource.EMAIL,
            "dialpad": EventSource.DIALPAD,
            "manual": EventSource.MANUAL,
        }
        source = source_map.get(request.source, EventSource.EMAIL)
        
        # Use orchestrator to get triage and content
        orch_result = await orchestrator.process_event(
            event_type="escalation",
            content=request.issueDescription,
            source=source,
            metadata={"received_at": request.receivedAt},
        )
        
        escalation_content = orch_result.get("escalation_content", {})
        voice_script = escalation_content.get("voice_script", "")
        sms_message = escalation_content.get("sms_message", "")
        
        # Fallback to individual agents if orchestrator content is empty
        if not voice_script:
            voice_result = await voice_agent.generate_message(
                event_id=request.eventId,
                issue_description=request.issueDescription,
                received_at=request.receivedAt or ""
            )
            voice_script = voice_result["script"]
        
        if not sms_message:
            sms_result = await sms_agent.generate_message(
                event_id=request.eventId,
                issue_description=request.issueDescription,
                received_at=request.receivedAt or ""
            )
            sms_message = sms_result["message"]
        
        # Send call and SMS simultaneously
        call_sid = None
        sms_sid = None
        
        try:
            call_result = await twilio_service.make_call(
                to_number=contact_phone,
                event_id=request.eventId,
                escalation_log_id=request.escalationLogId,
                voice_script=voice_script
            )
            call_sid = call_result.get("sid")
        except Exception as e:
            logger.error(f"Call failed: {str(e)}")
        
        try:
            sms_result = await twilio_service.send_sms(
                to_number=contact_phone,
                message=sms_message,
                event_id=request.eventId
            )
            sms_sid = sms_result.get("sid")
        except Exception as e:
            logger.error(f"SMS failed: {str(e)}")
        
        if not call_sid and not sms_sid:
            return EscalateResponse(
                success=False,
                error="Both call and SMS failed"
            )
        
        return EscalateResponse(
            success=True,
            callSid=call_sid,
            smsSid=sms_sid
        )
        
    except Exception as e:
        logger.error(f"Orchestrated escalation failed: {str(e)}")
        return EscalateResponse(
            success=False,
            error=str(e)
        )


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
    
    Uses Twilio-optimized VoiceAIAgent to create natural TTS scripts.
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
    - Source-specific messaging (email, dialpad)
    
    All outbound calls are powered by Twilio with TwiML voice.
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
    
    Used when Twilio detects an answering machine/voicemail.
    """
    try:
        # Get escalation level from event context if available
        escalation_level = 1  # Default
        
        script = await voice_agent.generate_voicemail_script(
            event_id=request.eventId,
            issue_description=request.issueDescription,
            escalation_level=escalation_level,
        )
        
        return {"script": script}
        
    except Exception as e:
        logger.error(f"Voicemail script generation failed: {str(e)}")
        # Return template fallback
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
        # Return default message on failure
        return {
            "message": f"After-Hours Emergency – service request received. Reply ACK to accept."
        }
