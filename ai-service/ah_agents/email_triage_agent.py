"""Email Triage Agent — façade that delegates to the LangGraph triage sub-graph.

Public API preserved for the routes/email_poller callers:
    - ``EmailTriageAgent.classify(subject, body, sender_domain) -> dict``
    - ``classify_email(subject, body, sender_domain, keywords) -> dict``
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, Field

from config import get_settings

# Sub-graph contract owned by Agent 1.
from graph.subgraphs import triage_graph
from graph.callbacks import default_callbacks

logger = logging.getLogger(__name__)
settings = get_settings()


class TriageOutput(BaseModel):
    """Structured shape kept for any external consumer that still imports it."""

    score: float = Field(ge=0.0, le=1.0, description="Emergency score 0-1")
    reasoning: str = Field(default="", description="Brief explanation")
    summary: str = Field(default="", description="One-line summary of the email")
    is_service_related: bool = Field(default=False, description="Is this about property/maintenance service")
    location: Optional[str] = Field(None, description="Property/location if identified")
    equipment: Optional[str] = Field(None, description="Equipment/system involved")
    is_safety_critical: Optional[bool] = Field(None, description="Life/safety threat")


async def classify_email(
    subject: str,
    body: str,
    sender_domain: str = "",
    keywords: Optional[list] = None,
) -> dict:
    """Classify an email and return emergency score with context.

    Delegates to ``triage_graph``. The keyword fallback that used to live here
    is no longer needed at the façade layer because the sub-graph returns a
    reasonable default on LLM failure.
    """

    logger.info("=" * 60)
    logger.info("[EMAIL TRIAGE AGENT] Starting classification")
    logger.info(
        f"  Subject: {subject[:80]}..." if len(subject or '') > 80 else f"  Subject: {subject}"
    )
    logger.info(f"  Sender Domain: {sender_domain}")
    logger.info(f"  Body Length: {len(body or '')} chars")

    result = await triage_graph.ainvoke(
        {
            "subject": subject,
            "body": body,
            "sender_domain": sender_domain,
            "keywords": keywords or [],
        },
        config={
            "callbacks": default_callbacks(),
            "tags": ["email_triage", "after-hours-agent"],
            "metadata": {"sender_domain": sender_domain},
            "run_name": "email_triage",
        },
    )

    logger.info(f"  Service Related: {result.get('is_service_related')}")
    logger.info(f"  Score: {float(result.get('emergency_score', 0.0)):.2f}")
    logger.info(f"  Summary: {result.get('summary')}")
    logger.info(f"  Safety Critical: {result.get('is_safety_critical')}")
    logger.info("[EMAIL TRIAGE AGENT] Classification complete")
    logger.info("=" * 60)

    return {
        "emergency_score": result["emergency_score"],
        "is_service_related": result["is_service_related"],
        "summary": result["summary"],
        "extracted_context": {
            "location": result.get("location"),
            "equipment": result.get("equipment"),
            "is_safety_critical": result.get("is_safety_critical"),
        },
        "reasoning": result["reasoning"],
    }


class EmailTriageAgent:
    """Backward-compatible wrapper used by routes and the email poller."""

    async def classify(self, subject: str, body: str, sender_domain: str = "") -> dict:
        keywords = await self._fetch_keywords()
        return await classify_email(subject, body, sender_domain, keywords)

    async def _fetch_keywords(self) -> list:
        try:
            from services.http_client import get_http_client

            http_client = get_http_client()
            response = await http_client.get(
                f"{settings.backend_url}/api/settings/keywords",
                headers={"x-internal-key": settings.internal_api_key},
                timeout=5.0,
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.debug(f"Could not fetch keywords: {e}")
        return []
