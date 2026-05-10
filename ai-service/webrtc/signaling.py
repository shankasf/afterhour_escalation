from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.agent_tracking import isoformat, publish_agent_trace, utc_now
from webrtc.media_session import MediaSession

logger = logging.getLogger(__name__)
router = APIRouter()

_SESSIONS: dict[str, MediaSession] = {}
_SESSION_META: dict[str, dict[str, Any]] = {}

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
    session_token: str
    sdp: str


class EmployeeOffer(BaseModel):
    user_id: str
    event_id: str
    sdp: str


class IceCandidate(BaseModel):
    candidate: str
    sdpMid: str | None = None
    sdpMLineIndex: int | None = None


def _require_internal(x_internal_key: str | None) -> None:
    expected = os.environ.get("INTERNAL_API_KEY") or os.environ.get("internal_api_key")
    if expected and x_internal_key != expected:
        raise HTTPException(status_code=401, detail="invalid internal key")


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


@router.post("/customer/offer")
async def customer_offer(body: CustomerOffer) -> dict[str, Any]:
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
        return {"session_id": sid, "sdp": answer}
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        await _publish_voice_trace(
            sid, role="customer", actor_id=body.session_token, event_id=None,
            started_at=started_at, ended_at=utc_now(),
            status="error", error=error,
            sdp_offer_len=len(body.sdp or ""), answer_len=0, transcript_len=0,
        )
        raise


@router.post("/employee/offer")
async def employee_offer(body: EmployeeOffer, x_internal_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_internal(x_internal_key)
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
        return {"session_id": sid, "sdp": answer}
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        await _publish_voice_trace(
            sid, role="employee", actor_id=body.user_id, event_id=body.event_id,
            started_at=started_at, ended_at=utc_now(),
            status="error", error=error,
            sdp_offer_len=len(body.sdp or ""), answer_len=0, transcript_len=0,
        )
        raise


@router.post("/{session_id}/candidate")
async def candidate(session_id: str, body: IceCandidate) -> dict[str, Any]:
    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    # aiortc trickle ICE is largely handled via SDP; we acknowledge for client compatibility.
    return {"ok": True}


@router.post("/{session_id}/close")
async def close(session_id: str) -> dict[str, Any]:
    session = _SESSIONS.pop(session_id, None)
    meta = _SESSION_META.pop(session_id, None)
    if session:
        try:
            await session.close()
        except Exception as exc:
            logger.warning("Voice session close error: %s", exc)
    if meta:
        transcript_len = len(getattr(session, "transcript_buffer", []) or []) if session else 0
        await _publish_voice_trace(
            session_id,
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
