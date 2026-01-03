"""
Email UID Tracker - Database-backed persistent storage for processed email UIDs.
Replaces file-based tracking with reliable database storage.
"""

import asyncio
import logging
from typing import Set, Optional
from datetime import datetime
import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmailUidTracker:
    """
    Tracks processed email UIDs using database storage via backend API.
    Provides reliable persistence with proper locking for concurrent access.
    Falls back to in-memory cache if backend is unavailable.
    """

    def __init__(self, max_cache_size: int = 1000):
        self._cache: Set[str] = set()
        self._max_cache_size = max_cache_size
        self._initialized = False
        self._lock = asyncio.Lock()

    async def _load_from_backend(self) -> None:
        """Load processed UIDs from backend database."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{settings.backend_url}/api/email-tracking/processed-uids",
                    headers={"x-internal-key": settings.internal_api_key},
                )
                if response.status_code == 200:
                    data = response.json()
                    self._cache = set(data.get("uids", []))
                    logger.info(f"Loaded {len(self._cache)} processed UIDs from backend")
                else:
                    logger.warning(f"Failed to load UIDs from backend: {response.status_code}")
        except Exception as e:
            logger.error(f"Error loading UIDs from backend: {e}")

    async def _save_to_backend(self, uid: str) -> bool:
        """Save a processed UID to the backend database."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{settings.backend_url}/api/email-tracking/mark-processed",
                    json={"uid": uid, "processedAt": datetime.utcnow().isoformat()},
                    headers={"x-internal-key": settings.internal_api_key},
                )
                return response.status_code in (200, 201)
        except Exception as e:
            logger.error(f"Error saving UID to backend: {e}")
            return False

    async def is_processed(self, uid: str) -> bool:
        """
        Check if an email UID has been processed.

        Args:
            uid: The email UID to check

        Returns:
            True if already processed, False otherwise
        """
        if not uid:
            return False

        async with self._lock:
            if not self._initialized:
                await self._load_from_backend()
                self._initialized = True

            return uid in self._cache

    async def mark_processed(self, uid: str) -> None:
        """
        Mark an email UID as processed.

        Args:
            uid: The email UID to mark as processed
        """
        if not uid:
            return

        async with self._lock:
            if not self._initialized:
                await self._load_from_backend()
                self._initialized = True

            # Add to local cache first (for quick checks)
            self._cache.add(uid)

            # Trim cache if needed
            if len(self._cache) > self._max_cache_size:
                # Keep most recent half
                excess = len(self._cache) - (self._max_cache_size // 2)
                self._cache = set(list(self._cache)[excess:])

            # Persist to backend (non-blocking best effort)
            asyncio.create_task(self._save_to_backend_safe(uid))

    async def _save_to_backend_safe(self, uid: str) -> None:
        """Save to backend with error handling."""
        try:
            await self._save_to_backend(uid)
        except Exception as e:
            logger.error(f"Failed to persist UID {uid}: {e}")

    def get_processed_count(self) -> int:
        """Get the count of processed UIDs in cache."""
        return len(self._cache)

    async def clear_cache(self) -> None:
        """Clear the in-memory cache (does not affect database)."""
        async with self._lock:
            self._cache.clear()
            self._initialized = False


# Singleton instance
_tracker: Optional[EmailUidTracker] = None


def get_email_uid_tracker() -> EmailUidTracker:
    """Get or create the singleton tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = EmailUidTracker()
    return _tracker
