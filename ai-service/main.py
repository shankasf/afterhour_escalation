import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import asyncio

from config import get_settings
from logging_setup import setup_logging
from middleware import CorrelationIdMiddleware, HttpLoggingMiddleware
from routes.classify import router as classify_router
from routes.escalate import router as escalate_router
from routes.health import router as health_router
from routes.email import router as email_router
from routes.graph import router as graph_router
from routes.eval import router as eval_router
from routes.cost import router as cost_router
from webrtc.signaling import router as webrtc_router, start_reaper, stop_reaper
from services.email_poller import start_email_poller
from services.websocket_log_handler import setup_websocket_logging

# Configure structured JSON logging for the entire process.
setup_logging(os.getenv("LOG_LEVEL", "info"))
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Log LangSmith tracing status (auto-wired via env when enabled).
if os.getenv("LANGSMITH_TRACING") == "true":
    logger.info(
        "LangSmith tracing enabled: project=%s",
        os.getenv("LANGSMITH_PROJECT", "default"),
    )
else:
    logger.info("LangSmith tracing disabled (no env)")

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

    # Initialize the LangGraph checkpointer + compiled graph.
    from graph.graph import close_graph, init_graph
    try:
        await init_graph()
        logger.info("LangGraph initialized")
    except Exception as e:
        logger.warning(f"LangGraph init deferred: {e}")

    # Start email poller as background task
    poll_interval = 30  # seconds
    logger.info(f"Starting email poller (interval: {poll_interval}s)")
    _poller_task = asyncio.create_task(start_email_poller(poll_interval))

    # Start WebRTC idle-session reaper (closes peer connections + OpenAI WS
    # for sessions that have been silent for too long).
    try:
        await start_reaper()
    except Exception as e:
        logger.warning(f"WebRTC reaper failed to start: {e}")

    # Start the LLM cost ledger writer (drains queue to Postgres).
    try:
        from graph.cost_ledger import start_ledger
        await start_ledger()
        logger.info("LLM cost ledger writer started")
    except Exception as e:
        logger.warning(f"Cost ledger writer failed to start: {e}")

    yield

    # Cancel poller on shutdown
    if _poller_task:
        _poller_task.cancel()
        try:
            await _poller_task
        except asyncio.CancelledError:
            pass

    # Stop WebRTC reaper.
    try:
        await stop_reaper()
    except Exception as e:
        logger.warning(f"WebRTC reaper shutdown error: {e}")
    try:
        await close_graph()
    except Exception as e:
        logger.warning(f"LangGraph teardown error: {e}")
    try:
        from graph.cost_ledger import close_ledger
        await close_ledger()
    except Exception as e:
        logger.warning(f"Cost ledger shutdown error: {e}")
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

# Structured logging middleware. Starlette runs middlewares in the reverse
# order they are added (last-added is innermost). We want CorrelationId to be
# the outermost so that HttpLoggingMiddleware sees the correlation id, so
# add HttpLoggingMiddleware first and CorrelationIdMiddleware last.
app.add_middleware(HttpLoggingMiddleware)
app.add_middleware(CorrelationIdMiddleware)

# Include routers
app.include_router(health_router, tags=["health"])
app.include_router(classify_router, prefix="/classify", tags=["classification"])
app.include_router(escalate_router, prefix="/escalate", tags=["escalation"])
app.include_router(email_router, tags=["email"])
app.include_router(graph_router, prefix="/graph", tags=["graph"])
app.include_router(eval_router, prefix="/eval", tags=["eval"])
app.include_router(cost_router, prefix="/cost", tags=["cost"])
app.include_router(webrtc_router, prefix="/webrtc", tags=["webrtc"])


@app.get("/")
async def root():
    return {
        "service": "After-Hours Escalation AI Service",
        "version": "1.0.0",
        "status": "running"
    }


if __name__ == "__main__":
    # IMPORTANT: workers=1 is REQUIRED. The WebRTC signaling layer uses a
    # module-global _SESSIONS dict (see webrtc/signaling.py). Multiple workers
    # would each hold their own copy, so a candidate POST that lands on a
    # different worker than the original /offer would 404 the session.
    # Run multiple replicas at the pod level if you need to scale, with sticky
    # session routing at the ingress.
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        workers=1,
    )
