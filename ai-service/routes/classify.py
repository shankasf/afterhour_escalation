from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

from ah_agents.email_triage_agent import EmailTriageAgent
from ah_agents.escalation_orchestrator import (
    get_escalation_orchestrator,
    EventSource,
)
from config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize agents
email_triage_agent = EmailTriageAgent()
orchestrator = get_escalation_orchestrator()


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


class OrchestratedClassifyRequest(BaseModel):
    """Request for full orchestrated classification."""
    subject: str
    body: str
    senderDomain: str
    receivedAt: Optional[str] = None


class OrchestratedClassifyResponse(BaseModel):
    """Response from multi-agent orchestration."""
    shouldEscalate: bool
    emergencyScore: float
    priority: str
    reasoning: str
    issueSummary: str
    extractedContext: Dict[str, Any]
    escalationContent: Optional[Dict[str, str]] = None
    auditNotes: str


@router.post("", response_model=ClassifyResponse)
async def classify_email(request: ClassifyRequest):
    """
    Classify an email to determine if it's an emergency requiring escalation.
    Uses the simple email triage agent.
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


@router.post("/orchestrated", response_model=OrchestratedClassifyResponse)
async def orchestrated_classify_email(request: OrchestratedClassifyRequest):
    """
    Classify an email using the full multi-agent orchestration system.
    
    This endpoint uses the EscalationOrchestrator which coordinates between
    specialized agents (triage, message generation) and returns complete
    escalation context including generated voice/SMS content.
    """
    try:
        logger.info(f"Orchestrated classification for: {request.subject}")
        
        # Combine subject and body for analysis
        content = f"Subject: {request.subject}\n\n{request.body}"
        
        result = await orchestrator.process_event(
            event_type="email",
            content=content,
            source=EventSource.EMAIL,
            metadata={
                "subject": request.subject,
                "sender": request.senderDomain,
                "received_at": request.receivedAt,
            },
        )
        
        triage = result.get("triage", {})
        
        return OrchestratedClassifyResponse(
            shouldEscalate=result.get("should_escalate", False),
            emergencyScore=triage.get("emergency_score", 0.5),
            priority=triage.get("priority", "medium"),
            reasoning=triage.get("reasoning", ""),
            issueSummary=triage.get("issue_summary", request.subject),
            extractedContext={
                "location": triage.get("location"),
                "equipment": triage.get("equipment"),
                "is_safety_critical": triage.get("is_safety_critical", False),
            },
            escalationContent=result.get("escalation_content"),
            auditNotes=result.get("audit_notes", ""),
        )
        
    except Exception as e:
        logger.error(f"Orchestrated classification failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
