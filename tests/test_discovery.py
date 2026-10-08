from __future__ import annotations

import json
from collections import Counter
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import select

from monkleads.config import AppConfig, Secrets
from monkleads.db import Business
from monkleads.discovery.normalize import (
    ChainDetector,
    DedupeIndex,
    hostname,
    location_counts,
    normalize_name,
    normalize_phone,
)
from monkleads.discovery.places import PLACES_BASE, PlaceRecord, PlacesAPIError, PlacesClient, parse_place
from monkleads.pipeline import Pipeline, PipelineError, town_from_address

SOCIAL = ["facebook.com", "instagram.com"]


def raw_place(pid: str, name: str, **kw: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": pid,
        "displayName": {"text": name, "languageCode": "en"},
        "formattedAddress": kw.pop("address", f"{pid} River St, Troy, NY 12180, USA"),
        "nationalPhoneNumber": kw.pop("phone", None),
        "websiteUri": kw.pop("website", None),
        "rating": kw.pop("rating", 4.5),
        "userRatingCount": kw.pop("reviews", 40),
        "businessStatus": kw.pop("status", "OPERATIONAL"),
        "regularOpeningHours": {"weekdayDescriptions": ["Monday: 7:00 AM – 3:00 PM"]},
        "types": ["restaurant", "food"],
        "primaryType": "restaurant",
        "googleMapsUri": f"https://maps.google.com/?cid={pid}",
        "location": {"latitude": kw.pop("lat", 42.73), "longitude": kw.pop("lng", -73.69)},
    }
    assert not kw
    return {k: v for k, v in d.items() if v is not None}


# -- normalisation ------------------------------------------------------------


def test_normalize_phone() -> None:
    assert normalize_phone("(518) 555-1234") == "5185551234"
    assert normalize_phone("+1 518-555-1234") == "5185551234"
    assert normalize_phone("555-1234") is None
    assert normalize_phone(None) is None


def test_hostname() -> None:
    assert hostname("https://www.JoesDiner.com/menu") == "joesdiner.com"
    assert hostname("joesdiner.com") == "joesdiner.com"
    assert hostname("") is None


def test_normalize_name() -> None:
    assert normalize_name("Dunkin' - Troy") == "dunkin"
    assert normalize_name("The Placid Baker") == "placid baker"
    assert normalize_name("Ben & Jerry's (Hoosick St)") == "ben and jerrys"


def test_town_from_address() -> None:
    assert town_from_address("12 River St, Troy, NY 12180, USA") == "Troy"
    assert town_from_address("1 Main St, Averill Park, NY 12018, USA") == "Averill Park"
    assert town_from_address("Somewhere") is None


def test_parse_place() -> None:
    rec = parse_place(raw_place("p1", "Joe's Diner", phone="(518) 555-1234", website="https://joes.com"))
    assert rec.place_id == "p1" and rec.name == "Joe's Diner"
    assert rec.phone == "(518) 555-1234" and rec.website == "https://joes.com"
    assert rec.hours and rec.lat == 42.73 and rec.review_count == 40


# -- chains and dedupe --------------------------------------------------------


def rec(
    pid: str, name: str, website: str | None = None, address: str | None = None, phone: str | None = None
) -> PlaceRecord:
    return PlaceRecord(
        place_id=pid, name=name, website=website, address=address or f"{pid} Main St", phone=phone
    )


def test_chain_blocklist(cfg: AppConfig) -> None:
    det = ChainDetector(cfg.chains.blocklist, 3, cfg.chains.locator_url_patterns)
    assert det.check(rec("a", "Dunkin'"), Counter(), Counter(), SOCIAL)
    assert det.check(rec("a", "Stewart's Shops #123"), Counter(), Counter(), SOCIAL)
    assert det.check(rec("a", "Joe's Diner"), Counter(), Counter(), SOCIAL) is None
    # Blocklist matches whole leading words only, not substrings.
    assert det.check(rec("a", "Subwaying Tattoo"), Counter(), Counter(), SOCIAL) is None


