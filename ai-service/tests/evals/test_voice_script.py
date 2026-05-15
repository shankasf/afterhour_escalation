"""Eval tests for the voice_script sub-graph (both call + voicemail modes)."""

from __future__ import annotations

import pytest

from tests.evals.conftest import assert_pydantic_valid, load_dataset

DATASET = load_dataset("voice_script")


def test_dataset_loadable() -> None:
    assert len(DATASET) >= 10, f"need >=10 gold cases, have {len(DATASET)}"
    for row in DATASET:
        assert "input" in row and "expected" in row, f"malformed row: {row}"
        inp = row["input"]
        for k in (
            "event_id",
            "issue_description",
            "received_at",
            "responder_name",
            "escalation_level",
            "source_type",
            "mode",
        ):
            assert k in inp, f"row missing input.{k}: {row}"
        assert inp["mode"] in ("call", "voicemail")


@pytest.mark.eval
@pytest.mark.asyncio
@pytest.mark.parametrize("case", DATASET, ids=lambda c: c["input"]["event_id"])
async def test_voice_script_case(case: dict, live_llm) -> None:
    pytest.importorskip(
        "graph.subgraphs",
        reason="graph.subgraphs not yet built — Agent 1 still wiring sub-graphs",
    )
    from graph.callbacks import default_callbacks
    from graph.subgraphs import voice_script_graph  # type: ignore[attr-defined]

    result = await voice_script_graph.ainvoke(
        case["input"],
        config={
            "callbacks": default_callbacks(),
            "tags": ["eval", "voice_script", case["input"]["mode"]],
            "metadata": {
                "eval_case_id": case["input"]["event_id"],
                "target": "voice_script",
            },
        },
    )
    assert_pydantic_valid(
        result, ["script", "urgency_level", "estimated_duration_seconds", "generated_by"]
    )

    script = result["script"]
    expected = case["expected"]
    max_len = expected.get("max_length", 400)
    assert len(script) <= max_len, (
        f"script length {len(script)} > {max_len} chars (event={case['input']['event_id']})"
    )

    mode = case["input"]["mode"]
    low = script.lower()
    if mode == "call":
        # Call scripts greet the responder and include a press-1 callback prompt
        assert "press 1" in low or "press one" in low, (
            f"call script missing 'press 1' prompt: {script!r}"
        )
        assert "after-hours emergency" in low or "priority alert" in low, (
            f"call script missing urgency phrase: {script!r}"
        )
    else:
        # Voicemails should NOT include interactive press-1 prompts
        assert "press 1" not in low, f"voicemail should not include press 1: {script!r}"
