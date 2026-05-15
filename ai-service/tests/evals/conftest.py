"""Shared fixtures and helpers for the eval suite.

Two layers of tests live under tests/evals/:
- Structural tests (always run): dataset loadable, schema shape, etc.
- Live LLM tests (gated behind ``pytest -m eval``): actually invoke the
  sub-graphs and assert per-case behavior.

The ``live_llm`` fixture skips when ``OPENAI_API_KEY`` is empty so the
structural layer remains usable in any environment.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pytest

from tests.evals._metrics import snapshot as _cost_snapshot

DATASETS_DIR = Path(__file__).parent / "datasets"

# Where the dashboard reads from. Created on first write.
_RESULTS_PATH = Path(__file__).resolve().parents[2] / "data" / "eval_results.json"

# Map test-file stems to dashboard target names.
_TARGET_BY_STEM: dict[str, str] = {
    "test_triage": "triage",
    "test_voice_script": "voice_script",
    "test_sms": "sms",
    "test_voicemail": "voicemail",
    "test_orchestrator": "orchestrator",
}
_ALL_TARGETS = ("triage", "voice_script", "sms", "voicemail", "orchestrator")


@pytest.fixture(scope="session")
def live_llm() -> None:
    """Gate live-LLM tests behind a real API key.

    Tests that need to actually call OpenAI should depend on this fixture.
    """
    if not os.getenv("OPENAI_API_KEY"):
        pytest.skip("OPENAI_API_KEY not set — skipping live LLM eval")
    return None


@pytest.fixture(scope="session")
def langsmith_client():
    """Return a langsmith Client if API key is present, else None."""
    if not os.getenv("LANGSMITH_API_KEY"):
        return None
    try:
        from langsmith import Client
    except ImportError:  # pragma: no cover
        return None
    return Client()


def assert_pydantic_valid(result: dict[str, Any], required_keys: Iterable[str]) -> None:
    """Assert all required output keys exist and have non-None values.

    Treats empty strings as None to catch hollow LLM outputs.
    """
    assert isinstance(result, dict), f"expected dict result, got {type(result).__name__}"
    missing = [k for k in required_keys if k not in result]
    assert not missing, f"missing keys in result: {missing} (have {list(result.keys())})"
    empty = [
        k
        for k in required_keys
        if result.get(k) is None or (isinstance(result.get(k), str) and not result[k].strip())
    ]
    assert not empty, f"keys present but empty/None: {empty}"


def _target_from_nodeid(nodeid: str) -> str | None:
    """Map a pytest nodeid like 'tests/evals/test_triage.py::...' to a target."""
    # nodeid format: path::testname (path uses forward slashes regardless of OS)
    path = nodeid.split("::", 1)[0]
    stem = Path(path).stem
    return _TARGET_BY_STEM.get(stem)


def _empty_target_row() -> dict[str, Any]:
    return {
        "total": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "duration_ms": 0,
        "cost_usd": 0.0,
        "judge_mean": None,
        "langsmith_url": None,
    }


def pytest_terminal_summary(terminalreporter, exitstatus, config):  # type: ignore[no-untyped-def]
    """Write a structured summary of the last eval run to ``data/eval_results.json``.

    Aggregates outcomes per sub-graph target (inferred from test file name)
    and includes any cost accumulated via ``tests.evals._metrics``.
    """
    # Skip during collection-only runs so we don't clobber a real summary
    # with an all-zeros row when callers just inspect the test tree.
    try:
        if getattr(config.option, "collectonly", False):
            return
    except Exception:  # pragma: no cover
        pass

    try:
        targets: dict[str, dict[str, Any]] = {t: _empty_target_row() for t in _ALL_TARGETS}
        total_duration_ms = 0
        cost_by_target = _cost_snapshot()

        for outcome in ("passed", "failed", "skipped"):
            for rep in terminalreporter.stats.get(outcome, []):
                target = _target_from_nodeid(getattr(rep, "nodeid", ""))
                if not target:
                    continue
                row = targets[target]
                row[outcome] += 1
                row["total"] += 1
                duration = int((getattr(rep, "duration", 0.0) or 0.0) * 1000)
                row["duration_ms"] += duration
                total_duration_ms += duration

        for t, row in targets.items():
            row["cost_usd"] = round(cost_by_target.get(t, 0.0), 6)

        payload = {
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "runner": "pytest",
            "targets": targets,
            "total_cost_usd": round(sum(r["cost_usd"] for r in targets.values()), 6),
            "total_duration_ms": total_duration_ms,
            "langsmith_project": os.getenv("LANGSMITH_PROJECT"),
            "judge_model": None,
        }

        _RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RESULTS_PATH.write_text(json.dumps(payload, indent=2))
        terminalreporter.write_line(
            f"[evals] wrote summary -> {_RESULTS_PATH}", bold=True
        )
    except Exception as exc:  # pragma: no cover - never fail the test run
        terminalreporter.write_line(f"[evals] summary write failed: {exc!r}")


def load_dataset(name: str) -> list[dict[str, Any]]:
    """Load the named gold dataset.

    Looks up ``datasets/{name}_gold.jsonl`` relative to this file.
    Returns a list (not a generator) so pytest parametrize can introspect
    its length at collection time.
    """
    path = DATASETS_DIR / f"{name}_gold.jsonl"
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open() as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{line_no} invalid JSON: {e}") from e
    return rows
