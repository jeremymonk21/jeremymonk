"""Configuration: YAML file for behaviour, environment variables for secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, model_validator

CategoryGroup = Literal["food", "beauty", "trades", "auto", "retail", "services", "other"]
Fit = Literal["high", "medium", "low"]


class Town(BaseModel):
    name: str
    lat: float
    lng: float
    radius_km: float = Field(6.0, gt=0, le=50)
    county: str = "Rensselaer"
    extended: bool = False


class Category(BaseModel):
    key: str
    query: str
    group: CategoryGroup = "other"
    fit: Fit = "medium"
    place_types: list[str] = Field(default_factory=list)


class DiscoveryConfig(BaseModel):
    mode: Literal["text", "nearby"] = "text"
    max_pages_per_query: int = Field(2, ge=1, le=3)
    page_size: int = Field(20, ge=1, le=20)
    include_extended_area: bool = False
    origin: str = "Troy"
    max_distance_miles: float = 30.0
    concurrency: int = Field(4, ge=1, le=20)
    region_code: str = "us"


class ChainConfig(BaseModel):
    blocklist: list[str] = Field(default_factory=list)
    min_locations: int = Field(3, ge=2)
    locator_url_patterns: list[str] = Field(
        default_factory=lambda: ["/locations/", "/stores/", "/store/", "storelocator"]
    )


class AuditConfig(BaseModel):
    stale_after_days: int = Field(30, ge=0)
    concurrency: int = Field(5, ge=1, le=50)
    per_host_min_interval_s: float = Field(1.5, ge=0)
    request_timeout_s: float = Field(15.0, gt=0)
    max_html_bytes: int = 2_000_000
    user_agent: str = "MonkPressSiteCheck/1.0 (+https://themonkpress.com)"
    robots_user_agent: str = "MonkPressSiteCheck"
    run_pagespeed: bool = True
    pagespeed_timeout_s: float = 90.0
    pagespeed_concurrency: int = Field(3, ge=1, le=10)
    screenshots: bool = True
    screenshot_device: str = "iPhone 13"
    screenshot_concurrency: int = Field(2, ge=1, le=8)
    # Optional path to a Chrome/Chromium binary, for when Playwright's bundled browser isn't installed.
    chromium_executable: str | None = None
    copyright_stale_age_years: int = Field(6, ge=1)
    old_wordpress_major: int = 6
    social_domains: list[str] = Field(
        default_factory=lambda: ["facebook.com", "fb.com", "instagram.com", "linktr.ee"]
    )
    dead_platform_domains: list[str] = Field(default_factory=lambda: ["business.site"])

    def copyright_stale_before(self, today: date | None = None) -> int:
        """Copyright years strictly below this are 'stale'."""
        return (today or date.today()).year - self.copyright_stale_age_years


class ScoringWeights(BaseModel):
    no_website: float = 60
    social_only: float = 45
    broken_site: float = 55
    poor_mobile_speed: float = 25
    mediocre_mobile_speed: float = 10
    no_https: float = 12
    ssl_invalid: float = 15
    no_https_redirect: float = 3
    no_viewport: float = 15
    stale_copyright: float = 10
    outdated_platform: float = 10
    old_wordpress: float = 8
    outdated_markup: float = 10
    missing_title_or_description: float = 5
    no_tel_link: float = 6
    no_contact_form: float = 4
    no_hours: float = 4
    no_map: float = 2
    reputation_bonus: float = 12
    category_fit_high: float = 8
    category_fit_medium: float = 4
    category_fit_low: float = 0
    low_review_penalty: float = -5
    temporarily_closed_penalty: float = -15


class ScoringConfig(BaseModel):
    weights: ScoringWeights = Field(default_factory=ScoringWeights)
    reputation_min_rating: float = 4.3
    reputation_min_reviews: int = 25
    weak_site_threshold: float = 20
    poor_speed_below: int = 50
    mediocre_speed_below: int = 70
    distance_free_miles: float = 5
    distance_penalty_per_mile: float = 0.5
    distance_penalty_max: float = 15
    low_review_count: int = 3
    custom_min_reviews: int = 200
    standard_min_reviews: int = 50


class Sender(BaseModel):
    name: str = "Jeremy Monk"
    business: str = "The Monk Press"
    website: str = "https://themonkpress.com"
    email: str = ""
    phone: str = ""
    physical_address: str = ""
    home_area: str = "Rensselaer County"


class LLMConfig(BaseModel):
    enabled: bool = False
    model: str = "claude-opus-5-5"
    effort: Literal["low", "medium", "high"] = "low"
    max_concurrency: int = Field(3, ge=1, le=10)
    est_input_tokens: int = 900
    est_output_tokens: int = 600
    price_input_per_mtok: float = 4.0
    price_output_per_mtok: float = 20.0


class CostConfig(BaseModel):
    places_text_search_per_1000: float = 35.0
    places_nearby_search_per_1000: float = 35.0
    confirm_over_usd: float = 5.0


class CacheConfig(BaseModel):
    places_ttl_days: int = 30
    pagespeed_ttl_days: int = 7
    llm_ttl_days: int = 90


class OutputConfig(BaseModel):
    data_dir: Path = Path("data")
    suppression_file: Path = Path("suppression.txt")
    report_top_n: int = 25


class AppConfig(BaseModel):
    towns: list[Town]
    categories: list[Category]
    discovery: DiscoveryConfig = Field(default_factory=DiscoveryConfig)
    chains: ChainConfig = Field(default_factory=ChainConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)
    scoring: ScoringConfig = Field(default_factory=ScoringConfig)
    sender: Sender = Field(default_factory=Sender)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    costs: CostConfig = Field(default_factory=CostConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)

    @model_validator(mode="after")
    def _check(self) -> AppConfig:
        names = [t.name.lower() for t in self.towns]
        if len(names) != len(set(names)):
            raise ValueError("town names must be unique")
        keys = [c.key for c in self.categories]
        if len(keys) != len(set(keys)):
            raise ValueError("category keys must be unique")
        if self.discovery.origin.lower() not in names:
            raise ValueError(f"discovery.origin '{self.discovery.origin}' is not in towns")
        return self

    # -- derived paths ---------------------------------------------------
    @property
    def db_path(self) -> Path:
        return self.output.data_dir / "leads.db"

    @property
    def screenshots_dir(self) -> Path:
        return self.output.data_dir / "screenshots"

    @property
    def exports_dir(self) -> Path:
        return self.output.data_dir / "exports"

    @property
    def reports_dir(self) -> Path:
        return self.output.data_dir / "reports"

    # -- lookups -----------------------------------------------------------
    def origin_town(self) -> Town:
        return next(t for t in self.towns if t.name.lower() == self.discovery.origin.lower())

    def category(self, key: str | None) -> Category | None:
        return next((c for c in self.categories if c.key == key), None)

    def select_towns(self, names: list[str] | None = None, extended: bool | None = None) -> list[Town]:
        include_ext = self.discovery.include_extended_area if extended is None else extended
        if names:
            wanted = {n.lower() for n in names}
            unknown = wanted - {t.name.lower() for t in self.towns}
            if unknown:
                raise ValueError(f"unknown town(s): {', '.join(sorted(unknown))}")
            return [t for t in self.towns if t.name.lower() in wanted]
        return [t for t in self.towns if include_ext or not t.extended]

    def select_categories(self, keys: list[str] | None = None) -> list[Category]:
        if not keys:
            return list(self.categories)
        wanted = set(keys)
        unknown = wanted - {c.key for c in self.categories}
        if unknown:
            raise ValueError(f"unknown category key(s): {', '.join(sorted(unknown))}")
        return [c for c in self.categories if c.key in wanted]


def load_config(path: str | Path) -> AppConfig:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"config file not found: {path}")
    with path.open(encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    cfg = AppConfig.model_validate(raw)
    base = path.resolve().parent
    if not cfg.output.data_dir.is_absolute():
        cfg.output.data_dir = base / cfg.output.data_dir
    if not cfg.output.suppression_file.is_absolute():
        cfg.output.suppression_file = base / cfg.output.suppression_file
    return cfg


@dataclass(frozen=True)
class Secrets:
    google_places_key: str | None
    google_pagespeed_key: str | None
    anthropic_key: str | None

    @classmethod
    def from_env(cls, dotenv_path: str | Path | None = None) -> Secrets:
        load_dotenv(dotenv_path=dotenv_path, override=False)

        def get(name: str) -> str | None:
            value = os.environ.get(name, "").strip()
            return value or None

        places = get("GOOGLE_PLACES_API_KEY") or get("GOOGLE_API_KEY")
        return cls(
            google_places_key=places,
            google_pagespeed_key=get("GOOGLE_PAGESPEED_API_KEY") or places,
            anthropic_key=get("ANTHROPIC_API_KEY"),
        )
