from __future__ import annotations

from datetime import datetime, timezone


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
from typing import Any, List, Literal, Optional, TypedDict

from pydantic import BaseModel, Field


class TriageOutput(BaseModel):
    decision: Literal["escalate", "monitor", "ignore"]
    priority: Literal["critical", "high", "medium", "low"]
    emergency_score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    issue_summary: str = ""
    location: Optional[str] = None
    equipment: Optional[str] = None
    is_safety_critical: bool = False


class Contact(BaseModel):
    level: int
    role: str
    name: str
    phone: str
    user_id: Optional[str] = None
    email: Optional[str] = None
    is_available: Optional[bool] = None


class SkipEntry(BaseModel):
    contact_user_id: Optional[str] = None
    contact_name: str
    level: int
    reason: str
    skipped_at: datetime = Field(default_factory=_utc_now)


class Attempt(BaseModel):
    level: int
    contact_name: str
    contact_user_id: Optional[str] = None
    channel: Literal["voice_webrtc", "sms", "voicemail", "manual"]
    started_at: datetime = Field(default_factory=_utc_now)
    ended_at: Optional[datetime] = None
    outcome: Literal["acked", "declined", "no_answer", "callback_requested", "in_progress", "failed"] = "in_progress"
    transcript_ref: Optional[str] = None
    notes: Optional[str] = None


class Turn(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    text: str
    modality: Literal["text", "voice"] = "text"
    actor: Optional[str] = None
    at: datetime = Field(default_factory=_utc_now)


class IncidentState(TypedDict, total=False):
    event_id: str
    source: Literal["email", "chat", "manual"]
    raw: dict
    triage: Optional[TriageOutput]
    ladder: List[Contact]
    cursor: int
    skip_list: List[SkipEntry]
    attempts: List[Attempt]
    conversation_log: List[Turn]
    awaiting: Optional[Literal["ack", "callback"]]
    awaiting_deadline: Optional[datetime]
    status: Literal[
        "intake",
        "triaged",
        "after_hours_blocked",
        "outreach",
        "awaiting_ack",
        "awaiting_callback",
        "acknowledged",
        "resolved",
        "exhausted",
        "closed",
    ]
    customer_summary: str
    channel_event: Optional[dict]
