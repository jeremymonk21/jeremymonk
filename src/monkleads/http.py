"""Shared async HTTP plumbing: retries, per-host politeness, robots.txt."""

from __future__ import annotations

import asyncio
import logging
import ssl
import time
from collections import defaultdict
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    retry_if_result,
    stop_after_attempt,
    wait_exponential,
    wait_random,
)

log = logging.getLogger(__name__)

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})

# Module-level so tests can set them to 0.
WAIT_INITIAL_S = 1.0
WAIT_MAX_S = 20.0


def is_ssl_error(exc: BaseException) -> bool:
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, ssl.SSLError):
            return True
        text = str(cur)
        if "CERTIFICATE_VERIFY_FAILED" in text or "SSL:" in text or "certificate" in text.lower():
            return True
        cur = cur.__cause__ or cur.__context__
    return False


_CERT_MARKERS = (
    "CERTIFICATE_VERIFY_FAILED",
    "certificate has expired",
    "hostname mismatch",
    "self-signed certificate",
    "self signed certificate",
    "unable to get local issuer",
)


def is_cert_error(exc: BaseException) -> bool:
    """True only for certificate problems a browser would warn about (expired, wrong host, untrusted)."""
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, ssl.SSLCertVerificationError):
            return True
        if any(m.lower() in str(cur).lower() for m in _CERT_MARKERS):
            return True
        cur = cur.__cause__ or cur.__context__
    return False


def _retryable_exception(exc: BaseException) -> bool:
    if not isinstance(exc, httpx.TransportError):
        return False
    if isinstance(exc, httpx.UnsupportedProtocol | httpx.LocalProtocolError):
        return False
    return not is_ssl_error(exc)


def _retryable_response(resp: Any) -> bool:
    return isinstance(resp, httpx.Response) and resp.status_code in RETRY_STATUSES


def _return_last(state: RetryCallState) -> Any:
    # After the final attempt: return the last response (e.g. a 503) or re-raise the error.
    assert state.outcome is not None
    return state.outcome.result()


def _log_retry(state: RetryCallState) -> None:
    outcome = state.outcome
    detail = ""
    if outcome is not None:
        if outcome.failed:
            detail = type(outcome.exception()).__name__
        else:
            detail = f"HTTP {outcome.result().status_code}"
    log.debug("retrying request", extra={"attempt": state.attempt_number, "reason": detail})


async def request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    attempts: int = 3,
    **kwargs: Any,
) -> httpx.Response:
    """Send a request, retrying transient network errors and 429/5xx with exponential backoff.

    SSL verification failures are never retried. If every attempt returns a
    retryable status, the last response is returned rather than raised.
    """
    retrying = AsyncRetrying(
        stop=stop_after_attempt(attempts),
        wait=wait_exponential(multiplier=WAIT_INITIAL_S, max=WAIT_MAX_S) + wait_random(0, WAIT_INITIAL_S),
        retry=retry_if_exception(_retryable_exception) | retry_if_result(_retryable_response),
        retry_error_callback=_return_last,
        before_sleep=_log_retry,
        reraise=True,
    )
    resp: httpx.Response = await retrying(client.request, method, url, **kwargs)
    return resp


class HostRateLimiter:
    """Ensures at least ``min_interval`` seconds between requests to the same host."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._last: dict[str, float] = {}

    async def wait(self, host: str) -> None:
        if self.min_interval <= 0:
            return
        async with self._locks[host]:
            delay = self._last.get(host, 0.0) + self.min_interval - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._last[host] = time.monotonic()


class RobotsUnavailable(Exception):
    """robots.txt could not be fetched because the host is unreachable."""


class RobotsCache:
    """Fetches and caches robots.txt per scheme+host, following RFC 9309.

    * 2xx: parse the rules
    * 4xx: no restrictions
    * 5xx: treat the whole site as disallowed
    * network error: raises RobotsUnavailable (the caller treats the site as unreachable)
    """

    def __init__(self, client: httpx.AsyncClient, user_agent_token: str, limiter: HostRateLimiter) -> None:
        self._client = client
        self._ua = user_agent_token
        self._limiter = limiter
        self._parsers: dict[str, RobotFileParser] = {}
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        async with self._locks[origin]:
            parser = self._parsers.get(origin)
            if parser is None:
                parser = await self._fetch(origin)
                self._parsers[origin] = parser
        return parser.can_fetch(self._ua, url)

    async def _fetch(self, origin: str) -> RobotFileParser:
        parser = RobotFileParser()
        await self._limiter.wait(urlsplit(origin).hostname or origin)
        try:
            resp = await request_with_retry(
                self._client, "GET", f"{origin}/robots.txt", attempts=2, follow_redirects=True
            )
        except httpx.HTTPError as exc:
            raise RobotsUnavailable(str(exc)) from exc
        if resp.status_code >= 500:
            parser.disallow_all = True  # type: ignore[attr-defined]
        elif resp.status_code >= 400:
            parser.allow_all = True  # type: ignore[attr-defined]
        else:
            parser.parse(resp.text.splitlines())
        parser.modified()  # mark as "read" so can_fetch() trusts the rules
        return parser
