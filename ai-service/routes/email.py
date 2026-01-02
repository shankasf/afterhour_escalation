"""
Email API routes for the After-Hours Escalation System.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import logging

from services.email_service import get_email_service, EmailService
from services.email_poller import mark_email_processed, is_email_processed
from ah_agents.email_triage_agent import EmailTriageAgent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/email", tags=["email"])


class SendEmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str
    html_body: Optional[str] = None
    cc: Optional[List[EmailStr]] = None


class TestEmailRequest(BaseModel):
    to: Optional[EmailStr] = None


class EmailTriageResponse(BaseModel):
    message_id: str
    subject: str
    from_email: str
    emergency_score: float
    urgency_indicators: List[str]
    reasoning: str


@router.get("/test-connection")
async def test_email_connection():
    """
    Test IMAP and SMTP connections.
    
    Returns connection status for both email services.
    """
    try:
        email_service = get_email_service()
        results = email_service.test_connection()
        
        return {
            "success": results["imap"]["success"] and results["smtp"]["success"],
            "imap": results["imap"],
            "smtp": results["smtp"]
        }
    except Exception as e:
        logger.error(f"Connection test error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fetch-unread")
async def fetch_unread_emails(
    folder: str = "INBOX",
    limit: int = 20
):
    """
    Fetch unread emails from the inbox.
    
    Args:
        folder: Email folder to check (default: INBOX)
        limit: Maximum number of emails to fetch
    """
    try:
        email_service = get_email_service()
        emails = await email_service.fetch_unread_emails_async(folder, limit)
        
        return {
            "success": True,
            "count": len(emails),
            "emails": emails
        }
    except Exception as e:
        logger.error(f"Fetch emails error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fetch-and-triage")
async def fetch_and_triage_emails(
    folder: str = "INBOX",
    limit: int = 10
):
    """
    Fetch unread emails and triage them for emergencies.
    
    Returns emails with emergency scores and triage analysis.
    """
    try:
        email_service = get_email_service()
        triage_agent = EmailTriageAgent()
        
        # Fetch emails
        emails = await email_service.fetch_unread_emails_async(folder, limit)
        
        triaged_emails = []
        
        for email_data in emails:
            # Triage each email
            triage_result = await triage_agent.classify(
                subject=email_data.get("subject", ""),
                body=email_data.get("body", ""),
                sender_domain=email_data.get("from_domain", "")
            )
            
            triaged_emails.append({
                **email_data,
                "triage": {
                    "emergency_score": triage_result.get("emergency_score", 0),
                    "urgency_indicators": triage_result.get("urgency_indicators", []),
                    "reasoning": triage_result.get("reasoning", ""),
                    "extracted_context": triage_result.get("extracted_context", {})
                }
            })
        
        # Sort by emergency score (highest first)
        triaged_emails.sort(
            key=lambda x: x["triage"]["emergency_score"], 
            reverse=True
        )
        
        return {
            "success": True,
            "count": len(triaged_emails),
            "emails": triaged_emails
        }
    except Exception as e:
        logger.error(f"Fetch and triage error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/latest")
async def fetch_latest_email(
    folder: str = "INBOX",
    include_read: bool = True,
):
    """Fetch the latest email in a folder.

    By default includes read emails, since most clients auto-mark as read.
    """
    try:
        email_service = get_email_service()
        latest = await email_service.fetch_latest_email_async(
            folder=folder,
            include_read=include_read,
        )

        return {
            "success": True,
            "email": latest,
        }
    except Exception as e:
        logger.error(f"Fetch latest email error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-latest")
async def process_latest_email(
    folder: str = "INBOX",
    background_tasks: BackgroundTasks = None,
):
    """
    Manually process the latest email (including read emails).
    Useful for testing or re-processing emails that were already read.
    """
    from services.email_poller import create_emergency_event
    from config import get_settings
    settings = get_settings()
    
    try:
        email_service = get_email_service()
        triage_agent = EmailTriageAgent()
        
        # Fetch latest email including read
        email_data = await email_service.fetch_latest_email_async(
            folder=folder,
            include_read=True,
        )
        
        if not email_data:
            return {"success": False, "error": "No email found"}
        
        uid = email_data.get("uid") or email_data.get("message_id")
        if is_email_processed(uid):
            return {
                "success": False,
                "error": "Email already processed",
                "uid": uid,
            }
        
        subject = email_data.get("subject", "")
        body = email_data.get("body", "")
        
        logger.info(f"Processing latest email: '{subject}'")
        
        # Triage the email
        triage_result = await triage_agent.classify(
            subject=subject,
            body=body,
            sender_domain=email_data.get("from_domain", "")
        )
        
        emergency_score = triage_result.get("emergency_score", 0)
        threshold = settings.emergency_score_threshold
        
        result = {
            "success": True,
            "email": {
                "subject": subject,
                "from": email_data.get("from_email"),
                "date": email_data.get("date"),
            },
            "triage": {
                "emergency_score": emergency_score,
                "threshold": threshold,
                "is_emergency": emergency_score >= threshold,
                "reasoning": triage_result.get("reasoning", ""),
            }
        }
        
        # If emergency, create event
        if emergency_score >= threshold:
            logger.warning(f"EMERGENCY: '{subject}' (score: {emergency_score})")
            await create_emergency_event(email_data, triage_result)
            result["escalation_triggered"] = True
        else:
            result["escalation_triggered"] = False

        # Mark as processed to avoid duplicate escalations
        mark_email_processed(uid)
            
        return result
        
    except Exception as e:
        logger.error(f"Process latest email error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send")
async def send_email(request: SendEmailRequest):
    """
    Send an email via SMTP.
    
    Args:
        request: Email details (to, subject, body, etc.)
    """
    try:
        email_service = get_email_service()
        success, message = await email_service.send_email_async(
            to=request.to,
            subject=request.subject,
            body=request.body,
            html_body=request.html_body,
            cc=request.cc
        )
        
        if not success:
            raise HTTPException(status_code=500, detail=message)
        
        return {"success": True, "message": message}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send email error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send-test")
async def send_test_email(request: TestEmailRequest):
    """
    Send a test email to verify SMTP configuration.
    
    Args:
        request: Optional recipient email (defaults to admin email or SMTP user)
    """
    from config import get_settings
    settings = get_settings()
    
    try:
        email_service = get_email_service()
        
        # Determine recipient
        to = request.to or settings.admin_email or settings.smtp_user
        
        if not to:
            raise HTTPException(
                status_code=400, 
                detail="No recipient specified and no admin email configured"
            )
        
        success, message = await email_service.send_email_async(
            to=to,
            subject="Test Email - After-Hours Escalation System",
            body="""
