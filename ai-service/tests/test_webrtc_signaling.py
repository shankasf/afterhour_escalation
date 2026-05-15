"""Tests for the WebRTC signaling endpoints.

Covers Bundle A1 (auth + rate-limit), A2 (fail-closed internal key),
B7 (trickle ICE), B10 (Pydantic hardening), and lifecycle cleanup.

These tests stub out the real ``MediaSession`` so they do not require
aiortc / OpenAI / TURN to actually run.
"""

from __future__ import annotations

import importlib
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _reload_signaling(monkeypatch, *, internal_key: str | None, env_name: str = "production"):
    """Re-import webrtc.signaling so the module-level _INTERNAL_KEY_AT_IMPORT
    picks up the patched env. Returns the freshly imported module."""
    if internal_key is None:
        monkeypatch.delenv("INTERNAL_API_KEY", raising=False)
        monkeypatch.delenv("internal_api_key", raising=False)
    else:
        monkeypatch.setenv("INTERNAL_API_KEY", internal_key)
    monkeypatch.setenv("APP_ENV", env_name)
    # Force re-import so module-globals re-evaluate.
    for mod_name in ("webrtc.signaling",):
        if mod_name in sys.modules:
            del sys.modules[mod_name]
    return importlib.import_module("webrtc.signaling")


def _build_app(signaling_module) -> FastAPI:
    app = FastAPI()
    app.include_router(signaling_module.router, prefix="/webrtc")
    return app


SAMPLE_OFFER_SDP = (
    "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
)


def _patch_media_session(signaling_mod, *, answer_sdp: str = "v=0\r\no=- ans 0 IN IP4 127.0.0.1\r\n",
                          raise_exc: Exception | None = None) -> MagicMock:
    """Replace MediaSession in the signaling module with a controllable mock.

    Returns the class mock so tests can inspect calls.
    """
    instance = MagicMock(name="MediaSessionInstance")
    instance.pc = MagicMock(name="RTCPeerConnection")
    # pc.on is used as a decorator — must return the wrapped function.
    instance.pc.on = MagicMock(side_effect=lambda *_args, **_kw: (lambda fn: fn))
    instance.pc.addIceCandidate = AsyncMock(return_value=None)
    if raise_exc is None:
        instance.start_with_offer = AsyncMock(return_value=answer_sdp)
    else:
        instance.start_with_offer = AsyncMock(side_effect=raise_exc)
    instance.close = AsyncMock(return_value=None)
    instance.transcript_buffer = []
    cls = MagicMock(return_value=instance)
    signaling_mod.MediaSession = cls  # type: ignore[attr-defined]
    return cls


def _patch_publish_trace(signaling_mod) -> AsyncMock:
    stub = AsyncMock(return_value=None)
    signaling_mod._publish_voice_trace = stub  # type: ignore[attr-defined]
    return stub


# ---------------------------------------------------------------------------
# Bundle A2 — fail-closed internal key
# ---------------------------------------------------------------------------


def test_employee_offer_requires_internal_key_header(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        json={"user_id": "u1", "event_id": "e1", "sdp": SAMPLE_OFFER_SDP},
        # no x-internal-key header
    )
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "invalid_internal_key"


def test_employee_offer_500_when_internal_key_missing_in_prod(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key=None, env_name="production")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        headers={"x-internal-key": "anything"},
        json={"user_id": "u1", "event_id": "e1", "sdp": SAMPLE_OFFER_SDP},
    )
    assert resp.status_code == 500
    assert resp.json()["detail"]["code"] == "internal_key_misconfigured"


def test_employee_offer_dev_env_allows_missing_internal_key(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key=None, env_name="development")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        json={"user_id": "u1", "event_id": "e1", "sdp": SAMPLE_OFFER_SDP},
    )
    # Should succeed because dev mode skips the check entirely.
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Bundle A1 — auth + rate-limit /customer/offer
# ---------------------------------------------------------------------------


