"""
Custom logging handler that sends logs to backend via HTTP for real-time dashboard display.

Reads structured fields directly from the LogRecord (matching the JSON spec
emitted by `logging_setup.JsonFormatter`) and forwards them — including
`correlationId` and any extras — to the backend.
"""
import logging
import threading
import queue
import time
import os
from datetime import datetime
from typing import Any, Dict, Optional
import httpx

from logging_setup import get_correlation_id, redact, with_correlation_header

# Standard LogRecord attributes — anything else attached to the record is
# considered an "extra" we want to forward as structured context.
_RESERVED_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}

_PY_LEVEL_TO_SPEC = {
    logging.DEBUG: 'debug',
    logging.INFO: 'info',
    logging.WARNING: 'warn',
    logging.ERROR: 'error',
    logging.CRITICAL: 'error',
}


class WebSocketLogHandler(logging.Handler):
    """
    A logging handler that sends log records to the backend service via HTTP.
    The backend then broadcasts them via WebSocket to connected dashboards.
    """

    def __init__(
        self,
        backend_url: Optional[str] = None,
        api_key: Optional[str] = None,
        batch_size: int = 10,
        flush_interval: float = 1.0,
        level: int = logging.DEBUG,
    ):
        super().__init__(level)
        self.backend_url = backend_url or os.getenv('BACKEND_URL', 'http://localhost:3004')
        self.api_key = api_key or os.getenv('INTERNAL_API_KEY', 'internal-service-key')
        self.endpoint = f"{self.backend_url}/api/internal/logs"
        self.batch_endpoint = f"{self.backend_url}/api/internal/logs/batch"
        self.batch_size = batch_size
        self.flush_interval = flush_interval

        # Queue for batching logs
        self.log_queue: queue.Queue = queue.Queue()
        self._shutdown = False

        # Start background thread for sending logs
        self._sender_thread = threading.Thread(target=self._sender_loop, daemon=True)
        self._sender_thread.start()

    def emit(self, record: logging.LogRecord):
        """Queue the log record for sending."""
        try:
            log_entry = self._format_record(record)
            self.log_queue.put(log_entry)
        except Exception:
            self.handleError(record)

    def _format_record(self, record: logging.LogRecord) -> Dict[str, Any]:
        """Format a log record into a JSON-serializable dict that matches the shared spec."""
        # ISO 8601 UTC with trailing Z, millisecond precision.
        ts = datetime.utcfromtimestamp(record.created).isoformat(timespec="milliseconds") + "Z"

        # Capture any "extra=" fields attached to the record.
        extras: Dict[str, Any] = {}
        for attr, val in record.__dict__.items():
            if attr in _RESERVED_RECORD_ATTRS or attr.startswith("_"):
                continue
            extras[attr] = redact(val)

        return {
            'ts': ts,
            'timestamp': ts,  # backward-compat with existing backend consumer
            'level': _PY_LEVEL_TO_SPEC.get(record.levelno, 'info'),
            'service': 'ai-service',
            'msg': redact(record.getMessage()),
            'message': redact(record.getMessage()),  # backward-compat
            'logger': record.name,
            'correlationId': get_correlation_id(),
            'details': {
                'filename': record.filename,
                'lineno': record.lineno,
                'funcName': record.funcName,
                **extras,
            },
        }

    def _sender_loop(self):
        """Background loop that batches and sends logs."""
        batch = []
        last_flush = time.time()

        while not self._shutdown:
            try:
                # Try to get a log from the queue with timeout
                try:
                    log_entry = self.log_queue.get(timeout=0.1)
                    batch.append(log_entry)
                except queue.Empty:
                    pass

                # Flush if batch is full or interval elapsed
                now = time.time()
                should_flush = (
                    len(batch) >= self.batch_size or
                    (len(batch) > 0 and now - last_flush >= self.flush_interval)
                )

                if should_flush:
                    self._send_batch(batch)
                    batch = []
                    last_flush = now

            except Exception as e:
                # Log to stderr to avoid recursion
                print(f"[WebSocketLogHandler] Error in sender loop: {e}")
                time.sleep(1)  # Backoff on error

    def _send_batch(self, batch: list):
        """Send a batch of logs to the backend."""
        if not batch:
            return

        try:
            # Use fresh client for each batch to avoid stale connections
            with httpx.Client(timeout=5.0) as client:
                if len(batch) == 1:
                    # Single log
                    client.post(
                        self.endpoint,
                        json=batch[0],
                        headers=with_correlation_header({'x-api-key': self.api_key})
                    )
                else:
                    # Batch logs
                    client.post(
                        self.batch_endpoint,
                        json=batch,
                        headers=with_correlation_header({'x-api-key': self.api_key})
                    )
        except Exception as e:
            # Log to stderr to avoid recursion
            print(f"[WebSocketLogHandler] Failed to send logs: {e}")

    def close(self):
        """Shutdown the handler."""
        self._shutdown = True
        self._sender_thread.join(timeout=2.0)
        super().close()


def setup_websocket_logging(logger_names: Optional[list] = None, level: int = logging.DEBUG):
    """
    Set up WebSocket logging for specified loggers.

    Args:
        logger_names: List of logger names to add handler to. If None, adds to root logger.
        level: Minimum log level to send.
    """
    handler = WebSocketLogHandler(level=level)
    handler.setFormatter(logging.Formatter('%(message)s'))

    if logger_names is None:
        # Add to root logger
        logging.getLogger().addHandler(handler)
    else:
        for name in logger_names:
            logging.getLogger(name).addHandler(handler)

    return handler
