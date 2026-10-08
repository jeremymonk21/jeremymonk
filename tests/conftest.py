from __future__ import annotations

from pathlib import Path

import pytest

from monkleads import http as mhttp
from monkleads.config import AppConfig, Secrets, load_config

REPO_CONFIG = Path(__file__).resolve().parents[1] / "config.yaml"


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retries happen instantly in tests."""
    monkeypatch.setattr(mhttp, "WAIT_INITIAL_S", 0.0)
    monkeypatch.setattr(mhttp, "WAIT_MAX_S", 0.0)


@pytest.fixture
def cfg(tmp_path: Path) -> AppConfig:
    c = load_config(REPO_CONFIG)
    c.output.data_dir = tmp_path / "data"
    c.output.suppression_file = tmp_path / "suppression.txt"
    c.audit.per_host_min_interval_s = 0
    c.sender.physical_address = "123 Example St, Troy, NY 12180"
    c.sender.email = "jeremy@example.com"
    return c


@pytest.fixture
def secrets() -> Secrets:
    return Secrets(google_places_key="test-key", google_pagespeed_key="test-key", anthropic_key=None)
