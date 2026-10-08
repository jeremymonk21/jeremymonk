"""Structured logging.

Use ``log.info("message", extra={"key": value})``. Extras are rendered as
``key=value`` pairs on the console, or as fields in JSON-lines mode.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.logging import RichHandler

_STD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()) | {
    "message",
    "asctime",
    "taskName",
}


def _extras(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in record.__dict__.items() if k not in _STD_ATTRS}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        payload.update(_extras(record))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class KeyValueFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = record.getMessage()
        extras = _extras(record)
        if extras:
            base += "  " + " ".join(f"{k}={v}" for k, v in extras.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def setup_logging(
    *,
    verbose: bool = False,
    json_logs: bool = False,
    log_file: Path | None = None,
    console: Console | None = None,
) -> None:
    root = logging.getLogger()
    for old in root.handlers:
        old.close()
    root.handlers.clear()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)

    if json_logs:
        handler: logging.Handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
    else:
        handler = RichHandler(
            console=console or Console(stderr=True),
            show_path=False,
            rich_tracebacks=True,
            markup=False,
        )
        handler.setFormatter(KeyValueFormatter())
    root.addHandler(handler)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(JsonFormatter())
        fh.setLevel(logging.DEBUG)
        root.addHandler(fh)

    # Third-party libraries are chatty at DEBUG/INFO.
    for noisy in ("httpx", "httpcore", "asyncio", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
