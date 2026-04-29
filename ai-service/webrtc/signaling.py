from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from webrtc.media_session import MediaSession

logger = logging.getLogger(__name__)
router = APIRouter()

_SESSIONS: dict[str, MediaSession] = {}

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


@router.post("/customer/offer")
async def customer_offer(body: CustomerOffer) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    session = MediaSession(
        session_id=sid, role="customer",
        user_or_session_id=body.session_token,
        system_prompt=_CUSTOMER_PROMPT, tools=[],
    )
    answer = await session.start_with_offer(body.sdp)
    _SESSIONS[sid] = session
    return {"session_id": sid, "sdp": answer}


@router.post("/employee/offer")
async def employee_offer(body: EmployeeOffer, x_internal_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_internal(x_internal_key)
    sid = str(uuid.uuid4())
    session = MediaSession(
        session_id=sid, role="employee",
        user_or_session_id=body.user_id,
        system_prompt=_EMPLOYEE_PROMPT, tools=[],
    )
    answer = await session.start_with_offer(body.sdp)
    _SESSIONS[sid] = session
    return {"session_id": sid, "sdp": answer}


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
    if session:
        await session.close()
    return {"ok": True}
