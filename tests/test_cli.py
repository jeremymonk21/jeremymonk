from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from monkleads.cli import app
from monkleads.compliance import SuppressionList
from monkleads.config import load_config
from monkleads.db import Audit, Business, make_engine, make_session_factory

from .conftest import REPO_CONFIG

runner = CliRunner()


@pytest.fixture
def config_file(tmp_path: Path) -> Path:
    text = REPO_CONFIG.read_text(encoding="utf-8")
    text = text.replace("  data_dir: data ", f"  data_dir: {tmp_path / 'data'} ")
    text = text.replace("  suppression_file: suppression.txt", f"  suppression_file: {tmp_path / 'supp.txt'}")
    text = text.replace('  physical_address: ""', '  physical_address: "PO Box 1, Troy, NY 12180"')
    path = tmp_path / "config.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def seed(config_file: Path) -> None:
    cfg = load_config(config_file)
    sf = make_session_factory(make_engine(cfg.db_path))
    with sf() as s, s.begin():
        b = Business(
            place_id="ChIJcliTest0001",
            name="Riverside Bakery",
            category_key="bakery",
            phone="(518) 555-0110",
            website="https://riversidebakery.example",
            rating=4.8,
            review_count=200,
        )
        s.add(b)
        s.add(
            Audit(
                business=b,
                site_status="broken",
                broken_reason="parked",
                findings={"input_url": "https://riversidebakery.example", "site_status": "broken"},
            )
        )


def invoke(config_file: Path, *args: str) -> str:
    result = runner.invoke(app, ["-c", str(config_file), *args], env={"COLUMNS": "200"})
    assert result.exit_code == 0, result.output
    return result.output


def test_discover_dry_run_makes_no_calls(config_file: Path) -> None:
    out = invoke(config_file, "discover", "--dry-run", "-t", "Troy", "-k", "cafe", "-k", "barber")
    assert "Dry run" in out and '"cafe in Troy, NY"' in out
    assert "$" in out  # cost estimate printed


def test_unknown_town_is_a_usage_error(config_file: Path) -> None:
    result = runner.invoke(app, ["-c", str(config_file), "discover", "--dry-run", "-t", "Atlantis"])
    assert result.exit_code == 2


def test_score_report_export_and_status(config_file: Path, tmp_path: Path) -> None:
    seed(config_file)
    assert "Scored 1 leads" in invoke(config_file, "score")
    assert "Riverside Bakery" in invoke(config_file, "leads")
    invoke(config_file, "report", "--out", str(tmp_path / "r.html"))
    assert "Riverside Bakery" in (tmp_path / "r.html").read_text(encoding="utf-8")
    out = invoke(config_file, "export", "--out-dir", str(tmp_path / "x"))
    assert "Exported 1 leads" in out
    assert len(list((tmp_path / "x").glob("*.xlsx"))) == 1

    out = invoke(config_file, "status", "1", "do_not_contact", "--note", "asked not to be contacted")
    assert "do_not_contact" in out
    sup = SuppressionList(tmp_path / "supp.txt")
    assert sup.matches(place_id="ChIJcliTest0001") and sup.matches(phone="5185550110")
    assert sup.matches(website="https://riversidebakery.example")
    assert "Exported 0 leads" in invoke(config_file, "export", "--out-dir", str(tmp_path / "y"))


def test_status_unknown_lead(config_file: Path) -> None:
    result = runner.invoke(app, ["-c", str(config_file), "status", "999", "contacted"])
    assert result.exit_code == 1


def test_suppress_command(config_file: Path, tmp_path: Path) -> None:
    out = invoke(config_file, "suppress", "joesdiner.com", "--reason", "existing client of a friend")
    assert "domain:joesdiner.com" in out
    assert SuppressionList(tmp_path / "supp.txt").matches(website="https://www.joesdiner.com")


def test_show_command(config_file: Path) -> None:
    seed(config_file)
    invoke(config_file, "score")
    out = invoke(config_file, "show", "1")
    assert "Why this score" in out and "domain shows a parking" in out
    assert "PO Box 1, Troy, NY 12180" in out  # CAN-SPAM postal address in the draft
