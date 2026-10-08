"""Mobile screenshots with headless Playwright (optional dependency).

Install with: pip install "monkleads[screenshots]" && playwright install chromium
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from types import TracebackType
from typing import Any

log = logging.getLogger(__name__)


def screenshot_filename(place_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", place_id)[:120] + ".png"


class Screenshotter:
    """Async context manager. ``available`` is False if Playwright isn't installed."""

    def __init__(
        self,
        out_dir: Path,
        *,
        device: str = "iPhone 13",
        user_agent_suffix: str = "",
        concurrency: int = 2,
        timeout_ms: int = 30_000,
        executable_path: str | None = None,
    ) -> None:
        self.out_dir = out_dir
        self.device = device
        self.ua_suffix = user_agent_suffix
        self.timeout_ms = timeout_ms
        self.executable_path = executable_path
        self._sem = asyncio.Semaphore(concurrency)
        self._pw: Any = None
        self._browser: Any = None
        self._device_opts: dict[str, Any] = {}
        self.available = False

    async def __aenter__(self) -> Screenshotter:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            log.warning(
                "playwright not installed; skipping screenshots (pip install 'monkleads[screenshots]')"
            )
            return self
        try:
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=True, executable_path=self.executable_path or None
            )
            self._device_opts = dict(self._pw.devices.get(self.device) or {})
            if not self._device_opts:
                log.warning("unknown device; using a generic phone viewport", extra={"device": self.device})
                self._device_opts = {
                    "viewport": {"width": 390, "height": 844},
                    "device_scale_factor": 3,
                    "is_mobile": True,
                    "has_touch": True,
                }
            if self.ua_suffix and "user_agent" in self._device_opts:
                self._device_opts["user_agent"] = f"{self._device_opts['user_agent']} {self.ua_suffix}"
            self.available = True
            self.out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:  # browser missing, sandbox issues, ...
            log.warning("could not start headless browser; skipping screenshots", extra={"error": str(exc)})
            await self._close()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self._close()

    async def _close(self) -> None:
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._pw is not None:
            await self._pw.stop()
            self._pw = None

    async def capture(self, url: str, place_id: str) -> Path | None:
        if not self.available:
            return None
        dest = self.out_dir / screenshot_filename(place_id)
        async with self._sem:
            context = await self._browser.new_context(**self._device_opts)
            try:
                page = await context.new_page()
                await page.goto(url, wait_until="load", timeout=self.timeout_ms)
                await page.wait_for_timeout(1500)  # let fonts / hero images settle
                await page.screenshot(path=str(dest), full_page=False)
                return dest
            except Exception as exc:
                log.info("screenshot failed", extra={"url": url, "error": str(exc)[:200]})
                return None
            finally:
                await context.close()
