"""Configuration management for AI Orchestration Service."""

import os
from typing import Optional, Dict, Any
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    # Service Configuration
    service_name: str = "ai-orchestration"
    service_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")

    # Server Configuration
    host: str = Field(default="0.0.0.0", env="AI_ORCHESTRATION_HOST")
    port: int = Field(default=8092, env="AI_ORCHESTRATION_PORT")
    workers: int = Field(default=1, env="AI_ORCHESTRATION_WORKERS")

    # Database Configuration
    db_host: str = Field(default="bsim-postgres", env="BSIM_DB_HOST")
    db_port: int = Field(default=5432, env="BSIM_DB_PORT")
    db_name: str = Field(default="bsim", env="BSIM_DB_NAME")
    db_user: str = Field(default="ben", env="BSIM_DB_USER")
    db_password: Optional[str] = Field(default=os.environ.get("BSIM_DB_PASSWORD"), env="BSIM_DB_PASSWORD")

    # Redis Configuration
    redis_host: str = Field(default="redis-cache", env="REDIS_HOST")
    redis_port: int = Field(default=6379, env="REDIS_PORT")
    redis_password: Optional[str] = Field(default=None, env="REDIS_PASSWORD")
    redis_db: int = Field(default=1, env="REDIS_DB")  # Use db 1 for orchestration
    redis_timeout: int = Field(default=5, env="REDIS_TIMEOUT")

    # AI Model Configuration
    anthropic_api_key: Optional[str] = Field(default=None, env="ANTHROPIC_API_KEY")
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")

    # Model Selection and Routing
    default_model: str = Field(default="claude-3-haiku-20240307", env="DEFAULT_MODEL")
    enable_model_routing: bool = Field(default=True, env="ENABLE_MODEL_ROUTING")

    # Cost Management
    daily_budget: float = Field(default=50.0, env="DAILY_BUDGET")
    weekly_budget: float = Field(default=350.0, env="WEEKLY_BUDGET")
    monthly_budget: float = Field(default=1500.0, env="MONTHLY_BUDGET")

    # Budget Alert Thresholds (percentage of budget)
    warning_threshold: float = Field(default=0.80, env="WARNING_THRESHOLD")
    critical_threshold: float = Field(default=0.95, env="CRITICAL_THRESHOLD")
    emergency_threshold: float = Field(default=1.00, env="EMERGENCY_THRESHOLD")

    # Rate Limiting
    requests_per_minute: int = Field(default=60, env="REQUESTS_PER_MINUTE")
    requests_per_hour: int = Field(default=1000, env="REQUESTS_PER_HOUR")
    burst_limit: int = Field(default=10, env="BURST_LIMIT")

    # Model Specific Limits
    opus_requests_per_hour: int = Field(default=100, env="OPUS_REQUESTS_PER_HOUR")
    sonnet_requests_per_hour: int = Field(default=300, env="SONNET_REQUESTS_PER_HOUR")
    haiku_requests_per_hour: int = Field(default=600, env="HAIKU_REQUESTS_PER_HOUR")

    # Circuit Breaker Configuration
    circuit_breaker_failure_threshold: int = Field(default=5, env="CIRCUIT_BREAKER_FAILURE_THRESHOLD")
    circuit_breaker_recovery_timeout: int = Field(default=60, env="CIRCUIT_BREAKER_RECOVERY_TIMEOUT")
    circuit_breaker_expected_exception: str = Field(default="Exception", env="CIRCUIT_BREAKER_EXPECTED_EXCEPTION")

    # Caching Configuration
    cache_ttl: int = Field(default=3600, env="CACHE_TTL")  # 1 hour default
    enable_response_caching: bool = Field(default=True, env="ENABLE_RESPONSE_CACHING")
    cache_key_version: str = Field(default="v1", env="CACHE_KEY_VERSION")

    # Performance Monitoring
    metrics_enabled: bool = Field(default=True, env="METRICS_ENABLED")
    performance_tracking: bool = Field(default=True, env="PERFORMANCE_TRACKING")
    quality_scoring: bool = Field(default=True, env="QUALITY_SCORING")

    # Logging Configuration
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_format: str = Field(default="structured", env="LOG_FORMAT")

    # External Service URLs
    vector_search_url: str = Field(default="http://vector-search:8090", env="VECTOR_SEARCH_URL")
    ghidra_mcp_url: str = Field(default="http://ghidra-mcp:8089", env="GHIDRA_MCP_URL")

    @field_validator("db_password")
    @classmethod
    def validate_db_password(cls, v):
        # Allow None for testing, will warn if missing
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v):
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v.upper() not in valid_levels:
            raise ValueError(f"Log level must be one of: {valid_levels}")
        return v.upper()

    @property
    def database_url(self) -> str:
        """Construct database URL for asyncpg."""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @property
    def redis_url(self) -> str:
        """Construct Redis URL."""
        auth_part = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth_part}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @property
    def model_limits(self) -> Dict[str, int]:
        """Get per-model rate limits."""
        return {
            "claude-3-opus-20240229": self.opus_requests_per_hour,
            "claude-3-sonnet-20240229": self.sonnet_requests_per_hour,
            "claude-3-haiku-20240307": self.haiku_requests_per_hour
        }

    @property
    def budget_thresholds(self) -> Dict[str, float]:
        """Get budget alert thresholds."""
        return {
            "warning": self.warning_threshold,
            "critical": self.critical_threshold,
            "emergency": self.emergency_threshold
        }

    model_config = {
        "env_file": ".env",
        "case_sensitive": False,
        "extra": "ignore"
    }


# Global settings instance
settings = Settings()