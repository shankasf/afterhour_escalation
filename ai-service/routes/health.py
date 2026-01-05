from fastapi import APIRouter
from services.after_hours import get_after_hours_status, is_after_hours

router = APIRouter()


@router.get("/health")
async def health_check():
    after_hours = get_after_hours_status()
    return {
        "status": "healthy",
        "service": "ai-service",
        "after_hours": {
            "is_active": after_hours["is_active"],
            "current_time": after_hours["current_time"],
            "window": f"{after_hours['window_start']} - {after_hours['window_end']} EST",
        }
    }


@router.get("/health/after-hours")
async def after_hours_status():
    """Get detailed after-hours window status."""
    return get_after_hours_status()

