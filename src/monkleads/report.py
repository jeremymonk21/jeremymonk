"""Local HTML report (Jinja2) of the top leads."""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

from jinja2 import Environment, PackageLoader, select_autoescape

from .config import Sender
from .db import utcnow
from .pipeline import LeadRow


def _env() -> Environment:
    env = Environment(
        loader=PackageLoader("monkleads", "templates"),
        autoescape=select_autoescape(["html", "j2"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["site_label"] = lambda r: (
        f"Broken: {r.broken_reason.replace('_', ' ')}"
        if r.site_status == "broken" and r.broken_reason
        else {
            "none": "No website",
            "social_only": "Social page only",
            "ok": "Has a website",
            "blocked": "Site blocked our check",
        }.get(r.site_status, r.site_status)
    )
    env.filters["safe_url"] = lambda u: u if u and u.lower().startswith(("http://", "https://")) else ""
    return env


def render_report(rows: Sequence[LeadRow], out_path: Path, *, sender: Sender, suppressed: int = 0) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shots = {
        r.id: os.path.relpath(r.screenshot.resolve(), out_path.parent.resolve()).replace(os.sep, "/")
        for r in rows
        if r.screenshot and r.screenshot.exists()
    }
    html = (
        _env()
        .get_template("report.html.j2")
        .render(
            leads=rows,
            shots=shots,
            sender=sender,
            generated=utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            suppressed=suppressed,
        )
    )
    out_path.write_text(html, encoding="utf-8")
    return out_path
