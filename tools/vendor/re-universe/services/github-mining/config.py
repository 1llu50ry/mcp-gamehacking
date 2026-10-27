"""Configuration management for GitHub mining service."""

import os
from typing import Optional, List, Set
from pydantic import Field
from pydantic_settings import BaseSettings


class GitHubMiningSettings(BaseSettings):
    """Configuration settings for GitHub mining service."""

    # Service configuration
    service_name: str = "github-mining"
    service_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")

    # Server settings
    host: str = Field(default="0.0.0.0", env="GITHUB_MINING_HOST")
    port: int = Field(default=8094, env="GITHUB_MINING_PORT")
    workers: int = Field(default=1, env="GITHUB_MINING_WORKERS")

    # Database configuration
    db_host: str = Field(default="bsim-postgres", env="BSIM_DB_HOST")
    db_port: int = Field(default=5432, env="BSIM_DB_PORT")
    db_name: str = Field(default="bsim", env="BSIM_DB_NAME")
    db_user: str = Field(default="ben", env="BSIM_DB_USER")
    db_password: Optional[str] = Field(default=os.environ.get("BSIM_DB_PASSWORD"), env="BSIM_DB_PASSWORD")

    # Redis configuration
    redis_host: str = Field(default="redis-cache", env="REDIS_HOST")
    redis_port: int = Field(default=6379, env="REDIS_PORT")
    redis_db: int = Field(default=2, env="REDIS_DB")

    # GitHub API configuration
    github_token: Optional[str] = Field(default=None, env="GITHUB_TOKEN")
    github_api_url: str = "https://api.github.com"
    github_per_page: int = 100  # Max items per API request

    # Rate limiting
    github_requests_per_hour: int = Field(default=1000, env="GITHUB_REQUESTS_PER_HOUR")
    concurrent_tasks: int = Field(default=5, env="CONCURRENT_MINING_TASKS")

    # Mining configuration
    default_search_queries: List[str] = [
        "ghidra binary analysis",
        "reverse engineering tools",
        "malware analysis framework",
        "binary similarity detection",
        "disassembly automation",
        "program analysis tools",
        "binary diffing",
        "vulnerability research tools",
        "exploit development",
        "forensics analysis"
    ]

    # Quality thresholds
    min_stars: int = Field(default=5, env="MIN_REPOSITORY_STARS")
    min_relevance_score: float = Field(default=0.3, env="MIN_RELEVANCE_SCORE")
    min_quality_score: float = Field(default=40.0, env="MIN_QUALITY_SCORE")

    # Content filtering
    max_repo_size_mb: int = Field(default=200, env="MAX_REPOSITORY_SIZE_MB")
    max_files_per_repo: int = Field(default=1000, env="MAX_FILES_PER_REPOSITORY")
    max_analysis_time_seconds: int = Field(default=300, env="MAX_ANALYSIS_TIME_SECONDS")

    # Excluded content
    excluded_languages: Set[str] = {
        "HTML", "CSS", "Makefile", "Dockerfile", "YAML", "JSON"
    }
    excluded_file_extensions: Set[str] = {
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf", ".zip",
        ".tar", ".gz", ".exe", ".dll", ".so", ".dylib"
    }

    # Security research focus areas
    security_keywords: List[str] = [
        "vulnerability", "exploit", "payload", "shellcode", "rop", "gadget",
        "buffer overflow", "heap spray", "use after free", "double free",
        "format string", "sql injection", "xss", "csrf", "reverse shell",
        "privilege escalation", "code injection", "memory corruption"
    ]

    reverse_engineering_keywords: List[str] = [
        "disassembly", "decompiler", "unpacker", "debugger", "tracer",
        "hooking", "patching", "binary analysis", "static analysis",
        "dynamic analysis", "control flow", "data flow", "call graph",
        "function signature", "binary similarity", "code similarity"
    ]

    malware_analysis_keywords: List[str] = [
        "malware", "virus", "trojan", "ransomware", "rootkit", "botnet",
        "c2", "command control", "obfuscation", "packer", "crypter",
        "steganography", "persistence", "evasion", "anti-analysis"
    ]

    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")

    # Task scheduling
    discovery_interval_hours: int = Field(default=6, env="DISCOVERY_INTERVAL_HOURS")
    analysis_interval_hours: int = Field(default=24, env="ANALYSIS_INTERVAL_HOURS")
    cleanup_interval_hours: int = Field(default=168, env="CLEANUP_INTERVAL_HOURS")  # 1 week

    @property
    def database_url(self) -> str:
        """Database connection URL."""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @property
    def redis_url(self) -> str:
        """Redis connection URL."""
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"

    def is_relevant_language(self, language: str) -> bool:
        """Check if a programming language is relevant for analysis."""
        if not language:
            return False
        return language.lower() not in {lang.lower() for lang in self.excluded_languages}

    def is_security_relevant(self, text: str) -> bool:
        """Check if text contains security-relevant keywords."""
        if not text:
            return False

        text_lower = text.lower()
        all_keywords = (
            self.security_keywords +
            self.reverse_engineering_keywords +
            self.malware_analysis_keywords
        )

        return any(keyword in text_lower for keyword in all_keywords)

    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = GitHubMiningSettings()