from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections import deque
from datetime import timezone
from typing import Any
from uuid import UUID

import httpx
from aiortc import RTCIceCandidate  # re-exported for tests / future use
from aiortc.sdp import candidate_from_sdp
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from logging_setup import with_correlation_header
from services.agent_tracking import isoformat, publish_agent_trace, utc_now
from webrtc.media_session import MediaSession

logger = logging.getLogger(__name__)
router = APIRouter()

# NOTE: _SESSIONS is a module-global dict. The AI service MUST run with a
# single uvicorn worker — multiple workers would each hold their own copy of
# this dict and break session lookup. See main.py where workers=1 is enforced.
_SESSIONS: dict[str, MediaSession] = {}
_SESSION_META: dict[str, dict[str, Any]] = {}
_SESSION_LAST_ACTIVITY: dict[str, float] = {}

# Hard cap on concurrent in-memory sessions before we start shedding load.
_MAX_SESSIONS = int(os.environ.get("WEBRTC_MAX_SESSIONS", "50"))
# Sessions older than this (seconds since last activity) get reaped.
_IDLE_TIMEOUT_SECONDS = int(os.environ.get("WEBRTC_IDLE_TIMEOUT_SECONDS", "600"))
# Reaper sweep interval.
_REAPER_INTERVAL_SECONDS = int(os.environ.get("WEBRTC_REAPER_INTERVAL_SECONDS", "60"))

# Per-IP token bucket: ip -> deque[float timestamps] for customer offer rate limit.
_OFFER_RATE_LIMIT_WINDOW_SECONDS = 60.0
_OFFER_RATE_LIMIT_MAX = int(os.environ.get("WEBRTC_OFFER_RATE_LIMIT_PER_MIN", "10"))
_OFFER_RATE_BUCKETS: dict[str, deque[float]] = {}
_OFFER_RATE_LOCK = asyncio.Lock()

# Resolved once at module import time so a missing key surfaces fast.
_INTERNAL_KEY_AT_IMPORT = os.environ.get("INTERNAL_API_KEY") or os.environ.get("internal_api_key")
_ENV_NAME = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "production").lower()
_IS_DEV_ENV = _ENV_NAME in ("dev", "development", "local", "test")

# Background reaper handle (set by lifespan startup in main.py).
_reaper_task: asyncio.Task | None = None

_CUSTOMER_PROMPT = (
    "You are the after-hours intake voice assistant. Be calm and concise. "
    "Gather: caller name, callback number, building/unit, issue, safety concerns. "
    "Once enough info is gathered, tell them a human responder is being paged."
)
_EMPLOYEE_PROMPT = (
    "You are the after-hours emergency dispatcher reading a script to the on-call responder. "
    "Read the provided script verbatim, then listen for ACK or decline. End the call after acknowledgment."
)


class CustomerOffer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_token: str = Field(min_length=1, max_length=512)
    sdp: str = Field(max_length=64_000)


class EmployeeOffer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=128)
    event_id: str = Field(min_length=1, max_length=128)
    sdp: str = Field(max_length=64_000)


class IceCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # `candidate` may be empty/None for end-of-candidates per WebRTC spec.
    candidate: str | None = Field(default=None, max_length=2048)
    sdpMid: str | None = Field(default=None, max_length=128)
    sdpMLineIndex: int | None = Field(default=None, ge=0, le=64)
    usernameFragment: str | None = Field(default=None, max_length=256)


def _backend_url() -> str:
    return os.environ.get("BACKEND_URL") or os.environ.get("backend_url") or "http://localhost:3004"


def _require_internal(x_internal_key: str | None) -> None:
    """Fail-closed internal key check.

    Resolves the expected key from env at import time. In non-dev environments
    a missing/empty key is a misconfiguration and we return 500 so traffic
    cannot silently bypass auth.
    """
    expected = _INTERNAL_KEY_AT_IMPORT
    if not expected:
        if _IS_DEV_ENV:
            # Dev only: accept any header so local dev isn't blocked.
            return
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_key_misconfigured"},
        )
    if x_internal_key != expected:
        raise HTTPException(status_code=401, detail={"code": "invalid_internal_key"})


