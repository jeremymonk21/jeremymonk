from __future__ import annotations

import httpx
import respx

from monkleads.audit.pagespeed import PSI_URL, parse_psi, run_pagespeed

PSI_JSON = {
    "lighthouseResult": {
        "categories": {
            "performance": {"score": 0.23},
            "accessibility": {"score": 0.81},
            "seo": {"score": 0.9},
            "best-practices": {"score": 0.75},
        },
        "audits": {
            "largest-contentful-paint": {"numericValue": 9120.4},
            "first-contentful-paint": {"numericValue": 3010.0},
            "cumulative-layout-shift": {"numericValue": 0.31},
            "total-blocking-time": {"numericValue": 870},
            "speed-index": {"numericValue": 7400},
            "unused-javascript": {"numericValue": 1},
        },
    },
    "loadingExperience": {
        "metrics": {
            "LARGEST_CONTENTFUL_PAINT_MS": {"percentile": 5200},
            "INTERACTION_TO_NEXT_PAINT": {"percentile": 310},
            "CUMULATIVE_LAYOUT_SHIFT_SCORE": {"percentile": 25},
        }
    },
}


def test_parse_psi() -> None:
    r = parse_psi(PSI_JSON)
    assert (r.performance, r.accessibility, r.seo, r.best_practices) == (23, 81, 90, 75)
    assert r.lcp_ms == 9120.4 and r.tbt_ms == 870
    assert r.field_lcp_ms == 5200 and r.field_cls == 0.25
    assert r.load_seconds == 5.2  # field data preferred over lab


def test_parse_psi_missing_data() -> None:
    r = parse_psi({})
    assert r.performance is None and r.load_seconds is None


@respx.mock
async def test_run_pagespeed_mobile_and_cached(cfg) -> None:  # type: ignore[no-untyped-def]
    from monkleads.cache import ApiCache
    from monkleads.db import make_engine, make_session_factory

    cache = ApiCache(make_session_factory(make_engine(":memory:")))
    route = respx.get(PSI_URL).respond(200, json=PSI_JSON)
    async with httpx.AsyncClient() as client:
        r1 = await run_pagespeed(client, "https://joes.com/", api_key="K", cache=cache)
        r2 = await run_pagespeed(client, "https://joes.com/", api_key="K", cache=cache)
    assert r1.performance == r2.performance == 23
    assert r2.lcp_ms == 9120.4
    assert route.call_count == 1
    q = route.calls.last.request.url.params
    assert q["strategy"] == "mobile" and q["key"] == "K"
    assert sorted(q.get_list("category")) == ["accessibility", "best-practices", "performance", "seo"]


@respx.mock
async def test_run_pagespeed_error_is_returned_not_raised() -> None:
    respx.get(PSI_URL).respond(
        400, json={"error": {"message": "Lighthouse returned error: FAILED_DOCUMENT_REQUEST"}}
    )
    async with httpx.AsyncClient() as client:
        r = await run_pagespeed(client, "https://broken.example/", api_key=None)
    assert r.performance is None and "FAILED_DOCUMENT_REQUEST" in (r.error or "")
