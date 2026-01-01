from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

from agents.email_triage_agent import EmailTriageAgent
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize agent
email_triage_agent = EmailTriageAgent()


class ClassifyRequest(BaseModel):
    subject: str
    body: str
    senderDomain: str


class ClassifyResponse(BaseModel):
    emergencyScore: float
    shouldEscalate: bool
    extractedContext: Dict[str, Any]
    reasoning: Optional[str] = None
    urgencyIndicators: List[str] = []


@router.post("", response_model=ClassifyResponse)
async def classify_email(request: ClassifyRequest):
    """
    Classify an email to determine if it's an emergency requiring escalation.
    """
    try:
        logger.info(f"Classifying email from {request.senderDomain}: {request.subject}")
        
        result = await email_triage_agent.classify(
            subject=request.subject,
            body=request.body,
            sender_domain=request.senderDomain
        )
        
        # Determine if should escalate based on threshold
        should_escalate = result["emergency_score"] >= settings.emergency_score_threshold
        
        return ClassifyResponse(
            emergencyScore=result["emergency_score"],
            shouldEscalate=should_escalate,
            extractedContext=result.get("extracted_context", {}),
            reasoning=result.get("reasoning"),
            urgencyIndicators=result.get("urgency_indicators", [])
        )
        
    except Exception as e:
        logger.error(f"Classification failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
