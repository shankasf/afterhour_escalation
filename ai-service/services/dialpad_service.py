"""Dialpad API Service for inbound call handling.

Dialpad is used for INBOUND calls only:
- Missed calls trigger escalation
- Voicemails are transcribed and analyzed by multi-agent system
- Events are posted to dashboard for tracking

Per Dialpad API docs:
- Call events: ringing, connected, missed, voicemail, voicemail_uploaded, transcription, hangup
- Voicemail transcription available in 'transcription_text' field
- Recording URLs in 'recording_details' list
"""

import logging
import hmac
import hashlib
import base64
from typing import Dict, Any, Optional, List
from datetime import datetime
import json

import httpx
import jwt

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class DialpadService:
    """Service for interacting with Dialpad API and processing webhooks.
    
    Dialpad handles all INBOUND calls. When calls are missed or go to voicemail,
    this service processes the events and triggers the multi-agent system.
    """

    def __init__(self):
        self.api_key = settings.dialpad_api_key
        self.webhook_secret = settings.dialpad_webhook_secret
        self.base_url = "https://dialpad.com/api/v2"
        self.enabled = bool(self.api_key)
        
        if self.enabled:
            logger.info("Dialpad service initialized for inbound call handling")
        else:
            logger.warning("Dialpad API key not configured - inbound call handling disabled")

    def verify_webhook(self, payload: bytes, signature: str) -> bool:
        """Verify Dialpad webhook signature (JWT format).
        
        Dialpad sends events as JWT tokens signed with a shared secret.
        """
        if not self.webhook_secret:
            logger.warning("No webhook secret configured - skipping verification")
            return True

        try:
            # Dialpad uses HMAC-SHA256 for signing JWTs
            decoded = jwt.decode(
                payload.decode() if isinstance(payload, bytes) else payload,
                self.webhook_secret,
                algorithms=["HS256"]
            )
            return True
        except jwt.InvalidTokenError as e:
            logger.error(f"JWT verification failed: {e}")
            return False

    def decode_webhook_payload(self, payload: str) -> Dict[str, Any]:
        """Decode a JWT-encoded webhook payload.
        
        Dialpad sends events in JWT format for security.
        """
        if not self.webhook_secret:
            # If no secret, try to parse as plain JSON
            try:
                return json.loads(payload)
            except json.JSONDecodeError:
                return {}

        try:
            decoded = jwt.decode(
                payload,
                self.webhook_secret,
                algorithms=["HS256"]
            )
            return decoded
        except jwt.InvalidTokenError:
            # Fallback to plain JSON if not JWT
            try:
                return json.loads(payload)
            except json.JSONDecodeError:
                return {}

    def parse_call_event(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a Dialpad call event into a standardized format.
        
        Dialpad call states we care about:
        - missed: Call was not answered
        - voicemail: Voicemail recording started
        - voicemail_uploaded: Voicemail recording completed
        - transcription: Voicemail has been transcribed
        """
        state = payload.get("state", "")
        
        event = {
            "call_id": payload.get("call_id"),
            "state": state,
            "direction": payload.get("direction"),  # inbound/outbound
            "external_number": payload.get("external_number"),
            "internal_number": payload.get("internal_number"),
            "timestamp": payload.get("event_timestamp"),
            "date_started": payload.get("date_started"),
            "date_rang": payload.get("date_rang"),
            "date_ended": payload.get("date_ended"),
            "duration": payload.get("duration"),
            "total_duration": payload.get("total_duration"),
        }

        # Contact info (external party)
        contact = payload.get("contact", {})
        if contact:
            event["contact_name"] = contact.get("name")
            event["contact_phone"] = contact.get("phone")
            event["contact_email"] = contact.get("email")

        # Target info (internal party - our side)
        target = payload.get("target", {})
        if target:
            event["target_name"] = target.get("name")
            event["target_phone"] = target.get("phone")
            event["target_type"] = target.get("type")

        # Voicemail transcription
        if payload.get("transcription_text"):
            event["transcription"] = payload["transcription_text"]

        # Voicemail/recording URLs
        if payload.get("voicemail_link"):
            event["voicemail_url"] = payload["voicemail_link"]
            
        recordings = payload.get("recording_details", [])
        if recordings:
            event["recordings"] = [
                {
                    "id": r.get("id"),
                    "url": r.get("url"),
                    "duration": r.get("duration"),
                    "type": r.get("recording_type"),
                }
                for r in recordings
            ]

        # AI Recap (if available)
        if payload.get("recap_summary"):
            event["ai_summary"] = payload["recap_summary"]
        if payload.get("recap_action_items"):
            event["ai_action_items"] = payload["recap_action_items"]

        return event

    def should_escalate(self, event: Dict[str, Any]) -> bool:
        """Determine if a Dialpad event should trigger escalation.
        
        Per design doc: All Dialpad events (missed calls, voicemails) 
        should trigger escalation - someone calling after hours is urgent.
        """
        state = event.get("state", "")
        direction = event.get("direction", "")
        
        # Only escalate inbound calls
        if direction != "inbound":
            return False

        # States that should trigger escalation
        escalation_states = {"missed", "voicemail", "voicemail_uploaded", "transcription"}
        
        return state in escalation_states

    async def get_call_details(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Fetch detailed call information from Dialpad API."""
        if not self.enabled:
            return None

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/calls/{call_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=10.0
                )
                if response.status_code == 200:
                    return response.json()
        except Exception as e:
            logger.error(f"Failed to get call details: {e}")
        
        return None

    async def get_voicemail_transcription(self, call_id: str) -> Optional[str]:
        """Fetch voicemail transcription for a call."""
        details = await self.get_call_details(call_id)
        if details:
            return details.get("transcription_text")
        return None

    async def get_recording_url(self, call_id: str) -> Optional[str]:
        """Get the recording URL for a call."""
        details = await self.get_call_details(call_id)
        if details:
            recordings = details.get("recording_details", [])
            for rec in recordings:
                if rec.get("recording_type") == "voicemail":
                    return rec.get("url")
            # Return first recording if no voicemail-specific one
            if recordings:
                return recordings[0].get("url")
        return None

    async def post_event_to_dashboard(
        self,
        event: Dict[str, Any],
        triage_result: Dict[str, Any]
    ) -> Optional[str]:
        """Post the processed event to the backend dashboard.
        
        Returns the created event ID.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{settings.backend_url}/api/events/dialpad",
                    json={
                        "callId": str(event.get("call_id")),
                        "state": event.get("state"),
                        "senderPhone": event.get("external_number") or event.get("contact_phone"),
                        "senderName": event.get("contact_name"),
                        "receivedAt": datetime.fromtimestamp(
                            event.get("timestamp", 0) / 1000
                        ).isoformat() if event.get("timestamp") else datetime.now().isoformat(),
                        "voicemailTranscription": event.get("transcription"),
                        "voicemailUrl": event.get("voicemail_url"),
                        "emergencyScore": triage_result.get("emergency_score", 0.8),
                        "priority": triage_result.get("triage", {}).get("priority", "high"),
                        "triageReasoning": triage_result.get("triage", {}).get("reasoning", ""),
                        "issueSummary": triage_result.get("triage", {}).get("issue_summary", ""),
                        "source": "dialpad",
                        "direction": "inbound",
                    },
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=15.0
                )
                
                if response.status_code in (200, 201):
                    data = response.json()
                    logger.info(f"Event posted to dashboard: {data.get('id')}")
                    return data.get("id")
                else:
                    logger.error(f"Failed to post event: {response.status_code}")
                    
        except Exception as e:
            logger.error(f"Failed to post event to dashboard: {e}")
        
        return None


# Singleton instance
_dialpad_service: Optional[DialpadService] = None


def get_dialpad_service() -> DialpadService:
    """Get or create the singleton DialpadService instance."""
    global _dialpad_service
    if _dialpad_service is None:
        _dialpad_service = DialpadService()
    return _dialpad_service
