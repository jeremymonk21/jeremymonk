"""Transparent 0-100 lead scoring and Monk Press tier suggestions.

Every point added or removed is recorded as a ``Reason`` so the score can be explained
line by line. All weights and thresholds come from ``config.yaml``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .audit.pagespeed import PageSpeedResult
from .audit.site_checks import SiteFindings
from .config import ScoringConfig

TIERS = ("Starter", "Standard", "Online Store", "Custom")

BROKEN_LABELS = {
    "dns_failure": "website address doesn't resolve (expired or misconfigured domain)",
    "unreachable": "website doesn't respond",
    "http_error": "website returns an error page",
    "parked": "domain shows a parking / for-sale page",
    "expired": "domain or hosting has expired",
    "under_construction": "site is an 'under construction' / 'coming soon' page",
    "dead_platform": "links to a Google business.site page (shut down in 2024)",
    "not_html": "website address doesn't serve a web page",
}


@dataclass
class LeadFacts:
    """Everything scoring needs, decoupled from the database."""

    name: str
    category_key: str | None = None
    category_group: str = "other"
    category_fit: str = "medium"
    town: str | None = None
    rating: float | None = None
    review_count: int | None = None
    business_status: str | None = None
    distance_miles: float | None = None
    website: str | None = None
    site: SiteFindings | None = None
    psi: PageSpeedResult | None = None
    origin: str = "Troy"


@dataclass
class Reason:
    code: str
    points: float
    detail: str
    site_problem: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ScoreResult:
    score: int
    raw_total: float
    reasons: list[Reason] = field(default_factory=list)
    tier: str = "Starter"
    tier_reason: str = ""
    weak_site: bool = False

    def explain(self) -> str:
        lines = [f"{r.points:+g}  {r.detail}" for r in self.reasons]
        lines.append(f"= {self.raw_total:g} -> score {self.score}")
        return "\n".join(lines)


def _site_reasons(facts: LeadFacts, cfg: ScoringConfig) -> list[Reason]:
    w = cfg.weights
    site = facts.site
    out: list[Reason] = []

    def add(code: str, points: float, detail: str) -> None:
        if points:
            out.append(Reason(code, points, detail, site_problem=True))

    if site is None or site.site_status == "none":
        add("no_website", w.no_website, "No website on the Google listing")
        return out
    if site.site_status == "social_only":
        add("social_only", w.social_only, f"'Website' is only a {site.social_network or 'social'} page")
        return out
    if site.site_status == "broken":
        label = BROKEN_LABELS.get(site.broken_reason or "", "website is broken")
        add(f"broken_{site.broken_reason or 'site'}", w.broken_site, f"Broken site: {label}")
        return out
    if site.site_status == "blocked":
        # We couldn't look; don't guess. PageSpeed (run by Google) may still have data.
        pass

    psi = facts.psi
    if psi and psi.performance is not None:
        if psi.performance < cfg.poor_speed_below:
            add("poor_mobile_speed", w.poor_mobile_speed, f"Mobile PageSpeed {psi.performance}/100 (poor)")
        elif psi.performance < cfg.mediocre_speed_below:
            add(
                "mediocre_mobile_speed",
                w.mediocre_mobile_speed,
                f"Mobile PageSpeed {psi.performance}/100 (so-so)",
            )

    if site.site_status == "blocked":
        return out

    if site.ssl_valid is False:
        add("ssl_invalid", w.ssl_invalid, "SSL certificate is invalid or expired")
    elif site.https is False:
        add("no_https", w.no_https, "No HTTPS (browser shows 'Not secure')")
    elif site.http_redirects_to_https is False:
        add("no_https_redirect", w.no_https_redirect, "http:// version doesn't forward to https://")
    if site.has_viewport is False:
        add("no_viewport", w.no_viewport, "Not set up for phones (no viewport tag)")
    if site.copyright_stale:
        add("stale_copyright", w.stale_copyright, f"Footer copyright is {site.copyright_year}")
    if site.wordpress_outdated:
        add("old_wordpress", w.old_wordpress, f"Old WordPress version {site.platform_version}")
    elif site.platform_outdated:
        add("outdated_platform", w.outdated_platform, f"Built on a dated platform ({site.platform})")
    if site.outdated_markup:
        add("outdated_markup", w.outdated_markup, "Uses outdated markup: " + ", ".join(site.outdated_markup))
    if site.has_title is False or site.has_meta_description is False:
        missing = [
            n
            for n, ok in (("title", site.has_title), ("description", site.has_meta_description))
            if ok is False
        ]
        add(
            "missing_title_or_description",
            w.missing_title_or_description,
            "Missing page " + " and ".join(missing),
        )
    if site.has_tel_link is False:
        add("no_tel_link", w.no_tel_link, "No tap-to-call phone link")
    if site.has_contact_form is False:
        add("no_contact_form", w.no_contact_form, "No contact form")
    if site.has_hours is False:
        add("no_hours", w.no_hours, "Hours not listed on the site")
    if site.has_map is False:
        add("no_map", w.no_map, "No map or directions link")
    return out


def score_lead(facts: LeadFacts, cfg: ScoringConfig) -> ScoreResult:
    w = cfg.weights
    reasons = _site_reasons(facts, cfg)
    site_points = sum(r.points for r in reasons)
    weak_site = site_points >= cfg.weak_site_threshold

    rating = facts.rating or 0.0
    reviews = facts.review_count or 0
    if weak_site and rating >= cfg.reputation_min_rating and reviews >= cfg.reputation_min_reviews:
        reasons.append(
            Reason(
                "reputation_bonus",
                w.reputation_bonus,
                f"Strong reputation ({rating:.1f}★, {reviews} reviews) but weak web presence",
            )
        )

    fit_points = {"high": w.category_fit_high, "medium": w.category_fit_medium, "low": w.category_fit_low}
    fit = fit_points.get(facts.category_fit, 0)
    if fit:
        reasons.append(
            Reason(
                "category_fit",
                fit,
                f"Good-fit category ({facts.category_key or facts.category_group}, {facts.category_fit})",
            )
        )

    if facts.distance_miles is not None and facts.distance_miles > cfg.distance_free_miles:
        penalty = min(
            (facts.distance_miles - cfg.distance_free_miles) * cfg.distance_penalty_per_mile,
            cfg.distance_penalty_max,
        )
        if penalty > 0:
            reasons.append(
                Reason(
                    "distance", -round(penalty, 1), f"{facts.distance_miles:.1f} miles from {facts.origin}"
                )
            )

    if reviews < cfg.low_review_count and w.low_review_penalty:
        reasons.append(
            Reason("low_reviews", w.low_review_penalty, f"Only {reviews} Google reviews (may be inactive)")
        )

    if facts.business_status == "CLOSED_TEMPORARILY" and w.temporarily_closed_penalty:
        reasons.append(
            Reason("temporarily_closed", w.temporarily_closed_penalty, "Temporarily closed on Google")
        )

    raw = round(sum(r.points for r in reasons), 1)
    tier, tier_reason = suggest_tier(facts, cfg)
    return ScoreResult(
        score=int(max(0, min(100, round(raw)))),
        raw_total=raw,
        reasons=reasons,
        tier=tier,
        tier_reason=tier_reason,
        weak_site=weak_site,
    )


def suggest_tier(facts: LeadFacts, cfg: ScoringConfig) -> tuple[str, str]:
    """Pick a Monk Press plan with a one-line reason."""
    site = facts.site
    reviews = facts.review_count or 0
    group = facts.category_group

    def has(attr: str) -> bool:
        return bool(site and getattr(site, attr, False))

    if has("has_shop"):
        return "Online Store", "already sells products on their site → Online Store"
    if (has("has_online_ordering") or has("has_booking")) and reviews >= cfg.custom_min_reviews:
        what = "online ordering" if has("has_online_ordering") else "online booking"
        return "Custom", f"busy business ({reviews} reviews) with {what} to integrate → Custom"
    if group == "retail":
        return "Online Store", "sells products in a shop → Online Store so customers can buy online"
    if group == "food":
        if has("has_online_ordering"):
            return "Standard", "has a menu and online ordering link → Standard"
        if has("has_menu"):
            return "Standard", "has a menu → Standard (menu, hours, photos, catering)"
        return "Standard", "food business that needs a menu page → Standard (menu, hours, photos)"
    if has("has_booking"):
        return "Standard", "takes appointments → Standard with a booking page"
    if group in {"trades", "auto", "beauty"} and reviews >= cfg.standard_min_reviews:
        return "Standard", f"established business ({reviews} reviews) with several services → Standard"
    if site and site.site_status == "social_only":
        return "Starter", "only on social media → Starter (home, services, contact)"
    return "Starter", "simple local service → Starter (home, services, contact)"
