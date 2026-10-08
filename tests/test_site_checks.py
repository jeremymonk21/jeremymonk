from __future__ import annotations

import socket
from typing import Any

import httpx
import pytest
import respx

from monkleads.audit.site_checks import SiteChecker, analyze_html
from monkleads.config import AppConfig

GOOD_HTML = """<!doctype html><html><head>
<title>Joe's Diner | Troy NY</title>
<meta name="description" content="Breakfast and lunch in Troy.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WordPress 6.5.2">
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
</head><body>
<nav><a href="/menu">Menu</a> <a href="tel:+15185551234">(518) 555-1234</a></nav>
<p>Hours: Monday - Friday 7am - 3pm, Saturday 8:00 am to 2 pm</p>
<iframe src="https://www.google.com/maps/embed?pb=abc"></iframe>
<form action="/contact"><input name="name"><input type="email" name="email"><textarea name="msg"></textarea></form>
<footer>&copy; 2025 Joe's Diner</footer>
</body></html>"""

OLD_HTML = """<html><head><title>Bob's Auto</title>
<meta name="generator" content="WordPress 4.9.8"></head>
<body><font>Welcome</font><font>to</font><font>Bob's</font><font>Auto</font><font>!</font>
<p>Call us at 518-555-0000</p><p>Copyright © 2012-2018 Bob's Auto Repair</p></body></html>"""


def analyze(html: str) -> dict[str, Any]:
    return analyze_html(html, stale_before_year=2020, old_wordpress_major=6)


# -- pure HTML analysis -------------------------------------------------------


def test_analyze_good_site() -> None:
    a = analyze(GOOD_HTML)
    assert a["has_title"] and a["has_meta_description"] and a["has_viewport"]
    assert a["has_tel_link"] and a["has_contact_form"] and a["has_map"] and a["has_hours"]
    assert a["copyright_year"] == 2025 and a["copyright_stale"] is False
    assert a["platform"] == "WordPress" and a["platform_version"] == "6.5.2"
    assert a["wordpress_outdated"] is False
    assert a["has_menu"] is True
    assert not a["_parked"] and not a["_under_construction"]


def test_analyze_old_site() -> None:
    a = analyze(OLD_HTML)
    assert a["has_viewport"] is False
    assert a["has_meta_description"] is False
    assert a["has_tel_link"] is False  # number shown but not tappable
    assert a["has_contact_form"] is False
    assert a["has_map"] is False
    assert a["copyright_year"] == 2018 and a["copyright_stale"] is True
    assert a["wordpress_outdated"] is True and a["platform_version"] == "4.9.8"
    assert "<font> tags" in a["outdated_markup"]


@pytest.mark.parametrize(
    ("html", "platform", "outdated"),
    [
        ('<img src="https://static.wixstatic.com/media/a.jpg">', "Wix", False),
        ('<link href="https://static1.squarespace.com/static/x.css">', "Squarespace", False),
        ('<script src="https://img1.wsimg.com/blobby/go/x.js"></script>', "GoDaddy Website Builder", False),
        ('<link href="https://cdn2.editmysite.com/css/sites.css">', "Weebly", True),
        ('<meta name="generator" content="Microsoft FrontPage 4.0">', "Microsoft FrontPage", True),
        ("<p>hello</p>", None, False),
    ],
)
def test_platform_detection(html: str, platform: str | None, outdated: bool) -> None:
    a = analyze(f"<html><head>{html}</head><body>Hi</body></html>")
    assert a["platform"] == platform
    assert a["platform_outdated"] is outdated


def test_parked_and_construction_detection() -> None:
    parked = analyze(
        "<html><body><h1>example.com</h1><p>This domain is for sale! Buy this domain.</p></body></html>"
    )
    assert parked["_parked"]
    soon = analyze("<html><body><h1>Coming Soon</h1><p>Our new website is on its way.</p></body></html>")
    assert soon["_under_construction"]
    # A real page that just mentions "coming soon" is not a placeholder.
    long_page = (
        "<html><body>"
        + ("<p>Fresh bagels every morning in Troy. </p>" * 40)
        + "<p>New menu coming soon</p></body></html>"
    )
    assert not analyze(long_page)["_under_construction"]


