"""Main FastAPI application for AI Orchestration Service."""

import asyncio
import uuid
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import (
    OrchestrationRequest, OrchestrationResponse, HealthStatus,
    BudgetStatus, SystemMetrics, TaskClassification
)
from config import settings
from logging_config import setup_logging, get_logger
from cost_manager import CostManager
from task_classifier import TaskClassifier

# Setup logging
setup_logging()
logger = get_logger(__name__)

# Global instances
redis_client: Optional[redis.Redis] = None
cost_manager: Optional[CostManager] = None
task_classifier: Optional[TaskClassifier] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management."""
    global redis_client, cost_manager, task_classifier

    logger.info("Starting AI Orchestration Service",
                version=settings.service_version,
                debug=settings.debug)

    try:
        # Initialize Redis connection
        redis_client = redis.from_url(
            settings.redis_url,
            decode_responses=False,
            retry_on_timeout=True,
            health_check_interval=30
        )

        # Test Redis connection
        await redis_client.ping()
        logger.info("Redis connection established",
                   host=settings.redis_host,
                   port=settings.redis_port)

        # Initialize cost manager
        cost_manager = CostManager(redis_client)
        logger.info("Cost manager initialized")

        # Initialize task classifier
        task_classifier = TaskClassifier()
        logger.info("Task classifier initialized")

        logger.info("AI Orchestration Service startup completed")

    except Exception as e:
        logger.error("Failed to start AI Orchestration Service", error=str(e))
        raise

    yield

    # Cleanup
    logger.info("Shutting down AI Orchestration Service")

    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed")

    logger.info("AI Orchestration Service shutdown completed")


# Create FastAPI app
app = FastAPI(
    title="AI Orchestration Service",
    description="Multi-model AI coordination with cost controls and intelligent routing",
    version=settings.service_version,
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthStatus)
async def health_check():
    """Health check endpoint."""
    try:
        # Test Redis connection
        redis_healthy = False
        try:
            await redis_client.ping()
            redis_healthy = True
        except Exception as e:
            logger.warning("Redis health check failed", error=str(e))

        # Test AI API availability (basic check)
        anthropic_available = bool(settings.anthropic_api_key)

        # Get budget status
        budget_status = BudgetStatus.NORMAL
        if cost_manager:
            spending = await cost_manager.get_spending_summary()
            budget_status = BudgetStatus(spending["budget_status"])

        # Determine overall status
        if redis_healthy and anthropic_available:
            status = "healthy"
        elif redis_healthy:
            status = "degraded"
        else:
            status = "unhealthy"

        return HealthStatus(
            status=status,
            service=settings.service_name,
            version=settings.service_version,
            database_connected=False,  # Not using database directly
            redis_connected=redis_healthy,
            anthropic_api_available=anthropic_available,
            avg_response_time_ms=250.0,  # Placeholder
            error_rate_percent=0.0,     # Placeholder
            budget_status=budget_status
        )

    except Exception as e:
        logger.error("Health check failed", error=str(e))
        return HealthStatus(
            status="unhealthy",
            service=settings.service_name,
            version=settings.service_version,
            database_connected=False,
            redis_connected=False,
            anthropic_api_available=False,
            avg_response_time_ms=0.0,
            error_rate_percent=100.0,
            budget_status=BudgetStatus.EMERGENCY
        )


@app.get("/metrics", response_model=SystemMetrics)
async def get_metrics():
    """Get system performance metrics."""
    try:
        spending = await cost_manager.get_spending_summary()

        return SystemMetrics(
            total_requests_today=0,  # TODO: Implement request counting
            successful_requests_today=0,
            failed_requests_today=0,
            avg_response_time_ms=250.0,
            cache_hit_rate_percent=0.0,  # TODO: Implement cache metrics
            cost_per_quality_point=0.05,  # TODO: Calculate from actual data
            budget_utilization_percent=spending["daily_percentage"],
            model_distribution=spending["model_breakdown"],
            task_type_distribution={}  # TODO: Implement task type tracking
        )

    except Exception as e:
        logger.error("Failed to get metrics", error=str(e))
        return SystemMetrics()


@app.post("/classify", response_model=TaskClassification)
async def classify_task(request: OrchestrationRequest):
    """Classify a task and get routing recommendation."""
    try:
        if not task_classifier:
            raise HTTPException(status_code=503, detail="Task classifier not initialized")

        classification = await task_classifier.classify_request(request)

        logger.info("Task classified",
                   request_id=request.request_id,
                   recommended_model=classification.recommended_model.value,
                   estimated_cost=classification.estimated_cost)

        return classification

    except Exception as e:
        logger.error("Task classification failed",
                    request_id=request.request_id,
                    error=str(e))
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


@app.post("/orchestrate", response_model=OrchestrationResponse)
async def orchestrate_request(request: OrchestrationRequest, background_tasks: BackgroundTasks):
    """Main orchestration endpoint - classify, route, and execute AI request."""
    start_time = datetime.now()

    # Ensure request has ID
    if not request.request_id:
        request.request_id = str(uuid.uuid4())

    logger.info("Orchestration request received",
               request_id=request.request_id,
               user_id=request.user_id,
               priority=request.priority.value)

    try:
        # Step 1: Classify the request
        classification = await task_classifier.classify_request(request)

        # Step 2: Check budget constraints
        affordable, budget_error = await cost_manager.check_request_affordability(
            request, classification.estimated_cost
        )

        if not affordable:
            logger.warning("Request rejected due to budget constraints",
                          request_id=request.request_id,
                          error=budget_error)

            return OrchestrationResponse(
                request_id=request.request_id,
                success=False,
                error=f"Budget constraint: {budget_error}",
                processing_time=(datetime.now() - start_time).total_seconds(),
                cost=0.0,
                tokens_used=0,
                classification=classification,
                remaining_budget=settings.daily_budget - cost_manager.cost_tracker.daily_spend,
                rate_limit_remaining=100  # Placeholder
            )

        # Step 3: Check for cost optimization suggestions
        suggested_model = await cost_manager.suggest_cost_optimization(classification.recommended_model)
        if suggested_model and suggested_model != classification.recommended_model:
            logger.info("Model downgraded for cost optimization",
                       original=classification.recommended_model.value,
                       suggested=suggested_model.value)
            classification.recommended_model = suggested_model
            classification.reasoning += f" (Cost-optimized to {suggested_model.value})"

        # Step 4: Execute the request (placeholder - would integrate with actual AI APIs)
        response_text = await _execute_ai_request(request, classification)

        # Step 5: Calculate actual metrics
        processing_time = (datetime.now() - start_time).total_seconds()
        tokens_used = int(len(request.prompt) * 1.3)  # Rough estimate
        actual_cost = cost_manager.calculate_request_cost(
            classification.recommended_model,
            int(tokens_used * 0.7),  # Input tokens
            int(tokens_used * 0.3)   # Output tokens
        )

        # Step 6: Create response
        response = OrchestrationResponse(
            request_id=request.request_id,
            success=True,
            response=response_text,
            model_used=classification.recommended_model,
            processing_time=processing_time,
            cost=actual_cost,
            tokens_used=tokens_used,
            classification=classification,
            remaining_budget=settings.daily_budget - cost_manager.cost_tracker.daily_spend,
            rate_limit_remaining=100  # Placeholder
        )

        # Step 7: Track cost in background
        background_tasks.add_task(cost_manager.track_request_cost, request, response)

        logger.info("Orchestration request completed",
                   request_id=request.request_id,
                   model_used=response.model_used.value,
                   processing_time=processing_time,
                   cost=actual_cost,
                   success=True)

        return response

    except Exception as e:
        processing_time = (datetime.now() - start_time).total_seconds()

        logger.error("Orchestration request failed",
                    request_id=request.request_id,
                    error=str(e),
                    processing_time=processing_time)

        return OrchestrationResponse(
            request_id=request.request_id,
            success=False,
            error=f"Orchestration failed: {str(e)}",
            processing_time=processing_time,
            cost=0.0,
            tokens_used=0,
            remaining_budget=settings.daily_budget - cost_manager.cost_tracker.daily_spend if cost_manager else 0,
            rate_limit_remaining=100  # Placeholder
        )


async def _execute_ai_request(
    request: OrchestrationRequest,
    classification: TaskClassification
) -> str:
    """Execute the actual AI request (placeholder implementation)."""

    # This is a placeholder implementation
    # In a real implementation, this would:
    # 1. Route to appropriate AI API (Anthropic, OpenAI, etc.)
    # 2. Handle retries and fallbacks
    # 3. Apply circuit breaker patterns
    # 4. Implement caching

    await asyncio.sleep(1)  # Simulate processing time

    return f"""AI Orchestration Service Response (Simulated)

