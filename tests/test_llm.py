from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("anthropic")

from monkleads.config import AppConfig  # noqa: E402
from monkleads.llm import OpenerWriter, estimate_llm_cost  # noqa: E402


class FakeMessages:
    def __init__(self, text: str, stop_reason: str = "end_turn") -> None:
        self.text = text
        self.stop_reason = stop_reason
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[
                SimpleNamespace(type="thinking", thinking=""),
                SimpleNamespace(type="text", text=self.text),
            ],
        )


def writer_with(cfg: AppConfig, fake: FakeMessages) -> OpenerWriter:
    w = OpenerWriter(cfg.llm, cfg.sender, api_key="test")
    w._client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    return w


PAYLOAD = {"business_name": "Joe's Diner", "problems_found": ["Your site is slow on phones."]}


async def test_llm_opener_used_when_valid(cfg: AppConfig) -> None:
    fake = FakeMessages("Hi, I'm Jeremy from The Monk Press in Troy. Free audit, no pressure. — Jeremy")
    out = await writer_with(cfg, fake).write(PAYLOAD)
    assert out and out.startswith("Hi, I'm Jeremy")
    call = fake.calls[0]
    assert call["model"] == cfg.llm.model
    assert call["fallbacks"] == "default"
    assert "Joe's Diner" in call["messages"][0]["content"]
    assert "Rensselaer County" in call["system"]


async def test_llm_opener_rejected_when_too_long(cfg: AppConfig) -> None:
    fake = FakeMessages("word " * 120)
    assert await writer_with(cfg, fake).write(PAYLOAD) is None


async def test_llm_refusal_falls_back(cfg: AppConfig) -> None:
    fake = FakeMessages("", stop_reason="refusal")
    assert await writer_with(cfg, fake).write(PAYLOAD) is None


def test_llm_cost_estimate(cfg: AppConfig) -> None:
    per = (
        cfg.llm.est_input_tokens * cfg.llm.price_input_per_mtok
        + cfg.llm.est_output_tokens * cfg.llm.price_output_per_mtok
    ) / 1e6
    assert estimate_llm_cost(100, cfg.llm) == pytest.approx(100 * per)
