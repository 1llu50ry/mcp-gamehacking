"""Main FastAPI application for chat interface service."""

import asyncio
import json
import uuid
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from models import (
    ChatRequest, ChatResponse, Conversation, ChatMessage, MessageFeedback,
    FeedbackRequest, ConversationSummary, ChatMetrics, HealthStatus,
    MessageRole, MessageType, FeedbackType
)
from database import db
from config import settings
from logging_config import setup_logging, get_logger

# Setup logging
setup_logging()
logger = get_logger(__name__)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# WebSocket connection manager
class ConnectionManager:
    """Manages WebSocket connections for real-time chat."""

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_conversations: Dict[str, List[str]] = {}

    async def connect(self, websocket: WebSocket, user_id: str, conversation_id: str):
        await websocket.accept()
        connection_id = f"{user_id}:{conversation_id}"
        self.active_connections[connection_id] = websocket

        if user_id not in self.user_conversations:
            self.user_conversations[user_id] = []
        if conversation_id not in self.user_conversations[user_id]:
            self.user_conversations[user_id].append(conversation_id)

        logger.info("WebSocket connected",
                   user_id=user_id,
                   conversation_id=conversation_id)

    def disconnect(self, user_id: str, conversation_id: str):
        connection_id = f"{user_id}:{conversation_id}"
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]

        if user_id in self.user_conversations:
            if conversation_id in self.user_conversations[user_id]:
                self.user_conversations[user_id].remove(conversation_id)

        logger.info("WebSocket disconnected",
                   user_id=user_id,
                   conversation_id=conversation_id)

    async def send_message(self, user_id: str, conversation_id: str, message: dict):
        connection_id = f"{user_id}:{conversation_id}"
        if connection_id in self.active_connections:
            try:
                await self.active_connections[connection_id].send_text(json.dumps(message))
            except Exception as e:
                logger.warning("Failed to send WebSocket message",
                              user_id=user_id,
                              error=str(e))
                self.disconnect(user_id, conversation_id)

manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management."""
    logger.info("Starting Chat Interface Service",
                version=settings.service_version,
                debug=settings.debug)

    try:
        # Initialize database
        await db.connect()
        logger.info("Database connection established")

        logger.info("Chat Interface Service startup completed")

    except Exception as e:
        logger.error("Failed to start Chat Interface Service", error=str(e))
        raise

    yield

    # Cleanup
    logger.info("Shutting down Chat Interface Service")
    await db.disconnect()
    logger.info("Chat Interface Service shutdown completed")


# Create FastAPI app
app = FastAPI(
    title="Chat Interface Service",
    description="Real-time chat interface with AI orchestration and user feedback",
    version=settings.service_version,
    lifespan=lifespan
)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for chat UI
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health", response_model=HealthStatus)
async def health_check():
    """Health check endpoint."""
    try:
        # Test database connection
        db_healthy = db.pool is not None and not db.pool._closed

        # Test AI orchestration service
        ai_healthy = False
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{settings.ai_orchestration_url}/health")
                ai_healthy = response.status_code == 200
        except Exception:
            pass

        # Count active WebSocket connections
        active_connections = len(manager.active_connections)

        # Determine overall status
        if db_healthy and ai_healthy:
            status = "healthy"
        elif db_healthy:
            status = "degraded"
        else:
            status = "unhealthy"

        return HealthStatus(
            status=status,
            database_connected=db_healthy,
            ai_orchestration_available=ai_healthy,
            websocket_active=True,
            active_connections=active_connections,
            avg_response_time_ms=150.0,  # Placeholder
            error_rate_percent=0.0       # Placeholder
        )

    except Exception as e:
        logger.error("Health check failed", error=str(e))
        return HealthStatus(
            status="unhealthy",
            database_connected=False,
            ai_orchestration_available=False,
            websocket_active=False,
            avg_response_time_ms=0.0,
            error_rate_percent=100.0
        )


@app.get("/", response_class=HTMLResponse)
async def chat_interface():
    """Serve the chat interface HTML."""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>AI Chat Interface</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            .chat-container { max-width: 800px; margin: 0 auto; }
            .chat-messages { height: 400px; border: 1px solid #ddd; padding: 10px; overflow-y: scroll; }
            .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
            .user-message { background-color: #e3f2fd; text-align: right; }
            .assistant-message { background-color: #f5f5f5; }
            .input-area { margin-top: 10px; }
            .input-area input { width: 70%; padding: 10px; }
            .input-area button { width: 25%; padding: 10px; }
            .feedback { margin-top: 5px; }
            .feedback button { margin-right: 5px; }
        </style>
    </head>
    <body>
        <div class="chat-container">
            <h1>AI Chat Interface</h1>
            <div id="chat-messages" class="chat-messages"></div>
            <div class="input-area">
                <input type="text" id="message-input" placeholder="Type your message here..." />
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>

        <script>
            let ws = null;
            let conversationId = null;

            function initializeChat() {
                // For demo purposes, use a test user and create/use a conversation
                conversationId = localStorage.getItem('conversationId') || null;
                connectWebSocket();
            }

            function connectWebSocket() {
                const userId = 'demo-user';  // In production, get from authentication
                const convId = conversationId || 'new';

                ws = new WebSocket(`ws://localhost:8093/ws/${userId}/${convId}`);

                ws.onopen = function(event) {
                    console.log('Connected to chat');
                };

                ws.onmessage = function(event) {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                };

                ws.onclose = function(event) {
                    console.log('Disconnected from chat');
                    setTimeout(connectWebSocket, 3000); // Reconnect after 3 seconds
                };
            }

            function sendMessage() {
                const input = document.getElementById('message-input');
                const message = input.value.trim();

                if (message && ws) {
                    const chatRequest = {
                        message: message,
                        conversation_id: conversationId
                    };

                    ws.send(JSON.stringify(chatRequest));
                    input.value = '';

                    // Add user message to UI immediately
                    addMessageToUI('user', message);
                }
            }

            function handleMessage(data) {
                if (data.type === 'conversation_created') {
                    conversationId = data.conversation_id;
                    localStorage.setItem('conversationId', conversationId);
                } else if (data.type === 'message') {
                    addMessageToUI('assistant', data.content, data.message_id);
                }
            }

            function addMessageToUI(role, content, messageId = null) {
                const messagesDiv = document.getElementById('chat-messages');
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${role}-message`;
                messageDiv.innerHTML = `
                    <div>${content}</div>
                    ${role === 'assistant' && messageId ? `
                        <div class="feedback">
                            <button onclick="sendFeedback('${messageId}', 'thumbs_up')">👍</button>
                            <button onclick="sendFeedback('${messageId}', 'thumbs_down')">👎</button>
                        </div>
                    ` : ''}
                `;
                messagesDiv.appendChild(messageDiv);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            function sendFeedback(messageId, feedbackType) {
                fetch('/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message_id: messageId,
                        feedback_type: feedbackType,
                        helpful: feedbackType === 'thumbs_up'
                    })
                }).then(() => {
                    console.log('Feedback sent');
                });
            }

            // Initialize chat when page loads
            document.addEventListener('DOMContentLoaded', initializeChat);

            // Send message on Enter key
            document.getElementById('message-input').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        </script>
    </body>
    </html>
    """


