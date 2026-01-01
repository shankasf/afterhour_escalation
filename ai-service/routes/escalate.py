from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import logging

from agents.escalation_agent import EscalationAgent
from agents.voice_agent import VoiceAgent
from agents.sms_agent import SmsAgent
from services.twilio_service import TwilioService
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

escalation_agent = EscalationAgent()
voice_agent = VoiceAgent()
sms_agent = SmsAgent()
twilio_service = TwilioService()


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
            "audioUrl": result.get("audio_url")
        }
        
    except Exception as e:
        logger.error(f"Voice generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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
