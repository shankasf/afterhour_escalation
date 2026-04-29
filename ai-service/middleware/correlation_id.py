"""Correlation ID middleware.

Reads (or generates) the `x-correlation-id` request header, sets it on the
`correlation_id_var` ContextVar so all downstream logs and outbound HTTP
clients can pick it up, and echoes it on the response.
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from logging_setup import correlation_id_var

_HEADER = "x-correlation-id"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Ensures a correlation id exists for every request and is echoed back."""

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = request.headers.get(_HEADER)
        cid = incoming if incoming else str(uuid.uuid4())

        token = correlation_id_var.set(cid)
        try:
            response = await call_next(request)
            response.headers[_HEADER] = cid
            return response
        finally:
            correlation_id_var.reset(token)
