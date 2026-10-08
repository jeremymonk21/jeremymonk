"""Google Places API (New) client: Text Search and Nearby Search.

Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
Only official API endpoints are used; nothing is scraped from Google Maps.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from typing import Any

import httpx

from ..cache import ApiCache
from ..http import request_with_retry

log = logging.getLogger(__name__)

PLACES_BASE = "https://places.googleapis.com/v1"

# Only public business-listing fields. websiteUri / phone / rating / hours put the call in the
# "Enterprise" pricing SKU; see costs in config.yaml.
PLACE_FIELDS = [
    "id",
    "displayName",
    "formattedAddress",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "websiteUri",
    "rating",
    "userRatingCount",
    "businessStatus",
    "regularOpeningHours.weekdayDescriptions",
    "types",
    "primaryType",
    "googleMapsUri",
    "location",
]
TEXT_FIELD_MASK = ",".join([f"places.{f}" for f in PLACE_FIELDS] + ["nextPageToken"])
NEARBY_FIELD_MASK = ",".join(f"places.{f}" for f in PLACE_FIELDS)


class PlacesAPIError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    @property
    def fatal(self) -> bool:
        """Bad request, bad key, or API not enabled: retrying other queries won't help."""
        return self.status in (400, 401, 403)


@dataclass
class PlaceRecord:
    place_id: str
    name: str
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    rating: float | None = None
    review_count: int | None = None
    business_status: str | None = None
    hours: list[str] = field(default_factory=list)
    types: list[str] = field(default_factory=list)
    primary_type: str | None = None
    maps_url: str | None = None
    lat: float | None = None
    lng: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def parse_place(d: dict[str, Any]) -> PlaceRecord:
    loc = d.get("location") or {}
    hours = (d.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
    return PlaceRecord(
        place_id=d["id"],
        name=(d.get("displayName") or {}).get("text") or "(unnamed)",
        address=d.get("formattedAddress"),
        phone=d.get("nationalPhoneNumber") or d.get("internationalPhoneNumber"),
        website=d.get("websiteUri"),
        rating=d.get("rating"),
        review_count=d.get("userRatingCount"),
        business_status=d.get("businessStatus"),
        hours=list(hours),
        types=list(d.get("types") or []),
        primary_type=d.get("primaryType"),
        maps_url=d.get("googleMapsUri"),
        lat=loc.get("latitude"),
        lng=loc.get("longitude"),
    )


class PlacesClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        *,
        cache: ApiCache | None = None,
        cache_ttl_days: float = 30,
        page_size: int = 20,
        region_code: str = "us",
    ) -> None:
        self._client = client
        self._key = api_key
        self._cache = cache
        self._ttl = cache_ttl_days
        self._page_size = page_size
        self._region = region_code
        self.billable_calls = 0

    async def _post(self, path: str, body: dict[str, Any], field_mask: str) -> dict[str, Any]:
        cache_obj = {"path": path, "body": body, "mask": field_mask}
        if self._cache is not None:
            cached = self._cache.get("places", cache_obj, self._ttl)
            if cached is not None:
                return dict(cached)
        resp = await request_with_retry(
            self._client,
            "POST",
            f"{PLACES_BASE}/{path}",
            json=body,
            headers={"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": field_mask},
            timeout=30.0,
        )
        self.billable_calls += 1
        if resp.status_code != 200:
            try:
                message = resp.json().get("error", {}).get("message", resp.text)
            except ValueError:
                message = resp.text
            raise PlacesAPIError(
                f"Places API {path} returned {resp.status_code}: {message[:300]}", resp.status_code
            )
        data: dict[str, Any] = resp.json()
        if self._cache is not None:
            self._cache.set("places", cache_obj, data)
        return data

    async def text_search(
        self,
        query: str,
        *,
        lat: float,
        lng: float,
        radius_m: float,
        max_pages: int = 1,
    ) -> list[PlaceRecord]:
        body: dict[str, Any] = {
            "textQuery": query,
            "pageSize": self._page_size,
            "regionCode": self._region,
            "locationBias": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": min(radius_m, 50_000.0),
                }
            },
        }
        results: list[PlaceRecord] = []
        for page in range(max_pages):
            data = await self._post("places:searchText", body, TEXT_FIELD_MASK)
            places = data.get("places") or []
            results.extend(parse_place(p) for p in places)
            token = data.get("nextPageToken")
            log.debug("text search page", extra={"query": query, "page": page + 1, "n": len(places)})
            if not token:
                break
            body = {**body, "pageToken": token}
        return results

    async def nearby_search(
        self, place_types: list[str], *, lat: float, lng: float, radius_m: float
    ) -> list[PlaceRecord]:
        body = {
            "includedTypes": place_types,
            "maxResultCount": 20,
            "regionCode": self._region,
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": min(radius_m, 50_000.0),
                }
            },
        }
        data = await self._post("places:searchNearby", body, NEARBY_FIELD_MASK)
        return [parse_place(p) for p in data.get("places") or []]
