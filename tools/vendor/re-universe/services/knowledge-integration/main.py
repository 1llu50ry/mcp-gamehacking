"""Knowledge Integration Service - Bridges GitHub community insights with BSim function analysis."""

import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager
import asyncpg
import redis.asyncio as redis
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import structlog

from config import settings
from logging_config import setup_logging, get_logger
from knowledge_bridge import GhidraKnowledgeBridge, GhidraAnalysisWebhook

setup_logging()
logger = get_logger(__name__)

# Pydantic models for knowledge integration
class FunctionInsight(BaseModel):
    """Represents an insight about a function derived from community knowledge."""
    function_id: int
    function_name: str
    executable_id: int
    github_repo_id: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    insight_type: str  # 'vulnerability', 'pattern', 'usage', 'documentation'
    insight_content: str
    evidence: List[str] = Field(default_factory=list)
    last_updated: datetime = Field(default_factory=datetime.utcnow)

class IntegrationStats(BaseModel):
    """Statistics about the knowledge integration process."""
    total_functions_analyzed: int
    functions_with_insights: int
    github_repositories_linked: int
    vulnerability_insights: int
    pattern_insights: int
    usage_insights: int
    documentation_insights: int
    average_confidence_score: float
    last_integration_run: Optional[datetime] = None
    integration_runs_today: int
    pending_analyses: int

