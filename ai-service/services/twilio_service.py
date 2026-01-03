from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from urllib.parse import urlencode, quote
import logging
from typing import Optional, Dict, Any

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class TwilioService:
    """Service for handling Twilio calls and SMS."""
    
    def __init__(self):
        self.client = None
        self.enabled = False
        self._initialize()
    
    def _initialize(self):
        """Initialize Twilio client if credentials are available."""
        if settings.twilio_account_sid and settings.twilio_auth_token:
            try:
                self.client = Client(
                    settings.twilio_account_sid,
                    settings.twilio_auth_token
                )
                self.enabled = True
                logger.info("Twilio service initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Twilio: {str(e)}")
                self.enabled = False
        else:
            logger.warning("Twilio credentials not configured - service disabled")
            self.enabled = False
    
    async def make_call(
        self,
        to_number: str,
        event_id: str,
        escalation_log_id: str,
        voice_script: str
    ) -> Dict[str, Any]:
        """
        Make an outbound call using Twilio.
        
        Args:
            to_number: Phone number to call
            event_id: Event ID for tracking
            escalation_log_id: Escalation log ID for tracking
            voice_script: Script to be spoken during the call
        
        Returns:
            Dict with call SID and status
        """
        if not self.enabled:
            logger.warning("[TWILIO] Not enabled - simulating call")
            return {
                "sid": f"SIMULATED_CALL_{event_id}",
                "status": "simulated",
                "simulated": True
            }
        
        logger.info("="*60)
        logger.info("[TWILIO] Initiating outbound call")
        logger.info(f"  Event ID: {event_id}")
        logger.info(f"  Escalation Log ID: {escalation_log_id}")
        logger.info(f"  Original To Number: {to_number}")
        
        try:
            # Use override number if configured (for testing)
            actual_to_number = settings.escalation_override_number or to_number
            if settings.escalation_override_number:
                logger.info(f"  [OVERRIDE] Using test number: {actual_to_number}")
            else:
                logger.info(f"  Calling: {actual_to_number}")
            logger.info(f"  From Number: {settings.twilio_phone_number}")
            logger.info(f"  Voice Script: {voice_script[:80]}..." if len(voice_script) > 80 else f"  Voice Script: {voice_script}")
            
            # Build webhook URL with parameters - URL encode the script
            webhook_base = settings.twilio_webhook_url or f"{settings.backend_url}/twilio"
            # Use urlencode for proper URL encoding of parameters
            # Voice scripts should be ~35-40 words (~250-300 chars) per design spec
            params = urlencode({
                'event_id': event_id,
                'script': voice_script[:500]  # Allow full script up to 500 chars
            })
            voice_url = f"{webhook_base}/voice?{params}"
            status_callback = f"{webhook_base}/voice/status?event_id={event_id}&escalation_log_id={escalation_log_id}"
            
            call = self.client.calls.create(
                to=actual_to_number,
                from_=settings.twilio_phone_number,
                url=voice_url,
                status_callback=status_callback,
                status_callback_event=["initiated", "ringing", "answered", "completed"],
                status_callback_method="POST",
                timeout=30,  # 30 seconds to answer
                machine_detection="Enable",  # Detect voicemail
            )
            
            logger.info(f"[TWILIO] Call initiated successfully")
            logger.info(f"  Call SID: {call.sid}")
            logger.info(f"  Status: {call.status}")
            logger.info("="*60)
            
            return {
                "sid": call.sid,
                "status": call.status,
                "simulated": False
            }
            
        except TwilioRestException as e:
            logger.error(f"Twilio call failed: {e.msg}")
            raise Exception(f"Call failed: {e.msg}")
        except Exception as e:
            logger.error(f"Unexpected error making call: {str(e)}")
            raise
    
    async def send_sms(
        self,
        to_number: str,
        message: str,
        event_id: str
    ) -> Dict[str, Any]:
        """
        Send an SMS using Twilio.
        
        Args:
            to_number: Phone number to send SMS to
            message: SMS message content
            event_id: Event ID for tracking
        
        Returns:
            Dict with message SID and status
        """
        if not self.enabled:
            logger.warning("[TWILIO] Not enabled - simulating SMS")
            return {
                "sid": f"SIMULATED_SMS_{event_id}",
                "status": "simulated",
                "simulated": True
            }
        
        logger.info("="*60)
        logger.info("[TWILIO] Sending SMS")
        logger.info(f"  Event ID: {event_id}")
        logger.info(f"  Original To Number: {to_number}")
        
        try:
            # Use override number if configured (for testing)
            actual_to_number = settings.escalation_override_number or to_number
            if settings.escalation_override_number:
                logger.info(f"  [OVERRIDE] Using test number: {actual_to_number}")
            else:
                logger.info(f"  Sending to: {actual_to_number}")
            logger.info(f"  Message: {message[:100]}..." if len(message) > 100 else f"  Message: {message}")
            
            # Build status callback URL
            webhook_base = settings.twilio_webhook_url or f"{settings.backend_url}/twilio"
            status_callback = f"{webhook_base}/sms/status?event_id={event_id}"
            
            sms = self.client.messages.create(
                to=actual_to_number,
                from_=settings.twilio_phone_number,
                body=message,
                status_callback=status_callback,
            )
            
            logger.info(f"[TWILIO] SMS sent successfully")
            logger.info(f"  Message SID: {sms.sid}")
            logger.info(f"  Status: {sms.status}")
            logger.info("="*60)
            
            return {
                "sid": sms.sid,
                "status": sms.status,
                "simulated": False
            }
            
        except TwilioRestException as e:
            logger.error(f"Twilio SMS failed: {e.msg}")
            raise Exception(f"SMS failed: {e.msg}")
        except Exception as e:
            logger.error(f"Unexpected error sending SMS: {str(e)}")
            raise
    
    async def get_call_status(self, call_sid: str) -> Optional[str]:
        """Get the status of a call."""
        if not self.enabled or call_sid.startswith("SIMULATED"):
            return "simulated"
        
        try:
            call = self.client.calls(call_sid).fetch()
            return call.status
        except Exception as e:
            logger.error(f"Failed to get call status: {str(e)}")
            return None
    
    async def get_sms_status(self, message_sid: str) -> Optional[str]:
        """Get the status of an SMS."""
        if not self.enabled or message_sid.startswith("SIMULATED"):
            return "simulated"
        
        try:
            message = self.client.messages(message_sid).fetch()
            return message.status
        except Exception as e:
            logger.error(f"Failed to get SMS status: {str(e)}")
            return None
    
    def is_enabled(self) -> bool:
        """Check if Twilio service is enabled."""
        return self.enabled
