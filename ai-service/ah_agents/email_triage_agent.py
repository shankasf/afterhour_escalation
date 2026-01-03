"""Email Triage Agent - Classifies emails and determines emergency scores.

Uses OpenAI Agents SDK pattern from instruction.txt:
    from agents import Agent, Runner
    agent = Agent(name="...", instructions="...")
    result = await Runner.run(agent, input="...")
"""

import logging
import os
import re
from typing import Dict, Any, List, Optional

from pydantic import BaseModel, Field
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_MODEL = "gpt-5.2"


class TriageOutput(BaseModel):
    """Structured output for email triage."""
    score: float = Field(ge=0.0, le=1.0, description="Emergency score 0-1")
    reasoning: str = Field(default="", description="Brief explanation")
    location: Optional[str] = Field(None, description="Property/location if identified")
    equipment: Optional[str] = Field(None, description="Equipment/system involved")
    is_safety_critical: Optional[bool] = Field(None, description="Life/safety threat")


# Keywords for fallback scoring
CRITICAL_KEYWORDS = {
    "no power": 0.9, "power outage": 0.9, "flood": 0.95, "flooding": 0.95,
    "leak": 0.85, "water leak": 0.9, "fire alarm": 0.95, "fire": 0.9,
    "hvac failure": 0.85, "no heat": 0.85, "no cooling": 0.8, "no ac": 0.8,
    "elevator stuck": 0.9, "security breach": 0.9, "break-in": 0.9,
    "can't operate": 0.85, "cannot operate": 0.85, "emergency": 0.75,
}

URGENT_KEYWORDS = {
    "urgent": 0.7, "immediately": 0.65, "asap": 0.6, "offline": 0.6,
    "after hours": 0.5, "not working": 0.5, "broken": 0.5, "failed": 0.55,
}

NEGATIVE_KEYWORDS = {
    "pm": 0.3, "preventive maintenance": 0.4, "scheduled": 0.35, "routine": 0.4,
    "cosmetic": 0.3, "minor": 0.25, "when convenient": 0.3, "no rush": 0.4,
}


class EmailTriageAgent:
    """Agent for classifying emails and determining emergency scores."""

    def __init__(self):
        self._agent = None
        self._init_agent()

    def _init_agent(self):
        """Initialize the OpenAI Agent following instruction.txt pattern."""
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using keyword-only scoring")
            return

        os.environ.setdefault("OPENAI_API_KEY", api_key)

        try:
            from agents import Agent

            self._agent = Agent(
                name="Email Triage Agent",
                instructions=(
                    "You are an emergency triage system for after-hours maintenance requests. "
                    "Analyze emails and return an urgency score (0-1) with reasoning.\n\n"
                    "SCORING GUIDELINES:\n"
                    "- 0.9-1.0: Life safety (fire, flood, security breach, entrapment)\n"
                    "- 0.7-0.9: Critical ops (power outage, HVAC failure, can't operate)\n"
                    "- 0.5-0.7: Urgent but not critical (broken equipment, offline systems)\n"
                    "- 0.3-0.5: Can wait (degraded service, minor issues)\n"
                    "- 0.0-0.3: Routine (scheduled, preventive, low priority)"
                ),
                model=_MODEL,
                output_type=TriageOutput,
            )
            logger.info(f"Email Triage Agent initialized with model={_MODEL}")
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")

    async def classify(self, subject: str, body: str, sender_domain: str = "") -> Dict[str, Any]:
        """Classify an email and return emergency score with context."""
        full_text = f"{subject}\n{body}".lower()
        keyword_score = self._keyword_score(full_text)
        indicators = self._extract_indicators(full_text)

        if self._agent:
            try:
                from agents import Runner

                prompt = (
                    f"Analyze this after-hours maintenance email:\n\n"
                    f"Subject: {subject}\n"
                    f"Body: {body}\n"
                    f"Sender: {sender_domain}\n\n"
                    "Provide emergency score and reasoning."
                )
                result = await Runner.run(self._agent, prompt)
                output: TriageOutput = result.final_output

                # Combine AI and keyword scores
                combined_score = (output.score * 0.6) + (keyword_score * 0.4)

                return {
                    "emergency_score": min(1.0, combined_score),
                    "extracted_context": {
                        "location": output.location,
                        "equipment": output.equipment,
                        "is_safety_critical": output.is_safety_critical,
                    },
                    "urgency_indicators": indicators,
                    "reasoning": output.reasoning,
                    "keyword_score": keyword_score,
                    "ai_score": output.score,
                }
            except Exception as e:
                logger.error(f"AI classification failed: {e}")

        # Fallback to keyword-only
        return {
            "emergency_score": keyword_score,
            "extracted_context": self._extract_context(full_text),
            "urgency_indicators": indicators,
            "reasoning": "Keyword-based scoring (AI unavailable)",
            "keyword_score": keyword_score,
        }

    def _keyword_score(self, text: str) -> float:
        """Calculate score based on keyword matching."""
        score = 0.0
        matches = 0

        for keyword, weight in CRITICAL_KEYWORDS.items():
            if keyword in text:
                score += weight
                matches += 1

        for keyword, weight in URGENT_KEYWORDS.items():
            if keyword in text:
                score += weight * 0.7
                matches += 1

        reduction = sum(w for kw, w in NEGATIVE_KEYWORDS.items() if kw in text)

        if matches > 0:
            base = score / matches
            return min(1.0, max(0, base - (reduction * 0.5)))
        return 0.3

    def _extract_indicators(self, text: str) -> List[str]:
        """Extract matched urgency keywords."""
        all_kw = {**CRITICAL_KEYWORDS, **URGENT_KEYWORDS}
        return [kw for kw in all_kw if kw in text]

    def _extract_context(self, text: str) -> Dict[str, Any]:
        """Extract basic context from text."""
        context = {}

        # Location patterns
        for pattern in [r"at\s+(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd))", r"location[:\s]+([^\n,]+)"]:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                context["location"] = match.group(1).strip()
                break

        # Equipment
        for eq in ["hvac", "elevator", "boiler", "generator", "pump", "ac", "heater"]:
            if eq in text:
                context["equipment"] = eq.upper()
                break

        return context
