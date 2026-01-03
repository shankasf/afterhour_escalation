"""
Email Poller Service - Automatically polls for new emails and processes emergencies.
Uses database-backed persistent storage to track processed UIDs across restarts.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from config import get_settings
from services.email_service import get_email_service
from services.email_uid_tracker import get_email_uid_tracker
from services.http_client import get_http_client
from ah_agents.email_triage_agent import EmailTriageAgent

logger = logging.getLogger(__name__)
settings = get_settings()

# Track poller task reference
_poller_task = None


async def poll_and_process_emails():
    """
    Poll for new unread emails from the last 24 hours (New York time),
    triage them, and create events for emergencies.
    """
    logger.info("\n" + "*"*70)
    logger.info("[EMAIL POLLER] Starting email poll cycle")
    logger.info("*"*70)

    try:
        email_service = get_email_service()
        uid_tracker = get_email_uid_tracker()
        triage_agent = EmailTriageAgent()

        # Fetch unread emails from last 24 hours in New York timezone
        logger.info("[EMAIL POLLER] Fetching unread emails from last 24 hours (NY timezone)...")
        emails = await email_service.fetch_emails_since_async(
            since_hours=24,
            folder="INBOX",
            include_read=False,
            timezone="America/New_York"
        )

        if not emails:
            logger.info("[EMAIL POLLER] No new unread emails found")
            logger.info("*"*70 + "\n")
            return

        logger.info(f"[EMAIL POLLER] Found {len(emails)} unread emails to process")
        logger.info("-"*70)

        for idx, email_data in enumerate(emails, 1):
            uid = email_data.get("uid") or email_data.get("message_id")

            # Skip if already processed (using database-backed tracker)
            if await uid_tracker.is_processed(uid):
                logger.debug(f"[EMAIL POLLER] Skipping already processed email UID: {uid}")
                continue

            subject = email_data.get("subject", "")
            body = email_data.get("body", "")
            from_email = email_data.get("from_email", "")

            logger.info(f"\n[EMAIL POLLER] Processing email {idx}/{len(emails)}:")
            logger.info(f"  UID: {uid}")
            logger.info(f"  From: {from_email}")
            logger.info(f"  Subject: {subject[:60]}..." if len(subject) > 60 else f"  Subject: {subject}")

            try:
                # Triage the email
                triage_result = await triage_agent.classify(
                    subject=subject,
                    body=body,
                    sender_domain=email_data.get("from_domain", "")
                )

                emergency_score = triage_result.get("emergency_score", 0)
                threshold = settings.emergency_score_threshold
                
                logger.info(f"[EMAIL POLLER] Triage complete:")
                logger.info(f"  Emergency Score: {emergency_score:.2f}")
                logger.info(f"  Threshold: {threshold}")

                # Check if this is an emergency (score >= threshold)
                if emergency_score >= threshold:
                    logger.warning(f"[EMAIL POLLER] *** EMERGENCY DETECTED ***")
                    logger.warning(f"  Subject: {subject}")
                    logger.warning(f"  Score: {emergency_score:.2f} >= {threshold}")
                    logger.info("[EMAIL POLLER] Creating emergency event in backend...")

                    await create_emergency_event(
                        email_data=email_data,
                        triage_result=triage_result
                    )
                else:
                    logger.info(f"[EMAIL POLLER] Non-emergency - no escalation needed")
                    logger.info(f"  Score {emergency_score:.2f} < threshold {threshold}")

                # Mark as processed (persisted to database)
                await uid_tracker.mark_processed(uid)
                logger.info(f"[EMAIL POLLER] Email marked as processed")

            except Exception as e:
                logger.error(f"[EMAIL POLLER] Error triaging email '{subject}': {str(e)}")

    except Exception as e:
        logger.error(f"[EMAIL POLLER] Error polling emails: {str(e)}")
    
    logger.info("[EMAIL POLLER] Poll cycle complete")
    logger.info("*"*70 + "\n")


async def create_emergency_event(email_data: dict, triage_result: dict):
    """
    Create an emergency event in the backend and trigger escalation.
    Uses resilient HTTP client with retry logic.
    """
    logger.info("\n" + "!"*70)
    logger.info("[ESCALATION PIPELINE] Creating emergency event")
    logger.info("!"*70)
    
    try:
        http_client = get_http_client()

        # Create the event payload
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

        logger.info(f"[ESCALATION PIPELINE] Event payload:")
        logger.info(f"  Subject: {event_payload['subject'][:60]}..." if len(event_payload['subject']) > 60 else f"  Subject: {event_payload['subject']}")
        logger.info(f"  Sender: {event_payload['senderEmail']}")
        logger.info(f"  Emergency Score: {event_payload['emergencyScore']:.2f}")
        logger.info(f"  Posting to: {settings.backend_url}/api/events/email")

        # Create event with retry logic
        response = await http_client.post(
            f"{settings.backend_url}/api/events/email",
            json=event_payload,
            headers={"x-internal-key": settings.internal_api_key},
            timeout=30.0
        )

        if response.status_code in (200, 201):
            event = response.json()
            event_id = event.get("id")
            logger.info(f"[ESCALATION PIPELINE] Event created successfully!")
            logger.info(f"  Event ID: {event_id}")
            logger.info("-"*50)
            logger.info(f"[ESCALATION PIPELINE] Starting escalation for event {event_id}...")

            # Start escalation with retry logic
            escalate_response = await http_client.post(
                f"{settings.backend_url}/api/escalation/start/{event_id}",
                headers={"x-internal-key": settings.internal_api_key},
                timeout=30.0
            )

            if escalate_response.status_code == 200:
                logger.info(f"[ESCALATION PIPELINE] Escalation started successfully!")
                logger.info(f"  Calls and SMS being sent to on-call contacts...")
                logger.info("!"*70 + "\n")
            else:
                logger.error(f"[ESCALATION PIPELINE] Failed to start escalation")
                logger.error(f"  Status: {escalate_response.status_code}")
                logger.error(f"  Response: {escalate_response.text}")
        else:
            logger.error(f"[ESCALATION PIPELINE] Failed to create event")
            logger.error(f"  Status: {response.status_code}")
            logger.error(f"  Response: {response.text}")

    except Exception as e:
        logger.error(f"[ESCALATION PIPELINE] Error: {str(e)}")


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
    uid_tracker = get_email_uid_tracker()
    return {
        "running": _poller_task is not None and not _poller_task.done(),
        "processed_count": uid_tracker.get_processed_count(),
    }
