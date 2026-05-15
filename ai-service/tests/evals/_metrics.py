"""Tiny shared counter for per-target eval cost during a pytest session.

The structured logging callback under ``graph.callbacks`` already emits a
``cost_usd`` field on every ``llm end`` log. During the LangSmith runner
path we get richer cost data (judge models + experiment metadata), so the
pytest path is allowed to leave ``cost_usd`` at 0.0 if no callback updates
this module-level dict.

Usage:

    from tests.evals._metrics import add_cost
    add_cost("triage", 0.0042)
"""

from __future__ import annotations

from threading import Lock


_LOCK = Lock()
_COST_BY_TARGET: dict[str, float] = {}


def add_cost(target: str, cost_usd: float) -> None:
    """Increment the cumulative cost for a given target."""
    if not target or not cost_usd:
        return
    with _LOCK:
        _COST_BY_TARGET[target] = round(_COST_BY_TARGET.get(target, 0.0) + cost_usd, 6)


def get_cost(target: str) -> float:
    with _LOCK:
        return _COST_BY_TARGET.get(target, 0.0)


def reset() -> None:
    with _LOCK:
        _COST_BY_TARGET.clear()


def snapshot() -> dict[str, float]:
    with _LOCK:
        return dict(_COST_BY_TARGET)
