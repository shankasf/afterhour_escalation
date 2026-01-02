"""
Email Poller Service - Automatically polls for new emails and processes emergencies.
Uses file-based persistent storage to track processed UIDs across restarts.
"""

import asyncio
import logging
import json
import os
from datetime import datetime
from typing import Set
import httpx

from config import get_settings
from services.email_service import get_email_service
from ah_agents.email_triage_agent import EmailTriageAgent

logger = logging.getLogger(__name__)
settings = get_settings()

# File path for persistent UID storage
PROCESSED_UIDS_FILE = "/app/data/processed_email_uids.json"

# Track processed email UIDs to avoid reprocessing (loaded from file)
_processed_uids: Set[str] = set()
_poller_task = None


def _load_processed_uids():
    """Load processed UIDs from persistent storage."""
    global _processed_uids
    try:
        if os.path.exists(PROCESSED_UIDS_FILE):
            with open(PROCESSED_UIDS_FILE, 'r') as f:
                data = json.load(f)
                _processed_uids = set(data.get("uids", []))
                logger.info(f"Loaded {len(_processed_uids)} processed email UIDs from storage")
        else:
            # Ensure directory exists
            os.makedirs(os.path.dirname(PROCESSED_UIDS_FILE), exist_ok=True)
            _processed_uids = set()
            logger.info("No existing processed UIDs file, starting fresh")
    except Exception as e:
        logger.error(f"Error loading processed UIDs: {e}")
        _processed_uids = set()


def _save_processed_uids():
    """Save processed UIDs to persistent storage."""
    try:
        os.makedirs(os.path.dirname(PROCESSED_UIDS_FILE), exist_ok=True)
        with open(PROCESSED_UIDS_FILE, 'w') as f:
            json.dump({
                "uids": list(_processed_uids),
                "updated_at": datetime.utcnow().isoformat()
            }, f)
    except Exception as e:
        logger.error(f"Error saving processed UIDs: {e}")


def is_email_processed(uid: str) -> bool:
    """Check if an email UID has already been processed (persistent)."""
    if not uid:
        return False
    if not _processed_uids:
        _load_processed_uids()
    return uid in _processed_uids


def mark_email_processed(uid: str):
    """Mark an email UID as processed and persist it."""
    global _processed_uids
    if not uid:
        return
    if not _processed_uids:
        _load_processed_uids()

    _processed_uids.add(uid)

    # Keep only last 1000 UIDs to prevent bloat
    if len(_processed_uids) > 1000:
        uids_list = list(_processed_uids)
        _processed_uids = set(uids_list[-500:])

    _save_processed_uids()


async def poll_and_process_emails():
    """
    Poll for new unread emails from the last 24 hours (New York time),
    triage them, and create events for emergencies.
    """
    global _processed_uids
    
    logger.info("Polling for new emails (last 24 hours, NY time)...")
    
    try:
        email_service = get_email_service()
        triage_agent = EmailTriageAgent()
        
        # Fetch unread emails from last 24 hours in New York timezone
        emails = await email_service.fetch_emails_since_async(
            since_hours=24,
            folder="INBOX",
            include_read=False,
            timezone="America/New_York"
        )
        
        if not emails:
            logger.debug("No new unread emails in the last 24 hours")
            return
        
        logger.info(f"Found {len(emails)} unread emails from last 24 hours to process")
        
        for email_data in emails:
            uid = email_data.get("uid") or email_data.get("message_id")
            
            # Skip if already processed
            if is_email_processed(uid):
                logger.debug(f"Skipping already processed email UID: {uid}")
                continue
            
            subject = email_data.get("subject", "")
            body = email_data.get("body", "")
            from_email = email_data.get("from_email", "")
            from_name = email_data.get("from_name", "")
            
            logger.info(f"Processing email: '{subject}' from {from_email}")
            
            # Triage the email
            try:
                triage_result = await triage_agent.classify(
                    subject=subject,
                    body=body,
                    sender_domain=email_data.get("from_domain", "")
                )
                
                emergency_score = triage_result.get("emergency_score", 0)
                logger.info(f"Email '{subject}' scored {emergency_score} for emergency")
                
                # Check if this is an emergency (score >= threshold)
                threshold = settings.emergency_score_threshold
                if emergency_score >= threshold:
                    logger.warning(f"EMERGENCY DETECTED: '{subject}' (score: {emergency_score})")
                    
                    # Create event in backend
                    await create_emergency_event(
                        email_data=email_data,
                        triage_result=triage_result
                    )
                else:
                    logger.info(f"Non-emergency email: '{subject}' (score: {emergency_score} < {threshold})")
                
                # Mark as processed
                mark_email_processed(uid)
                    
            except Exception as e:
                logger.error(f"Error triaging email '{subject}': {str(e)}")
                
    except Exception as e:
        logger.error(f"Error polling emails: {str(e)}")


async def create_emergency_event(email_data: dict, triage_result: dict):
    """
    Create an emergency event in the backend and trigger escalation.
    """
    try:
        async with httpx.AsyncClient() as client:
            # Create the event (backend will set source=email)
            event_payload = {
                "subject": email_data.get("subject", ""),
                "rawContent": email_data.get("body", ""),
                "senderEmail": email_data.get("from_email", ""),
                "senderName": email_data.get("from_name", ""),
                "senderDomain": email_data.get("from_domain", ""),
                "emergencyScore": triage_result.get("emergency_score", 0),
                "aiSummary": triage_result.get("reasoning", ""),
                "extractedContext": triage_result.get("extracted_context", {}),
            }
            
            logger.info(f"Creating emergency event for: {email_data.get('subject')}")
            
            response = await client.post(
                f"{settings.backend_url}/api/events/email",
                json=event_payload,
                headers={"x-internal-key": settings.internal_api_key},
                timeout=30.0
            )
            
            if response.status_code in (200, 201):
                event = response.json()
                event_id = event.get("id")
                logger.info(f"Created event {event_id}, starting escalation...")
                
                # Start escalation via internal endpoint
                escalate_response = await client.post(
                    f"{settings.backend_url}/api/escalation/start/{event_id}",
                    headers={"x-internal-key": settings.internal_api_key},
                    timeout=30.0
                )
                
                if escalate_response.status_code == 200:
                    logger.info(f"Escalation started for event {event_id}")
                else:
                    logger.error(f"Failed to start escalation: {escalate_response.status_code} - {escalate_response.text}")
            else:
                logger.error(f"Failed to create event: {response.status_code} - {response.text}")
                
    except Exception as e:
        logger.error(f"Error creating emergency event: {str(e)}")


async def start_email_poller(interval_seconds: int = 30):
    """
    Start the email polling background task.
    
    Args:
        interval_seconds: How often to poll for new emails
    """
    global _poller_task
    
    logger.info(f"Starting email poller with {interval_seconds}s interval")
    
    while True:
        try:
            await poll_and_process_emails()
        except Exception as e:
            logger.error(f"Email poller error: {str(e)}")
        
        await asyncio.sleep(interval_seconds)


def get_poller_status():
    """Get the current poller status."""
    return {
        "running": _poller_task is not None and not _poller_task.done(),
        "processed_count": len(_processed_uids),
    }
