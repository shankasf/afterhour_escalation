from openai import OpenAI
import logging
from typing import Dict, Any
from datetime import datetime

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class VoiceAgent:
    """
    Agent for generating voice messages for escalation calls.
    Uses OpenAI for intelligent script generation.
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
                logger.info("Voice Agent initialized with OpenAI")
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI for Voice Agent: {str(e)}")
                self.enabled = False
        else:
            logger.warning("OpenAI API key not configured - using default scripts")
            self.enabled = False
    
    async def generate_message(
        self,
        event_id: str,
        issue_description: str,
        received_at: str
    ) -> Dict[str, Any]:
        """
        Generate a voice message script for an escalation call.
        
        The script should be:
        - Short (under 15 seconds when spoken)
        - Clear and urgent
        - Include instructions to press 1 to acknowledge
        
        Args:
            event_id: Event ID for tracking
            issue_description: Description of the issue
            received_at: When the event was received
        
        Returns:
            Dict with script and optional audio_url
        """
        # Parse time for the message
        try:
            if received_at:
                dt = datetime.fromisoformat(received_at.replace('Z', '+00:00'))
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = datetime.now().strftime("%I:%M %p")
        except:
            time_str = "recently"
        
        # Generate script using AI if available
        if self.enabled:
            try:
                script = await self._ai_generate_script(issue_description, time_str)
                return {
                    "script": script,
                    "audio_url": None,  # Could generate TTS audio here
                    "generated_by": "ai"
                }
            except Exception as e:
                logger.error(f"AI script generation failed: {str(e)}")
        
        # Fallback to template-based script
        script = self._generate_template_script(issue_description, time_str)
        return {
            "script": script,
            "audio_url": None,
            "generated_by": "template"
        }
    
    async def _ai_generate_script(self, issue_description: str, time_str: str) -> str:
        """Use OpenAI to generate a concise voice script."""
        prompt = f"""Generate a brief voice message for an after-hours emergency call.

Issue: {issue_description}
Time received: {time_str}

Requirements:
- Must be under 15 seconds when spoken (about 35-40 words max)
- Start with "After-hours emergency"
- Be clear and urgent but professional
- End with "Press 1 to acknowledge and take ownership"
- Do not include any special characters or emojis

Generate ONLY the script text, nothing else."""

        try:
            response = self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": "You generate brief, urgent voice scripts for emergency calls."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                max_tokens=100
            )
            
            script = response.choices[0].message.content.strip()
            
            # Ensure script ends with acknowledgment instruction
            if "press 1" not in script.lower():
                script += " Press 1 to acknowledge and take ownership."
            
            return script
            
        except Exception as e:
            logger.error(f"OpenAI script generation error: {str(e)}")
            raise
    
    def _generate_template_script(self, issue_description: str, time_str: str) -> str:
        """Generate a template-based script."""
        # Truncate issue description for voice
        short_issue = issue_description[:80] if issue_description else "service request"
        
        return (
            f"After-hours emergency received at {time_str}. "
            f"{short_issue}. "
            "Press 1 to acknowledge and take ownership."
        )
