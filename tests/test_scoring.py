from __future__ import annotations

from monkleads.audit.pagespeed import PageSpeedResult
from monkleads.audit.site_checks import SiteFindings
from monkleads.config import AppConfig, ScoringConfig
from monkleads.scoring import LeadFacts, score_lead, suggest_tier


def good_site(**overrides: object) -> SiteFindings:
    base = dict(
        input_url="https://example.com",
        site_status="ok",
        final_url="https://example.com/",
        http_status=200,
        https=True,
        ssl_valid=True,
        http_redirects_to_https=True,
        has_title=True,
        has_meta_description=True,
        has_viewport=True,
        has_tel_link=True,
        has_contact_form=True,
        has_map=True,
        has_hours=True,
        copyright_year=2026,
        copyright_stale=False,
    )
    base.update(overrides)
    return SiteFindings(**base)  # type: ignore[arg-type]


def facts(**overrides: object) -> LeadFacts:
    base: dict[str, object] = dict(
        name="Joe's Diner",
        category_key="restaurant",
        category_group="food",
        category_fit="high",
        town="Troy",
        rating=4.0,
        review_count=10,
        distance_miles=2.0,
        site=good_site(),
        psi=PageSpeedResult(performance=90, lcp_ms=1500),
    )
    base.update(overrides)
    return LeadFacts(**base)  # type: ignore[arg-type]


def codes(result: object) -> set[str]:
    return {r.code for r in result.reasons}  # type: ignore[attr-defined]


def test_reasons_sum_to_score(cfg: AppConfig) -> None:
    f = facts(site=good_site(has_viewport=False, copyright_year=2015, copyright_stale=True))
    r = score_lead(f, cfg.scoring)
    assert r.raw_total == round(sum(x.points for x in r.reasons), 1)
    assert r.score == round(r.raw_total)
    assert {"no_viewport", "stale_copyright", "category_fit"} <= codes(r)


def test_no_website_scores_very_high(cfg: AppConfig) -> None:
    r = score_lead(facts(site=SiteFindings(input_url=None, site_status="none"), psi=None), cfg.scoring)
    assert "no_website" in codes(r)
    assert r.score >= 60
    assert r.weak_site


def test_no_audit_at_all_counts_as_no_website(cfg: AppConfig) -> None:
    r = score_lead(facts(site=None, psi=None), cfg.scoring)
    assert "no_website" in codes(r)


def test_social_only_and_broken(cfg: AppConfig) -> None:
    social = score_lead(
        facts(
            site=SiteFindings(
                input_url="https://facebook.com/joes", site_status="social_only", social_network="facebook"
            ),
            psi=None,
        ),
        cfg.scoring,
    )
    assert "social_only" in codes(social)
    broken = score_lead(
        facts(
            site=SiteFindings(input_url="http://joes.com", site_status="broken", broken_reason="parked"),
            psi=None,
        ),
        cfg.scoring,
    )
    assert "broken_parked" in codes(broken)
    assert broken.score > social.score  # broken is weighted higher than social-only


def test_healthy_site_scores_low(cfg: AppConfig) -> None:
    r = score_lead(facts(), cfg.scoring)
    site_codes = {x.code for x in r.reasons if x.site_problem}
    assert site_codes == set()
    assert r.score <= 10
    assert not r.weak_site


def test_speed_thresholds(cfg: AppConfig) -> None:
    poor = score_lead(facts(psi=PageSpeedResult(performance=30)), cfg.scoring)
    so_so = score_lead(facts(psi=PageSpeedResult(performance=60)), cfg.scoring)
    fine = score_lead(facts(psi=PageSpeedResult(performance=85)), cfg.scoring)
    assert "poor_mobile_speed" in codes(poor)
    assert "mediocre_mobile_speed" in codes(so_so)
    assert not {"poor_mobile_speed", "mediocre_mobile_speed"} & codes(fine)


def test_https_problems_are_not_double_counted(cfg: AppConfig) -> None:
    r = score_lead(facts(site=good_site(https=False, ssl_valid=False)), cfg.scoring)
    assert "ssl_invalid" in codes(r)
    assert "no_https" not in codes(r)
    r2 = score_lead(
        facts(site=good_site(https=False, ssl_valid=None, http_redirects_to_https=None)), cfg.scoring
    )
    assert "no_https" in codes(r2)


