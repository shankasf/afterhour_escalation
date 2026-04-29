from __future__ import annotations

import logging
import os
from typing import Optional

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.postgres import PostgresSaver

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


def build_graph(checkpointer) -> "StateGraph":
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
_checkpointer_cm = None


def get_graph():
    global _compiled, _checkpointer_cm
    if _compiled is not None:
        return _compiled

    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        _checkpointer_cm = PostgresSaver.from_conn_string(db_url)
        checkpointer = _checkpointer_cm.__enter__()
        try:
            checkpointer.setup()
        except Exception as e:
            logger.warning("PostgresSaver.setup() failed (may already exist): %s", e)
    else:
        # Fall back to in-memory if no DATABASE_URL - useful for local boot/import checks.
        from langgraph.checkpoint.memory import MemorySaver
        checkpointer = MemorySaver()
        logger.warning("DATABASE_URL not set; using in-memory checkpointer")

    _compiled = build_graph(checkpointer)
    return _compiled