This is a test email from the After-Hours Escalation System.

If you received this email, your SMTP configuration is working correctly.

Email Configuration:
- SMTP Host: {}
- SMTP Port: {}
- Encryption: {}

Timestamp: {}
            """.format(
                settings.smtp_host,
                settings.smtp_port,
                settings.smtp_encryption,
                __import__('datetime').datetime.now().isoformat()
            ),
            html_body="""
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; text-align: center; }
        .content { padding: 24px; }
        .success { color: #059669; font-size: 48px; text-align: center; }
        .footer { background: #f9fafb; padding: 12px 24px; text-align: center; font-size: 12px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Test Email Successful</h1>
        </div>
        <div class="content">
            <p class="success">✓</p>
            <p style="text-align: center;">Your SMTP configuration is working correctly!</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p><strong>SMTP Host:</strong> {}</p>
            <p><strong>SMTP Port:</strong> {}</p>
            <p><strong>Encryption:</strong> {}</p>
        </div>
        <div class="footer">
            <p>After-Hours Escalation System</p>
        </div>
    </div>
</body>
</html>
            """.format(
                settings.smtp_host,
                settings.smtp_port,
                settings.smtp_encryption
            )
        )
        
        if not success:
            raise HTTPException(status_code=500, detail=message)
        
        return {
            "success": True, 
            "message": f"Test email sent to {to}",
            "recipient": to
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send test email error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin-alert")
async def send_admin_alert(
    subject: str,
    message: str,
    alert_type: str = "info"
):
    """
    Send an admin alert email.
    
    Args:
        subject: Alert subject
        message: Alert message
        alert_type: Type of alert (info, warning, error)
    """
    try:
        email_service = get_email_service()
        success, result_message = email_service.send_admin_alert(
            subject=subject,
            message=message,
            alert_type=alert_type
        )
        
        if not success:
            raise HTTPException(status_code=500, detail=result_message)
        
        return {"success": True, "message": result_message}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send admin alert error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
