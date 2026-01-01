from openai import OpenAI
import logging
from typing import Dict, Any
from datetime import datetime

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class SmsAgent:
    """
    Agent for generating SMS messages for escalation.
    Uses OpenAI for intelligent message generation.
    """
    
    def __init__(self):
        self.client = None
        self.enabled = False
        self._initialize()
    
    def _initialize(self):
        """Initialize OpenAI client."""
        if settings.openai_api_key:
            try:
                self.client = OpenAI(api_key=settings.openai_api_key)
                self.enabled = True
                logger.info("SMS Agent initialized with OpenAI")
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI for SMS Agent: {str(e)}")
                self.enabled = False
        else:
            logger.warning("OpenAI API key not configured - using default messages")
            self.enabled = False
    
    async def generate_message(
        self,
        event_id: str,
        issue_description: str,
        received_at: str
    ) -> Dict[str, Any]:
        """
        Generate an SMS message for an escalation.
        
        The message should:
        - Start with "After-Hours Emergency"
        - Include time and brief description
        - Instruct to reply ACK to accept
        - Be concise (SMS length)
        
        Args:
            event_id: Event ID for tracking
            issue_description: Description of the issue
            received_at: When the event was received
        
        Returns:
            Dict with message text
        """
        # Parse time for the message
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace('Z', '+00:00'))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except:
            time_str = "now"
        
        # Generate message using AI if available
        if self.enabled:
            try:
                message = await self._ai_generate_message(issue_description, time_str)
                return {
                    "message": message,
                    "generated_by": "ai"
                }
            except Exception as e:
                logger.error(f"AI message generation failed: {str(e)}")
        
        # Fallback to template-based message
        message = self._generate_template_message(issue_description, time_str)
        return {
            "message": message,
            "generated_by": "template"
        }
    
    async def _ai_generate_message(self, issue_description: str, time_str: str) -> str:
        """Use OpenAI to generate a concise SMS message."""
        prompt = f"""Generate a brief SMS message for an after-hours emergency.

Issue: {issue_description}
Time received: {time_str}

Requirements:
- MUST start with "After-Hours Emergency"
- Include the time received
- Brief description of the issue (keep it short)
- MUST end with "Reply ACK to accept."
- Total message should be under 160 characters if possible
- No emojis or special formatting

Generate ONLY the SMS text, nothing else."""

        try:
            response = self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": "You generate brief SMS alerts for emergencies."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                max_tokens=80
            )
            
            message = response.choices[0].message.content.strip()
            
            # Ensure message has ACK instruction
            if "reply ack" not in message.lower():
                message += " Reply ACK to accept."
            
            return message
            
        except Exception as e:
            logger.error(f"OpenAI SMS generation error: {str(e)}")
            raise
    
    def _generate_template_message(self, issue_description: str, time_str: str) -> str:
        """Generate a template-based SMS message."""
        # Truncate issue description
        short_issue = issue_description[:60] if issue_description else "service request"
        
        return (
            f"After-Hours Emergency – {short_issue} received at {time_str}. "
            "Reply ACK to accept."
        )
