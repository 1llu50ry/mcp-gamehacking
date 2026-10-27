"""Configuration management for chat interface service."""

import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings


class ChatInterfaceSettings(BaseSettings):
    """Configuration settings for chat interface service."""

    # Service configuration
    service_name: str = "chat-interface"
    service_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")

    # Server settings
    host: str = Field(default="0.0.0.0", env="CHAT_INTERFACE_HOST")
    port: int = Field(default=8093, env="CHAT_INTERFACE_PORT")
    workers: int = Field(default=1, env="CHAT_INTERFACE_WORKERS")

    # Database configuration
    db_host: str = Field(default="bsim-postgres", env="BSIM_DB_HOST")
    db_port: int = Field(default=5432, env="BSIM_DB_PORT")
    db_name: str = Field(default="bsim", env="BSIM_DB_NAME")
    db_user: str = Field(default="ben", env="BSIM_DB_USER")
    db_password: Optional[str] = Field(default=os.environ.get("BSIM_DB_PASSWORD"), env="BSIM_DB_PASSWORD")

    # AI Orchestration service
    ai_orchestration_url: str = Field(
        default="http://ai-orchestration:8092",
        env="AI_ORCHESTRATION_URL"
    )

    # Authentication (JWT)
    jwt_secret_key: str = Field(
        default="your-secret-key-change-in-production",
        env="JWT_SECRET_KEY"
    )
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = Field(default=60 * 24, env="JWT_EXPIRE_MINUTES")  # 24 hours

    # Rate limiting
    rate_limit_requests: int = Field(default=100, env="RATE_LIMIT_REQUESTS")
    rate_limit_period: int = Field(default=60, env="RATE_LIMIT_PERIOD")  # seconds

    # WebSocket configuration
    websocket_max_connections: int = Field(default=1000, env="WEBSOCKET_MAX_CONNECTIONS")
    websocket_heartbeat_interval: int = Field(default=30, env="WEBSOCKET_HEARTBEAT_INTERVAL")

    # Chat configuration
    max_conversation_history: int = Field(default=100, env="MAX_CONVERSATION_HISTORY")
    message_retention_days: int = Field(default=365, env="MESSAGE_RETENTION_DAYS")

    # Default AI settings
    default_model: str = Field(default="claude-3-haiku-20240307", env="DEFAULT_AI_MODEL")
    default_max_tokens: int = Field(default=4000, env="DEFAULT_MAX_TOKENS")
    default_temperature: float = Field(default=0.7, env="DEFAULT_TEMPERATURE")

    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")

    @property
    def database_url(self) -> str:
        """Database connection URL."""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = ChatInterfaceSettings()