class KnowledgeIntegrator:
    """Integrates GitHub community insights with BSim function analysis."""

    def __init__(self, db_pool: asyncpg.Pool, redis_client: redis.Redis):
        self.db = db_pool
        self.redis = redis_client
        self.logger = get_logger(self.__class__.__name__)

    async def analyze_function_similarity(self, function_id: int) -> List[FunctionInsight]:
        """Analyze a function and find similar functions in GitHub repositories."""
        insights = []

        try:
            async with self.db.acquire() as conn:
                # Get function details
                func_result = await conn.fetchrow("""
                    SELECT fa.*, et.exe_name
                    FROM function_analysis fa
                    JOIN executabletable et ON fa.executable_id = et.id
                    WHERE fa.id = $1
                """, function_id)

                if not func_result:
                    self.logger.warning(f"Function {function_id} not found")
                    return insights

                # Look for similar functions based on complexity and patterns
                similar_functions = await conn.fetch("""
                    SELECT fa2.*, et2.exe_name,
                           ABS(fa2.cyclomatic_complexity - $2) as complexity_diff,
                           ABS(fa2.instruction_count - $3) as instruction_diff
                    FROM function_analysis fa2
                    JOIN executabletable et2 ON fa2.executable_id = et2.id
                    WHERE fa2.id != $1
                      AND ABS(fa2.cyclomatic_complexity - $2) <= 5
                      AND ABS(fa2.instruction_count - $3) <= 50
                    ORDER BY complexity_diff + (instruction_diff / 10)
                    LIMIT 20
                """, function_id, func_result['cyclomatic_complexity'], func_result['instruction_count'])

                # Look for GitHub repositories with similar patterns
                github_matches = await conn.fetch("""
                    SELECT gr.*, ke.extract_type, ke.content, ke.confidence_score
                    FROM github_repositories gr
                    JOIN knowledge_extracts ke ON gr.repo_id = ke.repo_id
                    WHERE ke.extract_type = 'code_pattern'
                      AND gr.quality_score > 0.7
                      AND gr.relevance_score > 0.6
                    ORDER BY gr.quality_score DESC, gr.relevance_score DESC
                    LIMIT 10
                """)

                # Generate insights from similar functions
                if similar_functions:
                    pattern_insight = FunctionInsight(
                        function_id=function_id,
                        function_name=func_result['function_name'] or 'unnamed',
                        executable_id=func_result['executable_id'],
                        confidence_score=min(0.8, len(similar_functions) / 10.0),
                        insight_type='pattern',
                        insight_content=f"Function shows similar complexity patterns to {len(similar_functions)} other functions",
                        evidence=[f"{sf['exe_name']}:{sf['function_name']}" for sf in similar_functions[:5] if sf['function_name']]
                    )
                    insights.append(pattern_insight)

                # Generate insights from GitHub matches
                for match in github_matches:
                    if match['confidence_score'] and match['confidence_score'] > 0.6:
                        github_insight = FunctionInsight(
                            function_id=function_id,
                            function_name=func_result['function_name'] or 'unnamed',
                            executable_id=func_result['executable_id'],
                            github_repo_id=str(match['repo_id']),
                            confidence_score=float(match['confidence_score']),
                            insight_type='documentation',
                            insight_content=f"Similar patterns found in high-quality repository: {match['full_name']}",
                            evidence=[match['content'][:200]] if match['content'] else []
                        )
                        insights.append(github_insight)

        except Exception as e:
            self.logger.error(f"Error analyzing function {function_id}: {e}")

        return insights

    async def store_insights(self, insights: List[FunctionInsight]) -> int:
        """Store function insights in the database."""
        stored_count = 0

        try:
            async with self.db.acquire() as conn:
                for insight in insights:
                    # Create a unique key for deduplication
                    insight_key = hashlib.md5(
                        f"{insight.function_id}:{insight.insight_type}:{insight.insight_content}".encode()
                    ).hexdigest()

                    await conn.execute("""
                        INSERT INTO function_insights (
                            function_id, function_name, executable_id, github_repo_id,
                            confidence_score, insight_type, insight_content, evidence,
                            insight_key, last_updated
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (insight_key) DO UPDATE SET
                            confidence_score = EXCLUDED.confidence_score,
                            insight_content = EXCLUDED.insight_content,
                            evidence = EXCLUDED.evidence,
                            last_updated = EXCLUDED.last_updated
                    """, insight.function_id, insight.function_name, insight.executable_id,
                        insight.github_repo_id, insight.confidence_score, insight.insight_type,
                        insight.insight_content, insight.evidence, insight_key, insight.last_updated)

                    stored_count += 1

        except Exception as e:
            self.logger.error(f"Error storing insights: {e}")

        return stored_count

    async def get_integration_stats(self) -> IntegrationStats:
        """Get statistics about the knowledge integration process."""
        try:
            async with self.db.acquire() as conn:
                # Function analysis stats
                func_stats = await conn.fetchrow("""
                    SELECT
                        COUNT(*) as total_functions,
                        COUNT(DISTINCT CASE WHEN fi.function_id IS NOT NULL THEN fa.id END) as functions_with_insights
                    FROM function_analysis fa
                    LEFT JOIN function_insights fi ON fa.id = fi.function_id
                """)

                # GitHub integration stats
                github_stats = await conn.fetchrow("""
                    SELECT
                        COUNT(DISTINCT gr.repo_id) as github_repos,
                        COUNT(DISTINCT fi.github_repo_id) as linked_repos
                    FROM github_repositories gr
                    LEFT JOIN function_insights fi ON gr.repo_id::text = fi.github_repo_id
                """)

                # Insight type breakdown
                insight_stats = await conn.fetchrow("""
                    SELECT
                        COUNT(CASE WHEN insight_type = 'vulnerability' THEN 1 END) as vulnerability_insights,
                        COUNT(CASE WHEN insight_type = 'pattern' THEN 1 END) as pattern_insights,
                        COUNT(CASE WHEN insight_type = 'usage' THEN 1 END) as usage_insights,
                        COUNT(CASE WHEN insight_type = 'documentation' THEN 1 END) as documentation_insights,
                        AVG(confidence_score) as avg_confidence,
                        MAX(last_updated) as last_run,
                        COUNT(CASE WHEN DATE(last_updated) = CURRENT_DATE THEN 1 END) as runs_today
                    FROM function_insights
                """)

                return IntegrationStats(
                    total_functions_analyzed=func_stats['total_functions'] or 0,
                    functions_with_insights=func_stats['functions_with_insights'] or 0,
                    github_repositories_linked=github_stats['linked_repos'] or 0,
                    vulnerability_insights=insight_stats['vulnerability_insights'] or 0,
                    pattern_insights=insight_stats['pattern_insights'] or 0,
                    usage_insights=insight_stats['usage_insights'] or 0,
                    documentation_insights=insight_stats['documentation_insights'] or 0,
                    average_confidence_score=float(insight_stats['avg_confidence'] or 0.0),
                    last_integration_run=insight_stats['last_run'],
                    integration_runs_today=insight_stats['runs_today'] or 0,
                    pending_analyses=0  # TODO: Implement queue tracking
                )

        except Exception as e:
            self.logger.error(f"Error getting integration stats: {e}")
            return IntegrationStats(
                total_functions_analyzed=0, functions_with_insights=0,
                github_repositories_linked=0, vulnerability_insights=0,
                pattern_insights=0, usage_insights=0, documentation_insights=0,
                average_confidence_score=0.0, integration_runs_today=0, pending_analyses=0
            )

