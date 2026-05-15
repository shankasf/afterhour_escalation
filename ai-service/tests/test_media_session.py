"""Tests for MediaSession lifecycle.

Focus on Bundle B5: any failure inside ``start_with_offer`` (specifically
``_open_realtime`` or ``createAnswer``) must call ``close()`` so the
RTCPeerConnection and OpenAI websocket do not leak.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from webrtc.media_session import MediaSession


@pytest.fixture
def fake_pc() -> MagicMock:
    pc = MagicMock(name="RTCPeerConnection")
    pc.on = MagicMock(side_effect=lambda *_a, **_kw: (lambda fn: fn))
    pc.addTransceiver = MagicMock()
    pc.addTrack = MagicMock()
    pc.setRemoteDescription = AsyncMock(return_value=None)
    pc.createAnswer = AsyncMock(return_value=MagicMock(sdp="v=0\r\nans\r\n", type="answer"))
    pc.setLocalDescription = AsyncMock(return_value=None)
    pc.close = AsyncMock(return_value=None)
    pc.localDescription = MagicMock(sdp="v=0\r\nans\r\n")
    return pc


@pytest.mark.asyncio
async def test_open_realtime_failure_closes_peer_connection(fake_pc):
    session = MediaSession(
        session_id="sid-1",
        role="customer",
        user_or_session_id="tok",
        system_prompt="prompt",
        tools=[],
    )

    with patch("webrtc.media_session.RTCPeerConnection", return_value=fake_pc):
        # Force _open_realtime to blow up after the PC is created.
        with patch.object(
            MediaSession, "_open_realtime", new=AsyncMock(side_effect=RuntimeError("ws-fail"))
        ):
            with pytest.raises(RuntimeError, match="ws-fail"):
                await session.start_with_offer("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n")

    # close() must have been triggered by the error path, which closes the PC.
    assert fake_pc.close.await_count >= 1
    # The session's reference to pc should be cleared by close().
    assert session.pc is None


@pytest.mark.asyncio
async def test_create_answer_failure_closes_pc_and_ws(fake_pc):
    session = MediaSession(
        session_id="sid-2",
        role="employee",
        user_or_session_id="user-1",
        system_prompt="prompt",
        tools=[],
    )

    fake_ws = AsyncMock(name="RealtimeWS")
    fake_ws.close = AsyncMock(return_value=None)
    fake_ws.send = AsyncMock(return_value=None)

    async def _fake_open_realtime(self) -> None:
        self.ws = fake_ws

    fake_pc.createAnswer = AsyncMock(side_effect=RuntimeError("sdp-bad"))

    with patch("webrtc.media_session.RTCPeerConnection", return_value=fake_pc):
        with patch.object(MediaSession, "_open_realtime", new=_fake_open_realtime):
            with pytest.raises(RuntimeError, match="sdp-bad"):
                await session.start_with_offer("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n")

    assert fake_pc.close.await_count >= 1
    assert fake_ws.close.await_count >= 1
    assert session.ws is None
    assert session.pc is None


@pytest.mark.asyncio
async def test_close_is_idempotent_after_partial_setup():
    session = MediaSession(
        session_id="sid-3",
        role="customer",
        user_or_session_id="tok",
        system_prompt="prompt",
        tools=[],
    )
    # close() called before start_with_offer must not raise.
    await session.close()
    # And calling it twice is still safe.
    await session.close()


def test_default_transcription_model_is_modern():
    from webrtc.media_session import DEFAULT_TRANSCRIPTION_MODEL

    # Should NOT be the legacy whisper-1 default.
    assert DEFAULT_TRANSCRIPTION_MODEL == "gpt-4o-transcribe"


def test_load_ice_servers_respects_env_json(monkeypatch):
    from webrtc import media_session as ms

    monkeypatch.setenv(
        "ICE_SERVERS_JSON",
        '[{"urls": ["turn:turn.example.com:3478"], "username": "u", "credential": "p"}]',
    )
    servers = ms._load_ice_servers()
    assert len(servers) == 1
    assert servers[0].username == "u"


def test_load_ice_servers_falls_back_on_bad_env(monkeypatch):
    from webrtc import media_session as ms

    monkeypatch.setenv("ICE_SERVERS_JSON", "{not json")
    monkeypatch.delenv("TURN_HOST", raising=False)
    servers = ms._load_ice_servers()
    assert len(servers) == 1
    # Falls back to Google STUN.
    assert any("stun:" in u for u in servers[0].urls)
