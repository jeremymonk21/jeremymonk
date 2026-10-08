"""Command-line interface: discover, audit, score, report, export, status, run."""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, TypeVar

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

from .compliance import KINDS, SuppressionList
from .config import AppConfig, Secrets, load_config
from .db import OutreachStatus, find_business, set_status, utcnow
from .export import write_csv, write_xlsx
from .logging_setup import setup_logging
from .pipeline import CostEstimate, Pipeline, PipelineError, estimate_discovery_cost, estimate_opener_cost
from .report import render_report

T = TypeVar("T")

app = typer.Typer(
    help="The Monk Press lead finder. Finds, audits, and ranks local businesses. Drafts only, never sends.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()
log = logging.getLogger("monkleads")


@dataclass
class State:
    config_path: Path
    cfg: AppConfig
    secrets: Secrets

    _pipeline: Pipeline | None = None

    @property
    def pipeline(self) -> Pipeline:
        if self._pipeline is None:
            self._pipeline = Pipeline(self.cfg, self.secrets)
        return self._pipeline


@app.callback()
def main(
    ctx: typer.Context,
    config: Annotated[Path, typer.Option("--config", "-c", help="Path to config.yaml")] = Path("config.yaml"),
    env_file: Annotated[Path | None, typer.Option(help="Path to a .env file")] = None,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Debug logging")] = False,
    log_json: Annotated[bool, typer.Option("--log-json", help="JSON-lines logs on stderr")] = False,
) -> None:
    setup_logging(verbose=verbose, json_logs=log_json)
    try:
        cfg = load_config(config)
    except (FileNotFoundError, ValueError) as exc:
        console.print(f"[red]Config error:[/red] {exc}")
        raise typer.Exit(2) from exc
    setup_logging(verbose=verbose, json_logs=log_json, log_file=cfg.output.data_dir / "monkleads.log")
    ctx.obj = State(config, cfg, Secrets.from_env(env_file))


def _progress() -> Progress:
    return Progress(
        SpinnerColumn(),
        TextColumn("[bold]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
        transient=False,
    )


def _print_estimate(title: str, est: CostEstimate) -> None:
    table = Table(title=title, show_lines=False)
    table.add_column("Item")
    table.add_column("Calls", justify="right")
    table.add_column("Est. cost (USD)", justify="right")
    for line in est.lines:
        calls = (
            f"{line.calls_low}"
            if line.calls_low == line.calls_high
            else f"{line.calls_low}–{line.calls_high}"
        )
        cost = f"${line.low:,.2f}" if line.low == line.high else f"${line.low:,.2f}–${line.high:,.2f}"
        table.add_row(line.label, calls, cost)
    table.add_row("[bold]Total (worst case)[/bold]", "", f"[bold]${est.high:,.2f}[/bold]")
    console.print(table)
    for note in est.notes:
        console.print(f"  [dim]{note}[/dim]")


def _confirm_cost(state: State, est: CostEstimate, *, yes: bool) -> None:
    threshold = state.cfg.costs.confirm_over_usd
    if est.high <= threshold or yes:
        return
    if not sys.stdin.isatty():
        console.print(
            f"[red]Estimated cost ${est.high:,.2f} is over ${threshold:,.2f}. Re-run with --yes to proceed.[/red]"
        )
        raise typer.Exit(1)
    if not typer.confirm(f"Estimated cost up to ${est.high:,.2f}. Continue?", default=False):
        raise typer.Exit(1)


def _run(coro: Coroutine[Any, Any, T]) -> T:
    try:
        return asyncio.run(coro)
    except PipelineError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

TownOpt = Annotated[
    list[str] | None, typer.Option("--town", "-t", help="Town name (repeatable). Default: all configured.")
]
CatOpt = Annotated[
    list[str] | None, typer.Option("--category", "-k", help="Category key (repeatable). Default: all.")
]
ExtOpt = Annotated[
    bool | None, typer.Option("--extended/--no-extended", help="Include Albany/Saratoga towns.")
]
DryOpt = Annotated[
    bool, typer.Option("--dry-run", help="Show what would happen; make no API calls or changes.")
]
YesOpt = Annotated[bool, typer.Option("--yes", "-y", help="Skip the cost confirmation prompt.")]


def _do_discover(
    state: State,
    town: list[str] | None,
    category: list[str] | None,
    extended: bool | None,
    dry_run: bool,
    yes: bool,
) -> None:
    cfg = state.cfg
    try:
        towns = cfg.select_towns(town, extended)
        cats = cfg.select_categories(category)
    except ValueError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(2) from exc
    est = estimate_discovery_cost(cfg, towns, cats)
    _print_estimate("Discovery cost estimate", est)
    if dry_run:
        console.print(f"[yellow]Dry run:[/yellow] would run {len(towns) * len(cats)} searches, e.g.:")
        for t in towns[:3]:
            for c in cats[:3]:
                console.print(f'  • "{c.query} in {t.name}, NY" (within {t.radius_km:g} km)')
        return
    _confirm_cost(state, est, yes=yes)
    with _progress() as progress:
        stats = _run(state.pipeline.discover(towns, cats, progress))
    s = stats
    console.print(
        f"[green]Discovered[/green] {s.found} places "
        f"({s.new} new, {s.updated} updated). API calls: {s.api_calls}, cache hits: {s.cache_hits}."
    )
    if s.excluded:
        console.print("Excluded: " + ", ".join(f"{k} {v}" for k, v in s.excluded.items()))
    if s.errors:
        console.print(f"[yellow]{s.errors} searches failed (see log).[/yellow]")


@app.command()
def discover(
    ctx: typer.Context,
    town: TownOpt = None,
    category: CatOpt = None,
    extended: ExtOpt = None,
    dry_run: DryOpt = False,
    yes: YesOpt = False,
) -> None:
    """Find businesses with the Google Places API (New) and store them."""
    _do_discover(ctx.obj, town, category, extended, dry_run, yes)


def _do_audit(
    state: State,
    *,
    force: bool,
    limit: int | None,
    ids: list[int] | None,
    psi: bool,
    screenshots: bool,
    dry_run: bool,
) -> None:
    pipe = state.pipeline
    with pipe.sessions() as s:
        todo = pipe.select_for_audit(s, force=force, limit=limit, ids=ids)
        with_site = sum(1 for b in todo if b.website)
        names = [b.name for b in todo[:10]]
    console.print(
        f"{len(todo)} businesses need an audit ({with_site} with a website; "
        f"others are recorded as 'no website' instantly)."
    )
    if dry_run:
        for n in names:
            console.print(f"  • {n}")
        if len(todo) > len(names):
            console.print(f"  … and {len(todo) - len(names)} more")
        return
    if not todo:
        return
    with _progress() as progress:
        stats = _run(
            pipe.audit(
                todo,
                run_psi=psi and state.cfg.audit.run_pagespeed,
                screenshots=screenshots and state.cfg.audit.screenshots,
                progress=progress,
            )
        )
    st = stats
    console.print(
        f"[green]Audited[/green] {st.audited} "
        f"({', '.join(f'{k}: {v}' for k, v in st.by_status.items())}). "
        f"PageSpeed: {st.pagespeed}, screenshots: {st.screenshots}, errors: {st.errors}."
    )


@app.command()
def audit(
    ctx: typer.Context,
    force: Annotated[bool, typer.Option(help="Re-audit even if the last audit is recent.")] = False,
    limit: Annotated[int | None, typer.Option(help="Audit at most N businesses.")] = None,
    id: Annotated[list[int] | None, typer.Option("--id", help="Only these lead IDs (repeatable).")] = None,
    psi: Annotated[bool, typer.Option("--psi/--no-psi", help="Run PageSpeed Insights.")] = True,
    screenshots: Annotated[bool, typer.Option("--screenshots/--no-screenshots")] = True,
    dry_run: DryOpt = False,
) -> None:
    """Audit websites of stale or never-audited leads (PageSpeed, site checks, screenshots)."""
    _do_audit(ctx.obj, force=force, limit=limit, ids=id, psi=psi, screenshots=screenshots, dry_run=dry_run)


def _do_score(state: State, *, llm: bool | None, dry_run: bool, yes: bool) -> None:
    use_llm = state.cfg.llm.enabled if llm is None else llm
    pipe = state.pipeline
    if use_llm:
        n = pipe.pending_llm_count()
        est = estimate_opener_cost(state.cfg, n)
        _print_estimate("Opener drafting cost estimate", est)
        if not dry_run:
            _confirm_cost(state, est, yes=yes)
            if not state.secrets.anthropic_key:
                console.print(
                    "[yellow]ANTHROPIC_API_KEY is not set; the SDK will try other configured credentials.[/yellow]"
                )
    if dry_run:
        console.print("[yellow]Dry run:[/yellow] scoring makes no changes in dry-run mode.")
        return
    with _progress() as progress:
        stats = _run(pipe.score(use_llm=use_llm, progress=progress))
    st = stats
    console.print(
        f"[green]Scored[/green] {st.scored} leads. Claude openers: {st.llm_openers}. "
        f"Email drafts: {st.email_drafts}."
    )
    if st.skipped_unaudited:
        console.print(f"[dim]{st.skipped_unaudited} leads not audited yet; run `monkleads audit`.[/dim]")
    for w in st.warnings:
        console.print(f"[yellow]Note:[/yellow] {w}")


@app.command()
def score(
    ctx: typer.Context,
    llm: Annotated[bool | None, typer.Option("--llm/--no-llm", help="Draft openers with Claude.")] = None,
    dry_run: DryOpt = False,
    yes: YesOpt = False,
) -> None:
    """Score audited leads (0-100), suggest a plan, and draft problems + opener."""
    _do_score(ctx.obj, llm=llm, dry_run=dry_run, yes=yes)


def _stamp() -> str:
    return utcnow().strftime("%Y%m%d-%H%M")


def _do_report(state: State, top: int | None, out: Path | None) -> Path:
    n = top or state.cfg.output.report_top_n
    rows, suppressed = state.pipeline.ranked_leads(top=n)
    path = out or state.cfg.reports_dir / f"leads-{_stamp()}.html"
    render_report(rows, path, sender=state.cfg.sender, suppressed=suppressed)
    console.print(f"[green]Report[/green] ({len(rows)} leads): {path}")
    return path


@app.command()
def report(
    ctx: typer.Context,
    top: Annotated[int | None, typer.Option(help="Number of leads (default: output.report_top_n).")] = None,
    out: Annotated[Path | None, typer.Option(help="Output HTML file.")] = None,
) -> None:
    """Write a local HTML report of the top N leads with screenshots, reasons, and openers."""
    _do_report(ctx.obj, top, out)


def _do_export(state: State, fmt: str, top: int | None, min_score: int, out_dir: Path | None) -> None:
    rows, suppressed = state.pipeline.ranked_leads(top=top, min_score=min_score)
    folder = out_dir or state.cfg.exports_dir
    stamp = _stamp()
    paths = []
    if fmt in ("csv", "both"):
        paths.append(write_csv(rows, folder / f"leads-{stamp}.csv"))
    if fmt in ("xlsx", "both"):
        paths.append(write_xlsx(rows, folder / f"leads-{stamp}.xlsx"))
    console.print(f"[green]Exported[/green] {len(rows)} leads ({suppressed} suppressed):")
    for p in paths:
        console.print(f"  {p}")


@app.command()
def export(
    ctx: typer.Context,
    fmt: Annotated[str, typer.Option("--format", "-f", help="csv, xlsx, or both")] = "both",
    top: Annotated[int | None, typer.Option(help="Only the top N leads.")] = None,
    min_score: Annotated[int, typer.Option(help="Drop leads below this score.")] = 0,
    out_dir: Annotated[Path | None, typer.Option(help="Folder for the files.")] = None,
) -> None:
    """Export the ranked lead list to CSV and/or a formatted Excel file (suppression list applied)."""
    if fmt not in ("csv", "xlsx", "both"):
        console.print("[red]--format must be csv, xlsx, or both[/red]")
        raise typer.Exit(2)
    _do_export(ctx.obj, fmt, top, min_score, out_dir)


@app.command()
def status(
    ctx: typer.Context,
    lead: Annotated[str, typer.Argument(help="Lead ID (from reports/exports) or Google place_id")],
    new_status: Annotated[
        OutreachStatus,
        typer.Argument(
            metavar="STATUS", help="new | contacted | replied | meeting | won | lost | do_not_contact"
        ),
    ],
    note: Annotated[str | None, typer.Option("--note", "-n", help="Add a dated note.")] = None,
) -> None:
    """Update a lead's outreach status and notes."""
    state: State = ctx.obj
    pipe = state.pipeline
    with pipe.sessions() as s, s.begin():
        b = find_business(s, lead)
        if b is None:
            console.print(f"[red]No lead found for {lead!r}[/red]")
            raise typer.Exit(1)
        set_status(s, b, new_status, note)
        name, place_id, phone, website = b.name, b.place_id, b.phone, b.website
    if new_status is OutreachStatus.DO_NOT_CONTACT:
        sup = SuppressionList(state.cfg.output.suppression_file)
        sup.add("place", place_id, f"do_not_contact: {name}")
        if phone:
            sup.add("phone", phone, f"do_not_contact: {name}")
        if website and not sup.matches(website=website):
            from .discovery.normalize import host_matches, hostname

            host = hostname(website)
            if host and not host_matches(host, state.cfg.audit.social_domains):
                sup.add("domain", host, f"do_not_contact: {name}")
        console.print("[yellow]Added to the suppression list.[/yellow]")
    console.print(f"[green]{name}[/green] → {new_status.value}" + (" (note added)" if note else ""))


@app.command()
def suppress(
    ctx: typer.Context,
    value: Annotated[str, typer.Argument(help="place_id, phone, domain, or business name")],
    kind: Annotated[
        str | None, typer.Option(help=f"One of {', '.join(KINDS)} (auto-detected if omitted)")
    ] = None,
    reason: Annotated[str | None, typer.Option(help="Why (kept as a comment)")] = None,
) -> None:
    """Add an entry to the suppression list (never exported or reported)."""
    state: State = ctx.obj
    sup = SuppressionList(state.cfg.output.suppression_file)
    k, v = (kind, value) if kind else SuppressionList.classify(value)
    if k not in KINDS:
        console.print(f"[red]--kind must be one of {KINDS}[/red]")
        raise typer.Exit(2)
    sup.add(k, v, reason)
    console.print(f"Suppressed {k}:{v}")


@app.command()
def leads(
    ctx: typer.Context,
    top: Annotated[int, typer.Option(help="How many to show.")] = 20,
    status_filter: Annotated[list[str] | None, typer.Option("--status", help="Only these statuses.")] = None,
) -> None:
    """Show the ranked leads in the terminal."""
    rows, suppressed = ctx.obj.pipeline.ranked_leads(
        top=top, statuses=set(status_filter) if status_filter else None
    )
    table = Table(title=f"Top {len(rows)} leads" + (f" ({suppressed} suppressed)" if suppressed else ""))
    for col in ("ID", "Score", "Business", "Town", "Site", "Plan", "Top problem", "Status"):
        table.add_column(col, overflow="fold")
    for r in rows:
        site = r.site_status if r.site_status != "broken" else f"broken: {r.broken_reason}"
        table.add_row(
            str(r.id),
            str(r.score),
            r.name,
            r.town or "",
            site,
            r.tier,
            r.problems[0] if r.problems else "",
            r.status,
        )
    console.print(table)


@app.command()
def show(
    ctx: typer.Context,
    lead: Annotated[str, typer.Argument(help="Lead ID or Google place_id")],
) -> None:
    """Print the full call sheet for one lead: score breakdown, problems, plan, opener, email draft."""
    state: State = ctx.obj
    rows, _ = state.pipeline.ranked_leads(statuses=None)
    row = next((r for r in rows if str(r.id) == lead or r.place_id == lead), None)
    if row is None:
        console.print(
            f"[red]No scored, active lead found for {lead!r}[/red] (won / do_not_contact / suppressed are hidden)"
        )
        raise typer.Exit(1)
    console.rule(f"[bold]{row.name}[/bold]  ·  score {row.score}  ·  ID {row.id}")
    console.print(f"{row.address or ''}\n{row.phone or ''}  {row.website or 'no website'}")
    if row.rating:
        console.print(
            f"Google: {row.rating:.1f}★ from {row.review_count or 0} reviews  ·  status: {row.status}"
        )
    console.print("\n[bold]Why this score[/bold]")
    for r in row.reasons:
        console.print(f"  {r['points']:+6g}  {r['detail']}")
    console.print(f"  {'=':>6}  {row.score}")
    console.print("\n[bold]Top problems[/bold]")
    for i, p in enumerate(row.problems, 1):
        console.print(f"  {i}. {p}")
    console.print(f"\n[bold]Suggested plan:[/bold] {row.tier}: {row.tier_reason}")
    console.print(f"\n[bold]Opener[/bold] ({row.opener_source})\n{row.opener}")
    if row.email_body:
        console.print(
            f"\n[bold]Email draft[/bold] (review before sending)\nSubject: {row.email_subject}\n\n{row.email_body}"
        )
    if row.notes:
        console.print(f"\n[bold]Notes[/bold]\n{row.notes}")


@app.command()
def run(
    ctx: typer.Context,
    town: TownOpt = None,
    category: CatOpt = None,
    extended: ExtOpt = None,
    llm: Annotated[bool | None, typer.Option("--llm/--no-llm", help="Draft openers with Claude.")] = None,
    psi: Annotated[bool, typer.Option("--psi/--no-psi")] = True,
    screenshots: Annotated[bool, typer.Option("--screenshots/--no-screenshots")] = True,
    skip_discover: Annotated[
        bool, typer.Option("--skip-discover", help="Reuse leads already in the database.")
    ] = False,
    top: Annotated[int | None, typer.Option(help="Leads in the HTML report.")] = None,
    dry_run: DryOpt = False,
    yes: YesOpt = False,
) -> None:
    """Full pipeline: discover → audit → score → report → export."""
    state: State = ctx.obj
    if not skip_discover:
        _do_discover(state, town, category, extended, dry_run, yes)
    _do_audit(state, force=False, limit=None, ids=None, psi=psi, screenshots=screenshots, dry_run=dry_run)
    _do_score(state, llm=llm, dry_run=dry_run, yes=yes)
    if dry_run:
        return
    _do_report(state, top, None)
    _do_export(state, "both", None, 0, None)


if __name__ == "__main__":  # pragma: no cover
    app()
