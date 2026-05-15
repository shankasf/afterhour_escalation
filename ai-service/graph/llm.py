"""LangChain chat model factory for LangGraph nodes.

Single source of truth for every `ChatOpenAI` instance used in the
sub-graphs under ``graph/subgraphs/``.

Per-purpose model selection:
    OPENAI_MODEL_<PURPOSE>  (e.g. OPENAI_MODEL_TRIAGE)
    OPENAI_MODEL            (global fallback)
    "gpt-5.5"               (final fallback)

LangSmith tracing is automatic. When the environment variables
``LANGSMITH_TRACING=true``, ``LANGSMITH_API_KEY`` and
``LANGSMITH_PROJECT`` are set, every ``.ainvoke()`` on the returned
``ChatOpenAI`` instance is recorded by the ``langsmith`` SDK without
any additional code. We rely on that env-driven behavior here and
deliberately do *not* configure tracing in code.
"""

from __future__ import annotations

import os
from typing import Literal

from langchain_openai import ChatOpenAI


Purpose = Literal[
    "triage",
    "voice",
    "sms",
    "voicemail",
    "orchestrator",
    "customer_dialog",
]


_DEFAULT_TEMPERATURES: dict[str, float] = {
    "triage": 0.2,
    "voice": 0.6,
    "sms": 0.6,
    "voicemail": 0.3,
    "orchestrator": 0.3,
    "customer_dialog": 0.4,
}


def _resolve_model(purpose: str) -> str:
    """Resolve the model name for a given purpose.

    Order: OPENAI_MODEL_<PURPOSE> -> OPENAI_MODEL -> "gpt-5.5".
    """
    purpose_key = f"OPENAI_MODEL_{purpose.upper()}"
    return (
        os.environ.get(purpose_key)
        or os.environ.get("OPENAI_MODEL")
        or "gpt-5.5"
    )


def get_chat_model(
    purpose: Purpose,
    temperature: float | None = None,
    *,
    streaming: bool = False,
    timeout: float = 15.0,
    max_retries: int = 2,
) -> ChatOpenAI:
    """Return a configured ``ChatOpenAI`` for the given purpose.

    Args:
        purpose: One of the supported purposes (triage, voice, sms,
            voicemail, orchestrator, customer_dialog).
        temperature: Optional override. Falls back to the per-purpose
            default in ``_DEFAULT_TEMPERATURES``.
        streaming: Whether to enable token streaming.
        timeout: Per-request timeout in seconds.
        max_retries: Number of retry attempts on transient errors.
    """
    if purpose not in _DEFAULT_TEMPERATURES:
        raise ValueError(f"Unknown purpose: {purpose!r}")

    temp = temperature if temperature is not None else _DEFAULT_TEMPERATURES[purpose]
    model = _resolve_model(purpose)

    return ChatOpenAI(
        model=model,
        temperature=temp,
        timeout=timeout,
        max_retries=max_retries,
        streaming=streaming,
        api_key=os.environ.get("OPENAI_API_KEY"),
    )


__all__ = ["get_chat_model", "Purpose"]
