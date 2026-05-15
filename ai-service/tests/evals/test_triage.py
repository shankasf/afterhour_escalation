"""Eval tests for the triage sub-graph.

Structural test always runs (no LLM). Per-case tests require ``-m eval``
and a real OPENAI_API_KEY (gated by the ``live_llm`` fixture).
"""

from __future__ import annotations

import pytest

from tests.evals.conftest import assert_pydantic_valid, load_dataset

DATASET = load_dataset("triage")


def test_dataset_loadable() -> None:
    assert len(DATASET) >= 10, f"need >=10 gold cases, have {len(DATASET)}"
    for row in DATASET:
        assert "input" in row and "expected" in row, f"malformed row: {row}"
        for k in ("subject", "body", "sender_domain"):
            assert k in row["input"], f"row missing input.{k}: {row}"


@pytest.mark.eval
@pytest.mark.asyncio
@pytest.mark.parametrize("case", DATASET, ids=lambda c: c["input"]["subject"][:40])
async def test_triage_case(case: dict, live_llm) -> None:
    pytest.importorskip(
        "graph.subgraphs",
        reason="graph.subgraphs not yet built — Agent 1 still wiring sub-graphs",
    )
    from graph.callbacks import default_callbacks
    from graph.subgraphs import triage_graph  # type: ignore[attr-defined]

    result = await triage_graph.ainvoke(
        case["input"],
        config={
            "callbacks": default_callbacks(),
            "tags": ["eval", "triage"],
            "metadata": {
                "eval_case_id": case["input"]["subject"][:40],
                "target": "triage",
            },
        },
    )
    assert_pydantic_valid(
        result, ["emergency_score", "is_service_related", "summary", "reasoning"]
    )

    expected = case["expected"]
    score = result["emergency_score"]
    if "min_score" in expected:
        assert score >= expected["min_score"], (
            f"score {score:.2f} < min {expected['min_score']} "
            f"(subject={case['input']['subject']!r})"
        )
    if "max_score" in expected:
        assert score <= expected["max_score"], (
            f"score {score:.2f} > max {expected['max_score']} "
            f"(subject={case['input']['subject']!r})"
        )
    if "is_service_related" in expected:
        assert result["is_service_related"] == expected["is_service_related"]
    if "is_safety_critical" in expected:
        assert result["is_safety_critical"] == expected["is_safety_critical"]
