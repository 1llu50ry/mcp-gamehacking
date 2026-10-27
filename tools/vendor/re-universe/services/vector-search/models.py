"""Data models for Vector Search API."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, validator
from datetime import datetime


class HealthResponse(BaseModel):
    """Health check response model."""
    status: str
    service: str
    version: str
    timestamp: datetime
    database_connected: bool
    embedding_service_available: bool


class EmbeddingRequest(BaseModel):
    """Request model for embedding generation."""
    function_ids: List[int] = Field(..., description="List of function IDs to generate embeddings for")
    force_regenerate: bool = Field(default=False, description="Force regeneration of existing embeddings")


class EmbeddingResponse(BaseModel):
    """Response model for embedding generation."""
    processed_count: int
    successful_count: int
    failed_count: int
    processing_time_ms: float
    details: List[Dict[str, Any]]


class SearchQuery(BaseModel):
    """Search query request model."""
    query: str = Field(..., min_length=1, max_length=1000, description="Search query text")
    limit: Optional[int] = Field(default=None, ge=1, le=100, description="Maximum number of results")
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Similarity threshold")
    use_cache: bool = Field(default=True, description="Whether to use cached results")

    @validator("query")
    def validate_query(cls, v):
        """Validate and clean query text."""
        # Remove extra whitespace
        cleaned = " ".join(v.strip().split())
        if not cleaned:
            raise ValueError("Query cannot be empty after cleaning")
        return cleaned


class FunctionResult(BaseModel):
    """Individual function search result."""
    function_id: int
    name_func: Optional[str]
    addr: Optional[int]
    name_exec: Optional[str]
    executable_md5: Optional[str]
    hierarchy_path: Optional[str]
    classification_confidence: Optional[float]
    similarity_score: float
    model_version: str
    embedding_updated: datetime


class SearchResponse(BaseModel):
    """Search results response model."""
    query: str
    result_count: int
    search_time_ms: float
    similarity_threshold: float
    cached: bool
    results: List[FunctionResult]


class BatchProcessingRequest(BaseModel):
    """Request for batch processing operations."""
    batch_size: Optional[int] = Field(default=None, ge=1, le=1000, description="Batch size for processing")
    max_functions: Optional[int] = Field(default=None, ge=1, description="Maximum functions to process")


class BatchProcessingResponse(BaseModel):
    """Response for batch processing operations."""
    started: bool
    message: str
    estimated_functions: Optional[int]
    estimated_time_seconds: Optional[float]


class MetricsResponse(BaseModel):
    """Performance metrics response."""
    total_functions: int
    functions_with_embeddings: int
    embedding_coverage_percent: float
    total_searches_today: int
    cache_hit_rate_percent: float
    avg_search_time_ms: float
    database_health: str


class CacheStatsResponse(BaseModel):
    """Cache statistics response."""
    cache_enabled: bool
    total_cached_queries: int
    cache_hit_rate_percent: float
    cache_size_mb: float
    oldest_cache_entry: Optional[datetime]
    newest_cache_entry: Optional[datetime]


class ErrorResponse(BaseModel):
    """Error response model."""
    error: str
    message: str
    timestamp: datetime
    request_id: Optional[str]


class StatusResponse(BaseModel):
    """Service status response."""
    service: str
    version: str
    status: str
    uptime_seconds: float
    database_status: str
    embedding_service_status: str
    total_functions: int
    functions_with_embeddings: int
    embedding_coverage_percent: float