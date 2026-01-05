"""Backend query/tools used by Agents.

This package mirrors the pattern used in `app_agents/*`:
- "queries" are tool functions (often network/DB calls)
- "agents" are declarative `Agent(...)` definitions that use those tools

All tool functions are compatible with the OpenAI Agents SDK `function_tool` decorator.
If the SDK isn't installed, the decorator becomes a no-op so imports don't crash.

IMPORTANT: The decorated functions remain directly callable as async functions,
while also being usable as agent tools.
"""

from __future__ import annotations

from functools import wraps
from typing import Callable, TypeVar

TFunc = TypeVar("TFunc", bound=Callable)


try:
    from agents import function_tool as _function_tool
except Exception:  # pragma: no cover
    _function_tool = None


def function_tool(func: TFunc) -> TFunc:
    """Safe wrapper around Agents SDK `function_tool`.

    Keeps the service importable even when the Agents SDK isn't present.
    Also ensures the decorated function remains directly callable as an async function.
    """

    if _function_tool is None:
        return func

    # Create the FunctionTool for agent use
    tool = _function_tool(func)

    # Create a wrapper that's callable but also acts as a FunctionTool
    @wraps(func)
    async def wrapper(*args, **kwargs):
        return await func(*args, **kwargs)

    # Copy FunctionTool attributes so it can be used as an agent tool
    wrapper.__tool__ = tool
    wrapper.name = getattr(tool, 'name', func.__name__)

    # Make it usable in agent tools list by giving it the same interface
    for attr in ['params_json_schema', 'on_invoke_tool', 'strict_json_schema']:
        if hasattr(tool, attr):
            setattr(wrapper, attr, getattr(tool, attr))

    return wrapper
