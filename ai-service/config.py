from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_voice_model: str = "gpt-4o-audio-preview"
    
    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    twilio_webhook_url: str = ""
    
    # Dialpad
    dialpad_api_key: str = ""
    dialpad_webhook_secret: str = ""
    
    # Backend service
    backend_url: str = "http://localhost:3004"
    
    # IMAP Settings (for receiving emails)
    imap_host: str = "outlook.office365.com"
    imap_port: int = 993
    imap_user: str = ""
    imap_password: str = ""
    imap_encryption: str = "SSL"
    
    # SMTP Settings (for sending emails)
    smtp_host: str = "smtp-mail.outlook.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_encryption: str = "STARTTLS"
    
    # Email Settings
    email_from_address: str = ""
    email_from_name: str = "After-Hours Escalation System"
    admin_email: str = ""
    
    # Microsoft 365 OAuth2 (for Modern Auth)
    ms365_client_id: str = ""
    ms365_client_secret: str = ""
    ms365_tenant_id: str = ""
    ms365_mailbox: str = ""
    
    # Emergency scoring
    emergency_score_threshold: float = 0.6
    
    # Escalation
    acknowledgment_timeout_seconds: int = 120
    
    # Internal API key for service-to-service auth
    internal_api_key: str = "internal-service-key"
    
    # Service
    host: str = "0.0.0.0"
    port: int = 8083
    debug: bool = False
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Allow extra env vars not defined in Settings


@lru_cache()
def get_settings() -> Settings:
    return Settings()
