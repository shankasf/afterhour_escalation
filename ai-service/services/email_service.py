"""
Email Service for After-Hours Escalation System.

Handles IMAP (receiving) and SMTP (sending) email operations
with Microsoft 365/Outlook support.
"""

import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
from email.utils import parseaddr
from typing import List, Dict, Any, Optional, Tuple
import logging
import ssl
from datetime import datetime, timedelta
import asyncio
from concurrent.futures import ThreadPoolExecutor

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmailService:
    """
    Service for handling email operations via IMAP and SMTP.
    Supports Microsoft 365/Outlook with SSL/TLS and STARTTLS.
    """
    
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=3)
        self._imap_connection: Optional[imaplib.IMAP4_SSL] = None
        
    # =====================================
    # IMAP - Email Receiving
    # =====================================
    
    def _connect_imap(self) -> imaplib.IMAP4_SSL:
        """Establish IMAP connection with SSL."""
        try:
            logger.info(f"Connecting to IMAP server: {settings.imap_host}:{settings.imap_port}")
            
            # Create SSL context
            ssl_context = ssl.create_default_context()
            
            # Connect using SSL (port 993)
            mail = imaplib.IMAP4_SSL(
                host=settings.imap_host,
                port=settings.imap_port,
                ssl_context=ssl_context
            )
            
            # Login
            mail.login(settings.imap_user, settings.imap_password)
            logger.info(f"Successfully connected to IMAP as {settings.imap_user}")
            
            return mail
            
        except imaplib.IMAP4.error as e:
            logger.error(f"IMAP authentication failed: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"IMAP connection error: {str(e)}")
            raise
    
    def _decode_header_value(self, value: str) -> str:
        """Decode email header value (handles encoded headers)."""
        if not value:
            return ""
        
        decoded_parts = []
        for part, encoding in decode_header(value):
            if isinstance(part, bytes):
                try:
                    decoded_parts.append(part.decode(encoding or 'utf-8', errors='replace'))
                except (LookupError, UnicodeDecodeError):
                    decoded_parts.append(part.decode('utf-8', errors='replace'))
            else:
                decoded_parts.append(part)
        
        return ''.join(decoded_parts)
    
    def _parse_email(self, msg: email.message.Message) -> Dict[str, Any]:
        """Parse email message into structured data."""
        # Get basic headers
        subject = self._decode_header_value(msg.get('Subject', ''))
        from_header = msg.get('From', '')
        date_header = msg.get('Date', '')
        message_id = msg.get('Message-ID', '')
        
        # Parse sender
        sender_name, sender_email = parseaddr(from_header)
        sender_name = self._decode_header_value(sender_name)
        sender_domain = sender_email.split('@')[-1] if '@' in sender_email else ''
        
        # Get body
        body_plain = ""
        body_html = ""
        
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get('Content-Disposition', ''))
                
                if 'attachment' in content_disposition:
                    continue
                
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        text = payload.decode(charset, errors='replace')
                        
                        if content_type == 'text/plain':
                            body_plain = text
                        elif content_type == 'text/html':
                            body_html = text
                except Exception as e:
                    logger.warning(f"Error decoding email part: {str(e)}")
        else:
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or 'utf-8'
                    body_plain = payload.decode(charset, errors='replace')
            except Exception as e:
                logger.warning(f"Error decoding email body: {str(e)}")
        
        # Prefer plain text, fall back to HTML stripped of tags
        body = body_plain or self._strip_html(body_html)
        
        return {
            "message_id": message_id,
            "subject": subject,
            "from_name": sender_name,
            "from_email": sender_email,
            "from_domain": sender_domain,
            "date": date_header,
            "body": body,
            "body_html": body_html,
            "has_attachments": self._has_attachments(msg),
        }
    
    def _strip_html(self, html: str) -> str:
        """Strip HTML tags from text (basic implementation)."""
        import re
        if not html:
            return ""
        
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', html)
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def _has_attachments(self, msg: email.message.Message) -> bool:
        """Check if email has attachments."""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_disposition() == 'attachment':
                    return True
        return False
    
    def fetch_unread_emails(self, folder: str = "INBOX", limit: int = 50) -> List[Dict[str, Any]]:
        """
        Fetch unread emails from the specified folder.
        
        Args:
            folder: Email folder to check (default: INBOX)
            limit: Maximum number of emails to fetch
            
        Returns:
            List of parsed email dictionaries
        """
        emails = []
        mail = None
        
        try:
            mail = self._connect_imap()
            mail.select(folder)
            
            # Search for unread emails
            status, messages = mail.search(None, 'UNSEEN')
            
            if status != 'OK':
                logger.warning(f"IMAP search failed: {status}")
                return []
            
            message_ids = messages[0].split()
            
            # Limit the number of emails
            message_ids = message_ids[-limit:] if len(message_ids) > limit else message_ids
            
            logger.info(f"Found {len(message_ids)} unread emails in {folder}")
            
            for msg_id in message_ids:
                try:
                    status, msg_data = mail.fetch(msg_id, '(RFC822)')
                    
                    if status == 'OK' and msg_data[0]:
                        raw_email = msg_data[0][1]
                        msg = email.message_from_bytes(raw_email)
                        parsed = self._parse_email(msg)
                        parsed['uid'] = msg_id.decode()
                        emails.append(parsed)
                except Exception as e:
                    logger.error(f"Error fetching email {msg_id}: {str(e)}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails: {str(e)}")
            return []
        finally:
            if mail:
                try:
                    mail.logout()
                except:
                    pass
    
    def fetch_emails_since(
        self, 
        since_hours: int = 24, 
        folder: str = "INBOX",
        include_read: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Fetch emails from the last N hours.
        
        Args:
            since_hours: Number of hours to look back
            folder: Email folder to check
            include_read: Whether to include already-read emails
            
        Returns:
            List of parsed email dictionaries
        """
        emails = []
        mail = None
        
        try:
            mail = self._connect_imap()
            mail.select(folder)
            
            # Calculate the date threshold
            since_date = (datetime.now() - timedelta(hours=since_hours)).strftime("%d-%b-%Y")
            
            # Build search criteria
            if include_read:
                criteria = f'(SINCE {since_date})'
            else:
                criteria = f'(UNSEEN SINCE {since_date})'
            
            status, messages = mail.search(None, criteria)
            
            if status != 'OK':
                logger.warning(f"IMAP search failed: {status}")
                return []
            
            message_ids = messages[0].split()
            logger.info(f"Found {len(message_ids)} emails since {since_date}")
            
            for msg_id in message_ids:
                try:
                    status, msg_data = mail.fetch(msg_id, '(RFC822)')
                    
                    if status == 'OK' and msg_data[0]:
                        raw_email = msg_data[0][1]
                        msg = email.message_from_bytes(raw_email)
                        parsed = self._parse_email(msg)
                        parsed['uid'] = msg_id.decode()
                        emails.append(parsed)
                except Exception as e:
                    logger.error(f"Error fetching email {msg_id}: {str(e)}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails: {str(e)}")
            return []
        finally:
            if mail:
                try:
                    mail.logout()
                except:
                    pass
    
    def mark_as_read(self, folder: str, uid: str) -> bool:
        """Mark an email as read."""
        mail = None
        try:
            mail = self._connect_imap()
            mail.select(folder)
            mail.store(uid.encode(), '+FLAGS', '\\Seen')
            logger.info(f"Marked email {uid} as read")
            return True
        except Exception as e:
            logger.error(f"Error marking email as read: {str(e)}")
            return False
        finally:
            if mail:
                try:
                    mail.logout()
                except:
                    pass
    
    async def fetch_unread_emails_async(
        self, 
        folder: str = "INBOX", 
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Async wrapper for fetch_unread_emails."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor, 
            lambda: self.fetch_unread_emails(folder, limit)
        )
    
    # =====================================
    # SMTP - Email Sending
    # =====================================
    
    def _connect_smtp(self) -> smtplib.SMTP:
        """Establish SMTP connection with STARTTLS."""
        try:
            logger.info(f"Connecting to SMTP server: {settings.smtp_host}:{settings.smtp_port}")
            
            # Connect to SMTP server
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)
            server.set_debuglevel(0)
            
            # Send EHLO first
            server.ehlo()
            
            # Start TLS encryption
            if settings.smtp_encryption.upper() == "STARTTLS":
                server.starttls(context=ssl.create_default_context())
                server.ehlo()  # Re-identify after STARTTLS
            
            # Login with explicit AUTH LOGIN
            server.login(settings.smtp_user, settings.smtp_password)
            logger.info(f"Successfully connected to SMTP as {settings.smtp_user}")
            
            return server
            
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP authentication failed: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"SMTP connection error: {str(e)}")
            raise
    
    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        html_body: Optional[str] = None,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        reply_to: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        Send an email via SMTP.
        
        Args:
            to: Recipient email address
            subject: Email subject
            body: Plain text body
            html_body: Optional HTML body
            cc: Optional CC recipients
            bcc: Optional BCC recipients
            reply_to: Optional reply-to address
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        server = None
        try:
            # Create message
            if html_body:
                msg = MIMEMultipart('alternative')
                msg.attach(MIMEText(body, 'plain'))
                msg.attach(MIMEText(html_body, 'html'))
            else:
                msg = MIMEText(body, 'plain')
            
            # Set headers
            msg['Subject'] = subject
            msg['From'] = f"{settings.email_from_name} <{settings.email_from_address or settings.smtp_user}>"
            msg['To'] = to
            
            if cc:
                msg['Cc'] = ', '.join(cc)
            if reply_to:
                msg['Reply-To'] = reply_to
            
            # Calculate all recipients
            recipients = [to]
            if cc:
                recipients.extend(cc)
            if bcc:
                recipients.extend(bcc)
            
            # Send
            server = self._connect_smtp()
            server.sendmail(
                settings.email_from_address or settings.smtp_user,
                recipients,
                msg.as_string()
            )
            
            logger.info(f"Email sent successfully to {to}")
            return True, "Email sent successfully"
            
        except Exception as e:
            error_msg = f"Failed to send email: {str(e)}"
            logger.error(error_msg)
            return False, error_msg
        finally:
            if server:
                try:
                    server.quit()
                except:
                    pass
    
    async def send_email_async(
        self,
        to: str,
        subject: str,
        body: str,
        html_body: Optional[str] = None,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        reply_to: Optional[str] = None
    ) -> Tuple[bool, str]:
        """Async wrapper for send_email."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor,
            lambda: self.send_email(to, subject, body, html_body, cc, bcc, reply_to)
        )
    
    def send_escalation_notification(
        self,
        to: str,
        alert_id: str,
        emergency_score: float,
        source: str,
        summary: str,
        acknowledge_url: str
    ) -> Tuple[bool, str]:
        """
        Send an escalation notification email.
        
        Args:
            to: Recipient email
            alert_id: Alert ID
            emergency_score: Emergency score (0-1)
            source: Alert source (email, voicemail, etc.)
            summary: Alert summary
            acknowledge_url: URL to acknowledge the alert
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        subject = f"🚨 EMERGENCY ALERT [{alert_id}] - Score: {emergency_score:.0%}"
        
        body = f"""
