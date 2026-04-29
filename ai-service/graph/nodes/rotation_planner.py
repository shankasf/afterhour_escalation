# Builds escalation ladder from backend - prompt-free node.
from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from graph.state import Contact, IncidentState
from graph.tools import get_current_rotation, get_escalation_ladder


async def rotation_planner(state: IncidentState, config: RunnableConfig) -> dict:
    rotation = await get_current_rotation()
    ladder_resp = await get_escalation_ladder()

    contacts: list[Contact] = []
    if rotation.success and rotation.primary_phone:
        contacts.append(Contact(level=1, role="Primary On-Call",
                                name=rotation.primary_name, phone=rotation.primary_phone))
    if rotation.success and rotation.secondary_phone:
        contacts.append(Contact(level=2, role="Secondary On-Call",
                                name=rotation.secondary_name or "Secondary",
                                phone=rotation.secondary_phone))

    used_levels = {c.level for c in contacts}
    for c in (ladder_resp.contacts or []):
        if c.level in used_levels:
            continue
        contacts.append(Contact(level=c.level, role=c.role, name=c.name,
                                phone=c.phone, email=c.email,
                                is_available=c.is_available))

    contacts.sort(key=lambda c: c.level)
    return {"ladder": contacts, "cursor": 0, "status": "outreach"}
