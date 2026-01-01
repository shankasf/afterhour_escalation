from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel
from typing import Optional
import logging
import hmac
import hashlib

from agents.dialpad_agent import DialpadAgent
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

dialpad_agent = DialpadAgent()


class DialpadProcessRequest(BaseModel):
    phoneNumber: str
    transcription: Optional[str] = None


class DialpadWebhookPayload(BaseModel):
    event_type: str
    call_id: Optional[str] = None
    from_number: Optional[str] = None
    to_number: Optional[str] = None
    voicemail_url: Optional[str] = None
    transcription: Optional[str] = None
    timestamp: Optional[str] = None


def verify_dialpad_signature(payload: bytes, signature: str) -> bool:
    """Verify Dialpad webhook signature."""
    if not settings.dialpad_webhook_secret:
        return True  # Skip verification if no secret configured
    
    expected = hmac.new(
        settings.dialpad_webhook_secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(expected, signature)


@router.post("")
async def dialpad_webhook(
    request: Request,
    x_dialpad_signature: Optional[str] = Header(None)
):
    """
    Handle incoming Dialpad webhooks for missed calls and voicemails.
    """
    try:
        body = await request.body()
        
        # Verify signature
        if x_dialpad_signature and not verify_dialpad_signature(body, x_dialpad_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")
        
        payload = await request.json()
        logger.info(f"Received Dialpad webhook: {payload.get('event_type')}")
        
        event_type = payload.get("event_type", "")
        
        if event_type in ["missed_call", "voicemail"]:
            result = await dialpad_agent.process_event(
                event_type=event_type,
                from_number=payload.get("from_number"),
                transcription=payload.get("transcription"),
                voicemail_url=payload.get("voicemail_url")
            )
            
            return {
                "success": True,
                "shouldEscalate": True,  # Dialpad events always escalate
                "eventId": result.get("event_id"),
                "context": result.get("context", {})
            }
        
        return {"success": True, "message": "Event type not handled"}
        
    except Exception as e:
        logger.error(f"Dialpad webhook error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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
