"""LangSmith experiment runner for the after-hours escalation sub-graphs.

Usage:
    python -m tests.evals.langsmith_runner --target triage
    python -m tests.evals.langsmith_runner --target all

What this does:
  1. Uploads each gold dataset to LangSmith as a versioned dataset
     (creates if missing, otherwise reuses by name).
  2. Runs ``langsmith.evaluate`` against the target sub-graph using
     a mix of structural, range/length, and LLM-as-judge evaluators.
  3. Prints a summary table to stdout.

Does NOT run automatically in CI — invoke explicitly when you want to
benchmark a model change. LLM-judge calls cost tokens.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable  # noqa: F401

DATASETS_DIR = Path(__file__).parent / "datasets"
RESULTS_PATH = Path(__file__).resolve().parents[2] / "data" / "eval_results.json"

TARGETS = ("triage", "voice_script", "sms", "voicemail", "orchestrator")

JUDGE_MODEL = "gpt-4o-mini"

# Required keys per sub-graph output (must match Agent 1's contracts)
REQUIRED_KEYS: dict[str, tuple[str, ...]] = {
    "triage": ("emergency_score", "is_service_related", "summary", "reasoning"),
    "voice_script": ("script", "urgency_level", "estimated_duration_seconds", "generated_by"),
    "sms": ("message", "generated_by"),
    "voicemail": ("emergency_score", "reasoning", "context", "recommended_action"),
    "orchestrator": ("should_escalate", "triage", "audit_notes"),
}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


# ---------------------------------------------------------------------------
# Target adapters: each takes the gold input dict and returns the graph output
# ---------------------------------------------------------------------------


async def _run_triage(inputs: dict) -> dict:
    from graph.subgraphs import triage_graph  # type: ignore[attr-defined]

    return await triage_graph.ainvoke(inputs)


async def _run_voice_script(inputs: dict) -> dict:
    from graph.subgraphs import voice_script_graph  # type: ignore[attr-defined]

    return await voice_script_graph.ainvoke(inputs)


async def _run_sms(inputs: dict) -> dict:
    from graph.subgraphs import sms_graph  # type: ignore[attr-defined]

    return await sms_graph.ainvoke(inputs)


async def _run_voicemail(inputs: dict) -> dict:
    from graph.subgraphs import voicemail_graph  # type: ignore[attr-defined]

    return await voicemail_graph.ainvoke(inputs)


async def _run_orchestrator(inputs: dict) -> dict:
    from graph.subgraphs import orchestrator_graph  # type: ignore[attr-defined]

    return await orchestrator_graph.ainvoke(inputs)


RUNNERS: dict[str, Callable[[dict], Awaitable[dict]]] = {
    "triage": _run_triage,
    "voice_script": _run_voice_script,
    "sms": _run_sms,
    "voicemail": _run_voicemail,
    "orchestrator": _run_orchestrator,
}


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------


def make_structural_evaluator(target: str):
    required = REQUIRED_KEYS[target]

    def _eval(run, example) -> dict:
        output = (run.outputs or {}) if run else {}
        missing = [k for k in required if k not in output or output.get(k) in (None, "")]
        return {
            "key": "structural_valid",
            "score": 0 if missing else 1,
            "comment": f"missing/empty: {missing}" if missing else "ok",
        }

    return _eval


def make_score_range_evaluator(target: str):
    """For triage/voicemail/orchestrator: score within expected bounds."""

    def _eval(run, example) -> dict:
        output = (run.outputs or {}) if run else {}
        expected = (example.outputs or {}) if example else {}
        if target in ("triage", "voicemail"):
            score = output.get("emergency_score")
        elif target == "orchestrator":
            # 1 if should_escalate matches expected
            actual = output.get("should_escalate")
            want = expected.get("should_escalate")
            if want is None:
                return {"key": "score_match", "score": None}
            return {
                "key": "should_escalate_match",
                "score": 1 if actual == want else 0,
                "comment": f"got={actual} want={want}",
            }
        else:
            return {"key": "score_match", "score": None}

        if score is None:
            return {"key": "score_match", "score": 0, "comment": "no score in output"}
        mn = expected.get("min_score")
        mx = expected.get("max_score")
        ok = True
        notes = []
        if mn is not None and score < mn:
            ok = False
            notes.append(f"{score:.2f} < min {mn}")
        if mx is not None and score > mx:
            ok = False
            notes.append(f"{score:.2f} > max {mx}")
        return {"key": "score_match", "score": 1 if ok else 0, "comment": "; ".join(notes) or "ok"}

    return _eval


def make_length_cap_evaluator(target: str):
    """SMS ≤ 160; voice scripts ≤ 400."""

    def _eval(run, example) -> dict:
        output = (run.outputs or {}) if run else {}
        if target == "sms":
            text = output.get("message", "")
            cap = 160
        elif target == "voice_script":
            text = output.get("script", "")
            cap = 400
        else:
            return {"key": "length_cap", "score": None}
        n = len(text or "")
        return {
            "key": "length_cap",
            "score": 1 if n <= cap else 0,
            "comment": f"len={n} cap={cap}",
        }

    return _eval


JUDGE_PROMPT = """You are evaluating an after-hours property-management escalation system.