def test_chain_by_repeated_name_and_domain(cfg: AppConfig) -> None:
    recs = [rec(str(i), "Tasty Burger Co", f"https://tastyburger.com/locations/{i}") for i in range(3)]
    recs.append(rec("x", "Solo Cafe", "https://solocafe.com"))
    names, domains = location_counts([(r.name, r.website, r.address) for r in recs], SOCIAL)
    det = ChainDetector([], 3, cfg.chains.locator_url_patterns)
    assert "3 locations" in (det.check(recs[0], names, domains, SOCIAL) or "")
    assert det.check(recs[3], names, domains, SOCIAL) is None


def test_store_locator_url_is_chain(cfg: AppConfig) -> None:
    det = ChainDetector([], 3, cfg.chains.locator_url_patterns)
    r = rec("a", "Regional Tire", "https://regionaltire.com/stores/troy-ny")
    assert "store-locator" in (det.check(r, Counter(), Counter(), SOCIAL) or "")


def test_shared_facebook_is_not_a_chain_or_duplicate(cfg: AppConfig) -> None:
    recs = [rec(str(i), f"Shop {i}", "https://facebook.com/") for i in range(5)]
    names, domains = location_counts([(r.name, r.website, r.address) for r in recs], SOCIAL)
    det = ChainDetector([], 3, [])
    assert all(det.check(r, names, domains, SOCIAL) is None for r in recs)
    idx = DedupeIndex(SOCIAL)
    idx.add("0", None, "https://facebook.com/")
    assert idx.duplicate_of("1", None, "https://facebook.com/") is None


def test_dedupe_by_phone_and_domain() -> None:
    idx = DedupeIndex(SOCIAL)
    idx.add("a", "(518) 555-1234", "https://joes.com")
    assert idx.duplicate_of("b", "518.555.1234", None) == "a"
    assert idx.duplicate_of("c", None, "http://www.joes.com/about") == "a"
    assert idx.duplicate_of("a", "(518) 555-1234", None) is None  # same place is an update
    assert idx.duplicate_of("d", "518-555-9999", "https://other.com") is None
    # sites.google.com hosts many businesses; the path identifies each one
    idx.add("e", None, "https://sites.google.com/view/joes")
    assert idx.duplicate_of("f", None, "https://sites.google.com/view/bobs") is None


# -- Places client (mocked) ---------------------------------------------------


@respx.mock
async def test_text_search_paginates_and_sends_field_mask() -> None:
    route = respx.post(f"{PLACES_BASE}/places:searchText")
    route.side_effect = [
        httpx.Response(200, json={"places": [raw_place("p1", "A")], "nextPageToken": "tok"}),
        httpx.Response(200, json={"places": [raw_place("p2", "B")]}),
    ]
    async with httpx.AsyncClient() as client:
        pc = PlacesClient(client, "KEY")
        out = await pc.text_search("cafe in Troy, NY", lat=42.7, lng=-73.6, radius_m=5000, max_pages=3)
    assert [r.place_id for r in out] == ["p1", "p2"]
    assert pc.billable_calls == 2
    first, second = route.calls
    assert first.request.headers["X-Goog-Api-Key"] == "KEY"
    mask = first.request.headers["X-Goog-FieldMask"]
    assert "places.websiteUri" in mask and "nextPageToken" in mask
    assert json.loads(second.request.content)["pageToken"] == "tok"


@respx.mock
async def test_text_search_respects_max_pages() -> None:
    route = respx.post(f"{PLACES_BASE}/places:searchText").respond(
        200, json={"places": [raw_place("p1", "A")], "nextPageToken": "more"}
    )
    async with httpx.AsyncClient() as client:
        out = await PlacesClient(client, "KEY").text_search("x", lat=0, lng=0, radius_m=1, max_pages=1)
    assert len(out) == 1 and route.call_count == 1


