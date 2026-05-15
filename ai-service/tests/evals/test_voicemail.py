"""Eval tests for the voicemail (inbound) triage sub-graph."""

from __future__ import annotations

import pytest

from tests.evals.conftest import assert_pydantic_valid, load_dataset

DATASET = load_dataset("voicemail")


def test_dataset_loadable() -> None:
    assert len(DATASET) >= 10, f"need >=10 gold cases, have {len(DATASET)}"
    for row in DATASET:
        assert "input" in row and "expected" in row, f"malformed row: {row}"
        inp = row["input"]
        assert "transcription" in inp and "from_number" in inp


@pytest.mark.eval
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", DATASET, ids=lambda c: c["input"]["transcription"][:40] or "<empty>"
)
async def test_voicemail_case(case: dict, live_llm) -> None:
    pytest.importorskip(
        "graph.subgraphs",
        reason="graph.subgraphs not yet built — Agent 1 still wiring sub-graphs",
    )
    from graph.callbacks import default_callbacks
    from graph.subgraphs import voicemail_graph  # type: ignore[attr-defined]

    result = await voicemail_graph.ainvoke(
        case["input"],
        config={
            "callbacks": default_callbacks(),
            "tags": ["eval", "voicemail"],
            "metadata": {
                "eval_case_id": case["input"]["from_number"],
                "target": "voicemail",
            },
        },
    )
    assert_pydantic_valid(result, ["emergency_score", "reasoning", "recommended_action"])
    assert "context" in result, "voicemail result missing 'context'"
    assert isinstance(result["context"], dict), "context must be a dict"
    assert len(result["context"]) >= 6, f"context expected >=6 keys, got {len(result['context'])}"

    score = result["emergency_score"]
    expected = case["expected"]
    if "min_score" in expected:
        assert score >= expected["min_score"], (
            f"vm score {score:.2f} < min {expected['min_score']} "
            f"(transcript={case['input']['transcription'][:60]!r})"
        )
    if "max_score" in expected:
        assert score <= expected["max_score"], (
            f"vm score {score:.2f} > max {expected['max_score']} "
            f"(transcript={case['input']['transcription'][:60]!r})"
        )
