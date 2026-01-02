"""After-hours window utilities.

Per design document:
- Coverage Window: 12:00 AM – 7:00 AM EST
- System only escalates during after-hours window
- Outside window: log only, no escalation
"""

from datetime import datetime, time
from typing import Tuple
import pytz


# After-hours window configuration
AFTER_HOURS_START = time(0, 0)   # 12:00 AM (midnight)
AFTER_HOURS_END = time(7, 0)    # 7:00 AM
TIMEZONE = pytz.timezone("America/New_York")  # EST/EDT


def is_after_hours(dt: datetime = None) -> bool:
    """Check if the given datetime falls within the after-hours window.
    
    After-hours window: 12:00 AM - 7:00 AM EST
    
    Args:
        dt: Datetime to check. If None, uses current time.
        
    Returns:
        True if within after-hours window, False otherwise.
    """
    if dt is None:
        dt = datetime.now(TIMEZONE)
    elif dt.tzinfo is None:
        # Assume UTC if no timezone
        dt = pytz.utc.localize(dt).astimezone(TIMEZONE)
    else:
        dt = dt.astimezone(TIMEZONE)
    
    current_time = dt.time()
    
    # Check if time is between midnight (00:00) and 7:00 AM
    return AFTER_HOURS_START <= current_time < AFTER_HOURS_END


def get_after_hours_status() -> dict:
    """Get current after-hours status with details.
    
    Returns:
        Dict with is_active, current_time, window_start, window_end, timezone
    """
    now = datetime.now(TIMEZONE)
    
    return {
        "is_active": is_after_hours(now),
        "current_time": now.strftime("%I:%M %p %Z"),
        "window_start": AFTER_HOURS_START.strftime("%I:%M %p"),
        "window_end": AFTER_HOURS_END.strftime("%I:%M %p"),
        "timezone": str(TIMEZONE),
        "timestamp": now.isoformat(),
    }


def get_next_window() -> Tuple[datetime, datetime]:
    """Get the next after-hours window start and end times.
    
    Returns:
        Tuple of (window_start, window_end) as timezone-aware datetimes
    """
    now = datetime.now(TIMEZONE)
    today = now.date()
    
    # Today's window
    window_start = TIMEZONE.localize(datetime.combine(today, AFTER_HOURS_START))
    window_end = TIMEZONE.localize(datetime.combine(today, AFTER_HOURS_END))
    
    # If we're past today's window, return tomorrow's
    if now >= window_end:
        from datetime import timedelta
        tomorrow = today + timedelta(days=1)
        window_start = TIMEZONE.localize(datetime.combine(tomorrow, AFTER_HOURS_START))
        window_end = TIMEZONE.localize(datetime.combine(tomorrow, AFTER_HOURS_END))
    
    return window_start, window_end


def should_escalate_now(force_escalate: bool = False) -> Tuple[bool, str]:
    """Determine if escalation should proceed based on current time.
    
    Args:
        force_escalate: If True, ignore time window and always escalate
        
    Returns:
        Tuple of (should_escalate, reason)
    """
    if force_escalate:
        return True, "Forced escalation (manual override)"
    
    if is_after_hours():
        return True, "Within after-hours window"
    
    status = get_after_hours_status()
    return False, f"Outside after-hours window (current: {status['current_time']}, window: {status['window_start']} - {status['window_end']} EST)"
