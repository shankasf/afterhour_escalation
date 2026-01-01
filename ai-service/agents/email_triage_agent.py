from openai import OpenAI
import logging
from typing import Dict, Any, List, Optional
import re

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmailTriageAgent:
    """
    Agent for classifying emails and determining emergency scores.
    Uses GPT-4o for intelligent analysis and keyword-based scoring.
    """
    
    def __init__(self):
        self.client = None
        self.enabled = False
        self._initialize()
        
        # High-weight emergency keywords
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
        
        # Medium-weight urgent keywords
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
        
        # Negative keywords (reduce score)
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
    
    def _initialize(self):
        """Initialize OpenAI client."""
        if settings.openai_api_key:
            try:
                self.client = OpenAI(api_key=settings.openai_api_key)
                self.enabled = True
                logger.info("Email Triage Agent initialized with OpenAI")
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI: {str(e)}")
                self.enabled = False
        else:
            logger.warning("OpenAI API key not configured - using keyword-only scoring")
            self.enabled = False
    
    async def classify(
        self,
        subject: str,
        body: str,
        sender_domain: str
    ) -> Dict[str, Any]:
        """
        Classify an email and compute emergency score.
        
        Args:
            subject: Email subject
            body: Email body (plain text)
            sender_domain: Sender's email domain
        
        Returns:
            Dict with emergency_score, extracted_context, urgency_indicators, reasoning
        """
        # Combine subject and body for analysis
        full_text = f"{subject}\n{body}".lower()
        
        # Calculate keyword-based score
        keyword_score = self._calculate_keyword_score(full_text)
        urgency_indicators = self._extract_urgency_indicators(full_text)
        
        # Use AI for enhanced analysis if available
        if self.enabled:
            try:
                ai_result = await self._ai_classify(subject, body, sender_domain)
                
                # Combine keyword and AI scores (weighted average)
                # AI gets 60% weight, keywords get 40%
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
        
        # Fallback to keyword-only scoring
        return {
            "emergency_score": keyword_score,
            "extracted_context": self._extract_basic_context(full_text),
            "urgency_indicators": urgency_indicators,
            "reasoning": "Keyword-based scoring (AI unavailable)",
            "keyword_score": keyword_score,
        }
    
    def _calculate_keyword_score(self, text: str) -> float:
        """Calculate emergency score based on keywords."""
        score = 0.0
        matches = 0
        
        # Check critical keywords
        for keyword, weight in self.critical_keywords.items():
            if keyword in text:
                score += weight
                matches += 1
        
        # Check urgent keywords
        for keyword, weight in self.urgent_keywords.items():
            if keyword in text:
                score += weight * 0.7  # Lower contribution
                matches += 1
        
        # Check negative keywords (reduce score)
        negative_reduction = 0.0
        for keyword, weight in self.negative_keywords.items():
            if keyword in text:
                negative_reduction += weight
        
        # Normalize score
        if matches > 0:
            base_score = score / matches
            final_score = max(0, base_score - (negative_reduction * 0.5))
            return min(1.0, final_score)
        
        return 0.3  # Default low score if no keywords found
    
    def _extract_urgency_indicators(self, text: str) -> List[str]:
        """Extract urgency indicators from text."""
        indicators = []
        
        all_keywords = {**self.critical_keywords, **self.urgent_keywords}
        for keyword in all_keywords:
            if keyword in text:
                indicators.append(keyword)
        
        return indicators
    
    def _extract_basic_context(self, text: str) -> Dict[str, Any]:
        """Extract basic context using pattern matching."""
        context = {}
        
        # Try to extract location
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
        
        # Try to extract equipment
        equipment_words = ["hvac", "elevator", "boiler", "generator", "pump", "ac", "heater"]
        for eq in equipment_words:
            if eq in text:
                context["equipment"] = eq.upper()
                break
        
        return context
    
    async def _ai_classify(
        self,
        subject: str,
        body: str,
        sender_domain: str
    ) -> Dict[str, Any]:
        """Use OpenAI for intelligent classification."""
        prompt = f"""You are an emergency triage system for after-hours maintenance requests.
Analyze the following email and determine its urgency level.

Email Subject: {subject}
Email Body: {body}
Sender Domain: {sender_domain}

Provide your analysis in the following JSON format:
{{
    "score": <float between 0 and 1, where 1 is most urgent>,
    "reasoning": "<brief explanation of your score>",
    "context": {{
        "location": "<extracted location if mentioned>",
        "equipment": "<equipment mentioned if any>",
        "issue_description": "<brief description of the issue>",
        "is_safety_critical": <true/false>
    }}
}}

Guidelines:
- Score 0.9-1.0: Life safety issues, fire, flooding, security breach, complete system failure
- Score 0.7-0.9: Critical operations impacted, no power, HVAC failure, can't operate business
- Score 0.5-0.7: Urgent but not critical, broken equipment, offline systems
- Score 0.3-0.5: Important but can wait, degraded service, minor issues
- Score 0.0-0.3: Routine, scheduled, preventive maintenance, low priority

Respond ONLY with valid JSON."""

        try:
            response = self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": "You are an emergency classification assistant. Respond only with valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # Parse JSON response
            import json
            # Clean up potential markdown code blocks
            if result_text.startswith("```"):
                result_text = re.sub(r"```json?\n?", "", result_text)
                result_text = result_text.replace("```", "")
            
            result = json.loads(result_text)
            
            return {
                "score": float(result.get("score", 0.5)),
                "reasoning": result.get("reasoning", ""),
                "context": result.get("context", {})
            }
            
        except Exception as e:
            logger.error(f"OpenAI classification error: {str(e)}")
            raise
