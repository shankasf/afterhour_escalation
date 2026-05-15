"""Eval results summary endpoint.

Exposes the most-recent ``data/eval_results.json`` produced by either the
pytest hook (``tests/evals/conftest.py::pytest_terminal_summary``) or the
LangSmith runner (``tests/evals/langsmith_runner.py``). The admin
dashboard reads this through the Nest backend proxy.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

_RESULTS_PATH = Path(__file__).resolve().parent.parent / "data" / "eval_results.json"
_SCENARIO_RESULTS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "scenario_test_results.json"
)


def _empty_payload() -> dict:
    return {
        "last_run_at": None,
        "runner": None,
        "targets": {},
        "total_cost_usd": 0.0,
        "total_duration_ms": 0,
        "langsmith_project": None,
        "judge_model": None,
    }


@router.get("/summary")
async def eval_summary() -> dict:
    """Return the last eval-run summary, or an empty payload if missing."""
    if not _RESULTS_PATH.exists():
        return _empty_payload()
    try:
        return json.loads(_RESULTS_PATH.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read eval_results.json: %s", exc)
        raise HTTPException(status_code=500, detail="eval results unreadable") from exc


@router.get("/scenarios")
async def eval_scenarios() -> dict:
    """Return the most recent customer-chat scenario-test results.

    Populated by ``python -m tests.evals.scenario_test_customer_chat``.
    """
    if not _SCENARIO_RESULTS_PATH.exists():
        return {"results": [], "summary": None}
    try:
        return json.loads(_SCENARIO_RESULTS_PATH.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read scenario_test_results.json: %s", exc)
        raise HTTPException(
            status_code=500, detail="scenario results unreadable"
        ) from exc
