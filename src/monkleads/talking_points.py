"""Plain-English problems and a short, friendly opener in Jeremy's voice.

Nothing here sends anything. These are drafts for Jeremy to read, edit, and use himself.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from .config import Sender
from .scoring import LeadFacts, ScoreResult

MAX_OPENER_WORDS = 90  # openers must be *under* this many words


@dataclass
class Problem:
    code: str
    text: str  # full sentence for the call sheet
    short: str  # lower-case clause that fits into "I noticed ___."
    points: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _speed_sentence(facts: LeadFacts) -> tuple[str, str]:
    psi = facts.psi
    secs = psi.load_seconds if psi else None
    if secs and secs >= 2.5:
        n = int(round(secs))
        return (
            f"Your site takes about {n} seconds to show up on a phone. Most people give up after 3.",
            f"your site takes about {n} seconds to load on a phone",
        )
    score = psi.performance if psi else None
    return (
        f"Google's own speed test gives your site {score} out of 100 on phones, so it feels slow.",
        "your site is pretty slow to load on a phone",
    )


def _problem_for(code: str, facts: LeadFacts) -> tuple[str, str] | None:
    site = facts.site
    if code == "no_website":
        what = facts.category_key.replace("_", " ") if facts.category_key else "businesses"
        where = f" in {facts.town}" if facts.town else ""
        return (
            "Your Google listing has no website link, so people who find you on Google Maps have "
            f"nowhere to click when they search for {what}{where}.",
            "your Google listing doesn't have a website link",
        )
    if code == "social_only":
        net = (site.social_network if site else None) or "social media"
        net = {"facebook": "Facebook", "instagram": "Instagram", "fb": "Facebook"}.get(net, net.title())
        return (
            f"Your Google listing sends people to your {net} page instead of a website. Anyone not on "
            f"{net} hits a login screen.",
            f"your Google listing points to your {net} page rather than a website",
        )
    if code.startswith("broken_"):
        reason = code.removeprefix("broken_")
        host = (site.input_url if site else None) or "your web address"
        host = re.sub(r"^https?://(www\.)?", "", host).rstrip("/")
        texts = {
            "dns_failure": (
                f"Your website ({host}) doesn't load at all. The domain may have expired or isn't pointed anywhere.",
                f"the website on your Google listing ({host}) doesn't load",
            ),
            "unreachable": (
                f"Your website ({host}) didn't respond when I tried to open it.",
                f"your website ({host}) wouldn't load for me",
            ),
            "http_error": (
                f"Your website ({host}) shows an error page instead of your business.",
                "your website shows an error page instead of your business",
            ),
            "parked": (
                f"Your web address ({host}) shows a 'domain for sale' page instead of your business.",
                "your web address is showing a 'domain for sale' page",
            ),
            "expired": (
                f"Your website ({host}) says the domain or hosting has expired.",
                "your website is showing an 'expired' notice",
            ),
            "under_construction": (
                "Your website still says 'coming soon' / 'under construction'.",
                "your website still says 'coming soon'",
            ),
            "dead_platform": (
                "Your Google listing links to a business.site page. Google shut those down in 2024, so that link is dead.",
                "the website link on your Google listing goes to a page Google shut down",
            ),
            "not_html": (
                f"Your web address ({host}) doesn't open a normal web page.",
                "your web address doesn't open a normal web page",
            ),
        }
        return texts.get(reason, (f"Your website ({host}) isn't working.", "your website isn't working"))
    if code in ("poor_mobile_speed", "mediocre_mobile_speed"):
        return _speed_sentence(facts)
    if code == "ssl_invalid":
        return (
            "Your site's security certificate is broken, so browsers show a scary warning before your site.",
            "browsers show a security warning before your site loads",
        )
    if code == "no_https":
        return (
            "Your site isn't secure (no padlock), so Chrome labels it 'Not secure'.",
            "Chrome marks your site as 'Not secure'",
        )
    if code == "no_https_redirect":
        return (
            "If someone types your address without https, they land on the unsecured version.",
            "the plain http version of your site doesn't forward to the secure one",
        )
    if code == "no_viewport":
        return (
            "Your site isn't set up for phones, so visitors have to pinch and zoom to read it.",
            "your site isn't set up for phones (lots of pinching and zooming)",
        )
    if code == "stale_copyright":
        year = site.copyright_year if site else None
        return (
            f"The footer says ©{year}, which makes the site look like nobody's minding it.",
            f"the footer still says ©{year}",
        )
    if code == "old_wordpress":
        ver = site.platform_version if site else ""
        return (
            f"Your site runs an old version of WordPress ({ver}) that's missing years of security fixes.",
            "your site is running an old version of WordPress",
        )
    if code == "outdated_platform":
        plat = site.platform if site else "an older builder"
        return (
            f"Your site is built on {plat}, which is dated and hard to keep looking current.",
            f"your site is on {plat}, which is pretty dated now",
        )
    if code == "outdated_markup":
        return (
            "Parts of the site are built with very old techniques that don't work well on phones.",
            "parts of the site use very old building blocks that don't work on phones",
        )
    if code == "missing_title_or_description":
        return (
            "Your homepage is missing the title/description Google shows in search results.",
            "your homepage is missing the text Google shows in search results",
        )
    if code == "no_tel_link":
        return (
            "There's no tap-to-call button. On a phone, people can't just tap your number to call.",
            "there's no tap-to-call button on your site",
        )
    if code == "no_contact_form":
        return (
            "There's no contact form, so people can't reach out after hours without calling.",
            "there's no contact form on your site",
        )
    if code == "no_hours":
        return ("Your hours aren't on your website.", "your hours aren't on your website")
    if code == "no_map":
        return ("There's no map or directions on your site.", "there's no map or directions on your site")
    return None


def build_problems(facts: LeadFacts, result: ScoreResult, limit: int = 3) -> list[Problem]:
    """Top problems by points, translated to plain English."""
    problems: list[Problem] = []
    for reason in sorted(
        (r for r in result.reasons if r.site_problem and r.points > 0), key=lambda r: -r.points
    ):
        texts = _problem_for(reason.code, facts)
        if texts:
            problems.append(Problem(reason.code, texts[0], texts[1], reason.points))
        if len(problems) >= limit:
            break
    return problems


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _praise(facts: LeadFacts) -> str:
    rating, reviews = facts.rating or 0, facts.review_count or 0
    if rating >= 4.3 and reviews >= 25:
        return f"With {rating:.1f} stars from {reviews} reviews, your customers clearly love you. "
    if rating >= 4.5 and reviews >= 10:
        return f"Your reviews are great ({rating:.1f} stars). "
    return ""


def template_opener(facts: LeadFacts, problems: list[Problem], sender: Sender) -> str:
    """A short, plain-spoken opener. Always fewer than MAX_OPENER_WORDS words."""
    first = sender.name.split()[0]
    # Broken/parked/social-only sites get the mockup offer; there's nothing to audit yet.
    no_site = not facts.site or facts.site.site_status in ("none", "social_only", "broken")
    noticed = problems[0].short if problems else None
    praise = _praise(facts)

    if no_site:
        found = f"I came across {facts.name} on Google"
        found += f" and noticed {noticed}. " if noticed else ". "
        offer = (
            "If it'd help, I'd be glad to put together a free mockup of a simple site, "
            "just so you can see it. No cost, no pressure."
        )
    else:
        found = f"I pulled up {facts.name}'s website on my phone"
        found += f" and noticed {noticed}. " if noticed else ". "
        offer = (
            "If it'd help, I'll do a free audit: I go through your site on a phone and send a short "
            "video with the three things I'd fix first. No cost, no pressure."
        )

    intro = f"Hi, I'm {sender.name}. I run {sender.business}, a one-person web design shop here in {sender.home_area}. "
    sign = f" — {first}"

    for parts in (
        (intro, found, praise, offer, sign),
        (intro, found, offer, sign),
        (f"Hi, I'm {first} from {sender.business} here in {sender.home_area}. ", found, offer, sign),
    ):
        text = "".join(parts).strip()
        if word_count(text) < MAX_OPENER_WORDS:
            return text
    # Extremely long business names: trim hard but stay polite.
    words = text.split()
    return " ".join(words[: MAX_OPENER_WORDS - 3]) + sign


def opener_facts_payload(facts: LeadFacts, problems: list[Problem], result: ScoreResult) -> dict[str, Any]:
    """Facts handed to the LLM (no scores or internal jargon)."""
    return {
        "business_name": facts.name,
        "town": facts.town,
        "category": (facts.category_key or "").replace("_", " "),
        "google_rating": facts.rating,
        "google_review_count": facts.review_count,
        "has_real_website": bool(facts.site and facts.site.site_status in ("ok", "blocked")),
        "problems_found": [p.text for p in problems],
        "suggested_plan": result.tier,
    }