def test_copyright_takes_latest_year_in_range() -> None:
    assert analyze("<footer>© 2014 - 2019 Acme</footer>")["copyright_year"] == 2019
    assert analyze("<footer>Copyright 2026 Acme</footer>")["copyright_stale"] is False
    assert analyze("<footer>No notice here</footer>")["copyright_year"] is None


def test_contact_form_via_service_embed() -> None:
    a = analyze('<iframe src="https://form.jotform.com/12345"></iframe>')
    assert a["has_contact_form"]


# -- network checks with mocked HTTP -----------------------------------------


async def ok_resolver(host: str) -> list[Any]:
    return [("ok",)]


async def bad_resolver(host: str) -> list[Any]:
    raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")


@pytest.fixture
async def checker_factory(cfg: AppConfig):  # type: ignore[no-untyped-def]
    clients: list[httpx.AsyncClient] = []

    def make(resolver=ok_resolver) -> SiteChecker:  # type: ignore[no-untyped-def]
        client = httpx.AsyncClient(headers={"User-Agent": cfg.audit.user_agent})
        clients.append(client)
        return SiteChecker(client, cfg.audit, resolver=resolver)

    yield make
    for c in clients:
        await c.aclose()


async def test_no_website() -> None:
    from monkleads.config import AuditConfig

    async with httpx.AsyncClient() as client:
        f = await SiteChecker(client, AuditConfig()).check(None)
    assert f.site_status == "none" and not f.has_website


async def test_social_only_makes_no_requests(checker_factory) -> None:  # type: ignore[no-untyped-def]
    with respx.mock(assert_all_called=False) as mock:
        f = await checker_factory().check("https://www.facebook.com/joesdiner")
        assert mock.calls.call_count == 0
    assert f.site_status == "social_only" and f.social_network == "facebook"


async def test_dead_business_site(checker_factory) -> None:  # type: ignore[no-untyped-def]
    f = await checker_factory().check("https://joes-diner.business.site/")
    assert f.site_status == "broken" and f.broken_reason == "dead_platform"


async def test_dns_failure(checker_factory) -> None:  # type: ignore[no-untyped-def]
    f = await checker_factory(bad_resolver).check("http://expired-domain-example.com")
    assert f.site_status == "broken" and f.broken_reason == "dns_failure"


