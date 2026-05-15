"""Eval tests for the sms sub-graph — strict 160-char carrier cap."""

from __future__ import annotations

import pytest

from tests.evals.conftest import assert_pydantic_valid, load_dataset

DATASET = load_dataset("sms")


def test_dataset_loadable() -> None:
    assert len(DATASET) >= 10, f"need >=10 gold cases, have {len(DATASET)}"
    for row in DATASET:
        assert "input" in row and "expected" in row, f"malformed row: {row}"
        inp = row["input"]
        for k in ("event_id", "issue_description", "received_at"):
            assert k in inp, f"row missing input.{k}: {row}"


@pytest.mark.eval
@pytest.mark.asyncio
@pytest.mark.parametrize("case", DATASET, ids=lambda c: c["input"]["event_id"])
async def test_sms_case(case: dict, live_llm) -> None:
    pytest.importorskip(
        "graph.subgraphs",
        reason="graph.subgraphs not yet built — Agent 1 still wiring sub-graphs",
    )
    from graph.callbacks import default_callbacks
    from graph.subgraphs import sms_graph  # type: ignore[attr-defined]

    result = await sms_graph.ainvoke(
        case["input"],
        config={
            "callbacks": default_callbacks(),
            "tags": ["eval", "sms"],
            "metadata": {
                "eval_case_id": case["input"]["event_id"],
                "target": "sms",
            },
        },
    )
    assert_pydantic_valid(result, ["message", "generated_by"])

    message = result["message"]
    expected = case["expected"]

    max_len = expected.get("max_length", 160)
    assert len(message) <= max_len, (
        f"sms length {len(message)} > {max_len} (event={case['input']['event_id']}): {message!r}"
    )
    assert message.startswith("After-Hours Emergency"), (
        f"sms must start with 'After-Hours Emergency': {message!r}"
    )
    must_contain = expected.get("must_contain", "Reply ACK to accept")
    assert must_contain in message, f"sms missing {must_contain!r}: {message!r}"
