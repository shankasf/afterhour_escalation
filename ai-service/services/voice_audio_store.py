import time
from typing import Dict, Optional, Tuple

# In-memory store for short-lived audio blobs generated for Twilio playback.
# Note: This is intentionally ephemeral (container restart clears it).
_TTL_SECONDS = 60 * 30
_STORE: Dict[str, Tuple[float, bytes]] = {}


def put_audio(audio_id: str, audio_bytes: bytes) -> None:
    _STORE[audio_id] = (time.time(), audio_bytes)


def get_audio(audio_id: str) -> Optional[bytes]:
    now = time.time()
    expired = [key for key, (ts, _) in _STORE.items() if now - ts > _TTL_SECONDS]
    for key in expired:
        _STORE.pop(key, None)

    item = _STORE.get(audio_id)
    if not item:
        return None
    return item[1]
