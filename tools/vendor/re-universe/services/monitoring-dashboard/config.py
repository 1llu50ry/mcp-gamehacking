"""Configuration for Monitoring Dashboard Service."""

import os
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """Application settings with environment variable overrides."""

    # Environment
    environment: str = "production"
    debug: bool = False

    # Service configuration
    service_name: str = "monitoring-dashboard"
    service_version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = 8096

    # Database configuration
    db_host: str = Field(default="bsim-postgres", env="BSIM_DB_HOST")
    db_port: int = Field(default=5432, env="BSIM_DB_PORT")
    db_name: str = Field(default="bsim", env="BSIM_DB_NAME")
    db_user: str = Field(default="ben", env="BSIM_DB_USER")
    db_password: str = Field(default="", env="BSIM_DB_PASSWORD")

    # Redis configuration
    redis_host: str = Field(default="redis-cache", env="REDIS_HOST")
    redis_port: int = Field(default=6379, env="REDIS_PORT")
    redis_db: int = 5  # Use db 5 for monitoring

    # Monitoring settings
    collection_interval_minutes: int = 1
    retention_days: int = 30
    alert_threshold_response_time: float = 5000.0  # ms
    alert_threshold_error_rate: float = 10.0  # percent

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"

# Global settings instance
settings = Settings()