@app.websocket("/ws/{user_id}/{conversation_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, conversation_id: str):
    """WebSocket endpoint for real-time chat."""

    # Handle new conversation creation
    if conversation_id == "new":
        conversation = Conversation(user_id=user_id)
        conversation = await db.create_conversation(conversation)
        conversation_id = conversation.conversation_id

        await websocket.accept()
        await websocket.send_text(json.dumps({
            "type": "conversation_created",
            "conversation_id": conversation_id
        }))
    else:
        await manager.connect(websocket, user_id, conversation_id)

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            request_data = json.loads(data)

            # Process chat request
            chat_request = ChatRequest(
                conversation_id=conversation_id,
                message=request_data["message"]
            )

            # Send to AI orchestration service
            response = await process_chat_message(chat_request, user_id)

            # Send response back via WebSocket
            await manager.send_message(user_id, conversation_id, {
                "type": "message",
                "content": response.message.content,
                "message_id": response.message.message_id,
                "model_used": response.model_used,
                "cost": response.cost,
                "processing_time": response.processing_time
            })

    except WebSocketDisconnect:
        manager.disconnect(user_id, conversation_id)


async def process_chat_message(request: ChatRequest, user_id: str) -> ChatResponse:
    """Process a chat message through the AI orchestration service."""
    start_time = datetime.utcnow()

    try:
        # Get or create conversation
        if not request.conversation_id:
            conversation = Conversation(user_id=user_id)
            conversation = await db.create_conversation(conversation)
            request.conversation_id = conversation.conversation_id
        else:
            conversation = await db.get_conversation(request.conversation_id)
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")

        # Store user message
        user_message = ChatMessage(
            conversation_id=request.conversation_id,
            role=MessageRole.USER,
            content=request.message,
            message_type=request.message_type
        )
        await db.add_message(user_message)

        # Get conversation context
        message_history = await db.get_conversation_messages(
            request.conversation_id,
            limit=settings.max_conversation_history
        )

        # Prepare request for AI orchestration
        ai_request = {
            "request_id": str(uuid.uuid4()),
            "user_id": user_id,
            "prompt": request.message,
            "context": {
                "conversation_id": request.conversation_id,
                "message_history": [
                    {"role": msg.role.value, "content": msg.content}
                    for msg in message_history[-10:]  # Last 10 messages for context
                ]
            },
            "priority": "normal",
            "preferred_model": request.preferred_model,
            "max_cost": 0.50  # Maximum cost per request
        }

        # Send to AI orchestration service
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.ai_orchestration_url}/orchestrate",
                json=ai_request
            )
            response.raise_for_status()
            ai_response = response.json()

        # Create assistant message
        assistant_message = ChatMessage(
            conversation_id=request.conversation_id,
            role=MessageRole.ASSISTANT,
            content=ai_response["response"],
            message_type=MessageType.TEXT,
            model_used=ai_response["model_used"],
            tokens_used=ai_response["tokens_used"],
            cost=ai_response["cost"],
            processing_time=ai_response["processing_time"],
            metadata={"ai_request_id": ai_response["request_id"]}
        )

        # Store assistant message
        await db.add_message(assistant_message)

        # Calculate total processing time
        total_processing_time = (datetime.utcnow() - start_time).total_seconds()

        # Create response
        chat_response = ChatResponse(
            conversation_id=request.conversation_id,
            message=assistant_message,
            model_used=ai_response["model_used"],
            processing_time=total_processing_time,
            total_tokens=ai_response["tokens_used"],
            cost=ai_response["cost"]
        )

        logger.info("Chat message processed",
                   conversation_id=request.conversation_id,
                   user_id=user_id,
                   model_used=ai_response["model_used"],
                   processing_time=total_processing_time,
                   cost=ai_response["cost"])

        return chat_response

    except Exception as e:
        logger.error("Failed to process chat message",
                    error=str(e),
                    user_id=user_id,
                    conversation_id=request.conversation_id)
        raise HTTPException(status_code=500, detail=f"Failed to process message: {str(e)}")


@app.post("/conversations", response_model=Conversation)
@limiter.limit(f"{settings.rate_limit_requests}/{settings.rate_limit_period}s")
async def create_conversation(request, conversation: Conversation):
    """Create a new conversation."""
    return await db.create_conversation(conversation)


@app.get("/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation."""
    conversation = await db.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.get("/users/{user_id}/conversations", response_model=List[ConversationSummary])
async def list_user_conversations(user_id: str, limit: int = 50, offset: int = 0):
    """List conversations for a user."""
    return await db.list_conversations(user_id, limit=limit, offset=offset)


@app.get("/conversations/{conversation_id}/messages", response_model=List[ChatMessage])
async def get_conversation_messages(conversation_id: str, limit: int = 100):
    """Get messages for a conversation."""
    return await db.get_conversation_messages(conversation_id, limit=limit)


@app.post("/feedback", response_model=MessageFeedback)
@limiter.limit(f"{settings.rate_limit_requests}/{settings.rate_limit_period}s")
async def submit_feedback(request, feedback_request: FeedbackRequest):
    """Submit feedback for a message."""
    # Get message to validate it exists and get conversation info
    # For now, we'll create a basic feedback record
    feedback = MessageFeedback(
        message_id=feedback_request.message_id,
        conversation_id="temp",  # Would need to look up from message
        user_id="temp-user",     # Would get from authentication
        feedback_type=feedback_request.feedback_type,
        rating=feedback_request.rating,
        helpful=feedback_request.helpful,
        comment=feedback_request.comment,
        categories=feedback_request.categories
    )

    return await db.add_feedback(feedback)


@app.get("/metrics", response_model=ChatMetrics)
async def get_chat_metrics():
    """Get chat service metrics."""
    # This would be implemented with actual metrics collection
    return ChatMetrics(
        total_conversations=0,
        active_conversations=0,
        total_messages=0,
        total_cost=0.0,
        feedback_count=0,
        average_response_time=150.0,
        uptime_percentage=99.9
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=settings.workers
    )