Given the original input and the system's output, score how well the output
captured the URGENCY and ACTIONABILITY of the situation on a 1-5 scale:

  5 — perfectly captures the urgency, prioritization, and required action
  4 — captures the urgency correctly with minor omissions
  3 — captures the gist but misses important nuance
  2 — mis-prioritizes (e.g., treats safety-critical as routine, or vice versa)
  1 — wrong or unsafe output

Input:
{input}

Output:
{output}

Respond with ONLY a single integer 1-5. No explanation."""


def make_llm_judge_evaluator():
    """LLM-as-judge using gpt-4o-mini (cheap, independent of the model under test)."""

    def _eval(run, example) -> dict:
        output = (run.outputs or {}) if run else {}
        inputs = (example.inputs or {}) if example else {}
        try:
            from openai import OpenAI

            client = OpenAI()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": JUDGE_PROMPT.format(
                            input=json.dumps(inputs, indent=2)[:2000],
                            output=json.dumps(output, indent=2)[:2000],
                        ),
                    }
                ],
                temperature=0,
                max_tokens=4,
            )
            raw = (resp.choices[0].message.content or "").strip()
            digit = next((c for c in raw if c.isdigit()), None)
            score = int(digit) if digit else 0
            return {
                "key": "llm_judge_urgency",
                "score": score,
                "comment": f"raw={raw!r}",
            }
        except Exception as e:  # pragma: no cover
            return {"key": "llm_judge_urgency", "score": 0, "comment": f"error: {e}"}

    return _eval


# ---------------------------------------------------------------------------
# Dataset upload + experiment driver
# ---------------------------------------------------------------------------


def ensure_dataset(client, target: str) -> str:
    """Create-or-update a LangSmith dataset, return its name."""
    name = f"ah-escalation-{target}-gold"
    rows = _load_jsonl(DATASETS_DIR / f"{target}_gold.jsonl")
    try:
        existing = client.read_dataset(dataset_name=name)
        dataset_id = existing.id
        print(f"[{target}] reusing dataset {name} (id={dataset_id}, {len(rows)} gold rows)")
    except Exception:
        existing = client.create_dataset(
            dataset_name=name,
            description=f"After-hours escalation gold set for {target} sub-graph",
        )
        dataset_id = existing.id
        client.create_examples(
            inputs=[r["input"] for r in rows],
            outputs=[r["expected"] for r in rows],
            dataset_id=dataset_id,
        )
        print(f"[{target}] created dataset {name} with {len(rows)} examples")
    return name


def _summarize_results(results: Any) -> dict[str, Any]:
    """Extract per-target counters from a LangSmith ExperimentResults object.

    Iterates the results list (which is typically lazy) and tallies:
      - total / passed / failed
      - duration_ms (sum across runs)
      - judge_mean (average of the ``llm_judge_urgency`` score where present)
      - langsmith_url (first non-empty experiment URL we see)
    """
    total = passed = failed = 0
    duration_ms_total = 0
    judge_scores: list[float] = []
    langsmith_url: str | None = None

    try:
        experiment_name = getattr(results, "experiment_name", None)
        if experiment_name and not langsmith_url:
            # Best-effort URL: LangSmith UI uses /o/<org>/projects/p/<project>/...
            # but the experiment_name is sufficient for the dashboard to link to.
            langsmith_url = f"https://smith.langchain.com/experiments/{experiment_name}"
    except Exception:  # pragma: no cover
        pass

    try:
        for item in results:
            total += 1
            run = item.get("run") if isinstance(item, dict) else getattr(item, "run", None)
            scores = item.get("evaluation_results", {}) if isinstance(item, dict) else getattr(item, "evaluation_results", {})
            # Run error → failed
            err = getattr(run, "error", None) if run else None
            if err:
                failed += 1
            else:
                passed += 1
            # Duration
            start = getattr(run, "start_time", None) if run else None
            end = getattr(run, "end_time", None) if run else None
            if start and end:
                try:
                    duration_ms_total += int((end - start).total_seconds() * 1000)
                except Exception:
                    pass
            # Judge score (1-5)
            try:
                eval_results = scores.get("results") if isinstance(scores, dict) else getattr(scores, "results", [])
                for er in eval_results or []:
                    key = getattr(er, "key", None) or (er.get("key") if isinstance(er, dict) else None)
                    score = getattr(er, "score", None) if not isinstance(er, dict) else er.get("score")
                    if key == "llm_judge_urgency" and isinstance(score, (int, float)) and score > 0:
                        judge_scores.append(float(score))
            except Exception:  # pragma: no cover
                pass
    except Exception:  # pragma: no cover
        pass

    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": 0,
        "duration_ms": duration_ms_total,
        "judge_mean": round(sum(judge_scores) / len(judge_scores), 3) if judge_scores else None,
        "langsmith_url": langsmith_url,
    }


def run_target(target: str) -> dict:
    from langsmith import Client, evaluate

    client = Client()
    dataset_name = ensure_dataset(client, target)
    runner = RUNNERS[target]

    def _sync_target(inputs: dict) -> dict:
        return asyncio.run(runner(inputs))

    evaluators = [
        make_structural_evaluator(target),
        make_score_range_evaluator(target),
        make_length_cap_evaluator(target),
        make_llm_judge_evaluator(),
    ]
    prefix = f"{target}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}"
    results = evaluate(
        _sync_target,
        data=dataset_name,
        evaluators=evaluators,
        experiment_prefix=prefix,
    )
    summary = _summarize_results(results)
    # Pull cost from the in-process accumulator if anything recorded into it.
    try:
        from tests.evals._metrics import get_cost

        summary["cost_usd"] = round(get_cost(target), 6)
    except Exception:
        summary["cost_usd"] = 0.0
    return {"target": target, "experiment": prefix, "results": results, "summary": summary}


def _empty_row() -> dict[str, Any]:
    return {
        "total": 0, "passed": 0, "failed": 0, "skipped": 0,
        "duration_ms": 0, "cost_usd": 0.0, "judge_mean": None, "langsmith_url": None,
    }


def _write_eval_json(runs: list[dict]) -> None:
    """Persist the per-target summary to ``data/eval_results.json``."""
    targets: dict[str, dict[str, Any]] = {t: _empty_row() for t in TARGETS}
    total_cost = 0.0
    total_duration_ms = 0
    for run in runs:
        target = run.get("target")
        summary = run.get("summary") or {}
        if target in targets and summary:
            targets[target] = {
                "total": int(summary.get("total", 0)),
                "passed": int(summary.get("passed", 0)),
                "failed": int(summary.get("failed", 0)),
                "skipped": int(summary.get("skipped", 0)),
                "duration_ms": int(summary.get("duration_ms", 0)),
                "cost_usd": float(summary.get("cost_usd", 0.0)),
                "judge_mean": summary.get("judge_mean"),
                "langsmith_url": summary.get("langsmith_url"),
            }
            total_cost += targets[target]["cost_usd"]
            total_duration_ms += targets[target]["duration_ms"]

    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "runner": "langsmith",
        "targets": targets,
        "total_cost_usd": round(total_cost, 6),
        "total_duration_ms": total_duration_ms,
        "langsmith_project": os.getenv("LANGSMITH_PROJECT"),
        "judge_model": JUDGE_MODEL,
    }

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(payload, indent=2))
    print(f"[evals] wrote summary -> {RESULTS_PATH}")


def print_summary(runs: list[dict]) -> None:
    print("\n" + "=" * 60)
    print(f"{'TARGET':<14} {'EXPERIMENT':<30} STATUS")
    print("-" * 60)
    for run in runs:
        print(f"{run['target']:<14} {run['experiment']:<30} done")
    print("=" * 60)
    print("View detailed traces in your LangSmith project dashboard.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run LangSmith experiments for after-hours escalation sub-graphs",
    )
    parser.add_argument(
        "--target",
        choices=(*TARGETS, "all"),
        required=True,
        help="Which sub-graph to evaluate (or 'all' for every target)",
    )
    args = parser.parse_args()

    if not os.getenv("LANGSMITH_API_KEY"):
        print("ERROR: LANGSMITH_API_KEY not set", file=sys.stderr)
        return 2
    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set (judge needs it)", file=sys.stderr)
        return 2

    targets = TARGETS if args.target == "all" else (args.target,)
    runs = [run_target(t) for t in targets]
    print_summary(runs)
    try:
        _write_eval_json(runs)
    except Exception as exc:  # pragma: no cover
        print(f"[evals] failed to write summary JSON: {exc!r}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