EMERGENCY ESCALATION ALERT

Alert ID: {alert_id}
Emergency Score: {emergency_score:.0%}
Source: {source}

Summary:
{summary}

Acknowledge this alert: {acknowledge_url}

---
This is an automated message from the After-Hours Escalation System.
"""
        
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }}
        .container {{ max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        .header {{ background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 24px; }}
        .content {{ padding: 24px; }}
        .info-box {{ background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0; border-radius: 4px; }}
        .score {{ font-size: 48px; font-weight: bold; color: #dc2626; text-align: center; }}
        .btn {{ display: inline-block; background: #dc2626; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 16px; }}
        .btn:hover {{ background: #b91c1c; }}
        .footer {{ background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 EMERGENCY ESCALATION ALERT</h1>
        </div>
        <div class="content">
            <p class="score">{emergency_score:.0%}</p>
            <p style="text-align: center; color: #6b7280;">Emergency Score</p>
            
            <div class="info-box">
                <p><strong>Alert ID:</strong> {alert_id}</p>
                <p><strong>Source:</strong> {source}</p>
            </div>
            
            <h3>Summary</h3>
            <p>{summary}</p>
            
            <div style="text-align: center; margin-top: 24px;">
                <a href="{acknowledge_url}" class="btn">Acknowledge Alert</a>
            </div>
        </div>
        <div class="footer">
            <p>After-Hours Escalation System</p>
            <p>This is an automated emergency notification.</p>
        </div>
    </div>
</body>
</html>
"""
        
        return self.send_email(to, subject, body, html_body)
    
    def send_admin_alert(
        self,
        subject: str,
        message: str,
        alert_type: str = "info"
    ) -> Tuple[bool, str]:
        """
        Send an admin alert email.
        
        Args:
            subject: Email subject
            message: Alert message
            alert_type: Alert type (info, warning, error)
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        if not settings.admin_email:
            logger.warning("Admin email not configured")
            return False, "Admin email not configured"
        
        color_map = {
            "info": "#3b82f6",
            "warning": "#f59e0b",
            "error": "#dc2626"
        }
        color = color_map.get(alert_type, "#3b82f6")
        
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }}
        .container {{ max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }}
        .header {{ background: {color}; color: white; padding: 16px 24px; }}
        .content {{ padding: 24px; }}
        .footer {{ background: #f9fafb; padding: 12px 24px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">{subject}</h2>
        </div>
        <div class="content">
            <p>{message}</p>
        </div>
        <div class="footer">
            <p>After-Hours Escalation System - Admin Alert</p>
        </div>
    </div>
</body>
</html>
"""
        
        return self.send_email(
            settings.admin_email,
            f"[Admin Alert] {subject}",
            message,
            html_body
        )
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test both IMAP and SMTP connections.
        
        Returns:
            Dict with connection status for both services
        """
        results = {
            "imap": {"success": False, "message": ""},
            "smtp": {"success": False, "message": ""}
        }
        
        # Test IMAP
        try:
            mail = self._connect_imap()
            mail.logout()
            results["imap"]["success"] = True
            results["imap"]["message"] = f"Connected to {settings.imap_host}"
        except Exception as e:
            results["imap"]["message"] = str(e)
        
        # Test SMTP
        try:
            server = self._connect_smtp()
            server.quit()
            results["smtp"]["success"] = True
            results["smtp"]["message"] = f"Connected to {settings.smtp_host}"
        except Exception as e:
            results["smtp"]["message"] = str(e)
        
        return results


# Singleton instance
_email_service: Optional[EmailService] = None


def get_email_service() -> EmailService:
    """Get or create the email service singleton."""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
