"""Data models for GitHub mining service."""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Set
from enum import Enum

from pydantic import BaseModel, Field, HttpUrl, field_validator


class RepositoryCategory(str, Enum):
    """Categories for repository classification."""
    REVERSE_ENGINEERING = "reverse_engineering"
    MALWARE_ANALYSIS = "malware_analysis"
    BINARY_ANALYSIS = "binary_analysis"
    SECURITY_RESEARCH = "security_research"
    EXPLOITATION = "exploitation"
    FORENSICS = "forensics"
    CRYPTOGRAPHY = "cryptography"
    VULNERABILITY_RESEARCH = "vulnerability_research"
    TOOLS_FRAMEWORKS = "tools_frameworks"
    EDUCATIONAL = "educational"
    OTHER = "other"


class RepositoryLanguage(str, Enum):
    """Primary programming languages."""
    PYTHON = "python"
    C = "c"
    CPP = "cpp"
    JAVASCRIPT = "javascript"
    GO = "go"
    RUST = "rust"
    JAVA = "java"
    CSHARP = "csharp"
    SHELL = "shell"
    ASSEMBLY = "assembly"
    OTHER = "other"


class QualityScore(str, Enum):
    """Repository quality assessment levels."""
    EXCELLENT = "excellent"  # 90-100
    GOOD = "good"           # 70-89
    FAIR = "fair"           # 50-69
    POOR = "poor"           # 30-49
    VERY_POOR = "very_poor" # 0-29


