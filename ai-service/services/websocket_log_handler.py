"""
Custom logging handler that sends logs to backend via HTTP for real-time dashboard display.
"""
import logging
import threading
import queue
import time
import os
from typing import Optional
import httpx

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

    def _format_record(self, record: logging.LogRecord) -> dict:
        """Format a log record into a JSON-serializable dict."""
        level_map = {
            logging.DEBUG: 'debug',
            logging.INFO: 'info',
            logging.WARNING: 'warn',
            logging.ERROR: 'error',
            logging.CRITICAL: 'error',
        }

        return {
            'level': level_map.get(record.levelno, 'info'),
            'message': record.getMessage(),
            'logger': record.name,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(record.created)),
            'details': {
                'filename': record.filename,
                'lineno': record.lineno,
                'funcName': record.funcName,
            }
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
                        headers={'x-api-key': self.api_key}
                    )
                else:
                    # Batch logs
                    client.post(
                        self.batch_endpoint,
                        json=batch,
                        headers={'x-api-key': self.api_key}
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
