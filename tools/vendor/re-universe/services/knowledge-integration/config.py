"""Configuration for Knowledge Integration Service."""

import os
from pydantic import BaseModel, Field, AliasChoices
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """Application settings with environment variable overrides."""

    # Environment
    environment: str = "production"
    debug: bool = False

    # Service configuration
    service_name: str = "knowledge-integration"
    service_version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = 8095

    # Database configuration
    db_host: str = Field(default="bsim-postgres", validation_alias=AliasChoices("BSIM_DB_HOST", "db_host"))
    db_port: int = Field(default=5432, validation_alias=AliasChoices("BSIM_DB_PORT", "db_port"))
    db_name: str = Field(default="bsim", validation_alias=AliasChoices("BSIM_DB_NAME", "db_name"))
    db_user: str = Field(default="ben", validation_alias=AliasChoices("BSIM_DB_USER", "db_user"))
    db_password: str = Field(default="", validation_alias=AliasChoices("BSIM_DB_PASSWORD", "db_password"))

    # Redis configuration
    redis_host: str = "redis-cache"
    redis_port: int = 6379
    redis_db: int = 4  # Use db 4 for knowledge integration

    # Integration settings
    analysis_batch_size: int = 100
    similarity_threshold: float = 0.6
    confidence_threshold: float = 0.5
    max_similar_functions: int = 20
    max_github_matches: int = 10
    integration_interval_hours: int = 6

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"

# Global settings instance
settings = Settings()
