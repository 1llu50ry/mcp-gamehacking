"""Configuration settings for YaraFlux MCP Server.

This module loads and provides configuration settings from environment variables
for the YaraFlux MCP Server, including JWT auth, storage options, and YARA settings.
"""

import os
from pathlib import Path
from typing import Any, Dict, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Base settings
    APP_NAME: str = "YaraFlux MCP Server"
    API_PREFIX: str = "/api/v1"
    DEBUG: bool = Field(default=False, description="Enable debug mode")

    # JWT Authentication
    JWT_SECRET_KEY: str = Field(..., description="Secret key for JWT token generation")
    JWT_ALGORITHM: str = Field(default="HS256", description="Algorithm for JWT")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30, description="Token expiration in minutes")

    # Storage settings
    USE_MINIO: bool = Field(default=False, description="Use MinIO for storage")
    STORAGE_DIR: Path = Field(default=Path("./data"), description="Local storage directory")

    # MinIO settings (required if USE_MINIO=True)
    MINIO_ENDPOINT: Optional[str] = Field(default=None, description="MinIO server endpoint")
    MINIO_ACCESS_KEY: Optional[str] = Field(default=None, description="MinIO access key")
    MINIO_SECRET_KEY: Optional[str] = Field(default=None, description="MinIO secret key")
    MINIO_SECURE: bool = Field(default=True, description="Use SSL for MinIO connection")
    MINIO_BUCKET_RULES: str = Field(default="yara-rules", description="MinIO bucket for YARA rules")
    MINIO_BUCKET_SAMPLES: str = Field(default="yara-samples", description="MinIO bucket for scanned files")
    MINIO_BUCKET_RESULTS: str = Field(default="yara-results", description="MinIO bucket for scan results")

    # YARA settings
    YARA_RULES_DIR: Path = Field(default=Path("./data/rules"), description="Local directory for YARA rules")
    YARA_SAMPLES_DIR: Path = Field(default=Path("./data/samples"), description="Local directory for scanned files")
    YARA_RESULTS_DIR: Path = Field(default=Path("./data/results"), description="Local directory for scan results")
    YARA_MAX_FILE_SIZE: int = Field(default=100 * 1024 * 1024, description="Max file size for scanning (bytes)")
    YARA_SCAN_TIMEOUT: int = Field(default=60, description="Timeout for YARA scans (seconds)")
    YARA_INCLUDE_DEFAULT_RULES: bool = Field(default=True, description="Include default ThreatFlux rules")

    # User settings
    ADMIN_USERNAME: str = Field(default="admin", description="Admin username")
    ADMIN_PASSWORD: str = Field(..., description="Admin password")

    # Server settings
    HOST: str = Field(default="0.0.0.0", description="Host to bind server")
    PORT: int = Field(default=8000, description="Port to bind server")

    @field_validator("STORAGE_DIR", "YARA_RULES_DIR", "YARA_SAMPLES_DIR", "YARA_RESULTS_DIR", mode="before")
    def ensure_path_exists(cls, v: Any) -> Path:  # pylint: disable=no-self-argument
        """Ensure paths exist and are valid."""
        path = Path(v)
        os.makedirs(path, exist_ok=True)
        return path

    @field_validator("USE_MINIO", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY")
    def validate_minio_settings(cls, v: Any, info: Dict[str, Any]) -> Any:  # pylint: disable=no-self-argument
        """Validate MinIO settings if USE_MINIO is True."""
        field_name = info.field_name
        data = info.data

        # Skip validation if we can't determine the field name
        if field_name is None:
            return v

        if field_name != "USE_MINIO" and data.get("USE_MINIO", False):
            if v is None:
                raise ValueError(f"{field_name} must be set when USE_MINIO is True")
        return v

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


# Create and export settings instance
settings = Settings()