@respx.mock
async def test_places_error_is_raised_with_status() -> None:
    respx.post(f"{PLACES_BASE}/places:searchText").respond(
        403, json={"error": {"message": "API key not valid"}}
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(PlacesAPIError) as ei:
            await PlacesClient(client, "BAD").text_search("x", lat=0, lng=0, radius_m=1)
    assert ei.value.fatal and "API key not valid" in str(ei.value)


@respx.mock
async def test_places_retries_on_503() -> None:
    route = respx.post(f"{PLACES_BASE}/places:searchText")
    route.side_effect = [httpx.Response(503), httpx.Response(200, json={"places": [raw_place("p1", "A")]})]
    async with httpx.AsyncClient() as client:
        out = await PlacesClient(client, "KEY").text_search("x", lat=0, lng=0, radius_m=1)
    assert len(out) == 1 and route.call_count == 2


# -- discover stage end to end ------------------------------------------------


@respx.mock
async def test_discover_filters_and_caches(cfg: AppConfig, secrets: Secrets) -> None:
    places = [
        raw_place("p1", "Joe's Diner", phone="(518) 555-1111", website="https://joesdiner.com"),
        raw_place("p2", "Dunkin'"),
        raw_place("p3", "Old Mill Cafe", status="CLOSED_PERMANENTLY"),
        raw_place("p4", "Far Away Bistro", lat=44.0, lng=-75.0),
        raw_place("p5", "Joe's Diner Catering", phone="518-555-1111"),  # same phone as p1
        raw_place("p6", "Sal's Barber", website="https://www.facebook.com/salsbarber"),
    ]
    route = respx.post(f"{PLACES_BASE}/places:searchText").respond(200, json={"places": places})
    pipe = Pipeline(cfg, secrets)
    towns = cfg.select_towns(["Troy"])
    cats = cfg.select_categories(["restaurant"])

    stats = await pipe.discover(towns, cats)
    assert stats.found == 6 and stats.new == 6 and route.call_count == 1
    assert stats.excluded["permanently_closed"] == 1
    assert stats.excluded["out_of_area"] == 1
    assert stats.excluded["chain"] == 1
    assert stats.excluded["duplicate"] == 1

    with pipe.sessions() as s:
        leads = {b.place_id: b for b in s.scalars(select(Business))}
    assert leads["p1"].excluded_reason is None and leads["p1"].town == "Troy"
    assert leads["p1"].phone_normalized == "5185551111" and leads["p1"].domain == "joesdiner.com"
    assert leads["p6"].excluded_reason is None
    assert leads["p5"].excluded_reason == "duplicate of p1"

    # Second run hits the cache, makes no billable call, and updates rather than inserts.
    stats2 = await pipe.discover(towns, cats)
    assert route.call_count == 1 and stats2.api_calls == 0 and stats2.cache_hits == 1
    assert stats2.new == 0 and stats2.updated == 6
    with pipe.sessions() as s:
        assert s.get(Business, leads["p5"].id).excluded_reason == "duplicate of p1"  # type: ignore[union-attr]


@respx.mock
async def test_discover_aborts_on_bad_key(cfg: AppConfig, secrets: Secrets) -> None:
    respx.post(f"{PLACES_BASE}/places:searchText").respond(403, json={"error": {"message": "denied"}})
    pipe = Pipeline(cfg, secrets)
    with pytest.raises(PipelineError, match="denied"):
        await pipe.discover(cfg.select_towns(["Troy", "Nassau"]), cfg.select_categories(["cafe"]))


async def test_discover_requires_key(cfg: AppConfig) -> None:
    pipe = Pipeline(cfg, Secrets(None, None, None))
    with pytest.raises(PipelineError, match="GOOGLE_PLACES_API_KEY"):
        await pipe.discover(cfg.select_towns(["Troy"]), cfg.select_categories(["cafe"]))


def test_town_and_category_selection(cfg: AppConfig) -> None:
    core = cfg.select_towns()
    assert all(not t.extended for t in core)
    assert any(t.extended for t in cfg.select_towns(extended=True))
    with pytest.raises(ValueError):
        cfg.select_towns(["Atlantis"])
    with pytest.raises(ValueError):
        cfg.select_categories(["spaceships"])
