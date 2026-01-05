from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from pydantic import BaseModel

from config import get_settings
from . import function_tool

logger = logging.getLogger(__name__)
settings = get_settings()


class DialpadTranscriptionOutput(BaseModel):
    transcription: Optional[str] = None
    success: bool = True
    error: Optional[str] = None


class CreateDialpadEventOutput(BaseModel):
    event_id: Optional[str] = None
    success: bool = True
    error: Optional[str] = None


@function_tool
async def fetch_dialpad_transcription(voicemail_url: str) -> DialpadTranscriptionOutput:
    """Fetch voicemail transcription from Dialpad (if enabled)."""
    if not settings.dialpad_api_key:
        return DialpadTranscriptionOutput(success=False, error="Dialpad API key not configured")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                voicemail_url,
                headers={"Authorization": f"Bearer {settings.dialpad_api_key}"},
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                return DialpadTranscriptionOutput(transcription=(data or {}).get("transcription"))
            return DialpadTranscriptionOutput(success=False, error=resp.text)
    except Exception as e:
        logger.error("[queries.dialpad] fetch_dialpad_transcription failed: %s", e)
        return DialpadTranscriptionOutput(success=False, error=str(e))


@function_tool
async def create_dialpad_event(
    sender_phone: Optional[str] = None,
    voicemail_transcription: Optional[str] = None,
    voicemail_url: Optional[str] = None,
    received_at: Optional[str] = None,
) -> CreateDialpadEventOutput:
    """Create a Dialpad event in the backend for dashboard visibility."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.backend_url}/api/events/dialpad",
                json={
                    "senderPhone": sender_phone,
                    "voicemailTranscription": voicemail_transcription,
                    "voicemailUrl": voicemail_url,
                    "receivedAt": received_at or "now",
                },
                headers={"x-internal-key": settings.internal_api_key},
                timeout=10.0,
            )
            if resp.status_code in (200, 201):
                data = resp.json() or {}
                return CreateDialpadEventOutput(event_id=data.get("id"))
            return CreateDialpadEventOutput(success=False, error=resp.text)
    except Exception as e:
        logger.error("[queries.dialpad] create_dialpad_event failed: %s", e)
        return CreateDialpadEventOutput(success=False, error=str(e))
