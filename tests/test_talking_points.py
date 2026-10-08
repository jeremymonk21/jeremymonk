from __future__ import annotations

import pytest

from monkleads.audit.pagespeed import PageSpeedResult
from monkleads.audit.site_checks import SiteFindings
from monkleads.config import AppConfig
from monkleads.scoring import LeadFacts, score_lead
from monkleads.talking_points import MAX_OPENER_WORDS, build_problems, template_opener, word_count


def slow_old_site() -> SiteFindings:
    return SiteFindings(
        input_url="https://bobsauto.com",
        site_status="ok",
        https=True,
        ssl_valid=True,
        http_redirects_to_https=True,
        has_title=True,
        has_meta_description=True,
        has_viewport=False,
        has_tel_link=False,
        has_contact_form=True,
        has_map=True,
        has_hours=False,
        copyright_year=2016,
        copyright_stale=True,
    )


def test_top_three_problems_in_plain_english(cfg: AppConfig) -> None:
    f = LeadFacts(
        name="Bob's Auto",
        category_key="auto_repair",
        category_group="auto",
        town="Troy",
        rating=4.8,
        review_count=95,
        site=slow_old_site(),
        psi=PageSpeedResult(performance=22, lcp_ms=9100),
    )
    result = score_lead(f, cfg.scoring)
    problems = build_problems(f, result)
    assert len(problems) == 3
    assert problems[0].code == "poor_mobile_speed"
    assert "9 seconds" in problems[0].text
    assert problems[1].code == "no_viewport"
    assert "©2016" in problems[2].text
    # no jargon
    for p in problems:
        for jargon in ("LCP", "viewport", "PageSpeed", "SSL", "Core Web Vitals"):
            assert jargon not in p.text


def test_no_website_problem_mentions_listing(cfg: AppConfig) -> None:
    f = LeadFacts(
        name="Sal's Barber",
        category_key="barber",
        category_group="beauty",
        town="Rensselaer",
        site=SiteFindings(input_url=None, site_status="none"),
    )
    problems = build_problems(f, score_lead(f, cfg.scoring))
    assert problems[0].text.startswith("Your Google listing has no website link")
    assert "barber in Rensselaer" in problems[0].text


@pytest.mark.parametrize(
    "site",
    [
        SiteFindings(input_url=None, site_status="none"),
        SiteFindings(
            input_url="https://facebook.com/x", site_status="social_only", social_network="facebook"
        ),
        SiteFindings(input_url="https://x.com", site_status="broken", broken_reason="dns_failure"),
        slow_old_site(),
    ],
)
def test_opener_rules(cfg: AppConfig, site: SiteFindings) -> None:
    f = LeadFacts(
        name="The Very Long Named Family Restaurant and Catering Hall of Troy",
        category_key="restaurant",
        category_group="food",
        town="Troy",
        rating=4.6,
        review_count=210,
        site=site,
        psi=PageSpeedResult(performance=30, lcp_ms=7000),
    )
    result = score_lead(f, cfg.scoring)
    opener = template_opener(f, build_problems(f, result), cfg.sender)
    assert word_count(opener) < MAX_OPENER_WORDS
    assert "free" in opener.lower()
    assert "no pressure" in opener.lower()
    assert "Jeremy" in opener
    assert "!" not in opener
    if site.site_status == "ok":
        assert "audit" in opener and "video" in opener
    else:
        assert "mockup" in opener


def test_opener_includes_praise_for_strong_reputation(cfg: AppConfig) -> None:
    f = LeadFacts(
        name="Placid Bakery",
        category_key="bakery",
        category_group="food",
        rating=4.8,
        review_count=300,
        site=SiteFindings(input_url=None, site_status="none"),
    )
    opener = template_opener(f, build_problems(f, score_lead(f, cfg.scoring)), cfg.sender)
    assert "4.8 stars from 300 reviews" in opener
