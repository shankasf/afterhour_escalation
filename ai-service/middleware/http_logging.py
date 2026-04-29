"""HTTP request/response logging middleware.

Logs one structured line per completed HTTP request with method, path,
status_code, duration_ms, client_ip, and the active correlation id (the
correlation id is added automatically by the JsonFormatter).

Skips noisy paths (`/health`, `/docs`, `/openapi.json`).
"""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("ai-service.http")

_SKIP_PATHS = {"/health", "/docs", "/openapi.json"}


def _level_for_status(status_code: int) -> int:
    if status_code >= 500:
        return logging.ERROR
    if status_code >= 400:
        return logging.WARNING
    return logging.INFO


class HttpLoggingMiddleware(BaseHTTPMiddleware):
    """Emit one structured log entry per HTTP request."""

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if path in _SKIP_PATHS or path.startswith("/health/"):
            return await call_next(request)

        start = time.perf_counter()
        client_ip = request.client.host if request.client else None
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.exception(
                "http request failed",
                extra={
                    "method": request.method,
                    "path": path,
                    "status_code": 500,
                    "duration_ms": duration_ms,
                    "client_ip": client_ip,
                },
            )
            raise

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.log(
            _level_for_status(response.status_code),
            "http %s %s -> %s",
            request.method,
            path,
            response.status_code,
            extra={
                "method": request.method,
                "path": path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip,
            },
        )
        return response
