"""Raw OpenAI async client + small helpers.

Kept for the legacy nodes under ``graph/nodes/`` (e.g. triage.py, outreach.py)
which still hit the OpenAI HTTP API directly. New code should prefer
``graph.llm.get_chat_model(...)`` so that LangSmith tracing happens
automatically.
"""

from __future__ import annotations

import os
from typing import Literal

from openai import AsyncOpenAI

_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.environ.get("OPENAI_API_KEY"),
            timeout=30.0,
            max_retries=2,
        )
    return _client


def get_openai_model() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-5.5")


Tier = Literal["triage", "voice", "sms", "voicemail", "orchestrator", "customer_dialog"]


def get_model_for_tier(tier: Tier) -> str:
    """Resolve the model name for a given tier.

    Mirrors ``graph.llm._resolve_model`` so that any legacy callers
    using the raw OpenAI client follow the same env conventions as
    the LangChain chat models.
    """
    env_key = f"OPENAI_MODEL_{tier.upper()}"
    return (
        os.environ.get(env_key)
        or os.environ.get("OPENAI_MODEL")
        or "gpt-5.5"
    )
