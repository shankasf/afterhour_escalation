# Services package
from .email_service import get_email_service, EmailService
from .after_hours import is_after_hours, get_after_hours_status, should_escalate_now
