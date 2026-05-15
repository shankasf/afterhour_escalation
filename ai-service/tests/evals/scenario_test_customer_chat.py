"""End-to-end scenario tester for the customer-facing LangGraph chatbot.

Simulates customer chats across emergency scenarios and traces every node the
graph executes (intake -> customer_chat_dialog -> triage -> after_hours_gate ->
routing/outreach). Reports per-scenario:

  - turns to "done"
  - emergency score from chat triage
  - safety_critical flag
  - graph status after gate (outreach / after_hours_blocked / closed)
  - per-LLM-call cost + latency from the StructuredLoggingCallbackHandler

Run with:
    set -a; source ../.env; source .env; set +a
    .venv/bin/python -m tests.evals.scenario_test_customer_chat
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Any

# Configure logging to capture callback events to memory for cost roll-up.
_log_records: list[dict[str, Any]] = []

class _MemoryHandler(logging.Handler):
    def emit(self, record):
        d = {"msg": record.getMessage()}
        for k in ("node", "model", "tokens_in", "tokens_out", "cost_usd",
                 "cost_total_usd", "latency_ms"):
            if hasattr(record, k):
                d[k] = getattr(record, k)
        if d.keys() & {"cost_usd", "tokens_in", "latency_ms", "node"}:
            _log_records.append(d)

logging.basicConfig(level=logging.WARNING)
logging.getLogger("ai-service.graph").setLevel(logging.INFO)
logging.getLogger("ai-service.graph").addHandler(_MemoryHandler())

# Silence httpx connection noise.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


SCENARIOS: list[dict[str, Any]] = [
    {
        "name": "fire_alarm_critical",
        "expected": {"min_score": 0.85, "decision": "escalate", "safety_critical": True},
        "user_turns": [
            "Hi, there's a FIRE ALARM going off at 123 Main St, smoke on the 3rd floor",
            "My name is Janet, callback 555-0101, unit 3B, I see flames near the elevator",
        ],
    },
    {
        "name": "gas_leak_life_safety",
        "expected": {"min_score": 0.85, "decision": "escalate", "safety_critical": True},
        "user_turns": [
            "I smell gas in the basement at 555 Oak Ave, really strong",
            "Mike Chen, 555-0202, basement near the boiler room. It's hard to breathe down here",
        ],
    },
    {
        "name": "water_flood_critical",
        "expected": {"min_score": 0.75, "decision": "escalate"},
        "user_turns": [
            "Major water leak in unit 4C, water everywhere coming through ceiling",
            "I'm Sarah, 555-0303, the leak is from the unit above, no one is trapped but it's flooding fast",
        ],
    },
    {
        "name": "power_outage_high",
        "expected": {"min_score": 0.65, "decision": "escalate"},
        "user_turns": [
            "We have a complete power outage in the building, all units affected",
            "Dave at 555-0404, building 200 Birch St, started 20 minutes ago, no immediate safety threat",
        ],
    },
    {
        "name": "elevator_entrapment",
        "expected": {"min_score": 0.85, "decision": "escalate", "safety_critical": True},
        "user_turns": [
            "Someone is stuck in the elevator at 200 Birch, they can't get out",
            "I'm Tom in the lobby, 555-0505. The person inside is calling for help, they say they're okay but trapped",
        ],
    },
    {
        "name": "routine_light_bulb",
        "expected": {"max_score": 0.4, "decision_in": ["monitor", "ignore", "escalate"]},
        "user_turns": [
            "Hi, the light bulb in the lobby of 123 Main is burned out, no rush",
            "Just letting you know — name's Pat, 555-0606, lobby of the main entrance, can wait until morning",
        ],
    },
    {
        "name": "scheduled_maintenance_low",
        "expected": {"max_score": 0.45, "decision_in": ["monitor", "ignore", "escalate"]},
        "user_turns": [
            "Wanted to schedule a maintenance window for HVAC next month, can it be done after hours?",
            "Building manager Lisa, 555-0707, 300 Pine St. Just planning — not urgent, just want it on the calendar",
        ],
    },
    {
        "name": "ambiguous_to_real_emergency",
        "expected": {"min_score": 0.6, "decision": "escalate"},
        "user_turns": [
            "Hey is anyone there",
            "yeah I'm not sure if this is urgent",
            "actually it is — there's water coming through my ceiling and the smoke alarm just went off",
            "I'm Alex, 555-0808, unit 6A at 400 Cedar Lane, the water has reached the outlets and I'm worried about an electrical fire",
        ],
    },
]


async def run_one_scenario(scenario: dict[str, Any]) -> dict[str, Any]:
    """Drive the chat dialog node turn-by-turn until done=True, then run triage gate."""
    from graph.nodes.customer_chat_dialog import customer_chat_dialog
    from graph.nodes.after_hours_gate import after_hours_gate
    from graph.state import IncidentState, Turn

    started = time.perf_counter()
    state: IncidentState = {
        "event_id": f"scenario_{scenario['name']}",
        "source": "chat",
        "raw": {"force_escalate": False},
        "ladder": [],
        "cursor": 0,
        "skip_list": [],
        "attempts": [],
        "conversation_log": [],
        "status": "intake",
        "customer_summary": "",
    }

    transcript: list[Turn] = []
    bot_replies: list[str] = []
    turns_used = 0

    for user_text in scenario["user_turns"]:
        turns_used += 1
        state["channel_event"] = {"kind": "customer_chat", "text": user_text, "modality": "text"}

        update = await customer_chat_dialog(state, {})
        # Apply update like LangGraph reducer would
        for k, v in update.items():
            state[k] = v
        transcript = state.get("conversation_log") or []
        if transcript:
            last_assistant = next(
                (t for t in reversed(transcript) if t.role == "assistant"), None
            )
            if last_assistant:
                bot_replies.append(last_assistant.text)

        if state.get("triage") is not None:
            break

    # If dialog never converged, force-run a final triage from the transcript
    triage = state.get("triage")
    if triage is None and transcript:
        from graph.nodes.customer_chat_dialog import _triage_from_transcript
        triage = await _triage_from_transcript(
            transcript, state.get("customer_summary") or ""
        )
        if triage is not None:
            state["triage"] = triage
            state["status"] = "triaged"

    # Run after_hours_gate to capture the routing decision
    gate_status = "no_gate_run"
    gate_reason = ""
    if triage is not None:
        gate_update = await after_hours_gate(state, {})
        gate_status = gate_update.get("status", "")
        gate_reason = (gate_update.get("customer_summary") or "").split("| gate:")[-1].strip()

    duration_ms = int((time.perf_counter() - started) * 1000)

    # Validate against expected
    result: dict[str, Any] = {
        "name": scenario["name"],
        "turns": turns_used,
        "duration_ms": duration_ms,
        "bot_replies": bot_replies,
        "triage": None,
        "gate_status": gate_status,
        "gate_reason": gate_reason,
        "validation": {},
    }

    if triage is not None:
        result["triage"] = {
            "decision": triage.decision,
            "priority": triage.priority,
            "emergency_score": round(triage.emergency_score, 2),
            "is_safety_critical": triage.is_safety_critical,
            "issue_summary": triage.issue_summary,
            "location": triage.location,
            "equipment": triage.equipment,
        }
        exp = scenario["expected"]
        checks = []
        if "min_score" in exp:
            ok = triage.emergency_score >= exp["min_score"]
            checks.append(("min_score", f"{triage.emergency_score:.2f} >= {exp['min_score']}", ok))
        if "max_score" in exp:
            ok = triage.emergency_score <= exp["max_score"]
            checks.append(("max_score", f"{triage.emergency_score:.2f} <= {exp['max_score']}", ok))
        if "decision" in exp:
            ok = triage.decision == exp["decision"]
            checks.append(("decision", f"{triage.decision} == {exp['decision']}", ok))
        if "decision_in" in exp:
            ok = triage.decision in exp["decision_in"]
            checks.append(("decision_in", f"{triage.decision} in {exp['decision_in']}", ok))
        if "safety_critical" in exp:
            ok = triage.is_safety_critical == exp["safety_critical"]
            checks.append(("safety", f"{triage.is_safety_critical} == {exp['safety_critical']}", ok))
        result["validation"] = {
            "checks": checks,
            "pass": all(c[2] for c in checks),
        }
    return result


def print_scenario_report(r: dict[str, Any]) -> None:
    name = r["name"]
    triage = r.get("triage") or {}
    val = r.get("validation") or {}
    pass_flag = "PASS" if val.get("pass") else ("FAIL" if val else "NO_TRIAGE")
    score = triage.get("emergency_score", "—")
    decision = triage.get("decision", "—")
    priority = triage.get("priority", "—")
    safety = triage.get("is_safety_critical", "—")
    gate = r.get("gate_status", "—")
    turns = r.get("turns", "—")
    dur = r.get("duration_ms", 0)
    print(f"\n{'='*80}")
    print(f"  [{pass_flag}]  {name:32s}  turns={turns}  {dur}ms")
    print(f"{'='*80}")
    print(f"  triage:   score={score}  decision={decision}  priority={priority}  safety={safety}")
    print(f"  gate:     status={gate}")
    if triage.get("issue_summary"):
        print(f"  summary:  {triage['issue_summary'][:90]}")
    if val.get("checks"):
        print(f"  checks:")
        for label, expr, ok in val["checks"]:
            marker = "✓" if ok else "✗"
            print(f"    {marker} {label}: {expr}")
    if r.get("bot_replies"):
        print(f"  bot reply (last): {r['bot_replies'][-1][:90]}")


async def main() -> None:
    print("\n" + "#"*80)
    print(f"# LangGraph customer-chat scenario test — {len(SCENARIOS)} scenarios")
    print(f"# Model: {os.environ.get('OPENAI_MODEL', '(default)')}")
    print(f"# LangSmith: {os.environ.get('LANGSMITH_PROJECT', '(not set)')}")
    print("#"*80)

    results = []
    overall_start = time.perf_counter()

    for s in SCENARIOS:
        try:
            r = await run_one_scenario(s)
        except Exception as exc:  # noqa: BLE001
            r = {"name": s["name"], "error": f"{type(exc).__name__}: {exc}"}
        results.append(r)
        print_scenario_report(r) if "error" not in r else print(
            f"\n[ERROR] {s['name']}: {r['error']}"
        )

    total_ms = int((time.perf_counter() - overall_start) * 1000)

    # Aggregate cost from callback records
    total_cost = sum(rec.get("cost_usd", 0.0) for rec in _log_records if "cost_usd" in rec)
    total_in = sum(rec.get("tokens_in", 0) for rec in _log_records if "tokens_in" in rec)
    total_out = sum(rec.get("tokens_out", 0) for rec in _log_records if "tokens_out" in rec)
    llm_calls = sum(1 for rec in _log_records if "tokens_in" in rec)

    # Summary table
    print("\n" + "#"*80)
    print("# SUMMARY")
    print("#"*80)
    rows = []
    for r in results:
        if "error" in r:
            rows.append((r["name"], "ERR", "—", "—", "—", "—", "—"))
            continue
        t = r.get("triage") or {}
        v = r.get("validation") or {}
        rows.append((
            r["name"],
            "PASS" if v.get("pass") else ("FAIL" if v else "NO_TRIAGE"),
            f"{t.get('emergency_score', '—')}",
            t.get("decision", "—"),
            t.get("priority", "—"),
            "Y" if t.get("is_safety_critical") else "N",
            r.get("gate_status", "—"),
        ))

    print(f"{'scenario':<32} {'status':<8} {'score':<7} {'decision':<10} {'priority':<10} {'safe':<5} {'gate':<22}")
    print("-" * 100)
    for row in rows:
        print(f"{row[0]:<32} {row[1]:<8} {row[2]:<7} {row[3]:<10} {row[4]:<10} {row[5]:<5} {row[6]:<22}")

    passed = sum(1 for r in results if (r.get("validation") or {}).get("pass"))
    print("-" * 100)
    print(f"PASS RATE: {passed}/{len(SCENARIOS)}  ({passed*100//max(1,len(SCENARIOS))}%)")
    print(f"TOTAL TIME: {total_ms}ms  ({total_ms//max(1,llm_calls) if llm_calls else 0}ms/llm-call)")
    print(f"LLM CALLS: {llm_calls}   tokens in: {total_in}   tokens out: {total_out}")
    print(f"TOTAL COST: ${total_cost:.4f}")

    # Save JSON for the dashboard
    out_path = "data/scenario_test_results.json"
    os.makedirs("data", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({
            "results": results,
            "summary": {
                "passed": passed,
                "total": len(SCENARIOS),
                "total_ms": total_ms,
                "llm_calls": llm_calls,
                "tokens_in": total_in,
                "tokens_out": total_out,
                "total_cost_usd": round(total_cost, 4),
            },
        }, f, indent=2, default=str)
    print(f"\nSaved to {out_path}")

    sys.exit(0 if passed == len(SCENARIOS) else 1)


if __name__ == "__main__":
    asyncio.run(main())
