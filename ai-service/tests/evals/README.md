# Eval Harness

Tests + LangSmith experiments for the five LangGraph sub-graphs that power
the after-hours escalation pipeline (`triage`, `voice_script`, `sms`,
`voicemail`, `orchestrator`).

## What this suite measures (three layers)

1. **Structural** (always runs, no LLM, free)
   - Each gold dataset loads and is well-formed.
   - When live tests run, the sub-graph output contains all required keys
     with non-empty values.
2. **Per-case assertions** (`pytest -m eval`, requires `OPENAI_API_KEY`)
   - Pointwise expectations from each gold JSONL row: emergency-score
     ranges, length caps, mode-specific phrases, escalation decisions, etc.
3. **LangSmith experiment** (`python -m tests.evals.langsmith_runner`)
   - Uploads each gold dataset to LangSmith and runs structural,
     range/length, and LLM-as-judge evaluators across the full set.
   - Produces a versioned experiment per run for regression tracking.

## Running locally

```bash
# Structural only — no API keys required, fast
.venv/bin/pytest tests/evals/

# Full per-case eval — needs OPENAI_API_KEY (and ideally LANGSMITH_TRACING=true)
.venv/bin/pytest tests/evals/ -m eval

# A single sub-graph
.venv/bin/pytest tests/evals/test_triage.py -m eval -v
```

LangSmith traces are auto-captured when `LANGSMITH_TRACING=true` and
`LANGSMITH_API_KEY` are in the environment — every test run also shows up
in your project as a trace, tagged `eval` plus the sub-graph name.

## Running the LangSmith experiment

```bash
# One target
python -m tests.evals.langsmith_runner --target triage

# All five
python -m tests.evals.langsmith_runner --target all
```

Requires both `LANGSMITH_API_KEY` and `OPENAI_API_KEY`. The runner will:

1. Create-or-reuse a dataset named `ah-escalation-{target}-gold` in your
   LangSmith project.
2. Run the sub-graph over every gold example.
3. Score each output with structural / range / length / LLM-judge evaluators.
4. Print a summary; full results live in the LangSmith experiment dashboard.

LLM-judge uses `gpt-4o-mini` (cheap, deliberately independent of whichever
model the sub-graphs use, so we can detect judge-model drift separately).

## Adding a new gold case

Each gold file is JSONL: one record per line, two top-level keys:

```json
{"input": { ...exactly what the sub-graph ainvoke() expects... },
 "expected": { "min_score": 0.8, "is_service_related": true }}
```

Add the new line, keep the file sorted by realism / severity for sanity,
and run `pytest tests/evals/test_<target>.py` to confirm parametrization
picks it up.

## Pass / fail thresholds

| Layer                  | Threshold                                |
|------------------------|------------------------------------------|
| Structural             | 100% pass (no exceptions allowed)        |
| Per-case (`-m eval`)   | 100% pass on safety-critical cases       |
| LangSmith LLM-judge    | mean urgency score ≥ 4.0/5 across set    |
| LangSmith length cap   | 100% pass (SMS ≤ 160, voice ≤ 400)       |

A regression that drops mean LLM-judge below 4.0 or breaks the length cap
on any case is a hard block on shipping that model/prompt change.

## Dev dependencies

`pytest`, `pytest-asyncio` are required (installed into `.venv` — they are
test-only and intentionally NOT in `requirements.txt`, which holds the
runtime deps that ship in the container image).
