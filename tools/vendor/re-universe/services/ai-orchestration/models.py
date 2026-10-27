"""Data models for AI Orchestration Service."""

from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from enum import Enum
from pydantic import BaseModel, Field


class TaskComplexity(str, Enum):
    """Task complexity levels for model routing."""
    SIMPLE = "simple"
    MODERATE = "moderate"
    COMPLEX = "complex"


class TaskType(str, Enum):
    """Types of tasks that can be processed."""
    ANALYSIS = "analysis"
    GENERATION = "generation"
    BATCH = "batch"
    COORDINATION = "coordination"
    VALIDATION = "validation"
    WORKFLOW = "workflow"


class ModelType(str, Enum):
    """Available AI models."""
    OPUS = "claude-3-opus-20240229"
    SONNET = "claude-3-sonnet-20240229"
    HAIKU = "claude-3-haiku-20240307"


class RequestPriority(str, Enum):
    """Request priority levels."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class BudgetStatus(str, Enum):
    """Budget monitoring status levels."""
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


class CircuitBreakerState(str, Enum):
    """Circuit breaker states."""
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


# Request and Response Models
class OrchestrationRequest(BaseModel):
    """AI orchestration request model."""
    request_id: str = Field(..., description="Unique request identifier")
    user_id: Optional[str] = Field(None, description="User identifier")
    session_id: Optional[str] = Field(None, description="Session identifier")

    # Request content
    prompt: str = Field(..., description="The prompt/request content")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")

    # Request metadata
    priority: RequestPriority = Field(RequestPriority.NORMAL, description="Request priority")
    max_cost: Optional[float] = Field(None, description="Maximum allowed cost for this request")
    timeout: Optional[int] = Field(30, description="Request timeout in seconds")

    # Model preferences
    preferred_model: Optional[ModelType] = Field(None, description="Preferred model for processing")
    avoid_models: Optional[List[ModelType]] = Field(None, description="Models to avoid")

    # Workflow metadata
    workflow_type: Optional[str] = Field(None, description="Type of workflow being executed")
    function_address: Optional[str] = Field(None, description="Function address for Ghidra workflows")

    # Response requirements
    response_format: Optional[str] = Field("text", description="Expected response format")
    quality_threshold: Optional[float] = Field(0.8, description="Minimum quality threshold")


class TaskClassification(BaseModel):
    """Task classification result."""
    complexity: TaskComplexity
    task_type: TaskType
    recommended_model: ModelType
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: str
    estimated_cost: float
    estimated_time: float  # in seconds
    requires_fallback: bool = False
    batch_eligible: bool = False


class OrchestrationResponse(BaseModel):
    """AI orchestration response model."""
    request_id: str
    success: bool

    # Response content
    response: Optional[str] = None
    error: Optional[str] = None

    # Processing metadata
    model_used: Optional[ModelType] = None
    processing_time: float  # in seconds
    cost: float
    tokens_used: int
    quality_score: Optional[float] = None

    # Classification info
    classification: Optional[TaskClassification] = None

    # Budget and limits
    remaining_budget: float
    rate_limit_remaining: int

    # Caching info
    cached: bool = False
    cache_key: Optional[str] = None

    timestamp: datetime = Field(default_factory=datetime.now)


# Cost Management Models
class CostTracker(BaseModel):
    """Cost tracking information."""
    daily_spend: float = 0.0
    weekly_spend: float = 0.0
    monthly_spend: float = 0.0

    model_spend: Dict[str, float] = Field(default_factory=dict)
    hourly_spend: Dict[int, float] = Field(default_factory=dict)

    last_reset: datetime = Field(default_factory=datetime.now)

    # Budget status
    budget_status: BudgetStatus = BudgetStatus.NORMAL
    budget_alerts_sent: List[str] = Field(default_factory=list)


class BudgetAlert(BaseModel):
    """Budget alert information."""
    alert_type: BudgetStatus
    message: str
    current_spend: float
    budget_limit: float
    percentage_used: float
    timestamp: datetime = Field(default_factory=datetime.now)
    actions_taken: List[str] = Field(default_factory=list)


# Performance Monitoring Models
class ModelPerformance(BaseModel):
    """Model performance metrics."""
    model: ModelType
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0

    avg_response_time: float = 0.0
    avg_quality_score: float = 0.0
    avg_cost_per_request: float = 0.0

    last_24h_requests: int = 0
    last_24h_cost: float = 0.0

    circuit_breaker_state: CircuitBreakerState = CircuitBreakerState.CLOSED
    last_failure_time: Optional[datetime] = None
    consecutive_failures: int = 0


class SystemMetrics(BaseModel):
    """Overall system performance metrics."""
    total_requests_today: int = 0
    successful_requests_today: int = 0
    failed_requests_today: int = 0

    avg_response_time_ms: float = 0.0
    cache_hit_rate_percent: float = 0.0

    cost_per_quality_point: float = 0.0
    budget_utilization_percent: float = 0.0

    model_distribution: Dict[str, int] = Field(default_factory=dict)
    task_type_distribution: Dict[str, int] = Field(default_factory=dict)

    timestamp: datetime = Field(default_factory=datetime.now)


# Quality Control Models
class QualityAssessment(BaseModel):
    """Quality assessment for AI responses."""
    overall_score: float = Field(..., ge=0.0, le=1.0)

    # Quality dimensions
    accuracy: float = Field(..., ge=0.0, le=1.0)
    completeness: float = Field(..., ge=0.0, le=1.0)
    relevance: float = Field(..., ge=0.0, le=1.0)
    format_compliance: float = Field(..., ge=0.0, le=1.0)

    # Validation results
    validation_passed: bool
    validation_issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)

    # Metadata
    assessor_model: Optional[ModelType] = None
    assessment_time: datetime = Field(default_factory=datetime.now)


# Workflow Models
class WorkflowStep(BaseModel):
    """Individual workflow step definition."""
    step_name: str
    description: str

    # Model requirements
    recommended_model: ModelType
    complexity: TaskComplexity
    batch_capable: bool = False

    # Templates and validation
    template_name: Optional[str] = None
    validation_rules: Dict[str, Any] = Field(default_factory=dict)

    # Dependencies
    depends_on: List[str] = Field(default_factory=list)
    timeout: int = 30  # seconds


class WorkflowDefinition(BaseModel):
    """Complete workflow definition."""
    workflow_name: str
    description: str
    version: str

    steps: List[WorkflowStep]

    # Workflow metadata
    estimated_duration: int  # minutes
    estimated_cost: float
    quality_requirements: Dict[str, float] = Field(default_factory=dict)


class WorkflowExecution(BaseModel):
    """Workflow execution tracking."""
    execution_id: str
    workflow_name: str
    request_id: str

    # Execution state
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    current_step: Optional[str] = None
    completed_steps: List[str] = Field(default_factory=list)
    failed_steps: List[str] = Field(default_factory=list)

    # Results
    step_results: Dict[str, Any] = Field(default_factory=dict)
    quality_scores: Dict[str, float] = Field(default_factory=dict)

    # Metadata
    start_time: datetime = Field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    total_cost: float = 0.0
    models_used: List[ModelType] = Field(default_factory=list)


# Health Check Models
class HealthStatus(BaseModel):
    """Service health status."""
    status: Literal["healthy", "degraded", "unhealthy"]
    service: str
    version: str
    timestamp: datetime = Field(default_factory=datetime.now)

    # Component health
    database_connected: bool
    redis_connected: bool
    anthropic_api_available: bool

    # Performance indicators
    avg_response_time_ms: float
    error_rate_percent: float
    budget_status: BudgetStatus

    # Resource usage
    memory_usage_mb: Optional[float] = None
    cpu_usage_percent: Optional[float] = None