class MiningStatus(str, Enum):
    """Status of mining operations."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class GitHubRepository(BaseModel):
    """GitHub repository metadata model."""
    repo_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    github_id: int
    full_name: str  # owner/repo
    name: str
    owner: str

    # Repository metadata
    description: Optional[str] = None
    homepage: Optional[HttpUrl] = None
    topics: List[str] = Field(default_factory=list)
    language: Optional[str] = None
    primary_language: RepositoryLanguage = RepositoryLanguage.OTHER

    # Repository statistics
    stars_count: int = 0
    forks_count: int = 0
    watchers_count: int = 0
    issues_count: int = 0
    size_kb: int = 0

    # Repository status
    is_fork: bool = False
    is_archived: bool = False
    is_private: bool = False
    has_wiki: bool = False
    has_pages: bool = False

    # Timestamps
    created_at: datetime
    updated_at: datetime
    pushed_at: datetime

    # Classification
    category: RepositoryCategory = RepositoryCategory.OTHER
    relevance_score: float = 0.0  # 0.0-1.0
    quality_score: float = 0.0    # 0.0-100.0
    quality_grade: QualityScore = QualityScore.POOR

    # Mining metadata
    discovered_at: datetime = Field(default_factory=datetime.utcnow)
    last_analyzed: Optional[datetime] = None
    mining_status: MiningStatus = MiningStatus.PENDING


class RepositoryContent(BaseModel):
    """Repository content analysis."""
    repo_id: str

    # File analysis
    total_files: int = 0
    code_files: int = 0
    documentation_files: int = 0
    config_files: int = 0

    # Code metrics
    lines_of_code: int = 0
    cyclomatic_complexity: float = 0.0
    maintainability_index: float = 0.0

    # Content quality indicators
    has_readme: bool = False
    has_license: bool = False
    has_tests: bool = False
    has_ci_cd: bool = False
    has_documentation: bool = False

    # Security assessment
    security_issues: List[str] = Field(default_factory=list)
    vulnerability_count: int = 0

    # Relevance indicators
    ghidra_mentions: int = 0
    bsim_mentions: int = 0
    reverse_engineering_keywords: int = 0
    binary_analysis_keywords: int = 0

    analyzed_at: datetime = Field(default_factory=datetime.utcnow)


class GitHubUser(BaseModel):
    """GitHub user/organization model."""
    user_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    github_id: int
    login: str
    name: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None

    # User statistics
    public_repos: int = 0
    followers: int = 0
    following: int = 0

    # User classification
    is_organization: bool = False
    credibility_score: float = 0.0  # 0.0-1.0

    discovered_at: datetime = Field(default_factory=datetime.utcnow)


class MiningTask(BaseModel):
    """Background mining task model."""
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_type: str  # "discover", "analyze", "quality_check"

    # Task parameters
    search_query: Optional[str] = None
    repository_id: Optional[str] = None
    user_id: Optional[str] = None

    # Task configuration
    priority: int = Field(default=5, ge=1, le=10)
    max_repositories: int = Field(default=100, ge=1, le=1000)
    include_forks: bool = False
    min_stars: int = 0

    # Task status
    status: MiningStatus = MiningStatus.PENDING
    progress: float = 0.0  # 0.0-1.0

    # Results
    repositories_found: int = 0
    repositories_analyzed: int = 0
    high_quality_found: int = 0

    # Timing
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # Error handling
    error_message: Optional[str] = None
    retry_count: int = 0


class KnowledgeExtract(BaseModel):
    """Extracted knowledge from repositories."""
    extract_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    repo_id: str

    # Content identification
    file_path: str
    content_type: str  # "code", "documentation", "config", "script"

    # Extracted information
    title: str
    summary: str
    content: str
    keywords: List[str] = Field(default_factory=list)

    # Relevance scoring
    relevance_score: float = 0.0  # 0.0-1.0
    confidence_score: float = 0.0  # 0.0-1.0

    # Classification
    techniques: List[str] = Field(default_factory=list)
    tools_mentioned: List[str] = Field(default_factory=list)
    vulnerability_types: List[str] = Field(default_factory=list)

    extracted_at: datetime = Field(default_factory=datetime.utcnow)


class MiningConfiguration(BaseModel):
    """Mining service configuration."""
    # Search parameters
    search_queries: List[str] = Field(default_factory=lambda: [
        "ghidra binary analysis",
        "reverse engineering tools",
        "malware analysis framework",
        "binary similarity bsim",
        "disassembly automation"
    ])

    # Quality thresholds
    min_stars: int = 10
    min_relevance_score: float = 0.3
    min_quality_score: float = 50.0

    # Rate limiting
    api_requests_per_hour: int = 1000
    concurrent_analysis_tasks: int = 5

    # Content filtering
    excluded_languages: Set[str] = Field(default_factory=lambda: {"HTML", "CSS"})
    excluded_topics: Set[str] = Field(default_factory=lambda: {"spam", "test-repo"})
    max_repo_size_mb: int = 500

    # Analysis depth
    max_files_to_analyze: int = 100
    max_content_length: int = 50000

    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MiningStats(BaseModel):
    """Mining service statistics."""
    # Repository statistics
    total_repositories: int = 0
    high_quality_repositories: int = 0
    repositories_by_category: Dict[str, int] = Field(default_factory=dict)
    repositories_by_language: Dict[str, int] = Field(default_factory=dict)

    # Content statistics
    total_extracts: int = 0
    high_relevance_extracts: int = 0

    # Performance metrics
    avg_analysis_time_seconds: float = 0.0
    successful_analyses: int = 0
    failed_analyses: int = 0

    # API usage
    github_api_calls_today: int = 0
    github_api_limit_remaining: int = 0

    # Task statistics
    pending_tasks: int = 0
    active_tasks: int = 0
    completed_tasks_today: int = 0

    last_updated: datetime = Field(default_factory=datetime.utcnow)


class HealthStatus(BaseModel):
    """GitHub mining service health status."""
    status: str
    service: str = "github-mining"
    version: str = "1.0.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # Component health
    database_connected: bool
    github_api_available: bool
    redis_connected: bool

    # Service metrics
    active_mining_tasks: int = 0
    repositories_discovered: int = 0
    avg_analysis_time_ms: float = 0.0

    # API status
    github_rate_limit_remaining: int = 0
    github_rate_limit_reset: Optional[datetime] = None

    # Performance indicators
    memory_usage_mb: Optional[float] = None
    cpu_usage_percent: Optional[float] = None