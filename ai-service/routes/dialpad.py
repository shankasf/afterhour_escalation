from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import logging

from ah_agents.dialpad_agent import DialpadAgent
from ah_agents.voicemail_analyzer_agent import get_voicemail_analyzer_agent
from ah_agents.escalation_orchestrator import (
    get_escalation_orchestrator,
    EventSource,
)
from services.dialpad_service import get_dialpad_service
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize services and agents
dialpad_agent = DialpadAgent()
dialpad_service = get_dialpad_service()
voicemail_analyzer = get_voicemail_analyzer_agent()
orchestrator = get_escalation_orchestrator()


class DialpadProcessRequest(BaseModel):
    phoneNumber: str
    transcription: Optional[str] = None


class VoicemailAnalyzeRequest(BaseModel):
    """Request to analyze a voicemail transcript."""
    transcription: str
    fromNumber: Optional[str] = None
    callId: Optional[str] = None


class VoicemailAnalyzeResponse(BaseModel):
    """Response from voicemail analysis."""
    emergencyScore: float
    shouldEscalate: bool
    reasoning: str
    context: Dict[str, Any]
    recommendedAction: str


@router.post("")
async def dialpad_webhook(request: Request):
    """
    Handle incoming Dialpad call event webhooks (inbound calls only).
    
    Dialpad call states we handle:
    - missed: Call was not answered -> escalate immediately
    - voicemail: Voicemail recording started
    - voicemail_uploaded: Voicemail recording completed  
    - transcription: Voicemail has been transcribed -> analyze and escalate
    
    Per design doc: All Dialpad events (missed calls, voicemails) trigger
    escalation - someone calling after hours is inherently urgent.
    """
    try:
        body = await request.body()
        body_str = body.decode("utf-8")
        
        # Try to decode JWT payload if Dialpad sends it that way
        payload = dialpad_service.decode_webhook_payload(body_str)
        
        if not payload:
            # Fallback to plain JSON
            payload = await request.json()
        
        # Parse into standardized event format
        event = dialpad_service.parse_call_event(payload)
        state = event.get("state", "")
        direction = event.get("direction", "")
        
        logger.info(f"Received Dialpad call event: state={state}, direction={direction}, call_id={event.get('call_id')}")
        
        # Only process inbound calls
        if direction != "inbound":
            logger.info(f"Ignoring outbound call event: {event.get('call_id')}")
            return {"success": True, "message": "Outbound call ignored"}
        
        # Check if this event should trigger escalation
        if not dialpad_service.should_escalate(event):
            logger.info(f"Call state '{state}' does not require escalation")
            return {"success": True, "message": f"State '{state}' logged but not escalated"}
        
        # Get transcription content for analysis
        transcription = event.get("transcription", "")
        from_number = event.get("external_number") or event.get("contact_phone")
        
        # Use multi-agent orchestrator for full processing
        triage_result = await orchestrator.process_event(
            event_type=state,
            content=transcription or f"Inbound call ({state}) - no voicemail transcript available",
            source=EventSource.DIALPAD,
            metadata={
                "from_number": from_number,
                "contact_name": event.get("contact_name"),
                "voicemail_url": event.get("voicemail_url"),
                "call_id": str(event.get("call_id")),
                "received_at": event.get("date_started"),
                "recordings": event.get("recordings"),
                "ai_summary": event.get("ai_summary"),
            },
        )
        
        # Post event to dashboard
        event_id = await dialpad_service.post_event_to_dashboard(event, triage_result)
        
        return {
            "success": True,
            "shouldEscalate": True,  # Dialpad inbound events always escalate
            "eventId": event_id,
            "callId": event.get("call_id"),
            "state": state,
            "triage": triage_result.get("triage", {}),
            "escalationContent": triage_result.get("escalation_content"),
            "afterHours": triage_result.get("after_hours", {}),
        }
        
    except Exception as e:
        logger.error(f"Dialpad webhook error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/call-event")
async def dialpad_call_event(request: Request):
    """
    Alternative endpoint for Dialpad call events with explicit state handling.
    
    This endpoint provides more granular control over which call states
    trigger processing.
    """
    return await dialpad_webhook(request)


@router.post("/process")
async def process_dialpad_event(request: DialpadProcessRequest):
    """
    Process a Dialpad event (called from backend).
    """
    try:
        result = await dialpad_agent.process_event(
            event_type="missed_call",
            from_number=request.phoneNumber,
            transcription=request.transcription
        )
        
        return {
            "shouldEscalate": True,
            "context": result.get("context", {})
        }
        
    except Exception as e:
        logger.error(f"Dialpad processing error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-voicemail", response_model=VoicemailAnalyzeResponse)
async def analyze_voicemail(request: VoicemailAnalyzeRequest):
    """
    Analyze a voicemail transcript using the AI voicemail analyzer agent.
    
    This endpoint uses the VoicemailAnalyzerAgent (OpenAI Agents SDK)
    to extract emergency context and provide scoring/recommendations.
    """
    try:
        logger.info(f"Analyzing voicemail from {request.fromNumber}")
        
        result = await voicemail_analyzer.analyze(
            transcription=request.transcription,
            from_number=request.fromNumber,
        )
        
        return VoicemailAnalyzeResponse(
            emergencyScore=result.get("emergency_score", 0.8),
            shouldEscalate=result.get("emergency_score", 0.8) >= 0.6,
            reasoning=result.get("reasoning", ""),
            context=result.get("context", {}),
            recommendedAction=result.get("recommended_action", "escalate"),
        )
        
    except Exception as e:
        logger.error(f"Voicemail analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
