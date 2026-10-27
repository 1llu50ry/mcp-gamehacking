"""Monitoring Dashboard Service - Comprehensive system health and performance monitoring."""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager
import asyncpg
import redis.asyncio as redis
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import structlog

from config import settings
from logging_config import setup_logging, get_logger

setup_logging()
logger = get_logger(__name__)

# Pydantic models for monitoring
class ServiceHealth(BaseModel):
    """Health status of a service."""
    name: str
    url: str
    status: str  # healthy, degraded, unhealthy
    response_time_ms: Optional[float] = None
    last_checked: datetime
    components: Optional[Dict[str, str]] = None
    error_message: Optional[str] = None

class SystemMetrics(BaseModel):
    """Overall system metrics."""
    total_services: int
    healthy_services: int
    degraded_services: int
    unhealthy_services: int
    average_response_time: float
    database_connections: int
    redis_connections: int
    total_api_calls_today: int
    error_rate_percent: float
    last_updated: datetime

class PerformanceBaseline(BaseModel):
    """Performance baseline data."""
    service_name: str
    metric_name: str
    baseline_value: float
    current_value: float
    threshold_warning: float
    threshold_critical: float
    status: str  # normal, warning, critical
    trend: str  # improving, stable, degrading

class MonitoringCollector:
    """Collects monitoring data from all services."""

    def __init__(self, db_pool: Optional[asyncpg.Pool], redis_client: Optional[redis.Redis]):
        self.db = db_pool
        self.redis = redis_client
        self.logger = get_logger(self.__class__.__name__)
        self.http_client = httpx.AsyncClient(timeout=5.0)

        # Service endpoints to monitor
        self.services = {
            "Vector Search": "http://vector-search:8091/health",
            "AI Orchestration": "http://ai-orchestration:8092/health",
            "Chat Interface": "http://chat-interface:8093/health",
            "GitHub Mining": "http://github-mining:8094/health",
            "Knowledge Integration": "http://knowledge-integration:8095/health",
            "Ghidra API": "http://ghidra-api:8081/api/health"
        }

    async def check_service_health(self, name: str, url: str) -> ServiceHealth:
        """Check health of a single service."""
        try:
            start_time = datetime.utcnow()
            response = await self.http_client.get(url)
            end_time = datetime.utcnow()

            response_time = (end_time - start_time).total_seconds() * 1000

            if response.status_code == 200:
                try:
                    data = response.json()
                    status = data.get('status', 'unknown')
                    components = data.get('components', {})

                    return ServiceHealth(
                        name=name,
                        url=url,
                        status=status,
                        response_time_ms=response_time,
                        last_checked=end_time,
                        components=components
                    )
                except json.JSONDecodeError:
                    # Non-JSON response, assume healthy if 200
                    return ServiceHealth(
                        name=name,
                        url=url,
                        status="healthy",
                        response_time_ms=response_time,
                        last_checked=end_time
                    )
            else:
                return ServiceHealth(
                    name=name,
                    url=url,
                    status="unhealthy",
                    response_time_ms=response_time,
                    last_checked=end_time,
                    error_message=f"HTTP {response.status_code}"
                )

        except Exception as e:
            return ServiceHealth(
                name=name,
                url=url,
                status="unhealthy",
                response_time_ms=None,
                last_checked=datetime.utcnow(),
                error_message=str(e)
            )

    async def collect_all_health(self) -> List[ServiceHealth]:
        """Collect health status from all services."""
        health_checks = []

        for name, url in self.services.items():
            health_check = await self.check_service_health(name, url)
            health_checks.append(health_check)

        return health_checks

    async def get_system_metrics(self, health_checks: List[ServiceHealth]) -> SystemMetrics:
        """Calculate overall system metrics."""
        total = len(health_checks)
        healthy = sum(1 for h in health_checks if h.status == "healthy")
        degraded = sum(1 for h in health_checks if h.status == "degraded")
        unhealthy = sum(1 for h in health_checks if h.status == "unhealthy")

        # Calculate average response time (excluding failed requests)
        response_times = [h.response_time_ms for h in health_checks if h.response_time_ms is not None]
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0

        # Get database metrics
        db_connections = 0
        if self.db:
            try:
                async with self.db.acquire() as conn:
                    result = await conn.fetchval("SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'")
                    db_connections = result or 0
            except Exception as e:
                self.logger.warning(f"Could not get DB connection count: {e}")

        # Get Redis metrics
        redis_connections = 0
        if self.redis:
            try:
                info = await self.redis.info()
                redis_connections = info.get('connected_clients', 0)
            except Exception as e:
                self.logger.warning(f"Could not get Redis connection count: {e}")

        # Calculate error rate
        error_rate = (unhealthy / total * 100) if total > 0 else 0

        return SystemMetrics(
            total_services=total,
            healthy_services=healthy,
            degraded_services=degraded,
            unhealthy_services=unhealthy,
            average_response_time=avg_response_time,
            database_connections=db_connections,
            redis_connections=redis_connections,
            total_api_calls_today=0,  # TODO: Implement API call tracking
            error_rate_percent=error_rate,
            last_updated=datetime.utcnow()
        )

    async def store_metrics(self, health_checks: List[ServiceHealth], system_metrics: SystemMetrics):
        """Store metrics in database for historical tracking."""
        if not self.db:
            return

        try:
            async with self.db.acquire() as conn:
                # Store system metrics
                await conn.execute("""
                    INSERT INTO system_metrics (
                        timestamp, total_services, healthy_services, degraded_services,
                        unhealthy_services, average_response_time, database_connections,
                        redis_connections, error_rate_percent
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, datetime.utcnow(), system_metrics.total_services, system_metrics.healthy_services,
                    system_metrics.degraded_services, system_metrics.unhealthy_services,
                    system_metrics.average_response_time, system_metrics.database_connections,
                    system_metrics.redis_connections, system_metrics.error_rate_percent)

                # Store individual service health
                for health in health_checks:
                    await conn.execute("""
                        INSERT INTO service_health_log (
                            timestamp, service_name, status, response_time_ms, error_message
                        ) VALUES ($1, $2, $3, $4, $5)
                    """, health.last_checked, health.name, health.status, health.response_time_ms, health.error_message)

        except Exception as e:
            self.logger.error(f"Failed to store metrics: {e}")

    async def get_performance_baselines(self) -> List[PerformanceBaseline]:
        """Get performance baselines and current status."""
        baselines = []

        if not self.db:
            return baselines

        try:
            async with self.db.acquire() as conn:
                # Get average response times for each service over last 24 hours
                results = await conn.fetch("""
                    SELECT
                        service_name,
                        AVG(response_time_ms) as avg_response_time,
                        MAX(response_time_ms) as max_response_time,
                        MIN(response_time_ms) as min_response_time,
                        STDDEV(response_time_ms) as stddev_response_time
                    FROM service_health_log
                    WHERE timestamp > NOW() - INTERVAL '24 hours'
                      AND response_time_ms IS NOT NULL
                    GROUP BY service_name
                """)

                for row in results:
                    avg_time = float(row['avg_response_time'] or 0)
                    stddev_time = float(row['stddev_response_time'] or 0)

                    # Dynamic thresholds based on standard deviation
                    warning_threshold = avg_time + (2 * stddev_time)
                    critical_threshold = avg_time + (4 * stddev_time)

                    # Get most recent response time
                    recent_result = await conn.fetchval("""
                        SELECT response_time_ms FROM service_health_log
                        WHERE service_name = $1 AND response_time_ms IS NOT NULL
                        ORDER BY timestamp DESC LIMIT 1
                    """, row['service_name'])

                    current_time = float(recent_result or 0)

                    # Determine status
                    if current_time > critical_threshold:
                        status = "critical"
                    elif current_time > warning_threshold:
                        status = "warning"
                    else:
                        status = "normal"

                    baselines.append(PerformanceBaseline(
                        service_name=row['service_name'],
                        metric_name="response_time_ms",
                        baseline_value=avg_time,
                        current_value=current_time,
                        threshold_warning=warning_threshold,
                        threshold_critical=critical_threshold,
                        status=status,
                        trend="stable"  # TODO: Calculate trend
                    ))

        except Exception as e:
            self.logger.error(f"Failed to get performance baselines: {e}")

        return baselines

# Global collector instance
collector: Optional[MonitoringCollector] = None
scheduler: Optional[AsyncIOScheduler] = None

async def init_monitoring_schema(db_pool: Optional[asyncpg.Pool]):
    """Initialize monitoring database schema."""
    if not db_pool:
        return

    schema_sql = """
    -- System metrics table
    CREATE TABLE IF NOT EXISTS system_metrics (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        total_services INTEGER NOT NULL,
        healthy_services INTEGER NOT NULL,
        degraded_services INTEGER NOT NULL,
        unhealthy_services INTEGER NOT NULL,
        average_response_time DOUBLE PRECISION DEFAULT 0,
        database_connections INTEGER DEFAULT 0,
        redis_connections INTEGER DEFAULT 0,
        error_rate_percent DOUBLE PRECISION DEFAULT 0
    );

    -- Service health log table
    CREATE TABLE IF NOT EXISTS service_health_log (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        service_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        response_time_ms DOUBLE PRECISION,
        error_message TEXT
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_service_health_timestamp ON service_health_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health_log(service_name);
    """

    async with db_pool.acquire() as conn:
        await conn.execute(schema_sql)

    logger.info("Monitoring database schema initialized")

async def collect_metrics():
    """Scheduled task to collect metrics from all services."""
    if not collector:
        return

    logger.info("Starting metrics collection")

    try:
        health_checks = await collector.collect_all_health()
        system_metrics = await collector.get_system_metrics(health_checks)
        await collector.store_metrics(health_checks, system_metrics)

        logger.info(f"Metrics collection completed: {system_metrics.healthy_services}/{system_metrics.total_services} services healthy")

    except Exception as e:
        logger.error(f"Metrics collection failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    global collector, scheduler

    # Startup
    logger.info("Starting Monitoring Dashboard Service")

    # Database connection
    db_pool = None
    try:
        db_pool = await asyncpg.create_pool(
            host=settings.db_host,
            port=settings.db_port,
            user=settings.db_user,
            password=settings.db_password,
            database=settings.db_name,
            min_size=2,
            max_size=10
        )
        logger.info("Database connection established")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        logger.warning("Service starting without database")

    # Redis connection
    redis_client = None
    try:
        redis_client = redis.from_url(f"redis://{settings.redis_host}:{settings.redis_port}")
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception as e:
        logger.error(f"Redis connection failed: {e}")
        logger.warning("Service starting without Redis")

    # Initialize monitoring schema
    if db_pool:
        await init_monitoring_schema(db_pool)

    # Create collector instance
    collector = MonitoringCollector(db_pool, redis_client)

    # Setup scheduler for periodic metrics collection
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        collect_metrics,
        'interval',
        minutes=1,  # Collect metrics every minute
        id='metrics_collection',
        replace_existing=True
    )
    scheduler.start()

    logger.info("Monitoring Dashboard Service started successfully")

    yield

    # Shutdown
    logger.info("Shutting down Monitoring Dashboard Service")

    if scheduler:
        scheduler.shutdown()

    if collector and collector.http_client:
        await collector.http_client.aclose()

    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

# FastAPI app setup
app = FastAPI(
    title="Monitoring Dashboard Service",
    description="Comprehensive system health and performance monitoring",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    collector_healthy = collector is not None
    db_healthy = collector is not None and collector.db is not None
    redis_healthy = collector is not None and collector.redis is not None

    status = "healthy" if collector_healthy else "unhealthy"
    if collector_healthy and not (db_healthy and redis_healthy):
        status = "degraded"

    return {
        "status": status,
        "service": "monitoring-dashboard",
        "version": "1.0.0",
        "timestamp": datetime.utcnow(),
        "components": {
            "collector": "healthy" if collector_healthy else "unhealthy",
            "database": "healthy" if db_healthy else "unhealthy",
            "redis": "healthy" if redis_healthy else "unhealthy",
            "scheduler": "healthy" if scheduler and scheduler.running else "stopped"
        }
    }

@app.get("/api/health/all")
async def get_all_health():
    """Get health status of all services."""
    if not collector:
        raise HTTPException(status_code=503, detail="Collector not initialized")

    health_checks = await collector.collect_all_health()
    return health_checks

@app.get("/api/metrics/system")
async def get_system_metrics():
    """Get current system metrics."""
    if not collector:
        raise HTTPException(status_code=503, detail="Collector not initialized")

    health_checks = await collector.collect_all_health()
    system_metrics = await collector.get_system_metrics(health_checks)
    return system_metrics

@app.get("/api/baselines/performance")
async def get_performance_baselines():
    """Get performance baselines and current status."""
    if not collector:
        raise HTTPException(status_code=503, detail="Collector not initialized")

    baselines = await collector.get_performance_baselines()
    return baselines

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main monitoring dashboard page."""
    return templates.TemplateResponse("dashboard.html", {"request": request})

@app.get("/api/metrics/history/{hours}")
async def get_metrics_history(hours: int):
    """Get historical metrics for the specified number of hours."""
    if not collector or not collector.db:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        async with collector.db.acquire() as conn:
            results = await conn.fetch("""
                SELECT * FROM system_metrics
                WHERE timestamp > NOW() - INTERVAL '%s hours'
                ORDER BY timestamp ASC
            """, hours)

            return [dict(row) for row in results]

    except Exception as e:
        logger.error(f"Failed to get metrics history: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve metrics history")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8096,
        reload=True if settings.environment == "development" else False
    )