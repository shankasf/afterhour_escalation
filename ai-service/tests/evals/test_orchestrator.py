"""Eval tests for the orchestrator sub-graph — full event → escalation pipeline."""

from __future__ import annotations

import pytest

from tests.evals.conftest import assert_pydantic_valid, load_dataset

DATASET = load_dataset("orchestrator")


def test_dataset_loadable() -> None:
    assert len(DATASET) >= 10, f"need >=10 gold cases, have {len(DATASET)}"
    for row in DATASET:
        assert "input" in row and "expected" in row, f"malformed row: {row}"
        inp = row["input"]
        for k in ("event_type", "content", "source", "metadata"):
            assert k in inp, f"row missing input.{k}: {row}"


@pytest.mark.eval
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", DATASET, ids=lambda c: f"{c['input']['source']}:{c['input']['content'][:30]}"
)
async def test_orchestrator_case(case: dict, live_llm) -> None:
    pytest.importorskip(
        "graph.subgraphs",
        reason="graph.subgraphs not yet built — Agent 1 still wiring sub-graphs",
    )
    from graph.callbacks import default_callbacks
    from graph.subgraphs import orchestrator_graph  # type: ignore[attr-defined]

    result = await orchestrator_graph.ainvoke(
        case["input"],
        config={
            "callbacks": default_callbacks(),
            "tags": ["eval", "orchestrator", case["input"]["source"]],
            "metadata": {
                "eval_case_id": case["input"]["content"][:40],
                "target": "orchestrator",
            },
        },
    )
    assert_pydantic_valid(result, ["should_escalate", "triage", "audit_notes"])
    assert isinstance(result["should_escalate"], bool), "should_escalate must be bool"
    assert isinstance(result["triage"], dict), "triage must be a dict"

    expected = case["expected"]
    if "should_escalate" in expected:
        assert result["should_escalate"] == expected["should_escalate"], (
            f"should_escalate={result['should_escalate']} expected={expected['should_escalate']} "
            f"(content={case['input']['content'][:60]!r})"
        )

    # If we escalated, escalation_content must be present; if not, it should be None
    if result["should_escalate"]:
        assert result.get("escalation_content") is not None, (
            "should_escalate=True but escalation_content is None"
        )
    if "priority_in" in expected:
        prio = result["triage"].get("priority")
        assert prio in expected["priority_in"], (
            f"priority {prio!r} not in {expected['priority_in']}"
        )
