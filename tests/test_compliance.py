from __future__ import annotations

from pathlib import Path

import pytest

from monkleads.compliance import AD_DISCLOSURE, OPT_OUT_LINE, ComplianceError, SuppressionList, draft_email
from monkleads.config import Sender


def test_suppression_file_formats(tmp_path: Path) -> None:
    p = tmp_path / "suppression.txt"
    p.write_text(
        "# comment\n"
        "place:ChIJabc123def456\n"
        "phone:(518) 555-1234  # asked not to be contacted\n"
        "domain:https://www.joesdiner.com/\n"
        "name:Bob's Auto - Troy\n"
        "ChIJzzzzzzzzzzzz\n"
        "518.555.9999\n"
        "example.org\n",
        encoding="utf-8",
    )
    sup = SuppressionList(p)
    assert len(sup) == 7
    assert sup.matches(place_id="ChIJabc123def456")
    assert sup.matches(place_id="ChIJzzzzzzzzzzzz")
    assert sup.matches(phone="+1 518 555 1234")
    assert sup.matches(phone="5185559999")
    assert sup.matches(website="http://joesdiner.com/menu")
    assert sup.matches(website="https://example.org")
    assert sup.matches(name="Bob's Auto")
    assert sup.matches(place_id="other", phone="5180000000", website="https://ok.com", name="Fine Co") is None


def test_suppression_add_persists(tmp_path: Path) -> None:
    p = tmp_path / "s.txt"
    sup = SuppressionList(p)
    sup.add("phone", "518-555-0000", "do_not_contact")
    assert sup.matches(phone="5185550000")
    again = SuppressionList(p)
    assert again.matches(phone="(518) 555-0000")
    with pytest.raises(ValueError):
        sup.add("email", "x@y.com")


def test_classify_bare_values() -> None:
    assert SuppressionList.classify("ChIJN1t_tDeuEmsRUsoyG83frY4")[0] == "place"
    assert SuppressionList.classify("(518) 555-1234")[0] == "phone"
    assert SuppressionList.classify("www.joes.com")[0] == "domain"
    assert SuppressionList.classify("Joe's Diner")[0] == "name"


def sender(**kw: str) -> Sender:
    base = dict(
        name="Jeremy Monk",
        business="The Monk Press",
        physical_address="PO Box 1, Troy, NY 12180",
        email="j@example.com",
        phone="518-555-0100",
        website="https://themonkpress.com",
    )
    base.update(kw)
    return Sender(**base)


def test_email_draft_is_can_spam_compliant() -> None:
    d = draft_email("Joe's Diner", "Hi, I'm Jeremy...", has_site=True, sender=sender())
    assert "Joe's Diner" in d.subject and "website" in d.subject
    assert "Jeremy Monk" in d.body and "The Monk Press" in d.body
    assert "PO Box 1, Troy, NY 12180" in d.body
    assert OPT_OUT_LINE in d.body
    assert AD_DISCLOSURE in d.body


def test_email_draft_requires_postal_address() -> None:
    with pytest.raises(ComplianceError, match="physical_address"):
        draft_email("Joe's", "Hi", has_site=False, sender=sender(physical_address=""))