@respx.mock
async def test_healthy_https_site(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://joesdiner.com/robots.txt").respond(200, text="User-agent: *\nDisallow: /admin\n")
    respx.get("http://joesdiner.com/robots.txt").respond(
        301, headers={"location": "https://joesdiner.com/robots.txt"}
    )
    home = respx.get("https://joesdiner.com/").respond(200, html=GOOD_HTML)
    respx.get("http://joesdiner.com/").respond(301, headers={"location": "https://joesdiner.com/"})

    f = await checker_factory().check("joesdiner.com")
    assert f.site_status == "ok"
    assert f.https and f.ssl_valid and f.http_redirects_to_https
    assert f.robots_allowed is True
    assert f.has_viewport and f.has_tel_link and f.platform == "WordPress"
    ua = home.calls.last.request.headers["user-agent"]
    assert ua.startswith("MonkPressSiteCheck")


@respx.mock
async def test_http_only_site_without_redirect(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://oldshop.com/robots.txt").mock(side_effect=httpx.ConnectError("connection refused"))
    respx.get("http://oldshop.com/robots.txt").respond(404)
    respx.get("http://oldshop.com/").respond(200, html=OLD_HTML)

    f = await checker_factory().check("http://oldshop.com")
    assert f.site_status == "ok"
    assert f.https is False
    assert f.copyright_stale is True


@respx.mock
async def test_respects_robots_disallow(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://private.com/robots.txt").respond(200, text="User-agent: *\nDisallow: /\n")
    home = respx.get("https://private.com/").respond(200, html=GOOD_HTML)

    f = await checker_factory().check("https://private.com")
    assert f.site_status == "blocked"
    assert f.robots_allowed is False
    assert not home.called


@respx.mock
async def test_robots_rules_for_our_agent_only(checker_factory) -> None:  # type: ignore[no-untyped-def]
    robots = "User-agent: MonkPressSiteCheck\nDisallow: /\n\nUser-agent: *\nAllow: /\n"
    respx.get("https://picky.com/robots.txt").respond(200, text=robots)
    f = await checker_factory().check("https://picky.com")
    assert f.site_status == "blocked"


@respx.mock
async def test_server_error_is_broken_after_retries(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://down.com/robots.txt").respond(404)
    home = respx.get("https://down.com/").respond(500)
    f = await checker_factory().check("https://down.com")
    assert f.site_status == "broken" and f.broken_reason == "http_error"
    assert home.call_count == 2  # retried once with backoff


@respx.mock
async def test_404_homepage_is_broken(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://gone.com/robots.txt").respond(404)
    respx.get("https://gone.com/").respond(404, html="<h1>Not Found</h1>")
    f = await checker_factory().check("https://gone.com")
    assert f.broken_reason == "http_error" and f.http_status == 404


@respx.mock
async def test_403_is_blocked_not_broken(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://cf.com/robots.txt").respond(404)
    respx.get("https://cf.com/").respond(403)
    f = await checker_factory().check("https://cf.com")
    assert f.site_status == "blocked"


@respx.mock
async def test_parked_domain(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://parked.com/robots.txt").respond(404)
    respx.get("https://parked.com/").respond(
        200, html="<html><body>parked.com is for sale! This domain may be for sale.</body></html>"
    )
    respx.get("http://parked.com/robots.txt").respond(404)
    respx.get("http://parked.com/").respond(200, html="x")
    f = await checker_factory().check("parked.com")
    assert f.site_status == "broken" and f.broken_reason == "parked"


@respx.mock
async def test_redirect_to_parking_host(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://lapsed.com/robots.txt").respond(404)
    respx.get("https://lapsed.com/").respond(
        302, headers={"location": "https://www.hugedomains.com/domain_profile.cfm?d=lapsed.com"}
    )
    respx.get("https://www.hugedomains.com/domain_profile.cfm").respond(200, html="<html>Buy</html>")
    f = await checker_factory().check("https://lapsed.com")
    assert f.broken_reason == "parked"


@respx.mock
async def test_ssl_error_falls_back_to_http(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://badcert.com/robots.txt").mock(
        side_effect=httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate has expired")
    )
    respx.get("http://badcert.com/robots.txt").respond(404)
    respx.get("http://badcert.com/").respond(200, html=GOOD_HTML)
    f = await checker_factory().check("https://badcert.com")
    assert f.ssl_valid is False
    assert f.https is False
    assert f.site_status == "ok"


@respx.mock
async def test_unreachable(checker_factory) -> None:  # type: ignore[no-untyped-def]
    respx.get("https://dead.com/robots.txt").mock(side_effect=httpx.ConnectTimeout("timed out"))
    respx.get("http://dead.com/robots.txt").mock(side_effect=httpx.ConnectTimeout("timed out"))
    f = await checker_factory().check("dead.com")
    assert f.site_status == "broken" and f.broken_reason == "unreachable"


@respx.mock
async def test_non_certificate_tls_error_is_no_https_not_bad_cert(checker_factory) -> None:  # type: ignore[no-untyped-def]
    # e.g. an http-only server answering on port 443: no HTTPS, but not a "broken certificate"
    respx.get("https://plain.com/robots.txt").mock(
        side_effect=httpx.ConnectError("[SSL: WRONG_VERSION_NUMBER] wrong version number")
    )
    respx.get("http://plain.com/robots.txt").respond(404)
    respx.get("http://plain.com/").respond(200, html=GOOD_HTML)
    f = await checker_factory().check("plain.com")
    assert f.ssl_valid is None
    assert f.https is False