def _client_ip(request: Request) -> str:
    # Honor common proxy headers (k3s / nginx ingress) before falling back to peer.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def _enforce_offer_rate_limit(ip: str) -> None:
    """Per-IP token bucket: at most _OFFER_RATE_LIMIT_MAX offers per minute."""
    now = time.monotonic()
    cutoff = now - _OFFER_RATE_LIMIT_WINDOW_SECONDS
    async with _OFFER_RATE_LOCK:
        bucket = _OFFER_RATE_BUCKETS.setdefault(ip, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _OFFER_RATE_LIMIT_MAX:
            raise HTTPException(
                status_code=429,
                detail={"code": "rate_limited", "retry_after_seconds": int(_OFFER_RATE_LIMIT_WINDOW_SECONDS)},
            )
        bucket.append(now)


async def _validate_customer_session(session_token: str) -> None:
    """Reject if backend cannot resolve the chat session."""
    url = f"{_backend_url()}/api/customer-chat/{session_token}/messages"
    headers = with_correlation_header({"x-internal-key": _INTERNAL_KEY_AT_IMPORT or ""})
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("Customer session validation failed (network): %s", exc)
        raise HTTPException(status_code=503, detail={"code": "session_validation_unavailable"})
    if resp.status_code == 404:
        raise HTTPException(status_code=403, detail={"code": "invalid_session_token"})
    if resp.status_code >= 500:
        raise HTTPException(status_code=503, detail={"code": "session_validation_unavailable"})
    if resp.status_code not in (200, 201):
        # Treat any other non-2xx as invalid.
        raise HTTPException(status_code=403, detail={"code": "invalid_session_token"})


def _touch(sid: str) -> None:
    _SESSION_LAST_ACTIVITY[sid] = time.monotonic()


def _enforce_capacity() -> None:
    if len(_SESSIONS) >= _MAX_SESSIONS:
        raise HTTPException(status_code=503, detail={"code": "server_busy"})


async def _reaper_loop() -> None:
    """Periodically close idle sessions."""
    while True:
        try:
            await asyncio.sleep(_REAPER_INTERVAL_SECONDS)
            cutoff = time.monotonic() - _IDLE_TIMEOUT_SECONDS
            stale = [sid for sid, ts in list(_SESSION_LAST_ACTIVITY.items()) if ts < cutoff]
            for sid in stale:
                session = _SESSIONS.pop(sid, None)
                _SESSION_META.pop(sid, None)
                _SESSION_LAST_ACTIVITY.pop(sid, None)
                if session:
                    logger.info("Reaping idle voice session %s", sid)
                    try:
                        await session.close()
                    except Exception as exc:
                        logger.warning("Reaper close error for %s: %s", sid, exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Reaper iteration failed: %s", exc)


async def start_reaper() -> None:
    """Start the idle-session reaper. Called from FastAPI lifespan in main.py."""
    global _reaper_task
    if _reaper_task is None or _reaper_task.done():
        _reaper_task = asyncio.create_task(_reaper_loop(), name="webrtc-reaper")
        logger.info(
            "WebRTC reaper started (interval=%ds, idle_timeout=%ds, max_sessions=%d)",
            _REAPER_INTERVAL_SECONDS,
            _IDLE_TIMEOUT_SECONDS,
            _MAX_SESSIONS,
        )


async def stop_reaper() -> None:
    """Stop the reaper. Called from FastAPI lifespan in main.py."""
    global _reaper_task
    if _reaper_task and not _reaper_task.done():
        _reaper_task.cancel()
        try:
            await _reaper_task
        except asyncio.CancelledError:
            pass
        _reaper_task = None


def _voice_spans(sid: str, role: str, started_at, ended_at, status: str, error: str | None,
                 sdp_offer_len: int, answer_len: int, transcript_len: int) -> list[dict]:
    base = isoformat(started_at.astimezone(timezone.utc))
    end = isoformat(ended_at.astimezone(timezone.utc))
    spans = [
        {
            "spanId": "sdp_offer_received",
            "name": "sdp_offer_received",
            "runType": "tool",
            "status": "success",
            "inputs": {"role": role, "offer_bytes": sdp_offer_len},
            "startedAt": base,
            "endedAt": base,
        },
        {
            "spanId": "realtime_ws_connect",
            "name": "realtime_ws_connect",
            "runType": "llm",
            "status": "error" if error else "success",
            "outputs": {"error": error} if error else {"connected": True},
            "startedAt": base,
            "endedAt": end,
        },
        {
            "spanId": "sdp_answer_sent",
            "name": "sdp_answer_sent",
            "runType": "tool",
            "status": "error" if error else "success",
            "outputs": {"answer_bytes": answer_len},
            "startedAt": end,
            "endedAt": end,
        },
        {
            "spanId": "voice_session",
            "name": "voice_session",
            "runType": "chain",
            "status": status,
            "outputs": {"transcript_turns": transcript_len},
            "startedAt": base,
            "endedAt": end,
        },
    ]
    return spans


async def _publish_voice_trace(sid: str, *, role: str, actor_id: str, event_id: str | None,
                                started_at, ended_at, status: str, error: str | None,
                                sdp_offer_len: int, answer_len: int, transcript_len: int) -> None:
    latency_ms = int((ended_at - started_at).total_seconds() * 1000)
    project = os.environ.get("LANGSMITH_PROJECT", "after-hours-agent")
    trace_id = f"voice_{sid}"
    await publish_agent_trace(
        {
            "traceId": trace_id,
            "eventId": event_id,
            "threadId": actor_id,
            "project": project,
            "title": f"Voice {role} session {sid[:8]}",
            "source": f"voice_{role}",
            "status": status,
            "latencyMs": latency_ms,
            "errorMessage": error,
            "metadata": {
                "session_id": sid,
                "role": role,
                "actor_id": actor_id,
                "transport": "webrtc",
                "model": "gpt-realtime",
            },
            "tags": ["production", project, "voice", role, "webrtc"],
            "startedAt": isoformat(started_at.astimezone(timezone.utc)),
            "endedAt": isoformat(ended_at.astimezone(timezone.utc)),
            "spans": _voice_spans(sid, role, started_at, ended_at, status,
                                  error, sdp_offer_len, answer_len, transcript_len),
        }
    )


def _wire_ice_cleanup(session: MediaSession) -> None:
    """Auto-close a session when its peer connection enters a terminal ICE state."""
    pc = session.pc
    if pc is None:
        return

    @pc.on("iceconnectionstatechange")
    async def _on_ice_state_change() -> None:  # pragma: no cover - depends on real ICE
        state = pc.iceConnectionState
        if state in ("failed", "disconnected", "closed"):
            logger.info("ICE state %s for session %s, closing", state, session.session_id)
            _SESSIONS.pop(session.session_id, None)
            _SESSION_META.pop(session.session_id, None)
            _SESSION_LAST_ACTIVITY.pop(session.session_id, None)
            try:
                await session.close()
            except Exception as exc:
                logger.warning("Cleanup close after ICE %s failed: %s", state, exc)


@router.post("/customer/offer", status_code=201)
async def customer_offer(body: CustomerOffer, request: Request) -> dict[str, Any]:
    await _enforce_offer_rate_limit(_client_ip(request))
    await _validate_customer_session(body.session_token)
    _enforce_capacity()

    sid = str(uuid.uuid4())
    started_at = utc_now()
    session = MediaSession(
        session_id=sid, role="customer",
        user_or_session_id=body.session_token,
        system_prompt=_CUSTOMER_PROMPT, tools=[],
    )
    error: str | None = None
    answer = ""
    try:
        answer = await session.start_with_offer(body.sdp)
        _SESSIONS[sid] = session
        _SESSION_META[sid] = {
            "role": "customer",
            "actor_id": body.session_token,
            "event_id": None,
            "started_at": started_at,
            "sdp_offer_len": len(body.sdp or ""),
            "answer_len": len(answer or ""),
        }
        _touch(sid)
        _wire_ice_cleanup(session)
        return {"session_id": sid, "sdp": answer}
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        # Make sure we don't leak the PC / OpenAI WS on any failure path.
        try:
            await session.close()
        except Exception as close_exc:
            logger.warning("close() during customer_offer error cleanup failed: %s", close_exc)
        await _publish_voice_trace(
            sid, role="customer", actor_id=body.session_token, event_id=None,
            started_at=started_at, ended_at=utc_now(),
            status="error", error=error,
            sdp_offer_len=len(body.sdp or ""), answer_len=0, transcript_len=0,
        )
        raise


@router.post("/employee/offer", status_code=201)
async def employee_offer(body: EmployeeOffer, x_internal_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_internal(x_internal_key)
    _enforce_capacity()

    sid = str(uuid.uuid4())
    started_at = utc_now()
    session = MediaSession(
        session_id=sid, role="employee",
        user_or_session_id=body.user_id,
        system_prompt=_EMPLOYEE_PROMPT, tools=[],
    )
    error: str | None = None
    answer = ""
    try:
        answer = await session.start_with_offer(body.sdp)
        _SESSIONS[sid] = session
        _SESSION_META[sid] = {
            "role": "employee",
            "actor_id": body.user_id,
            "event_id": body.event_id,
            "started_at": started_at,
            "sdp_offer_len": len(body.sdp or ""),
            "answer_len": len(answer or ""),
        }
        _touch(sid)
        _wire_ice_cleanup(session)
        return {"session_id": sid, "sdp": answer}
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        try:
            await session.close()
        except Exception as close_exc:
            logger.warning("close() during employee_offer error cleanup failed: %s", close_exc)
        await _publish_voice_trace(
            sid, role="employee", actor_id=body.user_id, event_id=body.event_id,
            started_at=started_at, ended_at=utc_now(),
            status="error", error=error,
            sdp_offer_len=len(body.sdp or ""), answer_len=0, transcript_len=0,
        )
        raise


def _parse_ice_payload(body: IceCandidate) -> RTCIceCandidate | None:
    """Convert a browser-shaped RTCIceCandidateInit into aiortc's RTCIceCandidate.

    Returns None for end-of-candidates (empty string or null candidate).
    Raises HTTPException(400) on malformed input.
    """
    raw = body.candidate
    if raw is None or raw.strip() == "":
        return None

    # Browser RTCIceCandidate.toJSON() emits 'candidate:foundation ...'
    sdp_part = raw[len("candidate:"):] if raw.startswith("candidate:") else raw
    try:
        cand = candidate_from_sdp(sdp_part)
    except (AssertionError, ValueError, IndexError) as exc:
        logger.warning("Malformed ICE candidate: %s", exc)
        raise HTTPException(status_code=400, detail={"code": "invalid_ice_candidate"})

    cand.sdpMid = body.sdpMid
    cand.sdpMLineIndex = body.sdpMLineIndex
    return cand


@router.post("/{session_id}/candidate")
async def candidate(session_id: UUID, body: IceCandidate) -> dict[str, Any]:
    sid = str(session_id)
    session = _SESSIONS.get(sid)
    if not session:
        raise HTTPException(status_code=404, detail={"code": "session_not_found"})
    if session.pc is None:
        raise HTTPException(status_code=409, detail={"code": "peer_connection_not_ready"})

    ice = _parse_ice_payload(body)
    _touch(sid)
    if ice is None:
        # End-of-candidates: aiortc has no public API for this, just ack.
        return {"ok": True, "end_of_candidates": True}
    try:
        await session.pc.addIceCandidate(ice)
    except Exception as exc:
        logger.warning("addIceCandidate failed for %s: %s", sid, exc)
        raise HTTPException(status_code=400, detail={"code": "ice_candidate_rejected"})
    return {"ok": True}


@router.post("/{session_id}/close")
async def close(session_id: UUID) -> dict[str, Any]:
    sid = str(session_id)
    session = _SESSIONS.pop(sid, None)
    meta = _SESSION_META.pop(sid, None)
    _SESSION_LAST_ACTIVITY.pop(sid, None)
    if session:
        try:
            await session.close()
        except Exception as exc:
            logger.warning("Voice session close error: %s", exc)
    if meta:
        transcript_len = len(getattr(session, "transcript_buffer", []) or []) if session else 0
        await _publish_voice_trace(
            sid,
            role=meta["role"],
            actor_id=meta["actor_id"],
            event_id=meta.get("event_id"),
            started_at=meta["started_at"],
            ended_at=utc_now(),
            status="success" if transcript_len > 0 else "no_audio",
            error=None if transcript_len > 0 else "Session closed without any transcript turns",
            sdp_offer_len=meta["sdp_offer_len"],
            answer_len=meta["answer_len"],
            transcript_len=transcript_len,
        )
    return {"ok": True}