class _FakeAsyncClient:
    """Minimal stand-in for httpx.AsyncClient used by _validate_customer_session."""

    def __init__(self, responses: dict[str, httpx.Response]):
        self._responses = responses

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *_args: Any) -> None:
        return None

    async def get(self, url: str, headers: dict | None = None) -> httpx.Response:
        for needle, response in self._responses.items():
            if needle in url:
                return response
        # default to 404
        return httpx.Response(404, request=httpx.Request("GET", url))


def _install_fake_httpx(sig, responses: dict[str, httpx.Response], monkeypatch):
    """Patch the httpx.AsyncClient symbol as seen from inside webrtc.signaling.

    Uses monkeypatch so the swap is reverted at test teardown — avoids
    polluting the global httpx module between tests.
    """
    monkeypatch.setattr(
        sig.httpx, "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(responses),
    )


def test_customer_offer_rejects_invalid_session_token(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    # Backend says session token does not exist.
    _install_fake_httpx(sig, {
        "/api/customer-chat/bad-token/messages": httpx.Response(
            404, request=httpx.Request("GET", "http://x/api/customer-chat/bad-token/messages")
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/customer/offer",
        json={"session_token": "bad-token", "sdp": SAMPLE_OFFER_SDP},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "invalid_session_token"


def test_customer_offer_accepts_valid_session_token(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    cls = _patch_media_session(sig, answer_sdp="v=0\r\nans\r\n")
    _patch_publish_trace(sig)
    _install_fake_httpx(sig, {
        "/api/customer-chat/good-token/messages": httpx.Response(
            200,
            json=[{"id": 1, "text": "hi"}],
            request=httpx.Request("GET", "http://x/api/customer-chat/good-token/messages"),
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/customer/offer",
        json={"session_token": "good-token", "sdp": SAMPLE_OFFER_SDP},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["sdp"] == "v=0\r\nans\r\n"
    assert "session_id" in body
    # MediaSession was constructed for the customer role.
    assert cls.call_count == 1
    kwargs = cls.call_args.kwargs
    assert kwargs["role"] == "customer"
    assert kwargs["user_or_session_id"] == "good-token"


def test_customer_offer_rate_limited_per_ip(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    # Tight cap so we hit the limit in the test quickly.
    sig._OFFER_RATE_LIMIT_MAX = 2  # type: ignore[attr-defined]
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    _install_fake_httpx(sig, {
        "/api/customer-chat/": httpx.Response(
            200,
            json=[],
            request=httpx.Request("GET", "http://x/api/customer-chat/"),
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))

    payload = {"session_token": "tok", "sdp": SAMPLE_OFFER_SDP}
    headers = {"x-forwarded-for": "203.0.113.5"}

    r1 = client.post("/webrtc/customer/offer", json=payload, headers=headers)
    r2 = client.post("/webrtc/customer/offer", json=payload, headers=headers)
    r3 = client.post("/webrtc/customer/offer", json=payload, headers=headers)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r3.status_code == 429
    assert r3.json()["detail"]["code"] == "rate_limited"


# ---------------------------------------------------------------------------
# Bundle B10 — Pydantic hardening
# ---------------------------------------------------------------------------


def test_extra_field_rejected_on_employee_offer(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        headers={"x-internal-key": "secret-key"},
        json={
            "user_id": "u1",
            "event_id": "e1",
            "sdp": SAMPLE_OFFER_SDP,
            "extra_attack_field": "boom",
        },
    )
    assert resp.status_code == 422


def test_sdp_over_64k_rejected(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        headers={"x-internal-key": "secret-key"},
        json={"user_id": "u1", "event_id": "e1", "sdp": "x" * 70_000},
    )
    assert resp.status_code == 422


def test_candidate_session_id_must_be_uuid(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/not-a-uuid/candidate",
        json={"candidate": None},
    )
    # FastAPI surfaces invalid path-param UUIDs as 422.
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Bundle B7 — trickle ICE
# ---------------------------------------------------------------------------


def test_candidate_route_calls_add_ice_candidate(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    cls = _patch_media_session(sig)
    _patch_publish_trace(sig)
    _install_fake_httpx(sig, {
        "/api/customer-chat/tok/messages": httpx.Response(
            200,
            json=[],
            request=httpx.Request("GET", "http://x/api/customer-chat/tok/messages"),
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))

    # Create a session via /customer/offer to register it in _SESSIONS.
    offer_resp = client.post(
        "/webrtc/customer/offer",
        json={"session_token": "tok", "sdp": SAMPLE_OFFER_SDP},
    )
    assert offer_resp.status_code == 201
    sid = offer_resp.json()["session_id"]

    # Real-ish browser candidate (typical host candidate).
    cand_payload = {
        "candidate": "candidate:842163049 1 udp 1677729535 192.0.2.1 51234 typ host",
        "sdpMid": "0",
        "sdpMLineIndex": 0,
    }
    resp = client.post(f"/webrtc/{sid}/candidate", json=cand_payload)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # The MediaSession instance is shared, so look it up from _SESSIONS.
    session_instance = sig._SESSIONS[sid]  # type: ignore[attr-defined]
    assert session_instance.pc.addIceCandidate.await_count == 1


def test_candidate_route_accepts_end_of_candidates(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    _install_fake_httpx(sig, {
        "/api/customer-chat/tok/messages": httpx.Response(
            200,
            json=[],
            request=httpx.Request("GET", "http://x/api/customer-chat/tok/messages"),
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))
    offer_resp = client.post(
        "/webrtc/customer/offer",
        json={"session_token": "tok", "sdp": SAMPLE_OFFER_SDP},
    )
    sid = offer_resp.json()["session_id"]

    resp = client.post(f"/webrtc/{sid}/candidate", json={"candidate": None})
    assert resp.status_code == 200
    assert resp.json().get("end_of_candidates") is True


def test_candidate_route_rejects_malformed_candidate(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    _install_fake_httpx(sig, {
        "/api/customer-chat/tok/messages": httpx.Response(
            200,
            json=[],
            request=httpx.Request("GET", "http://x/api/customer-chat/tok/messages"),
        )
    }, monkeypatch)
    client = TestClient(_build_app(sig))
    offer_resp = client.post(
        "/webrtc/customer/offer",
        json={"session_token": "tok", "sdp": SAMPLE_OFFER_SDP},
    )
    sid = offer_resp.json()["session_id"]

    resp = client.post(
        f"/webrtc/{sid}/candidate",
        json={"candidate": "not even close to a candidate line"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_ice_candidate"


def test_candidate_route_404_for_unknown_session(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/00000000-0000-4000-8000-000000000000/candidate",
        json={"candidate": None},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "session_not_found"


# ---------------------------------------------------------------------------
# Bundle B6 — capacity cap
# ---------------------------------------------------------------------------


def test_offer_rejected_when_session_cap_exceeded(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    _patch_media_session(sig)
    _patch_publish_trace(sig)
    sig._MAX_SESSIONS = 0  # type: ignore[attr-defined]
    client = TestClient(_build_app(sig))

    resp = client.post(
        "/webrtc/employee/offer",
        headers={"x-internal-key": "secret-key"},
        json={"user_id": "u1", "event_id": "e1", "sdp": SAMPLE_OFFER_SDP},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "server_busy"


# ---------------------------------------------------------------------------
# Bundle B5 — error path triggers session.close()
# ---------------------------------------------------------------------------


def test_employee_offer_error_closes_session(monkeypatch):
    sig = _reload_signaling(monkeypatch, internal_key="secret-key")
    cls = _patch_media_session(sig, raise_exc=RuntimeError("boom"))
    _patch_publish_trace(sig)
    client = TestClient(_build_app(sig))

    with pytest.raises(Exception):
        client.post(
            "/webrtc/employee/offer",
            headers={"x-internal-key": "secret-key"},
            json={"user_id": "u1", "event_id": "e1", "sdp": SAMPLE_OFFER_SDP},
        )
    # MediaSession was created exactly once; its close() must have been awaited.
    instance = cls.return_value
    assert instance.close.await_count >= 1
