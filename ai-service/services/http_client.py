"""
Resilient HTTP Client with retry logic and circuit breaker.
Implements reliability patterns for external service calls.
"""

import asyncio
import logging
import time
from enum import Enum
from typing import Optional, Dict, Any, Callable
from dataclasses import dataclass, field
import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if recovered


@dataclass
class CircuitBreaker:
    """
    Circuit breaker implementation.
    Prevents cascading failures by failing fast when a service is down.
    """
    failure_threshold: int = 5
    recovery_timeout: float = 30.0
    half_open_max_calls: int = 3

    state: CircuitState = field(default=CircuitState.CLOSED)
    failure_count: int = field(default=0)
    last_failure_time: float = field(default=0.0)
    half_open_calls: int = field(default=0)

    def can_execute(self) -> bool:
        """Check if a request can be executed."""
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
                logger.info("Circuit breaker transitioning to HALF_OPEN")
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            return self.half_open_calls < self.half_open_max_calls

        return False

    def record_success(self) -> None:
        """Record a successful call."""
        if self.state == CircuitState.HALF_OPEN:
            self.half_open_calls += 1
            if self.half_open_calls >= self.half_open_max_calls:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
                logger.info("Circuit breaker transitioning to CLOSED")
        elif self.state == CircuitState.CLOSED:
            self.failure_count = 0

    def record_failure(self) -> None:
        """Record a failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.OPEN
            logger.warning("Circuit breaker transitioning to OPEN (half-open failure)")
        elif self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning(f"Circuit breaker transitioning to OPEN (failures: {self.failure_count})")


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 30.0
    exponential_base: float = 2.0
    jitter: bool = True


class ResilientHttpClient:
    """
    HTTP client with built-in resilience patterns:
    - Exponential backoff retry
    - Circuit breaker
    - Request timeout
    """

    def __init__(
        self,
        retry_config: Optional[RetryConfig] = None,
        circuit_breaker: Optional[CircuitBreaker] = None,
        default_timeout: float = 30.0,
    ):
        self.retry_config = retry_config or RetryConfig()
        self.circuit_breaker = circuit_breaker or CircuitBreaker()
        self.default_timeout = default_timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.default_timeout)
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _calculate_delay(self, attempt: int) -> float:
        """Calculate delay for exponential backoff."""
        delay = self.retry_config.base_delay * (
            self.retry_config.exponential_base ** attempt
        )
        delay = min(delay, self.retry_config.max_delay)

        if self.retry_config.jitter:
            import random
            delay = delay * (0.5 + random.random())

        return delay

    async def request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        json: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
        retry: bool = True,
    ) -> httpx.Response:
        """
        Make an HTTP request with resilience patterns.

        Args:
            method: HTTP method (GET, POST, etc.)
            url: Request URL
            headers: Request headers
            json: JSON body
            timeout: Request timeout (overrides default)
            retry: Whether to retry on failure

        Returns:
            HTTP response

        Raises:
            httpx.HTTPError: If all retries fail
            Exception: If circuit breaker is open
        """
        if not self.circuit_breaker.can_execute():
            raise Exception(
                f"Circuit breaker is OPEN. Last failure: {self.circuit_breaker.last_failure_time}"
            )

        client = await self._get_client()
        last_exception: Optional[Exception] = None
        max_attempts = self.retry_config.max_retries if retry else 1

        for attempt in range(max_attempts):
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=json,
                    timeout=timeout or self.default_timeout,
                )

                # Check for server errors (5xx)
                if response.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"Server error: {response.status_code}",
                        request=response.request,
                        response=response,
                    )

                self.circuit_breaker.record_success()
                return response

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_exception = e
                logger.warning(
                    f"Request failed (attempt {attempt + 1}/{max_attempts}): {str(e)}"
                )

                if attempt < max_attempts - 1:
                    delay = self._calculate_delay(attempt)
                    logger.info(f"Retrying in {delay:.2f} seconds...")
                    await asyncio.sleep(delay)
                else:
                    self.circuit_breaker.record_failure()

        raise last_exception or Exception("Request failed with no exception")

    async def get(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        retry: bool = True,
    ) -> httpx.Response:
        """Make a GET request."""
        return await self.request("GET", url, headers=headers, timeout=timeout, retry=retry)

    async def post(
        self,
        url: str,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        retry: bool = True,
    ) -> httpx.Response:
        """Make a POST request."""
        return await self.request(
            "POST", url, headers=headers, json=json, timeout=timeout, retry=retry
        )

    async def put(
        self,
        url: str,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        retry: bool = True,
    ) -> httpx.Response:
        """Make a PUT request."""
        return await self.request(
            "PUT", url, headers=headers, json=json, timeout=timeout, retry=retry
        )

    async def delete(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        retry: bool = True,
    ) -> httpx.Response:
        """Make a DELETE request."""
        return await self.request(
            "DELETE", url, headers=headers, timeout=timeout, retry=retry
        )


# Singleton instance
_http_client: Optional[ResilientHttpClient] = None


def get_http_client() -> ResilientHttpClient:
    """Get or create the singleton HTTP client."""
    global _http_client
    if _http_client is None:
        _http_client = ResilientHttpClient()
    return _http_client
