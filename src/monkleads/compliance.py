"""Suppression list and CAN-SPAM-compliant email drafts.

The tool never sends anything. Drafts are for Jeremy to review and send himself.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .config import Sender
from .db import utcnow
from .discovery.normalize import hostname, normalize_name, normalize_phone

KINDS = ("place", "phone", "domain", "name")


class ComplianceError(RuntimeError):
    pass


@dataclass
class SuppressionList:
    path: Path

    def __post_init__(self) -> None:
        self.place_ids: set[str] = set()
        self.phones: set[str] = set()
        self.domains: set[str] = set()
        self.names: set[str] = set()
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                self._add_line(line)

    @staticmethod
    def classify(value: str) -> tuple[str, str]:
        """Return (kind, value) for a bare or prefixed entry."""
        value = value.strip()
        m = re.match(r"^(place|phone|domain|name):\s*(.+)$", value, re.I)
        if m:
            return m.group(1).lower(), m.group(2).strip()
        if re.fullmatch(r"(ChIJ|GhIJ|Ei)[A-Za-z0-9_-]{10,}", value):
            return "place", value
        if normalize_phone(value) and re.fullmatch(r"[\d\s().+-]+", value):
            return "phone", value
        if re.fullmatch(r"(https?://)?[\w.-]+\.[a-z]{2,}(/.*)?", value, re.I):
            return "domain", value
        return "name", value

    def _add_line(self, line: str) -> None:
        line = line.split(" #", 1)[0].strip()
        if not line or line.startswith("#"):
            return
        kind, value = self.classify(line)
        if kind == "place":
            self.place_ids.add(value)
        elif kind == "phone":
            p = normalize_phone(value)
            if p:
                self.phones.add(p)
        elif kind == "domain":
            d = hostname(value)
            if d:
                self.domains.add(d)
        elif kind == "name":
            self.names.add(normalize_name(value))

    def __len__(self) -> int:
        return len(self.place_ids) + len(self.phones) + len(self.domains) + len(self.names)

    def matches(
        self,
        *,
        place_id: str | None = None,
        phone: str | None = None,
        website: str | None = None,
        name: str | None = None,
    ) -> str | None:
        """Return which entry suppressed this business, or None."""
        if place_id and place_id in self.place_ids:
            return f"place:{place_id}"
        p = normalize_phone(phone)
        if p and p in self.phones:
            return f"phone:{p}"
        d = hostname(website)
        if d and d in self.domains:
            return f"domain:{d}"
        if name and normalize_name(name) in self.names:
            return f"name:{name}"
        return None

    def add(self, kind: str, value: str, reason: str | None = None) -> None:
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        comment = f"  # {utcnow():%Y-%m-%d}" + (f" {reason}" if reason else "")
        line = f"{kind}:{value}{comment}"
        needs_newline = self.path.exists() and not self.path.read_text(encoding="utf-8").endswith("\n")
        with self.path.open("a", encoding="utf-8") as fh:
            if needs_newline:
                fh.write("\n")
            fh.write(line + "\n")
        self._add_line(line)


@dataclass
class EmailDraft:
    subject: str
    body: str


OPT_OUT_LINE = (
    "If you'd rather not hear from me again, just reply \"no thanks\" and I won't contact you again."
)
AD_DISCLOSURE = "This is a one-time note about my web design services."


def check_sender(sender: Sender) -> None:
    missing = [
        label
        for label, value in (
            ("sender.name", sender.name),
            ("sender.business", sender.business),
            ("sender.physical_address", sender.physical_address),
        )
        if not value.strip()
    ]
    if missing:
        raise ComplianceError(
            "CAN-SPAM: email drafts need a real sender identity and a valid postal address. "
            f"Fill in {', '.join(missing)} in config.yaml."
        )


def draft_email(business_name: str, opener: str, *, has_site: bool, sender: Sender) -> EmailDraft:
    """Build an email draft with sender identity, postal address, ad disclosure and opt-out.

    Raises ComplianceError if the sender's identity/address isn't configured.
    """
    check_sender(sender)
    subject = f"A quick idea for {business_name}'s website" if has_site else f"A website for {business_name}?"
    signature = [sender.name, sender.business, sender.physical_address]
    signature += [x for x in (sender.phone, sender.email, sender.website) if x]
    body = "\n".join(
        [
            opener.strip(),
            "",
            "--",
            *signature,
            "",
            AD_DISCLOSURE,
            OPT_OUT_LINE,
        ]
    )
    return EmailDraft(subject=subject[:150], body=body)
