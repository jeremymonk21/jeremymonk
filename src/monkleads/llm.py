"""Optional: draft the opener with Claude (behind --llm). Falls back to templates on any problem."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .cache import ApiCache
from .config import LLMConfig, Sender
from .talking_points import MAX_OPENER_WORDS, word_count

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You draft short first-contact notes for {name}, who runs {business}, a one-person web design \
studio in {area}, New York. {first} builds simple, fixed-price websites for small local businesses \
(domain, hosting, updates and Google Business Profile setup included).

Write ONE opener {first} could send or say to the business owner. Voice: local, plain-spoken, \
friendly, one real person, no hype, no marketing buzzwords, no exclamation marks, no emojis, \
no technical jargon (say "slow to load on a phone", not "LCP" or "Core Web Vitals").

Rules:
- Under {max_words} words. Plain text only, no subject line, no greeting placeholder like [Name].
- Mention at most one or two of the problems provided, in plain English. Never invent facts \
that are not in the data.
- If the business has a real website, offer the free audit: {first} looks at the site on a phone \
and sends a short video with the three things he'd fix first. Otherwise offer a free mockup.
- Make clear there's no cost and no pressure.
- Sign off with "— {first}".
"""


def _client(api_key: str | None) -> Any:
    try:
        from anthropic import AsyncAnthropic
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError("--llm needs the anthropic package: pip install 'monkleads[llm]'") from exc
    return AsyncAnthropic(api_key=api_key) if api_key else AsyncAnthropic()


class OpenerWriter:
    def __init__(
        self,
        cfg: LLMConfig,
        sender: Sender,
        *,
        api_key: str | None,
        cache: ApiCache | None = None,
        cache_ttl_days: float = 90,
    ) -> None:
        self.cfg = cfg
        self.sender = sender
        self._client = _client(api_key)
        self._cache = cache
        self._ttl = cache_ttl_days
        self._sem = asyncio.Semaphore(cfg.max_concurrency)
        self.calls = 0
        first = sender.name.split()[0]
        self._system = SYSTEM_PROMPT.format(
            name=sender.name,
            first=first,
            business=sender.business,
            area=sender.home_area,
            max_words=MAX_OPENER_WORDS,
        )

    async def write(self, payload: dict[str, Any]) -> str | None:
        cache_obj = {"model": self.cfg.model, "system": self._system, "payload": payload}
        if self._cache is not None:
            cached = self._cache.get("llm_opener", cache_obj, self._ttl)
            if isinstance(cached, str):
                return cached

        import json

        from anthropic import APIConnectionError, APIStatusError, RateLimitError

        async with self._sem:
            try:
                self.calls += 1
                response = await self._client.beta.messages.create(
                    model=self.cfg.model,
                    max_tokens=2000,
                    system=self._system,
                    output_config={"effort": self.cfg.effort},
                    # Server-side fallback if a safety classifier ever declines the request.
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    messages=[
                        {
                            "role": "user",
                            "content": "Business facts (JSON):\n" + json.dumps(payload, indent=2),
                        }
                    ],
                )
            except RateLimitError as exc:
                log.warning("Claude rate limited; using template", extra={"error": str(exc)[:200]})
                return None
            except APIStatusError as exc:
                log.warning("Claude API error; using template", extra={"status": exc.status_code})
                return None
            except APIConnectionError as exc:
                log.warning("Claude unreachable; using template", extra={"error": str(exc)[:200]})
                return None

        if response.stop_reason == "refusal":
            log.info("Claude declined; using template", extra={"business": payload.get("business_name")})
            return None
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text").strip()
        if not text or word_count(text) >= MAX_OPENER_WORDS:
            log.info(
                "Claude opener rejected (empty or too long); using template",
                extra={"words": word_count(text)},
            )
            return None
        if self._cache is not None:
            self._cache.set("llm_opener", cache_obj, text)
        return text


def estimate_llm_cost(n_leads: int, cfg: LLMConfig) -> float:
    per = (
        cfg.est_input_tokens * cfg.price_input_per_mtok + cfg.est_output_tokens * cfg.price_output_per_mtok
    ) / 1_000_000
    return n_leads * per