# Global integrator instance
integrator: Optional[KnowledgeIntegrator] = None
scheduler: Optional[AsyncIOScheduler] = None
knowledge_bridge: Optional[GhidraKnowledgeBridge] = None
analysis_webhook: Optional[GhidraAnalysisWebhook] = None

async def init_database_schema(db_pool: asyncpg.Pool):
    """Initialize database schema for knowledge integration."""
    schema_sql = """
    -- Function insights table for storing community knowledge insights
    CREATE TABLE IF NOT EXISTS function_insights (
        id SERIAL PRIMARY KEY,
        function_id BIGINT NOT NULL,
        function_name VARCHAR(256),
        executable_id INTEGER,
        github_repo_id VARCHAR(36),  -- UUID as string
        confidence_score DOUBLE PRECISION DEFAULT 0.0,
        insight_type VARCHAR(50) NOT NULL,  -- 'vulnerability', 'pattern', 'usage', 'documentation'
        insight_content TEXT NOT NULL,
        evidence TEXT[] DEFAULT '{}',
        insight_key VARCHAR(32) UNIQUE,  -- MD5 hash for deduplication
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_function_insights_function_id ON function_insights(function_id);
    CREATE INDEX IF NOT EXISTS idx_function_insights_type ON function_insights(insight_type);
    CREATE INDEX IF NOT EXISTS idx_function_insights_confidence ON function_insights(confidence_score DESC);
    CREATE INDEX IF NOT EXISTS idx_function_insights_github_repo ON function_insights(github_repo_id);
    """

    async with db_pool.acquire() as conn:
        await conn.execute(schema_sql)

    logger.info("Knowledge integration database schema initialized")

async def scheduled_integration():
    """Scheduled task to run knowledge integration."""
    if not integrator:
        return

    logger.info("Starting scheduled knowledge integration")

    try:
        # Get functions that need analysis
        async with integrator.db.acquire() as conn:
            functions = await conn.fetch("""
                SELECT fa.id
                FROM function_analysis fa
                LEFT JOIN function_insights fi ON fa.id = fi.function_id
                WHERE fi.function_id IS NULL OR fi.last_updated < NOW() - INTERVAL '7 days'
                ORDER BY fa.id
                LIMIT 100
            """)

            total_insights = 0
            for func in functions:
                insights = await integrator.analyze_function_similarity(func['id'])
                stored = await integrator.store_insights(insights)
                total_insights += stored

            logger.info(f"Knowledge integration completed: {total_insights} insights for {len(functions)} functions")

    except Exception as e:
        logger.error(f"Scheduled integration failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    global integrator, scheduler, knowledge_bridge, analysis_webhook

    # Startup
    logger.info("Starting Knowledge Integration Service")

    # Database connection with retry logic
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
        logger.warning("Service starting in degraded mode without database")

    # Redis connection
    redis_client = None
    try:
        redis_client = redis.from_url(f"redis://{settings.redis_host}:{settings.redis_port}")
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception as e:
        logger.error(f"Redis connection failed: {e}")
        logger.warning("Service starting without Redis cache")

    # Initialize database schema if database is available
    if db_pool:
        await init_database_schema(db_pool)

    # Create integrator instance
    integrator = KnowledgeIntegrator(db_pool, redis_client)

    # Initialize Ghidra Knowledge Bridge
    if db_pool:
        knowledge_bridge = GhidraKnowledgeBridge(
            ghidra_url="http://ghidra-server:8089",
            knowledge_url="http://localhost:8083",
            db_url=f"postgresql://{settings.db_user}:{settings.db_password}@{settings.db_host}:{settings.db_port}/{settings.db_name}"
        )
        await knowledge_bridge.connect()

        # Initialize webhook handler
        analysis_webhook = GhidraAnalysisWebhook(knowledge_bridge)
        logger.info("Ghidra Knowledge Bridge initialized")

    # Setup scheduler for periodic integration
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        scheduled_integration,
        'interval',
        hours=6,  # Run every 6 hours
        id='knowledge_integration',
        replace_existing=True
    )
    scheduler.start()

    logger.info("Knowledge Integration Service started successfully")

    yield

    # Shutdown
    logger.info("Shutting down Knowledge Integration Service")

    if scheduler:
        scheduler.shutdown()

    if knowledge_bridge:
        await knowledge_bridge.close()

    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

