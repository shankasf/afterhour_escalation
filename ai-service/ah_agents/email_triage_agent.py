import logging
import os
import re
from typing import Dict, Any, List, Optional

from pydantic import BaseModel, Field

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


_MODEL = "gpt-5.2"  # locked per project requirement


class _EmailContext(BaseModel):
    location: Optional[str] = None
    equipment: Optional[str] = None
    issue_description: Optional[str] = None
    is_safety_critical: Optional[bool] = None


class _EmailTriageLLMOutput(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    context: _EmailContext = Field(default_factory=_EmailContext)


class EmailTriageAgent:
    """Agent for classifying emails and determining emergency scores.

    Uses OpenAI Agents SDK (Responses API) when available, and falls back to a
    keyword-only scoring model if no OpenAI API key is configured.
    """

    def __init__(self):
        self.enabled = False
        self._llm_agent = None
        self._initialize()

        self.critical_keywords = {
            "no power": 0.9,
            "power outage": 0.9,
            "system down": 0.85,
            "flood": 0.95,
            "flooding": 0.95,
            "leak": 0.85,
            "water leak": 0.9,
            "fire alarm": 0.95,
            "fire": 0.9,
            "hvac failure": 0.85,
            "no heat": 0.85,
            "no cooling": 0.8,
            "no ac": 0.8,
            "elevator stuck": 0.9,
            "security breach": 0.9,
            "break-in": 0.9,
            "can't operate": 0.85,
            "cannot operate": 0.85,
            "emergency": 0.75,
        }

        self.urgent_keywords = {
            "urgent": 0.7,
            "immediately": 0.65,
            "asap": 0.6,
            "offline": 0.6,
            "after hours": 0.5,
            "not working": 0.5,
            "broken": 0.5,
            "failed": 0.55,
            "down": 0.5,
        }

        self.negative_keywords = {
            "pm": 0.3,
            "preventive maintenance": 0.4,
            "scheduled": 0.35,
            "routine": 0.4,
            "cosmetic": 0.3,
            "minor": 0.25,
            "when convenient": 0.3,
            "next week": 0.35,
            "no rush": 0.4,
            "low priority": 0.4,
        }

    def _initialize(self) -> None:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OpenAI API key not configured - using keyword-only scoring")
            self.enabled = False
            return

        # Ensure SDK sees the key even if only provided via Settings
        os.environ.setdefault("OPENAI_API_KEY", api_key)

        if settings.openai_model and settings.openai_model != _MODEL:
            logger.warning("Ignoring openai_model=%s; enforced model is %s", settings.openai_model, _MODEL)

        try:
            # Import from OpenAI Agents SDK (module name: `agents`).
            from agents import Agent, ModelSettings

            self._llm_agent = Agent(
                name="Email triage agent",
                instructions=(
                    "You are an emergency triage system for after-hours maintenance requests. "
                    "Return an urgency score and concise reasoning, plus extracted context."
                ),
                model=_MODEL,
                model_settings=ModelSettings(temperature=0.3),
                output_type=_EmailTriageLLMOutput,
            )
            self.enabled = True
            logger.info("Email Triage Agent initialized with OpenAI Agents SDK (Responses API). model=%s", _MODEL)
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI Agents SDK for Email Triage: {str(e)}")
            self.enabled = False

    async def classify(self, subject: str, body: str, sender_domain: str) -> Dict[str, Any]:
        full_text = f"{subject}\n{body}".lower()

        keyword_score = self._calculate_keyword_score(full_text)
        urgency_indicators = self._extract_urgency_indicators(full_text)

        if self.enabled:
            try:
                ai_result = await self._ai_classify(subject, body, sender_domain)
                combined_score = (ai_result["score"] * 0.6) + (keyword_score * 0.4)

                return {
                    "emergency_score": min(1.0, combined_score),
                    "extracted_context": ai_result.get("context", {}),
                    "urgency_indicators": urgency_indicators,
                    "reasoning": ai_result.get("reasoning", ""),
                    "keyword_score": keyword_score,
                    "ai_score": ai_result["score"],
                }
            except Exception as e:
                logger.error(f"AI classification failed, using keywords only: {str(e)}")

        return {
            "emergency_score": keyword_score,
            "extracted_context": self._extract_basic_context(full_text),
            "urgency_indicators": urgency_indicators,
            "reasoning": "Keyword-based scoring (AI unavailable)",
            "keyword_score": keyword_score,
        }

    def _calculate_keyword_score(self, text: str) -> float:
        score = 0.0
        matches = 0

        for keyword, weight in self.critical_keywords.items():
            if keyword in text:
                score += weight
                matches += 1

        for keyword, weight in self.urgent_keywords.items():
            if keyword in text:
                score += weight * 0.7
                matches += 1

        negative_reduction = 0.0
        for keyword, weight in self.negative_keywords.items():
            if keyword in text:
                negative_reduction += weight

        if matches > 0:
            base_score = score / matches
            final_score = max(0, base_score - (negative_reduction * 0.5))
            return min(1.0, final_score)

        return 0.3

    def _extract_urgency_indicators(self, text: str) -> List[str]:
        indicators: List[str] = []
        all_keywords = {**self.critical_keywords, **self.urgent_keywords}
        for keyword in all_keywords:
            if keyword in text:
                indicators.append(keyword)
        return indicators

    def _extract_basic_context(self, text: str) -> Dict[str, Any]:
        context: Dict[str, Any] = {}

        location_patterns = [
            r"at\s+(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln))",
            r"location[:\s]+([^\n,]+)",
            r"address[:\s]+([^\n,]+)",
        ]
        for pattern in location_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                context["location"] = match.group(1).strip()
                break

        equipment_words = ["hvac", "elevator", "boiler", "generator", "pump", "ac", "heater"]
        for eq in equipment_words:
            if eq in text:
                context["equipment"] = eq.upper()
                break

        return context

    async def _ai_classify(self, subject: str, body: str, sender_domain: str) -> Dict[str, Any]:
        if not self._llm_agent:
            raise RuntimeError("LLM agent not initialized")

        from agents import Runner

        prompt = (
            "Analyze this after-hours maintenance email and estimate emergency urgency.\n\n"
            f"Email Subject: {subject}\n"
            f"Email Body: {body}\n"
            f"Sender Domain: {sender_domain}\n\n"
            "Guidelines for score (0 to 1):\n"
            "- 0.9-1.0: Life safety issues, fire, flooding, security breach, complete system failure\n"
            "- 0.7-0.9: Critical ops impacted, no power, HVAC failure, cannot operate business\n"
            "- 0.5-0.7: Urgent but not critical, broken equipment, offline systems\n"
            "- 0.3-0.5: Important but can wait, degraded service, minor issues\n"
            "- 0.0-0.3: Routine, scheduled, preventive maintenance, low priority\n"
        )

        result = await Runner.run(self._llm_agent, prompt)
        out: _EmailTriageLLMOutput = result.final_output

        context_dict: Dict[str, Any] = out.context.model_dump(exclude_none=True)
        return {"score": float(out.score), "reasoning": out.reasoning or "", "context": context_dict}
