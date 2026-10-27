"""Data models for chat interface service."""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class MessageRole(str, Enum):
    """Message roles in a conversation."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class MessageType(str, Enum):
    """Types of messages."""
    TEXT = "text"
    CODE = "code"
    IMAGE = "image"
    FILE = "file"
    ERROR = "error"


class ConversationStatus(str, Enum):
    """Conversation status states."""
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class FeedbackType(str, Enum):
    """Types of feedback."""
    THUMBS_UP = "thumbs_up"
    THUMBS_DOWN = "thumbs_down"
    RATING = "rating"
    DETAILED = "detailed"


class ChatMessage(BaseModel):
    """Individual chat message model."""
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    role: MessageRole
    content: str
    message_type: MessageType = MessageType.TEXT
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # AI-specific fields
    model_used: Optional[str] = None
    tokens_used: Optional[int] = None
    cost: Optional[float] = None
    processing_time: Optional[float] = None

    # Response quality metrics
    confidence_score: Optional[float] = None
    quality_score: Optional[float] = None

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class MessageFeedback(BaseModel):
    """User feedback on AI responses."""
    feedback_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    message_id: str
    conversation_id: str
    user_id: str
    feedback_type: FeedbackType

    # Quantitative feedback
    rating: Optional[int] = Field(None, ge=1, le=5)  # 1-5 stars
    helpful: Optional[bool] = None  # thumbs up/down

    # Qualitative feedback
    comment: Optional[str] = None
    categories: List[str] = Field(default_factory=list)  # e.g., ["accuracy", "helpfulness"]

    timestamp: datetime = Field(default_factory=datetime.utcnow)

    @field_validator('rating')
    def validate_rating(cls, v, info):
        if info.data.get('feedback_type') == FeedbackType.RATING and v is None:
            raise ValueError('Rating is required for rating feedback type')
        return v


class Conversation(BaseModel):
    """Chat conversation model."""
    conversation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str = "New Conversation"
    description: Optional[str] = None

    status: ConversationStatus = ConversationStatus.ACTIVE

    # Conversation metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity: datetime = Field(default_factory=datetime.utcnow)

    # Analytics
    message_count: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0

    # Configuration
    context_settings: Dict[str, Any] = Field(default_factory=dict)
    ai_settings: Dict[str, Any] = Field(default_factory=dict)

    tags: List[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    """Request to send a chat message."""
    conversation_id: Optional[str] = None  # Create new if None
    message: str
    message_type: MessageType = MessageType.TEXT
    context: Dict[str, Any] = Field(default_factory=dict)

    # AI orchestration settings
    preferred_model: Optional[str] = None
    max_tokens: Optional[int] = Field(None, ge=1, le=8192)
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)

    # User preferences
    stream_response: bool = True
    include_thinking: bool = False


class ChatResponse(BaseModel):
    """Response from chat service."""
    conversation_id: str
    message: ChatMessage

    # Conversation context
    conversation: Optional[Conversation] = None
    message_history: List[ChatMessage] = Field(default_factory=list)

    # AI metrics
    model_used: str
    processing_time: float
    total_tokens: int
    cost: float

    # Quality indicators
    confidence_score: Optional[float] = None
    requires_feedback: bool = True

    timestamp: datetime = Field(default_factory=datetime.utcnow)


class FeedbackRequest(BaseModel):
    """Request to submit feedback on a message."""
    message_id: str
    feedback_type: FeedbackType
    rating: Optional[int] = Field(None, ge=1, le=5)
    helpful: Optional[bool] = None
    comment: Optional[str] = None
    categories: List[str] = Field(default_factory=list)


class ConversationSummary(BaseModel):
    """Summary of a conversation for listing."""
    conversation_id: str
    title: str
    status: ConversationStatus
    message_count: int
    last_activity: datetime
    preview: str  # First few words of last message
    created_at: datetime
    tags: List[str]


class ChatMetrics(BaseModel):
    """Chat service metrics."""
    total_conversations: int
    active_conversations: int
    total_messages: int
    total_cost: float

    # Quality metrics
    average_rating: Optional[float] = None
    feedback_count: int = 0
    positive_feedback_rate: Optional[float] = None

    # Performance metrics
    average_response_time: float
    uptime_percentage: float

    # Usage patterns
    peak_hours: List[int] = Field(default_factory=list)
    popular_tags: List[str] = Field(default_factory=list)

    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HealthStatus(BaseModel):
    """Chat service health status."""
    status: str
    service: str = "chat-interface"
    version: str = "1.0.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # Component health
    database_connected: bool
    ai_orchestration_available: bool
    websocket_active: bool

    # Performance indicators
    active_connections: int = 0
    avg_response_time_ms: float = 0.0
    error_rate_percent: float = 0.0

    # Resource usage
    memory_usage_mb: Optional[float] = None
    cpu_usage_percent: Optional[float] = None