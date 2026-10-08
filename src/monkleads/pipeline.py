"""Orchestration: discover -> audit -> score -> ranked leads. Shared by every CLI command."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from rich.progress import Progress
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .audit.pagespeed import PageSpeedResult, run_pagespeed
from .audit.screenshot import Screenshotter
from .audit.site_checks import SiteChecker, SiteFindings
from .cache import ApiCache
from .compliance import ComplianceError, SuppressionList, check_sender, draft_email
from .config import AppConfig, Category, Secrets, Town
from .db import (
    NEVER_RESURFACE,
    Audit,
    Business,
    Score,
    make_engine,
    make_session_factory,
    utcnow,
)
from .discovery.normalize import (
    ChainDetector,
    DedupeIndex,
    ensure_scheme,
    hostname,
    location_counts,
    normalize_phone,
)
from .discovery.places import PlaceRecord, PlacesAPIError, PlacesClient
from .geo import haversine_miles
from .llm import OpenerWriter, estimate_llm_cost
from .scoring import LeadFacts, score_lead
from .talking_points import build_problems, opener_facts_payload, template_opener

log = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Cost estimates
# ---------------------------------------------------------------------------


@dataclass
class CostLine:
    label: str
    calls_low: int
    calls_high: int
    unit_usd: float

    @property
    def low(self) -> float:
        return self.calls_low * self.unit_usd

    @property
    def high(self) -> float:
        return self.calls_high * self.unit_usd


@dataclass
class CostEstimate:
    lines: list[CostLine] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def high(self) -> float:
        return sum(line.high for line in self.lines)

    @property
    def low(self) -> float:
        return sum(line.low for line in self.lines)


def estimate_discovery_cost(cfg: AppConfig, towns: list[Town], cats: list[Category]) -> CostEstimate:
    est = CostEstimate()
    queries = len(towns) * len(cats)
    if cfg.discovery.mode == "text":
        unit = cfg.costs.places_text_search_per_1000 / 1000
        est.lines.append(
            CostLine(
                f"Places Text Search ({len(towns)} towns × {len(cats)} categories, "
                f"up to {cfg.discovery.max_pages_per_query} pages)",
                queries,
                queries * cfg.discovery.max_pages_per_query,
                unit,
            )
        )
    else:
        unit = cfg.costs.places_nearby_search_per_1000 / 1000
        est.lines.append(CostLine(f"Places Nearby Search ({queries} searches)", queries, queries, unit))
    est.notes.append("Cached queries (younger than cache.places_ttl_days) are free and not re-sent.")
    est.notes.append("Google's monthly free usage per SKU is not subtracted; actual cost may be lower.")
    return est


def estimate_opener_cost(cfg: AppConfig, n_leads: int) -> CostEstimate:
    est = CostEstimate()
    per = estimate_llm_cost(1, cfg.llm)
    est.lines.append(CostLine(f"Claude openers ({cfg.llm.model}, up to {n_leads} leads)", 0, n_leads, per))
    est.notes.append("Openers already drafted for unchanged facts are cached and not re-billed.")
    return est


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_STATE_ZIP = re.compile(r"^[A-Z]{2}\s+\d{5}")


def town_from_address(address: str | None) -> str | None:
    """'12 River St, Troy, NY 12180, USA' -> 'Troy'."""
    if not address:
        return None
    parts = [p.strip() for p in address.split(",")]
    for i, part in enumerate(parts):
        if _STATE_ZIP.match(part) and i > 0:
            return parts[i - 1]
    return None


def _findings(audit: Audit | None) -> SiteFindings | None:
    if audit is None:
        return None
    data = dict(audit.findings or {})
    # The audit row's own columns are authoritative if the JSON is missing them.
    data.setdefault("site_status", audit.site_status)
    if data.get("broken_reason") is None:
        data["broken_reason"] = audit.broken_reason
    data.setdefault("input_url", None)
    return SiteFindings.from_dict(data)


def facts_for(b: Business, audit: Audit | None, cfg: AppConfig) -> LeadFacts:
    cat = cfg.category(b.category_key)
    return LeadFacts(
        name=b.name,
        category_key=b.category_key,
        category_group=cat.group if cat else "other",
        category_fit=cat.fit if cat else "low",
        town=b.town,
        rating=b.rating,
        review_count=b.review_count,
        business_status=b.business_status,
        distance_miles=b.distance_miles,
        website=b.website,
        site=_findings(audit),
        psi=PageSpeedResult.from_dict(audit.pagespeed) if audit else None,
        origin=cfg.discovery.origin,
    )


@dataclass
class DiscoverStats:
    queries: int = 0
    api_calls: int = 0
    cache_hits: int = 0
    found: int = 0
    new: int = 0
    updated: int = 0
    excluded: Counter[str] = field(default_factory=Counter)
    errors: int = 0


@dataclass
class AuditStats:
    audited: int = 0
    errors: int = 0
    screenshots: int = 0
    pagespeed: int = 0
    by_status: Counter[str] = field(default_factory=Counter)


@dataclass
class ScoreStats:
    scored: int = 0
    llm_openers: int = 0
    email_drafts: int = 0
    skipped_unaudited: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class LeadRow:
    id: int
    place_id: str
    name: str
    category: str | None
    town: str | None
    address: str | None
    phone: str | None
    website: str | None
    maps_url: str | None
    rating: float | None
    review_count: int | None
    distance_miles: float | None
    site_status: str
    broken_reason: str | None
    platform: str | None
    performance: int | None
    score: int
    tier: str
    tier_reason: str
    problems: list[str]
    opener: str
    opener_source: str
    email_subject: str | None
    email_body: str | None
    reasons: list[dict[str, Any]]
    status: str
    notes: str
    screenshot: Path | None
    audited_at: str | None
    hours: list[str] = field(default_factory=list)


@dataclass
class _Snapshot:
    id: int
    place_id: str
    name: str
    website: str | None


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


class Pipeline:
    def __init__(self, cfg: AppConfig, secrets: Secrets) -> None:
        self.cfg = cfg
        self.secrets = secrets
        self.engine = make_engine(cfg.db_path)
        self.sessions = make_session_factory(self.engine)
        self.cache = ApiCache(self.sessions)

    def suppression(self) -> SuppressionList:
        return SuppressionList(self.cfg.output.suppression_file)

    def _http(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers={"User-Agent": self.cfg.audit.user_agent},
            timeout=httpx.Timeout(timeout, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    # -- discover ------------------------------------------------------------

    async def discover(
        self, towns: list[Town], cats: list[Category], progress: Progress | None = None
    ) -> DiscoverStats:
        key = self.secrets.google_places_key
        if not key:
            raise PipelineError("GOOGLE_PLACES_API_KEY is not set (see .env.example)")
        dcfg = self.cfg.discovery
        stats = DiscoverStats(queries=len(towns) * len(cats))
        task = progress.add_task("Discovering", total=stats.queries) if progress else None
        sem = asyncio.Semaphore(dcfg.concurrency)
        results: list[tuple[Town, Category, list[PlaceRecord]]] = []
        hits_before = self.cache.hits

        async with self._http(30.0) as client:
            places = PlacesClient(
                client,
                key,
                cache=self.cache,
                cache_ttl_days=self.cfg.cache.places_ttl_days,
                page_size=dcfg.page_size,
                region_code=dcfg.region_code,
            )

            async def one(town: Town, cat: Category) -> None:
                async with sem:
                    try:
                        if dcfg.mode == "nearby" and cat.place_types:
                            recs = await places.nearby_search(
                                cat.place_types, lat=town.lat, lng=town.lng, radius_m=town.radius_km * 1000
                            )
                        else:
                            recs = await places.text_search(
                                f"{cat.query} in {town.name}, NY",
                                lat=town.lat,
                                lng=town.lng,
                                radius_m=town.radius_km * 1000,
                                max_pages=dcfg.max_pages_per_query,
                            )
                    except PlacesAPIError as exc:
                        if exc.fatal:
                            raise  # bad key / API not enabled: stop the whole run
                        log.error(
                            "places search failed",
                            extra={"town": town.name, "category": cat.key, "error": str(exc)},
                        )
                        stats.errors += 1
                        recs = []
                    except httpx.HTTPError as exc:
                        log.error(
                            "places search failed",
                            extra={"town": town.name, "category": cat.key, "error": str(exc)},
                        )
                        stats.errors += 1
                        recs = []
                    results.append((town, cat, recs))
                    if progress and task is not None:
                        progress.advance(task)

            try:
                async with asyncio.TaskGroup() as tg:
                    for town in towns:
                        for cat in cats:
                            tg.create_task(one(town, cat))
            except* PlacesAPIError as eg:
                raise PipelineError(str(eg.exceptions[0])) from None
            stats.api_calls = places.billable_calls

        stats.cache_hits = self.cache.hits - hits_before
        self._store_places(results, stats)
        return stats

    def _store_places(
        self, results: list[tuple[Town, Category, list[PlaceRecord]]], stats: DiscoverStats
    ) -> None:
        cfg = self.cfg
        origin = cfg.origin_town()
        social = cfg.audit.social_domains
        # First sighting wins for town/category attribution.
        flat: dict[str, tuple[PlaceRecord, Town, Category]] = {}
        for town, cat, recs in results:
            for rec in recs:
                flat.setdefault(rec.place_id, (rec, town, cat))
        stats.found = len(flat)
        chains = ChainDetector(
            cfg.chains.blocklist, cfg.chains.min_locations, cfg.chains.locator_url_patterns
        )
        now = utcnow()

        with self.sessions() as s, s.begin():
            existing = {b.place_id: b for b in s.scalars(select(Business))}
            index = DedupeIndex(social)
            for b in existing.values():
                if not (b.excluded_reason or "").startswith("duplicate"):
                    index.add(b.place_id, b.phone, b.website)
            name_counts, domain_counts = location_counts(
                [(b.name, b.website, b.address) for pid, b in existing.items() if pid not in flat]
                + [(r.name, r.website, r.address) for r, _, _ in flat.values()],
                social,
            )

            for pid, (rec, town, cat) in flat.items():
                dist = (
                    haversine_miles(origin.lat, origin.lng, rec.lat, rec.lng)
                    if rec.lat is not None and rec.lng is not None
                    else None
                )
                excluded: str | None = None
                if rec.business_status == "CLOSED_PERMANENTLY":
                    excluded = "permanently_closed"
                elif dist is not None and dist > cfg.discovery.max_distance_miles:
                    excluded = "out_of_area"
                else:
                    reason = chains.check(rec, name_counts, domain_counts, social)
                    if reason:
                        excluded = f"chain: {reason}"
                if excluded is None:
                    dup = index.duplicate_of(pid, rec.phone, rec.website)
                    if dup:
                        excluded = f"duplicate of {dup}"

                biz = existing.get(pid)
                if biz is None:
                    biz = Business(
                        place_id=pid,
                        name=rec.name,
                        first_seen=now,
                        category_key=cat.key,
                        source_query=f"{cat.query} in {town.name}",
                    )
                    s.add(biz)
                    stats.new += 1
                else:
                    stats.updated += 1
                biz.name = rec.name
                biz.address = rec.address
                biz.town = town_from_address(rec.address) or town.name
                biz.phone = rec.phone
                biz.phone_normalized = normalize_phone(rec.phone)
                biz.website = rec.website
                biz.domain = hostname(rec.website)
                biz.rating = rec.rating
                biz.review_count = rec.review_count
                biz.business_status = rec.business_status
                biz.hours = rec.hours
                biz.primary_type = rec.primary_type
                biz.types = rec.types
                biz.maps_url = rec.maps_url
                biz.lat, biz.lng = rec.lat, rec.lng
                biz.distance_miles = round(dist, 1) if dist is not None else None
                biz.excluded_reason = excluded
                biz.last_seen = now
                if excluded:
                    stats.excluded[excluded.split(":")[0].split(" of ")[0]] += 1
                else:
                    index.add(pid, rec.phone, rec.website)

    # -- audit ---------------------------------------------------------------

    def select_for_audit(
        self, session: Session, *, force: bool = False, limit: int | None = None, ids: list[int] | None = None
    ) -> list[Business]:
        cutoff = utcnow() - timedelta(days=self.cfg.audit.stale_after_days)
        sup = self.suppression()
        q = (
            select(Business)
            .where(Business.excluded_reason.is_(None))
            .options(selectinload(Business.audits), selectinload(Business.outreach))
            .order_by(Business.review_count.desc().nulls_last(), Business.id)
        )
        if ids:
            q = q.where(Business.id.in_(ids))
        out: list[Business] = []
        for b in session.scalars(q):
            if b.status in NEVER_RESURFACE:
                continue
            if sup.matches(place_id=b.place_id, phone=b.phone, website=b.website, name=b.name):
                continue
            last = b.latest_audit
            website_changed = last is not None and (last.findings or {}).get("input_url") != (
                ensure_scheme(b.website) if b.website else None
            )
            if force or last is None or last.created_at < cutoff or website_changed:
                out.append(b)
            if limit and len(out) >= limit:
                break
        return out

    async def audit(
        self,
        businesses: list[Business],
        *,
        run_psi: bool,
        screenshots: bool,
        progress: Progress | None = None,
    ) -> AuditStats:
        acfg = self.cfg.audit
        snaps = [_Snapshot(b.id, b.place_id, b.name, b.website) for b in businesses]
        stats = AuditStats()
        task = progress.add_task("Auditing", total=len(snaps)) if progress else None
        site_sem = asyncio.Semaphore(acfg.concurrency)
        psi_sem = asyncio.Semaphore(acfg.pagespeed_concurrency)
        rows: list[Audit] = []

        async with self._http(acfg.request_timeout_s) as client:
            checker = SiteChecker(client, acfg)
            shooter = Screenshotter(
                self.cfg.screenshots_dir,
                device=acfg.screenshot_device,
                user_agent_suffix=acfg.robots_user_agent,
                concurrency=acfg.screenshot_concurrency,
                executable_path=acfg.chromium_executable,
            )
            async with shooter if screenshots else _null_ctx():

                async def one(snap: _Snapshot) -> None:
                    try:
                        async with site_sem:
                            findings = await checker.check(snap.website)
                        psi: PageSpeedResult | None = None
                        if run_psi and findings.site_status == "ok" and findings.final_url:
                            async with psi_sem:
                                psi = await run_pagespeed(
                                    client,
                                    findings.final_url,
                                    api_key=self.secrets.google_pagespeed_key,
                                    cache=self.cache,
                                    cache_ttl_days=self.cfg.cache.pagespeed_ttl_days,
                                    timeout_s=acfg.pagespeed_timeout_s,
                                )
                            if psi.error:
                                log.info(
                                    "pagespeed failed", extra={"business": snap.name, "error": psi.error}
                                )
                            else:
                                stats.pagespeed += 1
                        shot: Path | None = None
                        if (
                            screenshots
                            and findings.reachable
                            and findings.final_url
                            and findings.robots_allowed is not False
                            and findings.site_status in ("ok", "broken")
                        ):
                            shot = await shooter.capture(findings.final_url, snap.place_id)
                            if shot:
                                stats.screenshots += 1
                        rows.append(
                            Audit(
                                business_id=snap.id,
                                site_status=findings.site_status,
                                broken_reason=findings.broken_reason,
                                platform=findings.platform,
                                performance=psi.performance if psi else None,
                                accessibility=psi.accessibility if psi else None,
                                seo=psi.seo if psi else None,
                                best_practices=psi.best_practices if psi else None,
                                lcp_ms=(psi.field_lcp_ms or psi.lcp_ms) if psi else None,
                                cls=(
                                    psi.field_cls
                                    if psi and psi.field_cls is not None
                                    else (psi.cls if psi else None)
                                ),
                                screenshot_path=str(shot) if shot else None,
                                findings=findings.to_dict(),
                                pagespeed=psi.to_dict() if psi else None,
                                error=psi.error if psi else None,
                            )
                        )
                        stats.audited += 1
                        stats.by_status[findings.site_status] += 1
                    except Exception:
                        # Leave no audit row so the business is retried next run.
                        log.exception("audit failed", extra={"business": snap.name, "website": snap.website})
                        stats.errors += 1
                    finally:
                        if progress and task is not None:
                            progress.advance(task)

                await asyncio.gather(*(one(s) for s in snaps))

        with self.sessions() as s, s.begin():
            s.add_all(rows)
        return stats

    # -- score ---------------------------------------------------------------

    async def score(self, *, use_llm: bool, progress: Progress | None = None) -> ScoreStats:
        cfg = self.cfg
        stats = ScoreStats()
        sup = self.suppression()
        try:
            check_sender(cfg.sender)
            can_email = True
        except ComplianceError as exc:
            can_email = False
            stats.warnings.append(str(exc))

        with self.sessions() as s:
            q = (
                select(Business)
                .where(Business.excluded_reason.is_(None))
                .options(selectinload(Business.audits), selectinload(Business.outreach))
            )
            work: list[tuple[int, int, LeadFacts]] = []
            for b in s.scalars(q):
                if b.status in NEVER_RESURFACE or sup.matches(
                    place_id=b.place_id, phone=b.phone, website=b.website, name=b.name
                ):
                    continue
                audit = b.latest_audit
                if audit is None:
                    stats.skipped_unaudited += 1
                    continue
                work.append((b.id, audit.id, facts_for(b, audit, cfg)))

        writer: OpenerWriter | None = None
        if use_llm:
            writer = OpenerWriter(
                cfg.llm,
                cfg.sender,
                api_key=self.secrets.anthropic_key,
                cache=self.cache,
                cache_ttl_days=cfg.cache.llm_ttl_days,
            )
        task = progress.add_task("Scoring", total=len(work)) if progress else None

        async def one(bid: int, aid: int, facts: LeadFacts) -> dict[str, Any]:
            result = score_lead(facts, cfg.scoring)
            problems = build_problems(facts, result)
            opener, source = template_opener(facts, problems, cfg.sender), "template"
            if writer is not None:
                text = await writer.write(opener_facts_payload(facts, problems, result))
                if text:
                    opener, source = text, "llm"
            subject = body = None
            if can_email:
                has_site = bool(facts.site and facts.site.site_status in ("ok", "blocked"))
                draft = draft_email(facts.name, opener, has_site=has_site, sender=cfg.sender)
                subject, body = draft.subject, draft.body
            if progress and task is not None:
                progress.advance(task)
            return {
                "business_id": bid,
                "audit_id": aid,
                "score": result.score,
                "reasons": [r.to_dict() for r in result.reasons],
                "tier": result.tier,
                "tier_reason": result.tier_reason,
                "problems": [p.to_dict() for p in problems],
                "opener": opener,
                "opener_source": source,
                "email_subject": subject,
                "email_body": body,
            }

        outputs = await asyncio.gather(*(one(*w) for w in work))

        with self.sessions() as s, s.begin():
            for out in outputs:
                row = s.scalar(
                    select(Score).where(
                        Score.business_id == out["business_id"], Score.audit_id == out["audit_id"]
                    )
                )
                if row is None:
                    row = Score(**out)
                    s.add(row)
                else:
                    for k, v in out.items():
                        setattr(row, k, v)
                    row.created_at = utcnow()
                stats.scored += 1
                stats.llm_openers += out["opener_source"] == "llm"
                stats.email_drafts += out["email_body"] is not None
        return stats

    def pending_llm_count(self) -> int:
        with self.sessions() as s:
            return sum(
                1
                for b in s.scalars(select(Business).where(Business.excluded_reason.is_(None)))
                if b.audits and b.status not in NEVER_RESURFACE
            )

    # -- leads ---------------------------------------------------------------

    def ranked_leads(
        self, *, top: int | None = None, min_score: int = 0, statuses: set[str] | None = None
    ) -> tuple[list[LeadRow], int]:
        """Return (leads ranked by score, number removed by the suppression list)."""
        sup = self.suppression()
        rows: list[LeadRow] = []
        suppressed = 0
        with self.sessions() as s:
            q = (
                select(Business)
                .where(Business.excluded_reason.is_(None))
                .options(
                    selectinload(Business.audits),
                    selectinload(Business.scores),
                    selectinload(Business.outreach),
                )
            )
            for b in s.scalars(q):
                score = b.latest_score
                if score is None or b.status in NEVER_RESURFACE:
                    continue
                if statuses and b.status.value not in statuses:
                    continue
                if sup.matches(place_id=b.place_id, phone=b.phone, website=b.website, name=b.name):
                    suppressed += 1
                    continue
                if score.score < min_score:
                    continue
                audit = next((a for a in b.audits if a.id == score.audit_id), b.latest_audit)
                findings = (audit.findings if audit else None) or {}
                rows.append(
                    LeadRow(
                        id=b.id,
                        place_id=b.place_id,
                        name=b.name,
                        category=b.category_key,
                        town=b.town,
                        address=b.address,
                        phone=b.phone,
                        website=b.website,
                        maps_url=b.maps_url,
                        rating=b.rating,
                        review_count=b.review_count,
                        distance_miles=b.distance_miles,
                        site_status=audit.site_status if audit else "unknown",
                        broken_reason=audit.broken_reason if audit else None,
                        platform=findings.get("platform"),
                        performance=audit.performance if audit else None,
                        score=score.score,
                        tier=score.tier,
                        tier_reason=score.tier_reason,
                        problems=[p["text"] for p in score.problems],
                        opener=score.opener,
                        opener_source=score.opener_source,
                        email_subject=score.email_subject,
                        email_body=score.email_body,
                        reasons=list(score.reasons),
                        status=b.status.value,
                        notes=b.outreach.notes if b.outreach else "",
                        screenshot=Path(audit.screenshot_path) if audit and audit.screenshot_path else None,
                        audited_at=audit.created_at.strftime("%Y-%m-%d") if audit else None,
                        hours=list(b.hours or []),
                    )
                )
        rows.sort(key=lambda r: (-r.score, -(r.review_count or 0), r.name))
        return (rows[:top] if top else rows), suppressed


class _null_ctx:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *exc: object) -> None:
        return None
