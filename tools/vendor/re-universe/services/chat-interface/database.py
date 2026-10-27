"""Database operations for chat interface service."""

import asyncio
import asyncpg
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import json
import uuid

from models import (
    Conversation, ChatMessage, MessageFeedback, ConversationStatus,
    MessageRole, FeedbackType, ConversationSummary
)
from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class ChatDatabase:
    """Database manager for chat interface."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Establish database connection pool."""
        try:
            self.pool = await asyncpg.create_pool(
                host=settings.db_host,
                port=settings.db_port,
                user=settings.db_user,
                password=settings.db_password,
                database=settings.db_name,
                min_size=2,
                max_size=10,
                command_timeout=30
            )

            # Initialize database schema
            await self._init_schema()

            logger.info("Database connection pool established",
                       host=settings.db_host,
                       database=settings.db_name)

        except Exception as e:
            logger.error("Failed to establish database connection", error=str(e))
            raise

    async def disconnect(self):
        """Close database connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed")

    async def _init_schema(self):
        """Initialize database schema for chat system."""
        async with self.pool.acquire() as conn:

            # Create conversations table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    conversation_id UUID PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    title VARCHAR(500) NOT NULL DEFAULT 'New Conversation',
                    description TEXT,
                    status VARCHAR(50) NOT NULL DEFAULT 'active',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    message_count INTEGER DEFAULT 0,
                    total_tokens INTEGER DEFAULT 0,
                    total_cost DECIMAL(10,6) DEFAULT 0.0,
                    context_settings JSONB DEFAULT '{}',
                    ai_settings JSONB DEFAULT '{}',
                    tags TEXT[] DEFAULT '{}'
                )
            """)

            # Create chat_messages table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    message_id UUID PRIMARY KEY,
                    conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
                    metadata JSONB DEFAULT '{}',
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    model_used VARCHAR(100),
                    tokens_used INTEGER,
                    cost DECIMAL(10,6),
                    processing_time FLOAT,
                    confidence_score FLOAT,
                    quality_score FLOAT
                )
            """)

            # Create message_feedback table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS message_feedback (
                    feedback_id UUID PRIMARY KEY,
                    message_id UUID NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
                    conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                    user_id VARCHAR(255) NOT NULL,
                    feedback_type VARCHAR(50) NOT NULL,
                    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                    helpful BOOLEAN,
                    comment TEXT,
                    categories TEXT[] DEFAULT '{}',
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)

            # Create indexes for performance
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_user_id
                ON conversations(user_id)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_last_activity
                ON conversations(last_activity DESC)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
                ON chat_messages(conversation_id)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp
                ON chat_messages(timestamp DESC)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_message_feedback_message_id
                ON message_feedback(message_id)
            """)

            logger.info("Database schema initialized successfully")

    async def create_conversation(self, conversation: Conversation) -> Conversation:
        """Create a new conversation."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO conversations (
                    conversation_id, user_id, title, description, status,
                    context_settings, ai_settings, tags
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
                conversation.conversation_id,
                conversation.user_id,
                conversation.title,
                conversation.description,
                conversation.status.value,
                json.dumps(conversation.context_settings),
                json.dumps(conversation.ai_settings),
                conversation.tags
            )

        logger.info("Conversation created",
                   conversation_id=conversation.conversation_id,
                   user_id=conversation.user_id)

        return conversation

    async def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """Get conversation by ID."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM conversations
                WHERE conversation_id = $1
            """, uuid.UUID(conversation_id))

            if not row:
                return None

            return Conversation(
                conversation_id=str(row['conversation_id']),
                user_id=row['user_id'],
                title=row['title'],
                description=row['description'],
                status=ConversationStatus(row['status']),
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                last_activity=row['last_activity'],
                message_count=row['message_count'],
                total_tokens=row['total_tokens'],
                total_cost=float(row['total_cost']),
                context_settings=row['context_settings'],
                ai_settings=row['ai_settings'],
                tags=row['tags'] or []
            )

    async def list_conversations(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0
    ) -> List[ConversationSummary]:
        """List conversations for a user."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    c.conversation_id, c.title, c.status, c.message_count,
                    c.last_activity, c.created_at, c.tags,
                    COALESCE(
                        (SELECT LEFT(content, 100)
                         FROM chat_messages m
                         WHERE m.conversation_id = c.conversation_id
                         ORDER BY timestamp DESC LIMIT 1),
                        'No messages yet'
                    ) as preview
                FROM conversations c
                WHERE user_id = $1
                ORDER BY last_activity DESC
                LIMIT $2 OFFSET $3
            """, user_id, limit, offset)

            return [
                ConversationSummary(
                    conversation_id=str(row['conversation_id']),
                    title=row['title'],
                    status=ConversationStatus(row['status']),
                    message_count=row['message_count'],
                    last_activity=row['last_activity'],
                    preview=row['preview'],
                    created_at=row['created_at'],
                    tags=row['tags'] or []
                )
                for row in rows
            ]

    async def add_message(self, message: ChatMessage) -> ChatMessage:
        """Add a message to a conversation."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Insert message
                await conn.execute("""
                    INSERT INTO chat_messages (
                        message_id, conversation_id, role, content, message_type,
                        metadata, model_used, tokens_used, cost, processing_time,
                        confidence_score, quality_score
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                    uuid.UUID(message.message_id),
                    uuid.UUID(message.conversation_id),
                    message.role.value,
                    message.content,
                    message.message_type.value,
                    json.dumps(message.metadata),
                    message.model_used,
                    message.tokens_used,
                    message.cost,
                    message.processing_time,
                    message.confidence_score,
                    message.quality_score
                )

                # Update conversation stats
                await conn.execute("""
                    UPDATE conversations
                    SET message_count = message_count + 1,
                        total_tokens = total_tokens + COALESCE($2, 0),
                        total_cost = total_cost + COALESCE($3, 0),
                        last_activity = NOW(),
                        updated_at = NOW()
                    WHERE conversation_id = $1
                """,
                    uuid.UUID(message.conversation_id),
                    message.tokens_used or 0,
                    message.cost or 0.0
                )

        logger.debug("Message added to conversation",
                    message_id=message.message_id,
                    conversation_id=message.conversation_id,
                    role=message.role.value)

        return message

    async def get_conversation_messages(
        self,
        conversation_id: str,
        limit: int = 100,
        before_timestamp: Optional[datetime] = None
    ) -> List[ChatMessage]:
        """Get messages for a conversation."""
        async with self.pool.acquire() as conn:
            query = """
                SELECT * FROM chat_messages
                WHERE conversation_id = $1
            """
            params = [uuid.UUID(conversation_id)]

            if before_timestamp:
                query += " AND timestamp < $2"
                params.append(before_timestamp)

            query += " ORDER BY timestamp ASC LIMIT $" + str(len(params) + 1)
            params.append(limit)

            rows = await conn.fetch(query, *params)

            return [
                ChatMessage(
                    message_id=str(row['message_id']),
                    conversation_id=str(row['conversation_id']),
                    role=MessageRole(row['role']),
                    content=row['content'],
                    message_type=row['message_type'],
                    metadata=row['metadata'],
                    timestamp=row['timestamp'],
                    model_used=row['model_used'],
                    tokens_used=row['tokens_used'],
                    cost=float(row['cost']) if row['cost'] else None,
                    processing_time=row['processing_time'],
                    confidence_score=row['confidence_score'],
                    quality_score=row['quality_score']
                )
                for row in rows
            ]

    async def add_feedback(self, feedback: MessageFeedback) -> MessageFeedback:
        """Add feedback for a message."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO message_feedback (
                    feedback_id, message_id, conversation_id, user_id,
                    feedback_type, rating, helpful, comment, categories
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (message_id, user_id) DO UPDATE SET
                    feedback_type = EXCLUDED.feedback_type,
                    rating = EXCLUDED.rating,
                    helpful = EXCLUDED.helpful,
                    comment = EXCLUDED.comment,
                    categories = EXCLUDED.categories,
                    timestamp = NOW()
            """,
                uuid.UUID(feedback.feedback_id),
                uuid.UUID(feedback.message_id),
                uuid.UUID(feedback.conversation_id),
                feedback.user_id,
                feedback.feedback_type.value,
                feedback.rating,
                feedback.helpful,
                feedback.comment,
                feedback.categories
            )

        logger.info("Feedback added",
                   feedback_id=feedback.feedback_id,
                   message_id=feedback.message_id,
                   feedback_type=feedback.feedback_type.value)

        return feedback

    async def get_conversation_metrics(self, user_id: str) -> Dict[str, Any]:
        """Get metrics for user's conversations."""
        async with self.pool.acquire() as conn:
            metrics = await conn.fetchrow("""
                SELECT
                    COUNT(*) as total_conversations,
                    COUNT(*) FILTER (WHERE status = 'active') as active_conversations,
                    COALESCE(SUM(message_count), 0) as total_messages,
                    COALESCE(SUM(total_cost), 0) as total_cost,
                    COALESCE(AVG(
                        (SELECT AVG(rating)
                         FROM message_feedback f
                         WHERE f.conversation_id = c.conversation_id)
                    ), 0) as avg_rating
                FROM conversations c
                WHERE user_id = $1
            """, user_id)

            return dict(metrics) if metrics else {}


# Global database instance
db = ChatDatabase()