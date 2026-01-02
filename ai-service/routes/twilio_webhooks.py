from fastapi import APIRouter, Request, Form, HTTPException
from fastapi.responses import Response
import logging
import httpx
from twilio.twiml.voice_response import VoiceResponse, Gather
from twilio.request_validator import RequestValidator

from config import get_settings
from ah_agents.ack_monitor_agent import AckMonitorAgent
from ah_agents.voice_agent import get_voice_agent

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

ack_monitor = AckMonitorAgent()
voice_agent = get_voice_agent()


def create_twiml_response(content: str) -> Response:
    """Create a TwiML response."""
    return Response(content=content, media_type="application/xml")


@router.post("/voice")
async def handle_voice_call(request: Request):
    """
    Handle outbound voice call - provide TwiML instructions.
    
    All outbound calls are powered by Twilio. This endpoint returns TwiML
    that instructs Twilio how to conduct the call.
    """
    form_data = await request.form()
    event_id = form_data.get("event_id") or request.query_params.get("event_id")
    script = form_data.get("script") or request.query_params.get("script", 
        "After-hours emergency received. Press 1 to acknowledge and take ownership.")
    answered_by = form_data.get("AnsweredBy")  # Machine detection result
    
    # Outbound-only guard: if a random inbound call hits this webhook without context,
    # tell the caller this number is outbound-only and exit.
    if not event_id:
        logger.info("Received voice webhook without event_id; treating as inbound and rejecting.")
        response = VoiceResponse()
        response.say(
            "This number is for outbound notifications only. Please contact the main support line for help.",
            voice="alice",
        )
        return create_twiml_response(str(response))

    logger.info(f"Voice call initiated for event {event_id}, answered_by={answered_by}")
    
    response = VoiceResponse()
    
    # Handle machine/voicemail detection
    if answered_by in ["machine_start", "machine_end_beep", "machine_end_silence", "fax"]:
        logger.info(f"Voicemail detected for event {event_id}")
        # Generate shorter voicemail-specific message
        try:
            vm_script = await voice_agent.generate_voicemail_script(
                event_id=event_id,
                issue_description=script[:100],  # Use part of original script as description
                escalation_level=1,
            )
            response.say(vm_script, voice="alice")
        except Exception as e:
            logger.error(f"Voicemail script generation failed: {e}")
            response.say(
                "Urgent message from after-hours support. Please call back immediately.",
                voice="alice"
            )
        return create_twiml_response(str(response))
    
    # Normal call - use Gather to capture DTMF input
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

    if not event_id:
        response = VoiceResponse()
        response.say(
            "This number is for outbound notifications only. Please contact the main support line for help.",
            voice="alice",
        )
        return create_twiml_response(str(response))
    
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
                },
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0
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
                },
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0
            )
    except Exception as e:
        logger.error(f"Failed to notify backend of SMS status: {str(e)}")
    
    return {"success": True}
