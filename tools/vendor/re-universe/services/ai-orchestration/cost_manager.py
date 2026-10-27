"""Cost tracking and budget management for AI orchestration."""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import redis.asyncio as redis

from models import (
    ModelType, BudgetStatus, CostTracker, BudgetAlert,
    OrchestrationRequest, OrchestrationResponse
)
from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class CostManager:
    """Manages cost tracking, budget monitoring, and financial controls."""

    # Model pricing (per 1K tokens) - approximate pricing
    MODEL_PRICING = {
        ModelType.OPUS: {"input": 0.015, "output": 0.075},
        ModelType.SONNET: {"input": 0.003, "output": 0.015},
        ModelType.HAIKU: {"input": 0.00025, "output": 0.00125}
    }

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.cost_tracker = CostTracker()
        self.alerts_sent_today = set()

        # Load existing cost data
        asyncio.create_task(self._load_cost_data())

    async def _load_cost_data(self) -> None:
        """Load existing cost tracking data from Redis."""
        try:
            cost_data = await self.redis.get("cost_tracker")
            if cost_data:
                self.cost_tracker = CostTracker.model_validate_json(cost_data)

                # Reset daily costs if it's a new day
                if self.cost_tracker.last_reset.date() < datetime.now().date():
                    await self._reset_daily_costs()

            logger.info("Cost tracker initialized",
                       daily_spend=self.cost_tracker.daily_spend,
                       budget_status=self.cost_tracker.budget_status.value)

        except Exception as e:
            logger.error("Failed to load cost data", error=str(e))

    async def _reset_daily_costs(self) -> None:
        """Reset daily cost tracking for a new day."""
        logger.info("Resetting daily cost tracking")

        self.cost_tracker.daily_spend = 0.0
        self.cost_tracker.hourly_spend = {}
        self.cost_tracker.budget_status = BudgetStatus.NORMAL
        self.cost_tracker.budget_alerts_sent = []
        self.cost_tracker.last_reset = datetime.now()
        self.alerts_sent_today = set()

        await self._save_cost_data()

    async def _save_cost_data(self) -> None:
        """Save cost tracking data to Redis."""
        try:
            cost_json = self.cost_tracker.model_dump_json()
            await self.redis.set("cost_tracker", cost_json, ex=86400)  # 24 hour expiry
        except Exception as e:
            logger.error("Failed to save cost data", error=str(e))

    def calculate_request_cost(self, model: ModelType, input_tokens: int, output_tokens: int) -> float:
        """Calculate the cost of a request based on model and token usage."""
        pricing = self.MODEL_PRICING.get(model)
        if not pricing:
            logger.warning("Unknown model pricing", model=model.value)
            return 0.0

        input_cost = (input_tokens / 1000) * pricing["input"]
        output_cost = (output_tokens / 1000) * pricing["output"]
        total_cost = input_cost + output_cost

        return round(total_cost, 6)

    async def track_request_cost(
        self,
        request: OrchestrationRequest,
        response: OrchestrationResponse
    ) -> None:
        """Track the cost of a completed request."""
        if not response.model_used:
            logger.warning("No model specified for cost tracking", request_id=request.request_id)
            return

        # Calculate actual cost if not provided
        cost = response.cost
        if cost == 0 and response.tokens_used > 0:
            # Estimate token split (rough approximation)
            input_tokens = int(response.tokens_used * 0.7)
            output_tokens = int(response.tokens_used * 0.3)
            cost = self.calculate_request_cost(response.model_used, input_tokens, output_tokens)

        await self._update_cost_tracking(response.model_used, cost, datetime.now())

        logger.debug("Request cost tracked",
                    request_id=request.request_id,
                    model=response.model_used.value,
                    cost=cost,
                    tokens=response.tokens_used)

    async def _update_cost_tracking(self, model: ModelType, cost: float, timestamp: datetime) -> None:
        """Update internal cost tracking structures."""
        # Update daily spend
        self.cost_tracker.daily_spend += cost

        # Update weekly and monthly (approximate)
        self.cost_tracker.weekly_spend += cost
        self.cost_tracker.monthly_spend += cost

        # Update model-specific spend
        if model.value not in self.cost_tracker.model_spend:
            self.cost_tracker.model_spend[model.value] = 0.0
        self.cost_tracker.model_spend[model.value] += cost

        # Update hourly spend
        hour = timestamp.hour
        if hour not in self.cost_tracker.hourly_spend:
            self.cost_tracker.hourly_spend[hour] = 0.0
        self.cost_tracker.hourly_spend[hour] += cost

        # Check budget thresholds
        await self._check_budget_thresholds()

        # Save updated data
        await self._save_cost_data()

    async def _check_budget_thresholds(self) -> None:
        """Check budget thresholds and trigger appropriate actions."""
        daily_percentage = self.cost_tracker.daily_spend / settings.daily_budget
        thresholds = settings.budget_thresholds

        new_status = BudgetStatus.NORMAL
        if daily_percentage >= thresholds["emergency"]:
            new_status = BudgetStatus.EMERGENCY
        elif daily_percentage >= thresholds["critical"]:
            new_status = BudgetStatus.CRITICAL
        elif daily_percentage >= thresholds["warning"]:
            new_status = BudgetStatus.WARNING

        # Status changed - take action
        if new_status != self.cost_tracker.budget_status:
            old_status = self.cost_tracker.budget_status
            self.cost_tracker.budget_status = new_status

            await self._handle_budget_status_change(old_status, new_status, daily_percentage)

    async def _handle_budget_status_change(
        self,
        old_status: BudgetStatus,
        new_status: BudgetStatus,
        percentage: float
    ) -> None:
        """Handle budget status changes and take appropriate actions."""
        logger.warning("Budget status changed",
                      old_status=old_status.value,
                      new_status=new_status.value,
                      percentage=f"{percentage:.2%}",
                      daily_spend=self.cost_tracker.daily_spend,
                      daily_budget=settings.daily_budget)

        alert = BudgetAlert(
            alert_type=new_status,
            message=f"Budget status changed to {new_status.value}",
            current_spend=self.cost_tracker.daily_spend,
            budget_limit=settings.daily_budget,
            percentage_used=percentage,
            actions_taken=[]
        )

        if new_status == BudgetStatus.WARNING:
            alert.actions_taken = ["Monitoring increased"]

        elif new_status == BudgetStatus.CRITICAL:
            alert.actions_taken = [
                "Restricting expensive models",
                "Enabling aggressive caching"
            ]
            # Store critical protection settings
            await self.redis.set("budget_protection", "critical", ex=3600)

        elif new_status == BudgetStatus.EMERGENCY:
            alert.actions_taken = [
                "Emergency protection activated",
                "Haiku-only mode enabled",
                "Request queueing enabled"
            ]
            # Store emergency protection settings
            await self.redis.set("budget_protection", "emergency", ex=86400)

        # Store alert
        alert_key = f"budget_alert:{datetime.now().isoformat()}"
        await self.redis.set(alert_key, alert.model_dump_json(), ex=86400)

        self.cost_tracker.budget_alerts_sent.append(alert_key)

    async def check_request_affordability(
        self,
        request: OrchestrationRequest,
        estimated_cost: float
    ) -> Tuple[bool, Optional[str]]:
        """Check if a request can be afforded within current budget constraints."""

        # Check daily budget
        remaining_daily = settings.daily_budget - self.cost_tracker.daily_spend
        if estimated_cost > remaining_daily:
            return False, f"Request cost ${estimated_cost:.4f} exceeds remaining daily budget ${remaining_daily:.4f}"

        # Check user-specific max cost
        if request.max_cost and estimated_cost > request.max_cost:
            return False, f"Request cost ${estimated_cost:.4f} exceeds user limit ${request.max_cost:.4f}"

        # Check emergency protection status
        protection_level = await self.redis.get("budget_protection")
        if protection_level:
            protection_level = protection_level.decode()

            if protection_level == "emergency" and estimated_cost > 0.01:  # 1 cent limit in emergency
                return False, "Emergency budget protection active - only minimal cost requests allowed"

            elif protection_level == "critical" and estimated_cost > 0.05:  # 5 cent limit in critical
                return False, "Critical budget protection active - request cost too high"

        return True, None

    async def get_budget_protection_level(self) -> Optional[str]:
        """Get current budget protection level."""
        protection = await self.redis.get("budget_protection")
        return protection.decode() if protection else None

    async def suggest_cost_optimization(self, model: ModelType) -> Optional[ModelType]:
        """Suggest a more cost-effective model based on current budget status."""
        protection_level = await self.get_budget_protection_level()

        if protection_level == "emergency":
            return ModelType.HAIKU  # Always use cheapest model

        elif protection_level == "critical":
            # Downgrade expensive models
            if model == ModelType.OPUS:
                return ModelType.SONNET
            elif model == ModelType.SONNET:
                return ModelType.HAIKU

        elif self.cost_tracker.budget_status == BudgetStatus.WARNING:
            # Gentle cost optimization
            if model == ModelType.OPUS:
                # Suggest Sonnet instead of Opus for non-critical tasks
                return ModelType.SONNET

        return None  # No optimization needed

    async def get_spending_summary(self) -> Dict[str, any]:
        """Get comprehensive spending summary."""
        daily_percentage = (self.cost_tracker.daily_spend / settings.daily_budget) * 100

        return {
            "daily_spend": self.cost_tracker.daily_spend,
            "daily_budget": settings.daily_budget,
            "daily_remaining": settings.daily_budget - self.cost_tracker.daily_spend,
            "daily_percentage": round(daily_percentage, 2),

            "weekly_spend": self.cost_tracker.weekly_spend,
            "monthly_spend": self.cost_tracker.monthly_spend,

            "model_breakdown": self.cost_tracker.model_spend,
            "hourly_breakdown": self.cost_tracker.hourly_spend,

            "budget_status": self.cost_tracker.budget_status.value,
            "protection_active": await self.get_budget_protection_level() is not None,

            "last_reset": self.cost_tracker.last_reset.isoformat()
        }

    async def predict_daily_spend(self) -> Dict[str, float]:
        """Predict total daily spend based on current patterns."""
        current_hour = datetime.now().hour

        if current_hour == 0:
            return {
                "predicted_total": self.cost_tracker.daily_spend,
                "confidence": 0.1,
                "risk_level": "unknown"
            }

        # Calculate average hourly spend so far
        total_spent = self.cost_tracker.daily_spend
        avg_hourly = total_spent / (current_hour + 1)

        # Predict remaining hours
        remaining_hours = 24 - (current_hour + 1)
        predicted_remaining = avg_hourly * remaining_hours
        predicted_total = total_spent + predicted_remaining

        # Calculate confidence based on time of day
        confidence = min(1.0, (current_hour + 1) / 12)  # More confident as day progresses

        # Determine risk level
        predicted_percentage = predicted_total / settings.daily_budget
        if predicted_percentage > 1.0:
            risk_level = "high"
        elif predicted_percentage > 0.9:
            risk_level = "medium"
        else:
            risk_level = "low"

        return {
            "predicted_total": round(predicted_total, 4),
            "confidence": round(confidence, 2),
            "risk_level": risk_level,
            "current_spend": total_spent,
            "predicted_remaining": round(predicted_remaining, 4)
        }