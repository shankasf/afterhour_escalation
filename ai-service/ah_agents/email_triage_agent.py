"""Email Triage Agent - Classifies emails and determines emergency scores."""

import logging
from typing import Optional

from pydantic import BaseModel, Field
from agents import Agent, Runner

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class TriageOutput(BaseModel):
    """Structured output for email triage."""
    score: float = Field(ge=0.0, le=1.0, description="Emergency score 0-1")
    reasoning: str = Field(default="", description="Brief explanation")
    summary: str = Field(default="", description="One-line summary of the email")
    is_service_related: bool = Field(default=False, description="Is this about property/maintenance service")
    location: Optional[str] = Field(None, description="Property/location if identified")
    equipment: Optional[str] = Field(None, description="Equipment/system involved")
    is_safety_critical: Optional[bool] = Field(None, description="Life/safety threat")


def create_email_triage_agent() -> Agent:
    """Create the LLM agent that triages emails for emergencies."""

    return Agent(
        name="EmailTriageAgent",
        model="gpt-5.2",
        output_type=TriageOutput,
        instructions="""You are an emergency triage system for after-hours property maintenance requests.

Your job is to analyze emails and determine:
1. Is this email related to property/building maintenance services?
2. If yes, how urgent is it?

IMPORTANT: Many emails will be spam, promotional, banking notifications, newsletters, etc.
These are NOT service-related and should get a score of 0.0-0.1.

ONLY emails about property maintenance, building issues, or facility emergencies are relevant.

SCORING GUIDELINES:
- 0.0-0.1: NOT service-related (spam, promotions, banking, newsletters, personal emails)
- 0.1-0.3: Service-related but routine/low priority (scheduled maintenance, minor cosmetic)
- 0.3-0.5: Service-related, can wait until business hours (degraded service, non-critical)
- 0.5-0.7: Urgent but not critical (broken equipment affecting operations, offline systems)
- 0.7-0.9: Critical operations impact (power outage, HVAC failure, can't operate)
- 0.9-1.0: Life safety emergency (fire, flood, gas leak, security breach, someone trapped)

EXAMPLES OF NON-SERVICE EMAILS (score 0.0-0.1):
- Bank transaction notifications, UPI/payment confirmations
- Marketing emails, newsletters, social media notifications
- Order confirmations, shipping updates, password resets

EXAMPLES OF SERVICE EMAILS:
- "Fire alarm going off at 123 Main St" -> 0.95
- "No power in building" -> 0.9
- "Water leak in basement" -> 0.85
- "AC not working, it's 95 degrees" -> 0.75
- "Elevator making strange noise" -> 0.5
- "Light bulb out in lobby" -> 0.2

Always provide a one-line summary of the email content.""",
    )


# Singleton instance (module-level)
email_triage_agent = create_email_triage_agent()


# Backward-compatible alias
get_email_triage_agent = create_email_triage_agent


async def classify_email(
    subject: str,
    body: str,
    sender_domain: str = "",
    keywords: list = None,
) -> dict:
    """Classify an email and return emergency score with context."""
    logger.info("=" * 60)
    logger.info("[EMAIL TRIAGE AGENT] Starting classification")
    logger.info(f"  Subject: {subject[:80]}..." if len(subject) > 80 else f"  Subject: {subject}")
    logger.info(f"  Sender Domain: {sender_domain}")
    logger.info(f"  Body Length: {len(body)} chars")

    try:
        # Truncate body if too long
        truncated_body = body[:3000] if len(body) > 3000 else body

        # Build prompt with keywords if available
        prompt = (
            f"Analyze this email and determine if it's a property/maintenance service request:\n\n"
            f"FROM: {sender_domain}\n"
            f"SUBJECT: {subject}\n\n"
            f"BODY:\n{truncated_body}\n\n"
        )

        if keywords:
            prompt += _format_keywords(keywords)

        prompt += "Provide: is_service_related, score (0-1), summary, and reasoning."

        result = await Runner.run(email_triage_agent, prompt)
        output: TriageOutput = result.final_output

        logger.info(f"  Service Related: {output.is_service_related}")
        logger.info(f"  Score: {output.score:.2f}")
        logger.info(f"  Summary: {output.summary}")
        logger.info(f"  Safety Critical: {output.is_safety_critical}")
        logger.info("[EMAIL TRIAGE AGENT] Classification complete")
        logger.info("=" * 60)

        return {
            "emergency_score": output.score,
            "is_service_related": output.is_service_related,
            "summary": output.summary,
            "extracted_context": {
                "location": output.location,
                "equipment": output.equipment,
                "is_safety_critical": output.is_safety_critical,
            },
            "reasoning": output.reasoning,
        }
    except Exception as e:
        logger.error(f"[EMAIL TRIAGE AGENT] Classification failed: {e}")
        # Fallback to keyword scoring
        score = _fallback_score(f"{subject}\n{body}".lower(), keywords)
        return {
            "emergency_score": score,
            "is_service_related": score > 0.3,
            "summary": subject[:100],
            "extracted_context": {},
            "reasoning": f"Fallback scoring (error: {e})",
        }


def _format_keywords(keywords: list) -> str:
    """Format keywords into a prompt section."""
    if not keywords:
        return ""
    lines = ["EMERGENCY KEYWORDS (use for scoring):"]
    for kw in sorted(keywords, key=lambda x: x.get("weight", 0), reverse=True)[:20]:
        keyword = kw.get("keyword", "")
        weight = kw.get("weight", 1.0)
        score = min(1.0, weight / 2.0)
        lines.append(f"  - '{keyword}' -> ~{score:.1f}")
    return "\n".join(lines) + "\n\n"


def _fallback_score(text: str, keywords: list = None) -> float:
    """Fallback scoring when AI unavailable."""
    if keywords:
        for kw in keywords:
            if kw.get("keyword", "").lower() in text:
                return min(1.0, kw.get("weight", 1.0) / 2.0)

    critical = ["fire", "flood", "leak", "no power", "gas leak", "emergency"]
    for kw in critical:
        if kw in text:
            return 0.85

    urgent = ["urgent", "hvac", "no heat", "broken", "not working"]
    for kw in urgent:
        if kw in text:
            return 0.6

    service = ["maintenance", "repair", "building", "property"]
    for kw in service:
        if kw in text:
            return 0.3

    return 0.1


# Wrapper class for backward compatibility
class EmailTriageAgent:
    """Wrapper for backward compatibility."""

    async def classify(self, subject: str, body: str, sender_domain: str = "") -> dict:
        # Fetch keywords from backend
        keywords = await self._fetch_keywords()
        return await classify_email(subject, body, sender_domain, keywords)

    async def _fetch_keywords(self) -> list:
        try:
            from services.http_client import get_http_client
            http_client = get_http_client()
            response = await http_client.get(
                f"{settings.backend_url}/api/settings/keywords",
                headers={"x-internal-key": settings.internal_api_key},
                timeout=5.0
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.debug(f"Could not fetch keywords: {e}")
        return []
