"""Structured JSON logging setup for the ai-service.

Provides:
- correlation_id_var: ContextVar carrying the per-request correlation id
- get_correlation_id(): convenience accessor
- redact(value): recursive PII scrubber
- JsonFormatter: pythonjsonlogger subclass producing the project log spec
- setup_logging(level): wires the root logger to stdout JSON output

Log shape:
    {
        "ts": "2026-04-29T12:00:00.123Z",
        "level": "info",
        "service": "ai-service",
        "msg": "...",
        "correlationId": "...",
        ...extras
    }
"""

from __future__ import annotations

import logging
import os
import re
import sys
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Optional

try:
    # python-json-logger >= 2.x
    from pythonjsonlogger import jsonlogger as _jsonlogger
    _BaseJsonFormatter = _jsonlogger.JsonFormatter
except Exception:  # pragma: no cover - fallback for newer versions
    from pythonjsonlogger.json import JsonFormatter as _BaseJsonFormatter  # type: ignore


# ---------------------------------------------------------------------------
# Correlation ID
# ---------------------------------------------------------------------------

correlation_id_var: ContextVar[Optional[str]] = ContextVar(
    "correlation_id_var", default=None
)


def get_correlation_id() -> Optional[str]:
    """Return the current correlation id, or None if outside a request scope."""
    try:
        return correlation_id_var.get()
    except LookupError:
        return None


# ---------------------------------------------------------------------------
# PII redaction
# ---------------------------------------------------------------------------

_PHONE_PATTERNS = [
    re.compile(r"\(\d{3}\)\s?\d{3}-?\d{4}"),
    re.compile(r"\+?\d{10,15}"),
]
_EMAIL_PATTERN = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
)
_JWT_PATTERN = re.compile(r"Bearer\s+[A-Za-z0-9._\-]+")

_REDACT_KEYS = {
    "apikey",
    "api_key",
    "authorization",
    "password",
    "secret",
    "token",
    "x-api-key",
}


def _redact_string(text: str) -> str:
    if not text:
        return text
    out = _JWT_PATTERN.sub("Bearer [REDACTED]", text)
    out = _EMAIL_PATTERN.sub("[EMAIL]", out)
    for pat in _PHONE_PATTERNS:
        out = pat.sub("[PHONE]", out)
    return out


def redact(value: Any) -> Any:
    """Recursively scrub PII and sensitive keys from value.

    - Strings: replace phone numbers, emails, and Bearer tokens.
    - Dicts: redact sensitive keys (case-insensitive); recurse into values.
    - Lists/tuples: recurse element-wise.
    - Other types: returned unchanged.
    """
    if isinstance(value, str):
        return _redact_string(value)
    if isinstance(value, dict):
        result: dict = {}
        for k, v in value.items():
            key_str = str(k)
            if key_str.lower() in _REDACT_KEYS:
                result[k] = "[REDACTED]"
            else:
                result[k] = redact(v)
        return result
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, tuple):
        return tuple(redact(v) for v in value)
    return value


# ---------------------------------------------------------------------------
# JSON formatter
# ---------------------------------------------------------------------------

_PY_LEVEL_TO_SPEC = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "WARN": "warn",
    "ERROR": "error",
    "CRITICAL": "error",
    "FATAL": "error",
}


# Standard LogRecord attributes we should not echo as "extras".
_RESERVED_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


class JsonFormatter(_BaseJsonFormatter):
    """Custom JSON formatter producing the shared log spec.

    Renames keys to (`ts`, `level`, `msg`), maps Python `WARNING` to `warn`,
    injects `service` + `correlationId`, and runs everything through `redact`.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

    def add_fields(self, log_record: dict, record: logging.LogRecord, message_dict: dict) -> None:  # type: ignore[override]
        super().add_fields(log_record, record, message_dict)

        # Timestamp in ISO 8601 UTC with trailing Z, millisecond precision.
        ts = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
        log_record["ts"] = ts

        # Map level name to the spec form.
        raw_level = log_record.get("level") or log_record.get("levelname") or record.levelname
        log_record["level"] = _PY_LEVEL_TO_SPEC.get(str(raw_level).upper(), str(raw_level).lower())
        log_record.pop("levelname", None)

        # Message under "msg".
        msg = log_record.pop("message", None)
        if msg is None:
            msg = record.getMessage()
        log_record["msg"] = redact(msg)

        # Service and correlation id.
        log_record["service"] = "ai-service"
        log_record["correlationId"] = get_correlation_id()

        # Logger name as helpful context (not in spec but useful).
        log_record.setdefault("logger", record.name)

        # Pull extras attached via `logger.x(..., extra={...})` and redact them.
        for attr, val in record.__dict__.items():
            if attr in _RESERVED_RECORD_ATTRS:
                continue
            if attr.startswith("_"):
                continue
            if attr in log_record:
                continue
            log_record[attr] = redact(val)

        # Redact any nested values that may have been added by the base class.
        for key in list(log_record.keys()):
            if key in {"ts", "level", "service", "correlationId", "msg", "logger"}:
                continue
            log_record[key] = redact(log_record[key])

        # Drop the unused `asctime` key if present.
        log_record.pop("asctime", None)


# ---------------------------------------------------------------------------
# setup_logging
# ---------------------------------------------------------------------------

_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


def _resolve_level(level: Optional[str]) -> int:
    if level is None:
        level = os.getenv("LOG_LEVEL", "info")
    return _LEVEL_MAP.get(str(level).strip().lower(), logging.INFO)


def setup_logging(level: Optional[str] = None) -> logging.Logger:
    """Configure root logger to emit JSON lines to stdout.

    - Removes default handlers
    - Installs a single stdout StreamHandler with JsonFormatter
    - Silences noisy libraries at WARNING
    - Returns the root logger
    """
    log_level = _resolve_level(level)

    root = logging.getLogger()
    root.setLevel(log_level)

    # Remove pre-existing handlers (e.g., from logging.basicConfig).
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setLevel(log_level)
    formatter = JsonFormatter(
        # Field set is overridden by add_fields(); keep the base format minimal.
        "%(message)s"
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)

    # Silence noisy libs.
    for noisy in ("httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return root


def with_correlation_header(headers: Optional[dict] = None) -> dict:
    """Return a headers dict with the current correlation id injected.

    Use when making outbound HTTP calls so backend services can correlate
    work to the originating request.
    """
    out = dict(headers or {})
    cid = get_correlation_id()
    if cid:
        out.setdefault("x-correlation-id", cid)
    return out


__all__ = [
    "correlation_id_var",
    "get_correlation_id",
    "with_correlation_header",
    "redact",
    "JsonFormatter",
    "setup_logging",
]
