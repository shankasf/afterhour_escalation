import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import asyncio

from config import get_settings
from routes.classify import router as classify_router
from routes.dialpad import router as dialpad_router
from routes.escalate import router as escalate_router
from routes.twilio_webhooks import router as twilio_router
from routes.health import router as health_router
from routes.email import router as email_router
from services.email_poller import start_email_poller
from services.websocket_log_handler import setup_websocket_logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Add WebSocket log handler to stream logs to dashboard
try:
    ws_log_handler = setup_websocket_logging(level=logging.INFO)
    logger.info("WebSocket log handler initialized - logs will stream to dashboard")
except Exception as e:
    logger.warning(f"Failed to initialize WebSocket log handler: {e}")

settings = get_settings()

# Global reference to the poller task
_poller_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _poller_task
    logger.info("Starting AI Service...")
    
    # Start email poller as background task
    poll_interval = 30  # seconds
    logger.info(f"Starting email poller (interval: {poll_interval}s)")
    _poller_task = asyncio.create_task(start_email_poller(poll_interval))
    
    yield
    
    # Cancel poller on shutdown
    if _poller_task:
        _poller_task.cancel()
        try:
            await _poller_task
        except asyncio.CancelledError:
            pass
    logger.info("Shutting down AI Service...")


app = FastAPI(
    title="After-Hours Escalation AI Service",
    description="AI service for emergency classification and escalation",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router, tags=["health"])
app.include_router(classify_router, prefix="/classify", tags=["classification"])
app.include_router(dialpad_router, prefix="/dialpad", tags=["dialpad"])
app.include_router(escalate_router, prefix="/escalate", tags=["escalation"])
app.include_router(twilio_router, prefix="/twilio", tags=["twilio"])
app.include_router(email_router, tags=["email"])


@app.get("/")
async def root():
    return {
        "service": "After-Hours Escalation AI Service",
        "version": "1.0.0",
        "status": "running"
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
