"""
Dependency Injection Container for the AI Service.
Provides centralized management of service instances and their dependencies.
Follows the Modularity and Loose Coupling principles.
"""

import logging
from typing import Optional, TypeVar, Type, Dict, Any
from functools import lru_cache

logger = logging.getLogger(__name__)

T = TypeVar('T')


class Container:
    """
    Simple dependency injection container.
    Manages service lifecycles and dependencies.
    """

    _instances: Dict[str, Any] = {}
    _factories: Dict[str, callable] = {}

    @classmethod
    def register(cls, name: str, factory: callable) -> None:
        """Register a factory function for a service."""
        cls._factories[name] = factory
        logger.debug(f"Registered factory for: {name}")

    @classmethod
    def get(cls, name: str) -> Any:
        """Get or create a service instance."""
        if name not in cls._instances:
            if name not in cls._factories:
                raise KeyError(f"No factory registered for: {name}")
            cls._instances[name] = cls._factories[name]()
            logger.debug(f"Created instance for: {name}")
        return cls._instances[name]

    @classmethod
    def reset(cls, name: Optional[str] = None) -> None:
        """Reset one or all service instances."""
        if name:
            cls._instances.pop(name, None)
        else:
            cls._instances.clear()

    @classmethod
    def clear(cls) -> None:
        """Clear all registrations and instances."""
        cls._instances.clear()
        cls._factories.clear()


# Service accessor functions
def get_settings():
    """Get the settings instance."""
    from config import get_settings as _get_settings
    return _get_settings()


def get_email_service():
    """Get the email service instance."""
    return Container.get('email_service')


def get_escalation_orchestrator():
    """Get the escalation orchestrator instance."""
    return Container.get('escalation_orchestrator')


def get_http_client():
    """Get the resilient HTTP client instance."""
    return Container.get('http_client')


def get_email_uid_tracker():
    """Get the email UID tracker instance."""
    return Container.get('email_uid_tracker')


def init_container() -> None:
    """Initialize the DI container with all service factories."""
    from services.email_service import EmailService
    from ah_agents.escalation_orchestrator import EscalationOrchestrator
    from services.http_client import ResilientHttpClient
    from services.email_uid_tracker import EmailUidTracker

    Container.register('email_service', EmailService)
    Container.register('escalation_orchestrator', EscalationOrchestrator)
    Container.register('http_client', ResilientHttpClient)
    Container.register('email_uid_tracker', EmailUidTracker)

    logger.info("Dependency injection container initialized")