def test_reputation_bonus_only_with_weak_site(cfg: AppConfig) -> None:
    strong = dict(rating=4.7, review_count=120)
    weak = score_lead(
        facts(site=SiteFindings(input_url=None, site_status="none"), psi=None, **strong), cfg.scoring
    )
    healthy = score_lead(facts(**strong), cfg.scoring)
    assert "reputation_bonus" in codes(weak)
    assert "reputation_bonus" not in codes(healthy)


def test_reputation_bonus_requires_both_rating_and_reviews(cfg: AppConfig) -> None:
    no_site = SiteFindings(input_url=None, site_status="none")
    few_reviews = score_lead(facts(site=no_site, psi=None, rating=4.9, review_count=8), cfg.scoring)
    low_rating = score_lead(facts(site=no_site, psi=None, rating=3.9, review_count=300), cfg.scoring)
    assert "reputation_bonus" not in codes(few_reviews)
    assert "reputation_bonus" not in codes(low_rating)


def test_distance_penalty_grows_and_caps(cfg: AppConfig) -> None:
    sc = cfg.scoring
    near = score_lead(facts(distance_miles=3), sc)
    mid = score_lead(facts(distance_miles=15), sc)
    far = score_lead(facts(distance_miles=200), sc)
    assert "distance" not in codes(near)
    mid_pen = next(r.points for r in mid.reasons if r.code == "distance")
    far_pen = next(r.points for r in far.reasons if r.code == "distance")
    assert mid_pen == -(15 - sc.distance_free_miles) * sc.distance_penalty_per_mile
    assert far_pen == -sc.distance_penalty_max


def test_score_is_clamped(cfg: AppConfig) -> None:
    sc = ScoringConfig()
    sc.weights.no_website = 500
    r = score_lead(facts(site=None, psi=None), sc)
    assert r.score == 100
    sc.weights.category_fit_high = -500
    r2 = score_lead(facts(), sc)
    assert r2.score == 0


def test_weights_come_from_config(cfg: AppConfig) -> None:
    cfg.scoring.weights.no_viewport = 33
    r = score_lead(facts(site=good_site(has_viewport=False)), cfg.scoring)
    assert next(x.points for x in r.reasons if x.code == "no_viewport") == 33


def test_low_reviews_and_temporarily_closed_penalties(cfg: AppConfig) -> None:
    r = score_lead(facts(review_count=1, business_status="CLOSED_TEMPORARILY"), cfg.scoring)
    assert {"low_reviews", "temporarily_closed"} <= codes(r)


def test_blocked_site_is_not_penalised_for_unchecked_items(cfg: AppConfig) -> None:
    blocked = SiteFindings(input_url="https://x.com", site_status="blocked", http_status=403)
    r = score_lead(facts(site=blocked, psi=None), cfg.scoring)
    assert not [x for x in r.reasons if x.site_problem]


# -- tier suggestions ---------------------------------------------------------


def test_tier_restaurant_menu_is_standard(cfg: AppConfig) -> None:
    tier, why = suggest_tier(facts(site=good_site(has_menu=True)), cfg.scoring)
    assert tier == "Standard" and "menu" in why


def test_tier_shop_is_online_store(cfg: AppConfig) -> None:
    tier, _ = suggest_tier(facts(category_group="services", site=good_site(has_shop=True)), cfg.scoring)
    assert tier == "Online Store"
    tier2, _ = suggest_tier(facts(category_group="retail", site=None), cfg.scoring)
    assert tier2 == "Online Store"


def test_tier_busy_booking_is_custom(cfg: AppConfig) -> None:
    tier, why = suggest_tier(
        facts(category_group="beauty", review_count=450, site=good_site(has_booking=True)), cfg.scoring
    )
    assert tier == "Custom" and "booking" in why


def test_tier_small_barber_is_starter(cfg: AppConfig) -> None:
    tier, _ = suggest_tier(facts(category_group="beauty", review_count=12, site=None), cfg.scoring)
    assert tier == "Starter"


def test_tier_established_contractor_is_standard(cfg: AppConfig) -> None:
    tier, _ = suggest_tier(facts(category_group="trades", review_count=80, site=None), cfg.scoring)
    assert tier == "Standard"
