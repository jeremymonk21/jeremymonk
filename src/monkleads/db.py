"""SQLite storage via SQLAlchemy 2.0."""

from __future__ import annotations

import enum
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import (
    JSON,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite has no time zones; everything stored is UTC)."""
    return datetime.now(UTC).replace(tzinfo=None)


class OutreachStatus(enum.StrEnum):
    NEW = "new"
    CONTACTED = "contacted"
    REPLIED = "replied"
    MEETING = "meeting"
    WON = "won"
    LOST = "lost"
    DO_NOT_CONTACT = "do_not_contact"


# Leads in these states are never re-audited, re-scored, or re-surfaced.
NEVER_RESURFACE = frozenset({OutreachStatus.WON, OutreachStatus.DO_NOT_CONTACT})


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    place_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(500))
    town: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    phone_normalized: Mapped[str | None] = mapped_column(String(20), index=True)
    website: Mapped[str | None] = mapped_column(String(1000))
    domain: Mapped[str | None] = mapped_column(String(255), index=True)
    rating: Mapped[float | None] = mapped_column(Float)
    review_count: Mapped[int | None] = mapped_column(Integer)
    business_status: Mapped[str | None] = mapped_column(String(50))
    hours: Mapped[list[Any] | None] = mapped_column(JSON)
    primary_type: Mapped[str | None] = mapped_column(String(100))
    types: Mapped[list[Any] | None] = mapped_column(JSON)
    category_key: Mapped[str | None] = mapped_column(String(100))
    maps_url: Mapped[str | None] = mapped_column(String(1000))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    distance_miles: Mapped[float | None] = mapped_column(Float)
    # Why this business is not a lead (chain, permanently_closed, out_of_area, duplicate).
    excluded_reason: Mapped[str | None] = mapped_column(String(255))
    source_query: Mapped[str | None] = mapped_column(String(255))
    first_seen: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(default=utcnow)

    audits: Mapped[list[Audit]] = relationship(
        back_populates="business", order_by="Audit.created_at", cascade="all, delete-orphan"
    )
    scores: Mapped[list[Score]] = relationship(
        back_populates="business", order_by="Score.created_at", cascade="all, delete-orphan"
    )
    outreach: Mapped[Outreach | None] = relationship(
        back_populates="business", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def latest_audit(self) -> Audit | None:
        return self.audits[-1] if self.audits else None

    @property
    def latest_score(self) -> Score | None:
        return self.scores[-1] if self.scores else None

    @property
    def status(self) -> OutreachStatus:
        return self.outreach.status if self.outreach else OutreachStatus.NEW


class Audit(Base):
    __tablename__ = "audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    site_status: Mapped[str] = mapped_column(String(50))
    broken_reason: Mapped[str | None] = mapped_column(String(50))
    platform: Mapped[str | None] = mapped_column(String(100))
    performance: Mapped[int | None] = mapped_column(Integer)
    accessibility: Mapped[int | None] = mapped_column(Integer)
    seo: Mapped[int | None] = mapped_column(Integer)
    best_practices: Mapped[int | None] = mapped_column(Integer)
    lcp_ms: Mapped[float | None] = mapped_column(Float)
    cls: Mapped[float | None] = mapped_column(Float)
    screenshot_path: Mapped[str | None] = mapped_column(String(1000))
    findings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    pagespeed: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)

    business: Mapped[Business] = relationship(back_populates="audits")


class Score(Base):
    __tablename__ = "scores"
    __table_args__ = (UniqueConstraint("business_id", "audit_id", name="uq_score_audit"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    audit_id: Mapped[int | None] = mapped_column(ForeignKey("audits.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    score: Mapped[int] = mapped_column(Integer, index=True)
    reasons: Mapped[list[Any]] = mapped_column(JSON, default=list)
    tier: Mapped[str] = mapped_column(String(50))
    tier_reason: Mapped[str] = mapped_column(String(500))
    problems: Mapped[list[Any]] = mapped_column(JSON, default=list)
    opener: Mapped[str] = mapped_column(Text)
    opener_source: Mapped[str] = mapped_column(String(20), default="template")
    email_subject: Mapped[str | None] = mapped_column(String(255))
    email_body: Mapped[str | None] = mapped_column(Text)

    business: Mapped[Business] = relationship(back_populates="scores")


class Outreach(Base):
    __tablename__ = "outreach"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), unique=True)
    status: Mapped[OutreachStatus] = mapped_column(
        Enum(OutreachStatus, values_callable=lambda e: [m.value for m in e], native_enum=False),
        default=OutreachStatus.NEW,
    )
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    business: Mapped[Business] = relationship(back_populates="outreach")
    events: Mapped[list[OutreachEvent]] = relationship(
        back_populates="outreach", order_by="OutreachEvent.created_at", cascade="all, delete-orphan"
    )


class OutreachEvent(Base):
    """Append-only history of status changes and notes."""

    __tablename__ = "outreach_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outreach_id: Mapped[int] = mapped_column(ForeignKey("outreach.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    status: Mapped[str] = mapped_column(String(50))
    note: Mapped[str | None] = mapped_column(Text)

    outreach: Mapped[Outreach] = relationship(back_populates="events")


class ApiCacheEntry(Base):
    __tablename__ = "api_cache"
    __table_args__ = (UniqueConstraint("namespace", "key", name="uq_cache_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    namespace: Mapped[str] = mapped_column(String(50))
    key: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    payload: Mapped[str] = mapped_column(Text)


# ---------------------------------------------------------------------------
# Engine / session helpers
# ---------------------------------------------------------------------------


def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


def make_engine(path: Path | str) -> Engine:
    if str(path) == ":memory:":
        url = "sqlite://"
    else:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{p}"
    engine = create_engine(url, future=True)
    event.listen(engine, "connect", _sqlite_pragmas)
    Base.metadata.create_all(engine)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


def find_business(session: Session, ref: str) -> Business | None:
    """Look up by numeric id or Google place_id."""
    if ref.isdigit():
        return session.get(Business, int(ref))
    return session.scalar(select(Business).where(Business.place_id == ref))


def set_status(
    session: Session, business: Business, status: OutreachStatus, note: str | None = None
) -> Outreach:
    outreach = business.outreach
    if outreach is None:
        outreach = Outreach(business=business, status=status, notes="")
        session.add(outreach)
    outreach.status = status
    if note:
        stamp = utcnow().strftime("%Y-%m-%d")
        outreach.notes = (outreach.notes + "\n" if outreach.notes else "") + f"[{stamp}] {note}"
    outreach.updated_at = utcnow()
    outreach.events.append(OutreachEvent(status=status.value, note=note))
    return outreach


def dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, default=str)
