"""Google PageSpeed Insights API v5 (mobile strategy).

Docs: https://developers.google.com/speed/docs/insights/v5/get-started
The API is free; an API key raises the quota. Results are cached to limit calls.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, fields
from typing import Any

import httpx

from ..cache import ApiCache
from ..http import request_with_retry

log = logging.getLogger(__name__)

PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
CATEGORIES = ("performance", "accessibility", "seo", "best-practices")


@dataclass
class PageSpeedResult:
    performance: int | None = None
    accessibility: int | None = None
    seo: int | None = None
    best_practices: int | None = None
    # Lab data (Lighthouse, simulated mid-range phone on 4G)
    lcp_ms: float | None = None
    fcp_ms: float | None = None
    cls: float | None = None
    tbt_ms: float | None = None
    speed_index_ms: float | None = None
    # Field data (real Chrome users, 75th percentile), when Google has enough traffic
    field_lcp_ms: float | None = None
    field_inp_ms: float | None = None
    field_cls: float | None = None
    error: str | None = None

    @property
    def load_seconds(self) -> float | None:
        """Best plain-English 'how long until it shows up' number we have."""
        ms = self.field_lcp_ms or self.lcp_ms or self.speed_index_ms
        return round(ms / 1000, 1) if ms else None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> PageSpeedResult | None:
        if not data:
            return None
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in names})


def _score(categories: dict[str, Any], key: str) -> int | None:
    value = (categories.get(key) or {}).get("score")
    return round(value * 100) if isinstance(value, int | float) else None


def _audit_value(audits: dict[str, Any], key: str) -> float | None:
    value = (audits.get(key) or {}).get("numericValue")
    return float(value) if isinstance(value, int | float) else None


def parse_psi(data: dict[str, Any]) -> PageSpeedResult:
    lh = data.get("lighthouseResult") or {}
    cats = lh.get("categories") or {}
    audits = lh.get("audits") or {}
    metrics = (data.get("loadingExperience") or {}).get("metrics") or {}

    def field_pct(key: str) -> float | None:
        v = (metrics.get(key) or {}).get("percentile")
        return float(v) if isinstance(v, int | float) else None

    field_cls = field_pct("CUMULATIVE_LAYOUT_SHIFT_SCORE")
    return PageSpeedResult(
        performance=_score(cats, "performance"),
        accessibility=_score(cats, "accessibility"),
        seo=_score(cats, "seo"),
        best_practices=_score(cats, "best-practices"),
        lcp_ms=_audit_value(audits, "largest-contentful-paint"),
        fcp_ms=_audit_value(audits, "first-contentful-paint"),
        cls=_audit_value(audits, "cumulative-layout-shift"),
        tbt_ms=_audit_value(audits, "total-blocking-time"),
        speed_index_ms=_audit_value(audits, "speed-index"),
        field_lcp_ms=field_pct("LARGEST_CONTENTFUL_PAINT_MS"),
        field_inp_ms=field_pct("INTERACTION_TO_NEXT_PAINT"),
        # CrUX reports CLS multiplied by 100
        field_cls=field_cls / 100 if field_cls is not None else None,
    )


async def run_pagespeed(
    client: httpx.AsyncClient,
    url: str,
    *,
    api_key: str | None,
    cache: ApiCache | None = None,
    cache_ttl_days: float = 7,
    timeout_s: float = 90,
) -> PageSpeedResult:
    cache_obj = {"url": url, "strategy": "mobile"}
    if cache is not None:
        cached = cache.get("pagespeed", cache_obj, cache_ttl_days)
        if cached is not None:
            return parse_psi(cached)

    params: list[tuple[str, str]] = [("url", url), ("strategy", "mobile")]
    params += [("category", c) for c in CATEGORIES]
    if api_key:
        params.append(("key", api_key))
    try:
        resp = await request_with_retry(client, "GET", PSI_URL, params=params, timeout=timeout_s, attempts=3)
    except httpx.HTTPError as exc:
        return PageSpeedResult(error=f"{type(exc).__name__}: {exc}"[:300])
    if resp.status_code != 200:
        try:
            message = resp.json().get("error", {}).get("message", "")
        except ValueError:
            message = resp.text
        return PageSpeedResult(error=f"PSI HTTP {resp.status_code}: {message}"[:300])

    data = resp.json()
    if cache is not None:
        # Store only what we parse; Lighthouse JSON is several MB.
        slim = {
            "lighthouseResult": {
                "categories": data.get("lighthouseResult", {}).get("categories", {}),
                "audits": {
                    k: {"numericValue": v.get("numericValue")}
                    for k, v in data.get("lighthouseResult", {}).get("audits", {}).items()
                    if k
                    in {
                        "largest-contentful-paint",
                        "first-contentful-paint",
                        "cumulative-layout-shift",
                        "total-blocking-time",
                        "speed-index",
                    }
                },
            },
            "loadingExperience": data.get("loadingExperience", {}),
        }
        cache.set("pagespeed", cache_obj, slim)
    return parse_psi(data)
