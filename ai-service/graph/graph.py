from __future__ import annotations

import logging
import os
from typing import Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from graph.state import IncidentState
from graph.nodes import (
    intake,
    triage,
    after_hours_gate,
    rotation_planner,
    outreach,
    wait_for_ack,
    response_interpreter,
    callback_handler,
    customer_chat_dialog,
    customer_status_update,
    resolution,
    exhaustion,
    customer_callback,
)

logger = logging.getLogger(__name__)


def _route_after_gate(state: IncidentState) -> str:
    status = state.get("status", "")
    if status == "after_hours_blocked":
        return "customer_status_update"
    if status == "closed":
        return "__end__"
    return "rotation_planner"


def _route_source(state: IncidentState) -> str:
    if state.get("source") == "chat":
        return "customer_chat_dialog"
    return "after_hours_gate"


def _route_after_chat(state: IncidentState) -> str:
    triage_obj = state.get("triage")
    if triage_obj and triage_obj.decision == "escalate":
        return "after_hours_gate"
    return "__end__"


def _route_outreach(state: IncidentState) -> str:
    if state.get("status") == "exhausted":
        return "exhaustion"
    return "wait_for_ack"


def _route_after_interpret(state: IncidentState) -> str:
    status = state.get("status", "")
    if status == "acknowledged":
        return "resolution"
    if status == "awaiting_callback":
        return "callback_handler"
    if status == "exhausted":
        return "exhaustion"
    if status == "outreach":
        return "outreach"
    return "wait_for_ack"


def build_graph(checkpointer):
    g = StateGraph(IncidentState)

    g.add_node("intake", intake)
    g.add_node("triage", triage)
    g.add_node("after_hours_gate", after_hours_gate)
    g.add_node("rotation_planner", rotation_planner)
    g.add_node("outreach", outreach)
    g.add_node("wait_for_ack", wait_for_ack)
    g.add_node("response_interpreter", response_interpreter)
    g.add_node("callback_handler", callback_handler)
    g.add_node("customer_chat_dialog", customer_chat_dialog)
    g.add_node("customer_status_update", customer_status_update)
    g.add_node("resolution", resolution)
    g.add_node("exhaustion", exhaustion)
    g.add_node("customer_callback", customer_callback)

    g.add_edge(START, "intake")
    g.add_conditional_edges("intake", _route_source,
                             {"customer_chat_dialog": "customer_chat_dialog",
                              "after_hours_gate": "triage"})
    g.add_edge("triage", "after_hours_gate")
    g.add_conditional_edges("customer_chat_dialog", _route_after_chat,
                             {"after_hours_gate": "triage", "__end__": END})
    g.add_conditional_edges("after_hours_gate", _route_after_gate,
                             {"rotation_planner": "rotation_planner",
                              "customer_status_update": "customer_status_update",
                              "__end__": END})
    g.add_edge("rotation_planner", "outreach")
    g.add_conditional_edges("outreach", _route_outreach,
                             {"wait_for_ack": "wait_for_ack", "exhaustion": "exhaustion"})
    g.add_edge("wait_for_ack", "response_interpreter")
    g.add_conditional_edges("response_interpreter", _route_after_interpret,
                             {"resolution": "resolution",
                              "callback_handler": "callback_handler",
                              "exhaustion": "exhaustion",
                              "outreach": "outreach",
                              "wait_for_ack": "wait_for_ack"})
    g.add_edge("callback_handler", "customer_callback")
    g.add_edge("customer_callback", "wait_for_ack")
    g.add_edge("resolution", "customer_status_update")
    g.add_edge("exhaustion", "customer_status_update")
    g.add_edge("customer_status_update", END)

    return g.compile(checkpointer=checkpointer, interrupt_before=["wait_for_ack"])


_compiled = None
_pool: AsyncConnectionPool | None = None
_checkpointer = None


async def init_graph() -> None:
    """Initialize the LangGraph checkpointer + compiled graph for the FastAPI lifespan.

    Uses an AsyncConnectionPool so dropped Postgres connections are transparently
    replaced — a single long-lived AsyncConnection (the from_conn_string default)
    silently dies on idle/keepalive timeouts and breaks every subsequent graph call.

    Idempotent: subsequent calls return immediately.
    """
    global _compiled, _pool, _checkpointer
    if _compiled is not None:
        return

    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        pool = AsyncConnectionPool(
            conninfo=db_url,
            min_size=1,
            max_size=20,
            max_idle=300,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
            },
            open=False,
        )
        await pool.open(wait=True)
        checkpointer = AsyncPostgresSaver(pool)
        try:
            await checkpointer.setup()
        except Exception as exc:
            logger.warning("AsyncPostgresSaver.setup() failed (may already exist): %s", exc)
        _pool = pool
        _checkpointer = checkpointer
        logger.info("LangGraph checkpointer: AsyncPostgresSaver(pool min=1 max=20)")
    else:
        _checkpointer = MemorySaver()
        logger.warning("DATABASE_URL not set; using in-memory checkpointer (state lost on restart)")

    _compiled = build_graph(_checkpointer)


async def close_graph() -> None:
    """Tear down the checkpointer connection pool on shutdown."""
    global _compiled, _pool, _checkpointer
    if _pool is not None:
        try:
            await _pool.close()
        except Exception as exc:
            logger.warning("Error closing checkpointer pool: %s", exc)
        _pool = None
    _checkpointer = None
    _compiled = None


def get_graph():
    """Return the compiled graph. Must be called after init_graph()."""
    if _compiled is None:
        raise RuntimeError(
            "LangGraph not initialized. init_graph() must be awaited at FastAPI startup."
        )
    return _compiled
