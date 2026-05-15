"""LangChain callback handlers for structured logging from LangGraph runs.

Wires every node / LLM / tool event into the project's JSON logger
(``ai-service.graph``) so LangGraph activity shows up in the same log
stream as everything else (HTTP, websockets, email poller, etc.).

Usage from a sub-graph caller:

    from graph.callbacks import default_callbacks

    await graph.ainvoke(
        {...},
        config={"callbacks": default_callbacks(), "tags": ["triage"]},
    )
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from logging_setup import redact


logger = logging.getLogger("ai-service.graph")


# ---------------------------------------------------------------------------
# Cost tracking
# ---------------------------------------------------------------------------
#
# OpenAI list-prices as of 2026-05-13 (USD per 1K tokens). Cached input
# pricing applies to tokens reported under ``prompt_tokens_details.cached_tokens``.
# Audio (Realtime) is billed at separate per-token rates from text — the
# Realtime usage payload reports audio tokens under
# ``input_token_details.audio_tokens`` / ``output_token_details.audio_tokens``
# and they are priced via the ``audio_input`` / ``audio_output`` fields below.
# Source of truth: LangSmith model-price-map (verified live) + OpenAI public
# pricing page. Refresh via ``scripts/sync_pricing.py`` when models change.
_PRICING_USD_PER_1K: dict[str, dict[str, float]] = {
    # GPT-5.x text models
    "gpt-5.5":                     {"input": 0.005,    "cached_input": 0.0005,    "output": 0.030},
    "gpt-5.5-pro":                 {"input": 0.030,    "cached_input": 0.0030,    "output": 0.180},
    "gpt-5.4":                     {"input": 0.0025,   "cached_input": 0.00025,   "output": 0.015},
    "gpt-5.4-mini":                {"input": 0.00075,  "cached_input": 0.000075,  "output": 0.0045},
    "gpt-5.4-nano":                {"input": 0.0002,   "cached_input": 0.00002,   "output": 0.00125},
    "gpt-5.2":                     {"input": 0.00175,  "cached_input": 0.000175,  "output": 0.014},
    "gpt-5.1":                     {"input": 0.00125,  "cached_input": 0.000125,  "output": 0.010},
    # GPT-4o family (legacy)
    "gpt-4o":                      {"input": 0.0025,   "cached_input": 0.00125,   "output": 0.010},
    "gpt-4o-mini":                 {"input": 0.00015,  "cached_input": 0.000075,  "output": 0.0006},
    # Realtime audio: text tokens at gpt-5.5 rates; audio tokens billed
    # separately at $32/$64 per 1M (cached audio input at $0.40/M).
    # User audio = 1 token / 100ms; assistant audio = 1 token / 50ms.
    "gpt-realtime-2025-08-28": {
        "input": 0.005, "cached_input": 0.0005, "output": 0.020,
        "audio_input": 0.032, "audio_cached_input": 0.0004, "audio_output": 0.064,
    },
    "gpt-5-realtime-preview": {
        "input": 0.005, "cached_input": 0.0005, "output": 0.020,
        "audio_input": 0.032, "audio_cached_input": 0.0004, "audio_output": 0.064,
    },
    "gpt-realtime": {
        "input": 0.005, "cached_input": 0.0005, "output": 0.020,
        "audio_input": 0.032, "audio_cached_input": 0.0004, "audio_output": 0.064,
    },
}


def _normalize_model(model: str | None) -> str | None:
    """Strip the dated suffix from a returned model name (e.g. ``gpt-5.5-2026-04-23`` -> ``gpt-5.5``).

    OpenAI's API often echoes back a dated build of the requested model
    family. We want pricing keyed off the family name, so peel back any
    trailing ``-YYYY-MM-DD`` (or ``-MM-DD``) segment.
    """
    if not model:
        return model
    if model in _PRICING_USD_PER_1K:
        return model
    # Walk from the right, dropping ``-<chunk>`` segments until we hit
    # a known family or run out of segments.
    parts = model.split("-")
    while len(parts) > 1:
        parts.pop()
        candidate = "-".join(parts)
        if candidate in _PRICING_USD_PER_1K:
            return candidate
    return model


# Per-trace running cost. Keyed by the *root* run id of a LangGraph invocation
# so callers (or ``on_chain_end`` for top-level chains) can read a total.
_RUN_COST_USD: dict[str, float] = {}
# Parent linkage so we can roll a leaf llm cost up to its root chain.
_RUN_PARENT: dict[str, str] = {}
# Per-root-run metadata. Lets ``on_llm_end`` resolve the eval target by
# looking up the metadata that was attached to the top-level chain invocation.
_RUN_METADATA: dict[str, dict[str, Any]] = {}


# Map test-file stems (PYTEST_CURRENT_TEST parsing) to dashboard target names.
_TARGET_BY_TEST_STEM: dict[str, str] = {
    "test_triage": "triage",
    "test_voice_script": "voice_script",
    "test_sms": "sms",
    "test_voicemail": "voicemail",
    "test_orchestrator": "orchestrator",
}


def _target_from_pytest_env() -> str | None:
    """Infer the eval target from the active pytest test id, if any.

    ``PYTEST_CURRENT_TEST`` looks like
    ``tests/evals/test_triage.py::test_triage_case[FIRE alarm at 5 Main] (call)``
    so we take the basename, strip the ``test_`` prefix and ``.py`` suffix.
    """
    cur = os.environ.get("PYTEST_CURRENT_TEST")
    if not cur:
        return None
    # Path portion is everything before "::"
    path_part = cur.split("::", 1)[0]
    stem = Path(path_part).stem
    return _TARGET_BY_TEST_STEM.get(stem)


def _record_eval_cost(target: str | None, cost_usd: float) -> None:
    """Push cost into the test-suite per-target accumulator, if applicable.

    Imported lazily inside the function so the production code path never
    pulls in the ``tests/*`` package. Silent on any failure so a missing
    tests module can never break a real graph invocation.
    """
    if not target or not cost_usd:
        return
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        return
    try:
        from tests.evals._metrics import add_cost  # type: ignore[import-not-found]

        add_cost(target, cost_usd)
    except Exception:  # pragma: no cover - defensive
        pass


def _root_run_id(run_id: str) -> str:
    """Walk the parent chain to find the root run id."""
    seen: set[str] = set()
    cursor = run_id
    while cursor in _RUN_PARENT and cursor not in seen:
        seen.add(cursor)
        cursor = _RUN_PARENT[cursor]
    return cursor


def _compute_cost_usd(
    model: str | None,
    tokens_in: int | None,
    tokens_out: int | None,
    cached_tokens: int | None,
    audio_tokens_in: int | None = None,
    audio_cached_tokens: int | None = None,
    audio_tokens_out: int | None = None,
) -> float:
    """Return USD cost for a single LLM call, rounded to 6 decimals.

    Text tokens (``tokens_in`` / ``cached_tokens`` / ``tokens_out``) bill at
    ``input`` / ``cached_input`` / ``output``. Audio tokens (Realtime API)
    bill at ``audio_input`` / ``audio_cached_input`` / ``audio_output``.
    Unknown models fall back to 0.0 so an unknown family never throws.
    """
    if not model:
        return 0.0
    row = _PRICING_USD_PER_1K.get(_normalize_model(model) or "")
    if not row:
        return 0.0
    in_tokens = int(tokens_in or 0)
    out_tokens = int(tokens_out or 0)
    cached = max(0, min(int(cached_tokens or 0), in_tokens))
    uncached = in_tokens - cached
    aud_in = int(audio_tokens_in or 0)
    aud_out = int(audio_tokens_out or 0)
    aud_cached = max(0, min(int(audio_cached_tokens or 0), aud_in))
    aud_uncached = aud_in - aud_cached
    cost = (
        (uncached / 1000.0) * row["input"]
        + (cached / 1000.0) * row.get("cached_input", row["input"])
        + (out_tokens / 1000.0) * row["output"]
        + (aud_uncached / 1000.0) * row.get("audio_input", 0.0)
        + (aud_cached / 1000.0) * row.get("audio_cached_input", row.get("audio_input", 0.0))
        + (aud_out / 1000.0) * row.get("audio_output", 0.0)
    )
    return round(cost, 6)


def _cached_tokens_from_llm_output(llm_output: dict | None) -> int | None:
    """Extract the cached-token count, if reported by the model."""
    if not isinstance(llm_output, dict):
        return None
    usage = llm_output.get("token_usage") or llm_output.get("usage") or {}
    if not isinstance(usage, dict):
        return None
    details = usage.get("prompt_tokens_details")
    if isinstance(details, dict):
        ct = details.get("cached_tokens")
        if isinstance(ct, int):
            return ct
    return None


def _audio_tokens_from_llm_output(
    llm_output: dict | None,
) -> tuple[int | None, int | None, int | None]:
    """Return (audio_in, audio_cached_in, audio_out) from a Realtime usage payload.

    OpenAI Realtime puts ``input_token_details.audio_tokens`` and
    ``output_token_details.audio_tokens`` inside the usage envelope, and
    cached audio input under ``input_token_details.cached_tokens_details.audio_tokens``.
    """
    if not isinstance(llm_output, dict):
        return None, None, None
    usage = llm_output.get("token_usage") or llm_output.get("usage") or {}
    if not isinstance(usage, dict):
        return None, None, None
    in_det = usage.get("input_token_details") or usage.get("prompt_tokens_details") or {}
    out_det = usage.get("output_token_details") or usage.get("completion_tokens_details") or {}
    audio_in = in_det.get("audio_tokens") if isinstance(in_det, dict) else None
    audio_out = out_det.get("audio_tokens") if isinstance(out_det, dict) else None
    audio_cached = None
    cached_det = (in_det or {}).get("cached_tokens_details") if isinstance(in_det, dict) else None
    if isinstance(cached_det, dict):
        audio_cached = cached_det.get("audio_tokens")
    return (
        audio_in if isinstance(audio_in, int) else None,
        audio_cached if isinstance(audio_cached, int) else None,
        audio_out if isinstance(audio_out, int) else None,
    )


def _name(serialized: dict[str, Any] | None) -> str:
    if not serialized:
        return "<unknown>"
    return (
        serialized.get("name")
        or (serialized.get("id") or [None])[-1]
        or "<unknown>"
    )


def _short(text: str, limit: int = 200) -> str:
    if text is None:
        return ""
    return text if len(text) <= limit else text[:limit] + "..."


def _usage_from_llm_output(llm_output: dict | None) -> tuple[int | None, int | None]:
    """Best-effort extraction of (prompt_tokens, completion_tokens)."""
    if not llm_output:
        return None, None
    usage = (
        llm_output.get("token_usage")
        or llm_output.get("usage")
        or {}
    )
    if not isinstance(usage, dict):
        return None, None
    return (
        usage.get("prompt_tokens") or usage.get("input_tokens"),
        usage.get("completion_tokens") or usage.get("output_tokens"),
    )


def _finish_reason(response: Any) -> str | None:
    try:
        gens = getattr(response, "generations", None) or []
        if gens and gens[0]:
            info = getattr(gens[0][0], "generation_info", None) or {}
            return info.get("finish_reason")
    except Exception:
        return None
    return None


class StructuredLoggingCallbackHandler(BaseCallbackHandler):
    """Emit JSON-friendly log records for every LangChain/LangGraph event."""

    def __init__(self) -> None:
        self._starts: dict[UUID, float] = {}

    # ---- chains / nodes ------------------------------------------------

    def on_chain_start(
        self,
        serialized: dict[str, Any] | None,
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        self._starts[run_id] = time.perf_counter()
        rid = str(run_id)
        if parent_run_id is not None:
            _RUN_PARENT[rid] = str(parent_run_id)
        else:
            # Initialise the cumulative cost bucket for this root trace.
            _RUN_COST_USD.setdefault(rid, 0.0)
            # Stash the root-chain metadata so on_llm_end can find the eval
            # target by walking up to this root run id.
            if metadata:
                _RUN_METADATA[rid] = dict(metadata)
        logger.info(
            "node start",
            extra={
                "node": _name(serialized),
                "run_id": rid,
                "tags": tags or [],
                "metadata": redact(metadata or {}),
            },
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        duration_ms = self._elapsed_ms(run_id)
        rid = str(run_id)
        extra: dict[str, Any] = {"run_id": rid, "duration_ms": duration_ms}
        # Only top-level chains emit cost_total_usd (no parent in the map).
        if rid not in _RUN_PARENT:
            total = _RUN_COST_USD.pop(rid, 0.0)
            _RUN_METADATA.pop(rid, None)
            extra["cost_total_usd"] = round(total, 6)
        else:
            # Internal node: drop the parent linkage now that it's done.
            _RUN_PARENT.pop(rid, None)
        logger.info("node end", extra=extra)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        duration_ms = self._elapsed_ms(run_id)
        rid = str(run_id)
        # Best-effort cleanup so errored chains don't leak cost state.
        if rid not in _RUN_PARENT:
            _RUN_COST_USD.pop(rid, None)
        else:
            _RUN_PARENT.pop(rid, None)
        logger.error(
            "node error",
            extra={
                "run_id": rid,
                "duration_ms": duration_ms,
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )

    # ---- llm -----------------------------------------------------------

    def on_llm_start(
        self,
        serialized: dict[str, Any] | None,
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        invocation_params: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        self._starts[run_id] = time.perf_counter()
        if parent_run_id is not None:
            _RUN_PARENT[str(run_id)] = str(parent_run_id)
        model = (invocation_params or {}).get("model") or _name(serialized)
        approx_tokens = sum(len(p) for p in prompts) // 4  # rough heuristic
        logger.info(
            "llm start",
            extra={
                "run_id": str(run_id),
                "model": model,
                "prompt_tokens_estimate": approx_tokens,
            },
        )

    def on_chat_model_start(
        self,
        serialized: dict[str, Any] | None,
        messages: list[list[Any]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        invocation_params: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        # Treat chat models the same way as raw LLMs for accounting purposes.
        self._starts[run_id] = time.perf_counter()
        if parent_run_id is not None:
            _RUN_PARENT[str(run_id)] = str(parent_run_id)
        model = (invocation_params or {}).get("model") or _name(serialized)
        approx_tokens = 0
        try:
            for batch in messages:
                for m in batch:
                    approx_tokens += len(getattr(m, "content", "") or "") // 4
        except Exception:
            pass
        logger.info(
            "llm start",
            extra={
                "run_id": str(run_id),
                "model": model,
                "prompt_tokens_estimate": approx_tokens,
            },
        )

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        latency_ms = self._elapsed_ms(run_id)
        llm_output = getattr(response, "llm_output", None) or {}
        tokens_in, tokens_out = _usage_from_llm_output(llm_output)
        model = llm_output.get("model_name") if isinstance(llm_output, dict) else None
        cached_tokens = _cached_tokens_from_llm_output(llm_output)
        audio_in, audio_cached, audio_out = _audio_tokens_from_llm_output(llm_output)
        cost_usd = _compute_cost_usd(
            model, tokens_in, tokens_out, cached_tokens,
            audio_in, audio_cached, audio_out,
        )

        # Roll up into the cumulative cost for this trace's root run.
        rid = str(run_id)
        root = _root_run_id(rid)
        if root in _RUN_COST_USD:
            _RUN_COST_USD[root] = round(_RUN_COST_USD[root] + cost_usd, 6)
        # Drop the leaf's parent linkage; the chain itself keeps its own.
        _RUN_PARENT.pop(rid, None)

        # If we're inside a pytest eval run, push this LLM cost into the
        # per-target accumulator so the dashboard summary reflects it.
        # Prefer the file-stem heuristic; fall back to the ``target`` value
        # the test put on the root chain's metadata.
        target = _target_from_pytest_env()
        if not target:
            root_meta = _RUN_METADATA.get(root) or {}
            meta_target = root_meta.get("target")
            if isinstance(meta_target, str):
                target = meta_target
        _record_eval_cost(target, cost_usd)

        # Emit to the persistent cost ledger (fire-and-forget; never
        # block the hot path on the writer).
        try:
            from graph.cost_ledger import emit_cost_event

            root_meta = _RUN_METADATA.get(root) or {}
            emit_cost_event(
                run_id=rid,
                root_run_id=root,
                agent=root_meta.get("target") or root_meta.get("agent"),
                source="langchain",
                model=model,
                tokens_in=tokens_in,
                cached_tokens=cached_tokens,
                tokens_out=tokens_out,
                audio_tokens_in=audio_in,
                audio_cached_tokens=audio_cached,
                audio_tokens_out=audio_out,
                cost_usd=cost_usd,
                latency_ms=latency_ms,
                correlation_id=root_meta.get("correlation_id"),
            )
        except Exception:
            pass

        extras: dict[str, Any] = {
            "run_id": rid,
            "latency_ms": latency_ms,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "finish_reason": _finish_reason(response),
        }
        if cached_tokens is not None:
            extras["cached_tokens"] = cached_tokens
        if audio_in or audio_out:
            extras["audio_tokens_in"] = audio_in
            extras["audio_tokens_out"] = audio_out
            if audio_cached:
                extras["audio_cached_tokens"] = audio_cached
        logger.info("llm end", extra=extras)

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        latency_ms = self._elapsed_ms(run_id)
        _RUN_PARENT.pop(str(run_id), None)
        logger.error(
            "llm error",
            extra={
                "run_id": str(run_id),
                "latency_ms": latency_ms,
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )

    # ---- tools ---------------------------------------------------------

    def on_tool_start(
        self,
        serialized: dict[str, Any] | None,
        input_str: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._starts[run_id] = time.perf_counter()
        logger.info(
            "tool start",
            extra={
                "run_id": str(run_id),
                "tool_name": _name(serialized),
                "tool_args": redact(_short(input_str)),
            },
        )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        latency_ms = self._elapsed_ms(run_id)
        logger.info(
            "tool end",
            extra={"run_id": str(run_id), "latency_ms": latency_ms},
        )

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        latency_ms = self._elapsed_ms(run_id)
        logger.error(
            "tool error",
            extra={
                "run_id": str(run_id),
                "latency_ms": latency_ms,
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )

    # ---- internal ------------------------------------------------------

    def _elapsed_ms(self, run_id: UUID) -> int | None:
        started = self._starts.pop(run_id, None)
        if started is None:
            return None
        return int((time.perf_counter() - started) * 1000)


def default_callbacks() -> list[BaseCallbackHandler]:
    """Return the default callback list for sub-graph invocations."""
    return [StructuredLoggingCallbackHandler()]


__all__ = ["StructuredLoggingCallbackHandler", "default_callbacks"]
