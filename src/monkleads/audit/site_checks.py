"""Lightweight, polite website checks with httpx + BeautifulSoup.

One homepage fetch per site (plus robots.txt and one no-redirect request to see whether
http:// forwards to https://). robots.txt is honoured and requests to a host are spaced out.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import socket
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field, fields
from datetime import date
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from ..config import AuditConfig
from ..discovery.normalize import ensure_scheme, host_matches, hostname
from ..http import HostRateLimiter, RobotsCache, RobotsUnavailable, is_cert_error, request_with_retry

log = logging.getLogger(__name__)

SiteStatus = Literal["none", "social_only", "broken", "blocked", "ok"]
BrokenReason = Literal[
    "dns_failure",
    "unreachable",
    "http_error",
    "parked",
    "expired",
    "under_construction",
    "dead_platform",
    "not_html",
]


@dataclass
class SiteFindings:
    input_url: str | None
    site_status: SiteStatus = "ok"
    broken_reason: BrokenReason | None = None
    final_url: str | None = None
    http_status: int | None = None
    response_ms: int | None = None
    social_network: str | None = None
    robots_allowed: bool | None = None
    https: bool | None = None
    ssl_valid: bool | None = None
    http_redirects_to_https: bool | None = None
    title: str | None = None
    has_title: bool | None = None
    has_meta_description: bool | None = None
    has_viewport: bool | None = None
    has_tel_link: bool | None = None
    has_contact_form: bool | None = None
    has_map: bool | None = None
    has_hours: bool | None = None
    copyright_year: int | None = None
    copyright_stale: bool | None = None
    platform: str | None = None
    platform_version: str | None = None
    platform_outdated: bool = False
    wordpress_outdated: bool = False
    outdated_markup: list[str] = field(default_factory=list)
    has_menu: bool = False
    has_shop: bool = False
    has_booking: bool = False
    has_online_ordering: bool = False
    word_count: int | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def has_website(self) -> bool:
        return self.site_status != "none"

    @property
    def reachable(self) -> bool:
        """We loaded *something* at the URL (a real site, a parked page, a 'coming soon' page)."""
        return self.http_status is not None and self.http_status < 400

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SiteFindings:
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in names})


# ---------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------

# (platform name, lowercase substrings to look for in the HTML, considered outdated?)
PLATFORM_SIGNATURES: list[tuple[str, tuple[str, ...], bool]] = [
    ("Wix", ("static.wixstatic.com", "x-wix-", "wix.com website builder", "_wixcidx"), False),
    ("Squarespace", ("static1.squarespace.com", "squarespace-cdn.com", "<!-- this is squarespace"), False),
    ("Shopify", ("cdn.shopify.com", "shopify.theme"), False),
    ("Webflow", ("webflow.js", "assets.website-files.com", "data-wf-site"), False),
    (
        "GoDaddy Website Builder",
        ("img1.wsimg.com", "websites.godaddy.com", "go daddy website builder", "starfield technologies"),
        False,
    ),
    ("Square Online", ("square.site", "squareup.com/online"), False),
    ("Duda", ("dudaone", "multiscreensite.com", "irp.cdn-website.com"), False),
    ("BentoBox", ("getbento.com", "bentobox"), False),
    ("Popmenu", ("popmenu.com",), False),
    ("Weebly", ("weebly.com", "editmysite.com"), True),
    ("Jimdo", ("jimdo.com", "jimstatic.com"), True),
    ("Yola", ("yola.com", "yolacdn"), True),
    ("Homestead", ("homestead.com",), True),
    ("Webs", ("webs.com", "freewebs.com"), True),
    ("Google Sites", ("sites.google.com", "gstatic.com/sites"), True),
    ("Microsoft FrontPage", ("microsoft frontpage",), True),
    ("Adobe Muse", ("adobe muse",), True),
    ("iWeb", ('content="iweb',), True),
    ("Website Tonight", ("websitetonight",), True),
    ("Joomla", ("/media/jui/", "joomla!"), False),
    ("Drupal", ("drupal.settings", "/sites/default/files/"), False),
    ("WordPress", ("/wp-content/", "/wp-includes/", "wordpress"), False),
]

PARKED_MARKERS = (
    "this domain is for sale",
    "this domain may be for sale",
    "buy this domain",
    "domain is for sale",
    "is for sale!",
    "parked free, courtesy of godaddy",
    "parked courtesy of",
    "sedoparking.com",
    "parkingcrew.net",
    "bodis.com",
    "above.com/marketplace",
    "hugedomains.com",
    "afternic.com",
    "dan.com/buy-domain",
    "img1.wsimg.com/parking",
    "domain parking",
)
PARKING_HOSTS = (
    "sedoparking.com",
    "parkingcrew.net",
    "bodis.com",
    "hugedomains.com",
    "afternic.com",
    "dan.com",
    "parklogic.com",
    "domainmarket.com",
)
EXPIRED_MARKERS = (
    "this domain has expired",
    "domain has expired",
    "domain name has expired",
    "this domain name expired",
    "expired domain",
    "renew this domain",
    "account has been suspended",
    "this account has been suspended",
)
CONSTRUCTION_MARKERS = (
    "under construction",
    "coming soon",
    "launching soon",
    "website coming soon",
    "site is being built",
    "website is being built",
    "new website is on its way",
    "check back soon",
    "future home of",
)
FORM_SERVICES = (
    "jotform",
    "typeform",
    "wufoo",
    "formstack",
    "docs.google.com/forms",
    "forms.gle",
    "hsforms",
    "hs-form",
    "wpcf7",
    "gform_wrapper",
    "wpforms",
    "ninja-forms",
    "formspree",
    "form-wrapper",
    "wixforms",
    "contact-form",
)
MAP_MARKERS = (
    "google.com/maps",
    "maps.google.",
    "maps.googleapis.com",
    "goo.gl/maps",
    "maps.app.goo.gl",
    "api.mapbox.com",
    "openstreetmap.org",
    "maps.apple.com",
)
SHOP_MARKERS = (
    "add to cart",
    "add to bag",
    "/cart",
    "shopping cart",
    "cdn.shopify.com",
    "woocommerce",
    "ecwid",
    "/shop/",
    "/products/",
    "checkout",
    "buy now",
)
BOOKING_MARKERS = (
    "vagaro",
    "booksy",
    "styleseat",
    "schedulicity",
    "squareup.com/appointments",
    "square.site/book",
    "fresha",
    "mindbodyonline",
    "acuityscheduling",
    "calendly.com",
    "glossgenius",
    "setmore",
    "book now",
    "book online",
    "book an appointment",
    "schedule an appointment",
)
ORDERING_MARKERS = (
    "toasttab.com",
    "order online",
    "order now",
    "grubhub.com",
    "doordash.com",
    "ubereats.com",
    "chownow",
    "slicelife.com",
    "menufy",
    "clover.com/online-ordering",
    "order.online",
)

COPYRIGHT_RE = re.compile(
    r"(?:©|&copy;|\(c\)|copyright)\s*(?:©|&copy;)?\s*(?:(?:19|20)\d{2}\s*(?:-|–|—|to)\s*)?((?:19|20)\d{2})",
    re.IGNORECASE,
)
TIME_RE = r"\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)"
DAY_RE = r"\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|s|\.)?\b"
HOURS_RE = re.compile(rf"{DAY_RE}[^\n]{{0,60}}?{TIME_RE}|{TIME_RE}\s*(?:-|–|to)\s*{TIME_RE}", re.I)
WP_VERSION_RE = re.compile(r"wordpress\s+(\d+)\.(\d+)(?:\.(\d+))?", re.I)


# ---------------------------------------------------------------------------
# Pure HTML analysis (unit-tested without any network)
# ---------------------------------------------------------------------------


def analyze_html(
    html: str,
    *,
    stale_before_year: int,
    old_wordpress_major: int = 6,
) -> dict[str, Any]:
    """Extract every site-level finding we can from one HTML document."""
    soup = BeautifulSoup(html, "html.parser")
    lower = html.lower()

    for tag in soup(["script", "style", "noscript", "template"]):
        tag.extract()
    text = soup.get_text(" ", strip=True)
    text_lower = text.lower()
    out: dict[str, Any] = {"word_count": len(text.split())}

    # Title / description / viewport
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""
    out["title"] = title[:200] or None
    out["has_title"] = bool(title)
    desc = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    out["has_meta_description"] = bool(desc and str(desc.get("content", "")).strip())
    viewport = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.I)})
    out["has_viewport"] = bool(viewport and "width" in str(viewport.get("content", "")).lower())

    # Tap-to-call
    out["has_tel_link"] = any(
        str(a.get("href", "")).strip().lower().startswith("tel:") for a in soup.find_all("a")
    )

    # Contact form: a <form> with a message/email field, or a known form service
    has_form = False
    for form in soup.find_all("form"):
        if form.find("textarea") or form.find("input", attrs={"type": "email"}):
            has_form = True
            break
        names = " ".join(
            str(i.get("name", "")) + " " + str(i.get("id", "")) for i in form.find_all("input")
        ).lower()
        if "email" in names or "message" in names:
            has_form = True
            break
    out["has_contact_form"] = has_form or any(m in lower for m in FORM_SERVICES)

    # Map embed or directions link
    out["has_map"] = any(m in lower for m in MAP_MARKERS)

    # Hours on the page (text or schema.org openingHours)
    out["has_hours"] = bool(HOURS_RE.search(text)) or "openinghours" in lower

    # Copyright year (highest year mentioned in a copyright notice)
    years = [int(y) for y in COPYRIGHT_RE.findall(text)] + [int(y) for y in COPYRIGHT_RE.findall(html)]
    this_year = date.today().year
    years = [y for y in years if 1990 <= y <= this_year + 1]
    if years:
        out["copyright_year"] = max(years)
        out["copyright_stale"] = max(years) < stale_before_year
    else:
        out["copyright_year"] = None
        out["copyright_stale"] = None

    # Platform
    generator_tag = soup.find("meta", attrs={"name": re.compile(r"^generator$", re.I)})
    generator = str(generator_tag.get("content", "")) if generator_tag else ""
    platform, outdated = _detect_platform(lower, generator.lower())
    out["platform"] = platform
    out["platform_outdated"] = outdated
    out["platform_version"] = None
    out["wordpress_outdated"] = False
    if platform == "WordPress":
        m = WP_VERSION_RE.search(generator)
        if m:
            out["platform_version"] = ".".join(g for g in m.groups() if g)
            out["wordpress_outdated"] = int(m.group(1)) < old_wordpress_major
    elif generator and platform is None:
        out["platform"] = generator.split(" ")[0][:50]

    # Very old building blocks that don't work on phones
    markup: list[str] = []
    if soup.find("frameset") or soup.find("frame"):
        markup.append("frames")
    if ".swf" in lower or "shockwave-flash" in lower:
        markup.append("Flash")
    if soup.find("marquee") or soup.find("blink"):
        markup.append("marquee/blink")
    if len(soup.find_all("font")) >= 5:
        markup.append("<font> tags")
    out["outdated_markup"] = markup

    # Signals used for tier suggestions
    link_text = " ".join(a.get_text(" ", strip=True).lower() for a in soup.find_all("a"))
    hrefs = " ".join(str(a.get("href", "")).lower() for a in soup.find_all("a"))
    out["has_menu"] = bool(re.search(r"\bmenus?\b", link_text)) or "menu.pdf" in hrefs
    out["has_shop"] = any(m in lower for m in SHOP_MARKERS)
    out["has_booking"] = any(m in lower for m in BOOKING_MARKERS)
    out["has_online_ordering"] = any(m in lower for m in ORDERING_MARKERS)

    # Placeholder pages
    out["_parked"] = any(m in text_lower or m in lower for m in PARKED_MARKERS)
    out["_expired"] = any(m in text_lower for m in EXPIRED_MARKERS)
    out["_under_construction"] = out["word_count"] < 150 and any(
        m in text_lower for m in CONSTRUCTION_MARKERS
    )
    return out


def _detect_platform(html_lower: str, generator_lower: str) -> tuple[str | None, bool]:
    if generator_lower:
        for name, _sigs, outdated in PLATFORM_SIGNATURES:
            if name.lower().split(" ")[0] in generator_lower:
                return name, outdated
    for name, sigs, outdated in PLATFORM_SIGNATURES:
        if any(s in html_lower for s in sigs):
            return name, outdated
    return None, False


# ---------------------------------------------------------------------------
# Network check
# ---------------------------------------------------------------------------

Resolver = Callable[[str], Awaitable[Any]]


async def default_resolver(host: str) -> Any:
    loop = asyncio.get_running_loop()
    return await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)


def _with_scheme(url: str, scheme: str) -> str:
    p = urlsplit(url)
    return urlunsplit((scheme, p.netloc, p.path or "/", p.query, ""))


class SiteChecker:
    def __init__(
        self,
        client: httpx.AsyncClient,
        cfg: AuditConfig,
        *,
        limiter: HostRateLimiter | None = None,
        robots: RobotsCache | None = None,
        resolver: Resolver = default_resolver,
        today: date | None = None,
    ) -> None:
        self._client = client
        self._cfg = cfg
        self._limiter = limiter or HostRateLimiter(cfg.per_host_min_interval_s)
        self._robots = robots or RobotsCache(client, cfg.robots_user_agent, self._limiter)
        self._resolve = resolver
        self._stale_before = cfg.copyright_stale_before(today)

    async def _get(self, url: str) -> httpx.Response:
        await self._limiter.wait(urlsplit(url).hostname or url)
        return await request_with_retry(
            self._client,
            "GET",
            url,
            attempts=2,
            follow_redirects=True,
            timeout=self._cfg.request_timeout_s,
        )

    async def check(self, website: str | None) -> SiteFindings:
        if not website or not website.strip():
            return SiteFindings(input_url=None, site_status="none")

        url = ensure_scheme(website)
        f = SiteFindings(input_url=url)
        host = hostname(url)
        if host is None:
            f.site_status, f.broken_reason = "broken", "dns_failure"
            f.notes.append("website field is not a valid URL")
            return f

        social = host_matches(host, self._cfg.social_domains)
        if social:
            f.site_status, f.social_network = "social_only", social.split(".")[0]
            return f
        if host_matches(host, self._cfg.dead_platform_domains):
            f.site_status, f.broken_reason = "broken", "dead_platform"
            return f

        full_host = urlsplit(url).hostname or host
        try:
            await self._resolve(full_host)
        except (socket.gaierror, OSError, UnicodeError) as exc:
            f.site_status, f.broken_reason = "broken", "dns_failure"
            f.notes.append(f"DNS lookup failed: {exc}")
            return f

        resp = await self._fetch_homepage(url, f)
        if resp is None:
            return f

        f.final_url = str(resp.url)
        f.http_status = resp.status_code
        f.https = resp.url.scheme == "https"
        f.response_ms = int(resp.elapsed.total_seconds() * 1000) if resp.elapsed else None

        final_host = hostname(f.final_url)
        if final_host and host_matches(final_host, PARKING_HOSTS):
            f.site_status, f.broken_reason = "broken", "parked"
            return f
        if final_host and host_matches(final_host, self._cfg.social_domains):
            f.site_status, f.social_network = "social_only", final_host.split(".")[0]
            return f

        if resp.status_code in (401, 403, 429):
            # Often a firewall blocking automated checks, not a broken site. Don't claim it's broken.
            f.site_status = "blocked"
            f.notes.append(f"server answered {resp.status_code} to our check")
            return f
        if resp.status_code >= 400:
            f.site_status, f.broken_reason = "broken", "http_error"
            return f

        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype.lower() and ctype:
            f.site_status, f.broken_reason = "broken", "not_html"
            f.notes.append(f"homepage content-type is {ctype}")
            return f

        html = resp.content[: self._cfg.max_html_bytes].decode(resp.encoding or "utf-8", "replace")
        analysis = analyze_html(
            html,
            stale_before_year=self._stale_before,
            old_wordpress_major=self._cfg.old_wordpress_major,
        )
        for key, value in analysis.items():
            if not key.startswith("_"):
                setattr(f, key, value)
        if analysis["_parked"]:
            f.site_status, f.broken_reason = "broken", "parked"
        elif analysis["_expired"]:
            f.site_status, f.broken_reason = "broken", "expired"
        elif analysis["_under_construction"]:
            f.site_status, f.broken_reason = "broken", "under_construction"
        else:
            f.site_status = "ok"

        if f.https:
            await self._check_http_redirect(url, f)
        return f

    async def _fetch_homepage(self, url: str, f: SiteFindings) -> httpx.Response | None:
        """Try https first, then http. Records SSL / robots / reachability on ``f``."""
        last_error: str | None = None
        for scheme in ("https", "http"):
            target = _with_scheme(url, scheme)
            try:
                allowed = await self._robots.allowed(target)
            except RobotsUnavailable as exc:
                if scheme == "https" and is_cert_error(exc.__cause__ or exc):
                    f.ssl_valid = False
                last_error = str(exc)
                continue
            f.robots_allowed = allowed
            if not allowed:
                f.site_status = "blocked"
                f.notes.append("robots.txt asks automated tools not to fetch the homepage")
                return None
            try:
                resp = await self._get(target)
            except httpx.HTTPError as exc:
                if scheme == "https" and is_cert_error(exc):
                    f.ssl_valid = False
                last_error = f"{type(exc).__name__}: {exc}"
                continue
            if scheme == "https":
                f.ssl_valid = True
            return resp

        f.site_status, f.broken_reason = "broken", "unreachable"
        if last_error:
            f.notes.append(last_error[:300])
        return None

    async def _check_http_redirect(self, url: str, f: SiteFindings) -> None:
        target = _with_scheme(url, "http")
        try:
            if not await self._robots.allowed(target):
                return
            resp = await self._get(target)
        except (httpx.HTTPError, RobotsUnavailable):
            return
        f.http_redirects_to_https = resp.url.scheme == "https"


def findings_json(f: SiteFindings) -> str:
    return json.dumps(f.to_dict(), sort_keys=True)
