"""Backend query tools for LangGraph nodes.

Each query function is decorated with `@tool` (a thin wrapper around
`langchain_core.tools.tool`) so it can be used in two ways:

1. As a plain async function:
       await lookup_user_by_phone(phone_number)

2. As a LangChain `BaseTool` for `create_react_agent` / LangGraph tool nodes:
       lookup_user_by_phone.as_tool

The wrapper preserves direct-callability (existing callers like
`AckMonitorAgent`, `EscalationAgent`, and `graph/tools.py` await the function
directly) while still exposing the BaseTool interface via the `.as_tool`
attribute.
"""

from __future__ import annotations

from typing import Callable, TypeVar

from langchain_core.tools import tool as _lc_tool

TFunc = TypeVar("TFunc", bound=Callable)


def tool(func: TFunc) -> TFunc:
    """Decorator that makes ``func`` usable as both a plain async function
    and a LangChain ``BaseTool``.

    The returned object is the original coroutine function (so
    ``await func(arg)`` keeps working). The associated ``BaseTool`` is
    attached as ``.as_tool`` for use with LangGraph's
    ``create_react_agent`` or any tool-node that expects a ``BaseTool``.
    """

    lc_tool = _lc_tool(func)
    func.as_tool = lc_tool  # type: ignore[attr-defined]
    func.name = lc_tool.name  # type: ignore[attr-defined]
    return func


__all__ = ["tool"]
