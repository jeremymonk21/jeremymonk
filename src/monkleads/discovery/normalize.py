"""Normalisation, de-duplication and chain detection for discovered places."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit

from .places import PlaceRecord


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def ensure_scheme(url: str) -> str:
    url = url.strip()
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
        url = "http://" + url
    return url


def hostname(url: str | None) -> str | None:
    if not url:
        return None
    try:
        host = urlsplit(ensure_scheme(url)).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def host_matches(host: str | None, domains: Iterable[str]) -> str | None:
    """Return the matching domain if ``host`` is ``domain`` or a subdomain of it."""
    if not host:
        return None
    for d in domains:
        d = d.lower()
        if host == d or host.endswith("." + d):
            return d
    return None


# Hosts where many unrelated businesses live under one domain, told apart by path.
PATH_BASED_HOSTS = frozenset({"sites.google.com", "business.site", "linktr.ee"})

_SUFFIX_SPLIT = re.compile(r"\s+[-|–—:@]\s+|\s+\(|\s+#\d")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_name(name: str) -> str:
    """Lower-case, strip accents/punctuation and location suffixes ("Dunkin' - Troy" -> "dunkin")."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = _SUFFIX_SPLIT.split(text, maxsplit=1)[0].lower()
    text = text.replace("&", " and ").replace("'", "")
    text = _NON_ALNUM.sub(" ", text).strip()
    if text.startswith("the "):
        text = text[4:]
    return text


def site_key(website: str | None, social_domains: Iterable[str]) -> str | None:
    """Identity of a business website for de-duplication, or None if it can't identify one.

    Social hosts (facebook.com, ...) are shared by everyone, so they never identify a business.
    """
    d = hostname(website)
    if not d or host_matches(d, social_domains):
        return None
    if d in PATH_BASED_HOSTS and website:
        # e.g. sites.google.com/view/<business>: the path identifies the site.
        path = urlsplit(ensure_scheme(website)).path.strip("/").lower()
        return f"{d}/{path}" if path else None
    return d


@dataclass
class ChainDetector:
    blocklist: list[str]
    min_locations: int
    locator_url_patterns: list[str]

    def __post_init__(self) -> None:
        self._blocked = [normalize_name(b) for b in self.blocklist if b.strip()]

    def blocklisted(self, name: str) -> str | None:
        norm = normalize_name(name)
        for b in self._blocked:
            if norm == b or norm.startswith(b + " "):
                return b
        return None

    def check(
        self,
        rec: PlaceRecord,
        name_locations: Counter[str],
        domain_locations: Counter[str],
        social_domains: Iterable[str],
    ) -> str | None:
        """Return a human-readable reason if ``rec`` looks like a national/regional chain."""
        hit = self.blocklisted(rec.name)
        if hit:
            return f"blocklisted chain ({hit})"
        norm = normalize_name(rec.name)
        if name_locations[norm] >= self.min_locations:
            return f"same name at {name_locations[norm]} locations"
        domain = site_key(rec.website, social_domains)
        if domain:
            if domain_locations[domain] >= self.min_locations:
                return f"website {domain} shared by {domain_locations[domain]} locations"
            path = (rec.website or "").lower()
            for pat in self.locator_url_patterns:
                if pat.lower() in path:
                    return f"website looks like a store-locator page ({pat})"
        return None


def location_counts(
    records: Iterable[tuple[str, str | None, str | None]], social_domains: Iterable[str]
) -> tuple[Counter[str], Counter[str]]:
    """Count distinct addresses per normalised name and per website domain.

    ``records`` yields ``(name, website, address)``.
    """
    social = list(social_domains)
    names: dict[str, set[str]] = {}
    domains: dict[str, set[str]] = {}
    for name, website, address in records:
        addr = (address or "").lower().strip() or f"?{id(name)}"
        names.setdefault(normalize_name(name), set()).add(addr)
        d = site_key(website, social)
        if d:
            domains.setdefault(d, set()).add(addr)
    return (
        Counter({k: len(v) for k, v in names.items()}),
        Counter({k: len(v) for k, v in domains.items()}),
    )


@dataclass
class DedupeIndex:
    """Tracks place_ids, phones and domains already seen so repeats are dropped."""

    social_domains: list[str]

    def __post_init__(self) -> None:
        self.place_ids: set[str] = set()
        self.phones: dict[str, str] = {}
        self.domains: dict[str, str] = {}

    def add(self, place_id: str, phone: str | None, website: str | None) -> None:
        self.place_ids.add(place_id)
        p = normalize_phone(phone)
        if p:
            self.phones.setdefault(p, place_id)
        d = self._domain_key(website)
        if d:
            self.domains.setdefault(d, place_id)

    def _domain_key(self, website: str | None) -> str | None:
        return site_key(website, self.social_domains)

    def duplicate_of(self, place_id: str, phone: str | None, website: str | None) -> str | None:
        """Return the place_id this record duplicates, or None if it is new.

        Same place_id is not a duplicate (it is an update of an existing row).
        """
        if place_id in self.place_ids:
            return None
        p = normalize_phone(phone)
        if p and p in self.phones and self.phones[p] != place_id:
            return self.phones[p]
        d = self._domain_key(website)
        if d and d in self.domains and self.domains[d] != place_id:
            return self.domains[d]
        return None