# FastAPI app setup
app = FastAPI(
    title="Knowledge Integration Service",
    description="Bridges GitHub community insights with BSim function analysis",
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

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    db_healthy = integrator is not None and integrator.db is not None
    redis_healthy = integrator is not None and integrator.redis is not None

    # Service is degraded if missing DB/Redis but still functional
    if db_healthy and redis_healthy:
        status = "healthy"
    elif integrator is not None:
        status = "degraded"
    else:
        status = "unhealthy"

    return {
        "status": status,
        "service": "knowledge-integration",
        "version": "1.0.0",
        "timestamp": datetime.utcnow(),
        "components": {
            "database": "healthy" if db_healthy else "unhealthy",
            "redis": "healthy" if redis_healthy else "unhealthy",
            "scheduler": "healthy" if scheduler and scheduler.running else "stopped"
        }
    }

@app.get("/stats", response_model=IntegrationStats)
async def get_integration_stats():
    """Get knowledge integration statistics."""
    if not integrator:
        raise HTTPException(status_code=503, detail="Service not initialized")

    return await integrator.get_integration_stats()

@app.get("/function/{function_id}/insights", response_model=List[FunctionInsight])
async def get_function_insights(function_id: int):
    """Get insights for a specific function."""
    if not integrator:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        async with integrator.db.acquire() as conn:
            results = await conn.fetch("""
                SELECT * FROM function_insights
                WHERE function_id = $1
                ORDER BY confidence_score DESC, last_updated DESC
            """, function_id)

            return [
                FunctionInsight(
                    function_id=row['function_id'],
                    function_name=row['function_name'],
                    executable_id=row['executable_id'],
                    github_repo_id=row['github_repo_id'],
                    confidence_score=row['confidence_score'],
                    insight_type=row['insight_type'],
                    insight_content=row['insight_content'],
                    evidence=row['evidence'] or [],
                    last_updated=row['last_updated']
                ) for row in results
            ]

    except Exception as e:
        logger.error(f"Error getting insights for function {function_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve function insights")

@app.post("/function/{function_id}/analyze")
async def analyze_function(function_id: int, background_tasks: BackgroundTasks):
    """Trigger analysis for a specific function."""
    if not integrator:
        raise HTTPException(status_code=503, detail="Service not initialized")

    async def analyze_and_store(func_id: int):
        insights = await integrator.analyze_function_similarity(func_id)
        await integrator.store_insights(insights)
        logger.info(f"Analysis completed for function {func_id}: {len(insights)} insights generated")

    background_tasks.add_task(analyze_and_store, function_id)

    return {
        "message": f"Analysis started for function {function_id}",
        "function_id": function_id,
        "timestamp": datetime.utcnow()
    }

@app.post("/integration/run")
async def trigger_integration(background_tasks: BackgroundTasks):
    """Manually trigger knowledge integration process."""
    if not integrator:
        raise HTTPException(status_code=503, detail="Service not initialized")

    background_tasks.add_task(scheduled_integration)

    return {
        "message": "Knowledge integration process started",
        "timestamp": datetime.utcnow()
    }

# Ghidra MCP Integration Endpoints
@app.post("/webhook/ghidra/function-analysis")
async def ghidra_function_analysis_webhook(analysis_data: dict):
    """Webhook endpoint for Ghidra MCP function analysis results."""
    if not analysis_webhook:
        raise HTTPException(status_code=503, detail="Ghidra bridge not initialized")

    result = await analysis_webhook.handle_function_analysis(analysis_data)

    if result['status'] == 'error':
        raise HTTPException(status_code=500, detail=result['error'])

    return result

@app.post("/webhook/bsim/similarity-results")
async def bsim_similarity_webhook(similarity_data: dict):
    """Webhook endpoint for BSim similarity analysis results."""
    if not analysis_webhook:
        raise HTTPException(status_code=503, detail="Ghidra bridge not initialized")

    result = await analysis_webhook.handle_bsim_results(similarity_data)

    if result['status'] == 'error':
        raise HTTPException(status_code=500, detail=result['error'])

    return result

@app.get("/bridge/status")
async def get_bridge_status():
    """Get status of Ghidra Knowledge Bridge."""
    return {
        "bridge_initialized": knowledge_bridge is not None,
        "webhook_handler_ready": analysis_webhook is not None,
        "database_connected": integrator.db is not None if integrator else False,
        "timestamp": datetime.utcnow()
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8095,
        reload=True if settings.environment == "development" else False
    )