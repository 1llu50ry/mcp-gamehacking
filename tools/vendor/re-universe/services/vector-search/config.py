"""Configuration management for Vector Search Service."""

import os
from typing import Optional
import os
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    # Service Configuration
    service_name: str = "vector-search"
    service_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")

    # Server Configuration
    host: str = Field(default="0.0.0.0", env="VECTOR_SEARCH_HOST")
    port: int = Field(default=8090, env="VECTOR_SEARCH_PORT")
    workers: int = Field(default=1, env="VECTOR_SEARCH_WORKERS")

    # Database Configuration
    db_host: str = Field(default="bsim-postgres", env="BSIM_DB_HOST")
    db_port: int = Field(default=5432, env="BSIM_DB_PORT")
    db_name: str = Field(default="bsim", env="BSIM_DB_NAME")
    db_user: str = Field(default="ben", env="BSIM_DB_USER")
    db_password: Optional[str] = Field(default=os.environ.get("BSIM_DB_PASSWORD"), env="BSIM_DB_PASSWORD")

    # Vector Search Configuration
    embedding_model: str = Field(default="text-embedding-3-small", env="EMBEDDING_MODEL")
    vector_dimension: int = Field(default=1536, env="VECTOR_DIMENSION")
    similarity_threshold: float = Field(default=0.7, env="VECTOR_SIMILARITY_THRESHOLD")
    max_results: int = Field(default=20, env="VECTOR_MAX_RESULTS")

    # Embedding Generation
    embedding_batch_size: int = Field(default=100, env="EMBEDDING_BATCH_SIZE")
    embedding_rate_limit: int = Field(default=1000, env="EMBEDDING_RATE_LIMIT")

    # Performance Configuration
    cache_ttl: int = Field(default=3600, env="VECTOR_CACHE_TTL")
    query_timeout: int = Field(default=5, env="VECTOR_QUERY_TIMEOUT")

    # Redis Configuration
    redis_host: str = Field(default="redis-cache", env="REDIS_HOST")
    redis_port: int = Field(default=6379, env="REDIS_PORT")
    redis_password: Optional[str] = Field(default=None, env="REDIS_PASSWORD")
    redis_db: int = Field(default=0, env="REDIS_DB")
    redis_timeout: int = Field(default=5, env="REDIS_TIMEOUT")

    # OpenAI Configuration
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")

    # Monitoring Configuration
    metrics_enabled: bool = Field(default=True, env="METRICS_ENABLED")
    metrics_port: int = Field(default=8091, env="METRICS_PORT")

    # Logging Configuration
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_format: str = Field(default="structured", env="LOG_FORMAT")

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

    model_config = {
        "env_file": ".env",
        "case_sensitive": False,
        "extra": "ignore"
    }


# Global settings instance
settings = Settings()