Request ID: {request.request_id}
Model Used: {classification.recommended_model.value}
Task Type: {classification.task_type.value}
Complexity: {classification.complexity.value}

This is a placeholder response. In a full implementation, this would contain:
- Actual AI model response
- Proper error handling
- Response caching
- Quality scoring

Request Content: {request.prompt[:200]}{"..." if len(request.prompt) > 200 else ""}

Classification Reasoning: {classification.reasoning}
"""


@app.get("/budget", response_model=Dict[str, Any])
async def get_budget_status():
    """Get current budget status and spending summary."""
    try:
        spending = await cost_manager.get_spending_summary()
        prediction = await cost_manager.predict_daily_spend()

        return {
            "spending_summary": spending,
            "prediction": prediction,
            "protection_active": spending["protection_active"],
            "recommendations": []  # TODO: Add cost optimization recommendations
        }

    except Exception as e:
        logger.error("Failed to get budget status", error=str(e))
        raise HTTPException(status_code=500, detail=f"Budget status failed: {str(e)}")


@app.post("/budget/reset")
async def reset_budget():
    """Reset daily budget (admin endpoint)."""
    try:
        # Force reset daily costs
        await cost_manager._reset_daily_costs()

        logger.info("Budget manually reset")
        return {"message": "Budget reset successfully"}

    except Exception as e:
        logger.error("Failed to reset budget", error=str(e))
        raise HTTPException(status_code=500, detail=f"Budget reset failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=settings.workers
    )