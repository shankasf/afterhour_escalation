from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any, Callable, Optional

import numpy as np
import websockets
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaBlackhole
from aiortc.mediastreams import MediaStreamError, MediaStreamTrack
from av import AudioFrame
from av.audio.resampler import AudioResampler

logger = logging.getLogger(__name__)

REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime"


class _OutgoingAudioTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self) -> None:
        super().__init__()
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._sample_rate = 24000
        self._timestamp = 0

    async def push_pcm16(self, pcm: bytes) -> None:
        await self._queue.put(pcm)

    async def recv(self) -> AudioFrame:
        pcm = await self._queue.get()
        samples = np.frombuffer(pcm, dtype=np.int16).reshape(1, -1)
        frame = AudioFrame.from_ndarray(samples, format="s16", layout="mono")
        frame.sample_rate = self._sample_rate
        frame.pts = self._timestamp
        frame.time_base = self._time_base()
        self._timestamp += samples.shape[1]
        return frame

    @staticmethod
    def _time_base():
        from fractions import Fraction
        return Fraction(1, 24000)


class MediaSession:
    def __init__(self, session_id: str, role: str, user_or_session_id: str,
                 system_prompt: str, tools: Optional[list[dict]] = None,
                 tool_dispatch: Optional[Callable[[str, dict], Any]] = None) -> None:
        self.session_id = session_id
        self.role = role
        self.actor_id = user_or_session_id
        self.system_prompt = system_prompt
        self.tools = tools or []
        self.tool_dispatch = tool_dispatch
        self.pc: Optional[RTCPeerConnection] = None
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self._out_track = _OutgoingAudioTrack()
        self._tasks: list[asyncio.Task] = []
        self._resampler_in = AudioResampler(format="s16", layout="mono", rate=24000)
        self.transcript_buffer: list[dict] = []

    async def start_with_offer(self, sdp_offer: str) -> str:
        ice_servers = [RTCIceServer(urls=["stun:stun.l.google.com:19302"])]
        turn_host = os.environ.get("TURN_HOST")
        if turn_host:
            ice_servers.append(RTCIceServer(urls=[f"turn:{turn_host}"],
                                            username=os.environ.get("TURN_USER", ""),
                                            credential=os.environ.get("TURN_PASSWORD", "")))
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=ice_servers))
        self.pc.addTransceiver("audio", direction="sendrecv")
        self.pc.addTrack(self._out_track)

        @self.pc.on("track")
        def on_track(track: MediaStreamTrack) -> None:
            if track.kind == "audio":
                self._tasks.append(asyncio.create_task(self._pump_inbound(track)))
            else:
                MediaBlackhole().addTrack(track)

        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp_offer, type="offer"))

        await self._open_realtime()

        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        self._tasks.append(asyncio.create_task(self._pump_realtime()))
        return self.pc.localDescription.sdp

    async def _open_realtime(self) -> None:
        api_key = os.environ.get("OPENAI_API_KEY")
        headers = {"Authorization": f"Bearer {api_key}", "OpenAI-Beta": "realtime=v1"}
        self.ws = await websockets.connect(REALTIME_URL, additional_headers=headers, max_size=None)
        await self.ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "instructions": self.system_prompt,
                "voice": os.environ.get("OPENAI_VOICE_NAME", "alloy"),
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {"type": "server_vad"},
                "tools": self.tools,
            },
        }))

    async def _pump_inbound(self, track: MediaStreamTrack) -> None:
        while True:
            try:
                frame = await track.recv()
            except MediaStreamError:
                return
            for resampled in self._resampler_in.resample(frame):
                pcm = resampled.to_ndarray().astype(np.int16).tobytes()
                if self.ws:
                    await self.ws.send(json.dumps({
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(pcm).decode(),
                    }))

    async def _pump_realtime(self) -> None:
        assert self.ws is not None
        async for raw in self.ws:
            evt = json.loads(raw)
            t = evt.get("type", "")
            if t == "response.audio.delta":
                pcm = base64.b64decode(evt.get("delta") or "")
                if pcm:
                    await self._out_track.push_pcm16(pcm)
            elif t in ("response.audio_transcript.delta", "response.text.delta"):
                self.transcript_buffer.append({"role": "assistant", "delta": evt.get("delta", "")})
            elif t == "conversation.item.input_audio_transcription.completed":
                self.transcript_buffer.append({"role": "user", "text": evt.get("transcript", "")})
            elif t == "response.function_call_arguments.done":
                if self.tool_dispatch:
                    name = evt.get("name", "")
                    args = json.loads(evt.get("arguments") or "{}")
                    result = await self._invoke_tool(name, args)
                    await self.ws.send(json.dumps({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": evt.get("call_id"),
                            "output": json.dumps(result),
                        },
                    }))
                    await self.ws.send(json.dumps({"type": "response.create"}))

    async def _invoke_tool(self, name: str, args: dict) -> Any:
        if not self.tool_dispatch:
            return {"error": "no dispatcher"}
        return await self.tool_dispatch(name, args)

    async def close(self) -> None:
        for t in self._tasks:
            t.cancel()
        if self.ws:
            await self.ws.close()
        if self.pc:
            await self.pc.close()
