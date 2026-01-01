from fastapi import APIRouter, Request, Form, HTTPException
from fastapi.responses import Response
import logging
import httpx
from twilio.twiml.voice_response import VoiceResponse, Gather
from twilio.request_validator import RequestValidator

from config import get_settings
from agents.ack_monitor_agent import AckMonitorAgent

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

ack_monitor = AckMonitorAgent()


def create_twiml_response(content: str) -> Response:
    """Create a TwiML response."""
    return Response(content=content, media_type="application/xml")


@router.post("/voice")
async def handle_voice_call(request: Request):
    """
    Handle outbound voice call - provide TwiML instructions.
    """
    form_data = await request.form()
    event_id = form_data.get("event_id") or request.query_params.get("event_id")
    script = form_data.get("script") or request.query_params.get("script", 
        "After-hours emergency received. Press 1 to acknowledge and take ownership.")
    
    logger.info(f"Voice call initiated for event {event_id}")
    
    response = VoiceResponse()
    
    # Use Gather to capture DTMF input
    gather = Gather(
        num_digits=1,
        action=f"/twilio/voice/gather?event_id={event_id}",
        method="POST",
        timeout=10
    )
    gather.say(script, voice="alice")
    response.append(gather)
    
    # If no input, repeat
    response.say("We didn't receive any input. Goodbye.", voice="alice")
    
    return create_twiml_response(str(response))


@router.post("/voice/gather")
async def handle_voice_gather(
    request: Request,
    Digits: str = Form(None),
):
    """
    Handle DTMF input from voice call.
    """
    form_data = await request.form()
    event_id = request.query_params.get("event_id")
    called = form_data.get("Called")
    caller = form_data.get("From")
    
    logger.info(f"Voice gather - Event: {event_id}, Digits: {Digits}")
    
    response = VoiceResponse()
    
    if Digits == "1":
        # Acknowledgment received
        try:
            await ack_monitor.process_voice_ack(
                event_id=event_id,
                phone_number=caller or called
            )
            response.say(
                "Thank you. You have acknowledged this emergency and taken ownership. "
                "You will receive further details via SMS.",
                voice="alice"
            )
        except Exception as e:
            logger.error(f"Failed to process voice ACK: {str(e)}")
            response.say("There was an error processing your acknowledgment. Please try again.", voice="alice")
    else:
        response.say("Invalid input. Goodbye.", voice="alice")
    
    return create_twiml_response(str(response))


@router.post("/voice/status")
async def handle_voice_status(request: Request):
    """
    Handle call status callbacks from Twilio.
    """
    form_data = await request.form()
    call_sid = form_data.get("CallSid")
    call_status = form_data.get("CallStatus")
    event_id = request.query_params.get("event_id")
    escalation_log_id = request.query_params.get("escalation_log_id")
    
    logger.info(f"Call status update - SID: {call_sid}, Status: {call_status}")
    
    # Notify backend of status change
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{settings.backend_url}/api/escalation/call-status",
                json={
                    "callSid": call_sid,
                    "status": call_status,
                    "eventId": event_id,
                    "escalationLogId": escalation_log_id
                }
            )
    except Exception as e:
        logger.error(f"Failed to notify backend of call status: {str(e)}")
    
    return {"success": True}


@router.post("/sms")
async def handle_incoming_sms(request: Request):
    """
    Handle incoming SMS messages (for ACK responses).
    """
    form_data = await request.form()
    from_number = form_data.get("From")
    body = form_data.get("Body", "").strip()
    
    logger.info(f"Incoming SMS from {from_number}: {body}")
    
    response = VoiceResponse()  # Using VoiceResponse for MessagingResponse
    from twilio.twiml.messaging_response import MessagingResponse
    response = MessagingResponse()
    
    # Check if this is an ACK message
    if await ack_monitor.is_acknowledgment(body):
        try:
            result = await ack_monitor.process_sms_ack(
                phone_number=from_number,
                message=body
            )
            
            if result["success"]:
                response.message(
                    "Acknowledged. You have taken ownership of this emergency. "
                    "Reply DOWNGRADE if this is not an emergency."
                )
            else:
                response.message(
                    "Could not find an active escalation for your number. "
                    "Please contact the admin if this is urgent."
                )
        except Exception as e:
            logger.error(f"Failed to process SMS ACK: {str(e)}")
            response.message("Error processing acknowledgment. Please try again.")
    
    elif body.upper() == "DOWNGRADE":
        try:
            result = await ack_monitor.process_downgrade(phone_number=from_number)
            if result["success"]:
                response.message("Event has been downgraded to non-emergency status.")
            else:
                response.message("Could not process downgrade request.")
        except Exception as e:
            logger.error(f"Failed to process downgrade: {str(e)}")
            response.message("Error processing downgrade. Please contact admin.")
    
    else:
        # Unrecognized message
        response.message(
            "Reply ACK to acknowledge an emergency, or DOWNGRADE to mark as non-emergency."
        )
    
    return create_twiml_response(str(response))


@router.post("/sms/status")
async def handle_sms_status(request: Request):
    """
    Handle SMS delivery status callbacks.
    """
    form_data = await request.form()
    message_sid = form_data.get("MessageSid")
    message_status = form_data.get("MessageStatus")
    event_id = request.query_params.get("event_id")
    
    logger.info(f"SMS status update - SID: {message_sid}, Status: {message_status}")
    
    # Notify backend
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{settings.backend_url}/api/escalation/sms-status",
                json={
                    "smsSid": message_sid,
                    "status": message_status,
                    "eventId": event_id
                }
            )
    except Exception as e:
        logger.error(f"Failed to notify backend of SMS status: {str(e)}")
    
    return {"success": True}
