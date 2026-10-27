"""Main FastAPI application for GitHub mining service."""

import asyncio
import uuid
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from models import (
    GitHubRepository, MiningTask, MiningConfiguration, MiningStats, HealthStatus,
    RepositoryCategory, QualityScore, MiningStatus
)
from database import github_db
from config import settings
from github_analyzer import GitHubAnalyzer
from logging_config import setup_logging, get_logger

# Setup logging
setup_logging()
logger = get_logger(__name__)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# Global instances
analyzer: Optional[GitHubAnalyzer] = None
scheduler: Optional[AsyncIOScheduler] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management."""
    global analyzer, scheduler

    logger.info("Starting GitHub Mining Service",
                version=settings.service_version,
                debug=settings.debug)

    try:
        # Initialize database connection
        await github_db.connect()
        logger.info("Database connection established")

        # Initialize GitHub analyzer
        analyzer = GitHubAnalyzer(settings.github_token)
        logger.info("GitHub analyzer initialized",
                   has_token=bool(settings.github_token))

        # Initialize task scheduler
        scheduler = AsyncIOScheduler()

        # Schedule periodic mining tasks
        scheduler.add_job(
            scheduled_discovery,
            IntervalTrigger(hours=settings.discovery_interval_hours),
            id="discovery_task",
            name="Repository Discovery",
            replace_existing=True
        )

        scheduler.add_job(
            scheduled_analysis,
            IntervalTrigger(hours=settings.analysis_interval_hours),
            id="analysis_task",
            name="Repository Analysis",
            replace_existing=True
        )

        scheduler.add_job(
            scheduled_cleanup,
            IntervalTrigger(hours=settings.cleanup_interval_hours),
            id="cleanup_task",
            name="Database Cleanup",
            replace_existing=True
        )

        scheduler.start()
        logger.info("Task scheduler started")

        logger.info("GitHub Mining Service startup completed")

    except Exception as e:
        logger.error("Failed to start GitHub Mining Service", error=str(e))
        raise

    yield

    # Cleanup
    logger.info("Shutting down GitHub Mining Service")

    if scheduler:
        scheduler.shutdown()
        logger.info("Task scheduler shutdown")

    await github_db.disconnect()
    logger.info("GitHub Mining Service shutdown completed")


# Create FastAPI app
app = FastAPI(
    title="GitHub Mining Service",
    description="Community knowledge discovery with quality controls for security research",
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


@app.get("/health", response_model=HealthStatus)
async def health_check():
    """Health check endpoint."""
    try:
        # Test database connection
        db_healthy = github_db.pool is not None and not github_db.pool._closed

        # Test GitHub API availability
        github_healthy = False
        rate_limit_remaining = 0
        rate_limit_reset = None

        if analyzer:
            try:
                rate_limit_info = await analyzer.get_rate_limit_info()
                github_healthy = rate_limit_info.get("available", False)
                if github_healthy:
                    rate_limit_remaining = rate_limit_info.get("core", {}).get("remaining", 0)
                    reset_timestamp = rate_limit_info.get("core", {}).get("reset")
                    if reset_timestamp:
                        rate_limit_reset = datetime.fromtimestamp(reset_timestamp.timestamp())
            except Exception as e:
                logger.warning("GitHub API health check failed", error=str(e))

        # Get basic statistics
        stats = await github_db.get_mining_statistics()
        repositories_discovered = stats.get("repositories", {}).get("total_repositories", 0)
        active_tasks = stats.get("tasks", {}).get("active_tasks", 0)

        # Determine overall status
        if db_healthy and github_healthy:
            status = "healthy"
        elif db_healthy:
            status = "degraded"
        else:
            status = "unhealthy"

        return HealthStatus(
            status=status,
            database_connected=db_healthy,
            github_api_available=github_healthy,
            redis_connected=True,  # Assuming Redis is healthy if we got here
            active_mining_tasks=active_tasks,
            repositories_discovered=repositories_discovered,
            avg_analysis_time_ms=180000.0,  # Placeholder
            github_rate_limit_remaining=rate_limit_remaining,
            github_rate_limit_reset=rate_limit_reset
        )

    except Exception as e:
        logger.error("Health check failed", error=str(e))
        return HealthStatus(
            status="unhealthy",
            database_connected=False,
            github_api_available=False,
            redis_connected=False,
            avg_analysis_time_ms=0.0
        )


@app.get("/stats", response_model=MiningStats)
async def get_mining_stats():
    """Get comprehensive mining statistics."""
    try:
        stats = await github_db.get_mining_statistics()

        return MiningStats(
            total_repositories=stats.get("repositories", {}).get("total_repositories", 0),
            high_quality_repositories=stats.get("repositories", {}).get("high_quality_repositories", 0),
            repositories_by_category=stats.get("categories", {}),
            repositories_by_language=stats.get("languages", {}),
            avg_analysis_time_seconds=180.0,  # Placeholder
            successful_analyses=stats.get("repositories", {}).get("total_repositories", 0),
            failed_analyses=0,  # TODO: Track failed analyses
            pending_tasks=stats.get("tasks", {}).get("pending_tasks", 0),
            active_tasks=stats.get("tasks", {}).get("active_tasks", 0),
            completed_tasks_today=stats.get("tasks", {}).get("completed_today", 0)
        )

    except Exception as e:
        logger.error("Failed to get mining stats", error=str(e))
        raise HTTPException(status_code=500, detail=f"Stats retrieval failed: {str(e)}")


@app.post("/search", response_model=List[GitHubRepository])
@limiter.limit("10/minute")
async def search_repositories(
    request,
    background_tasks: BackgroundTasks,
    query: str,
    max_results: int = Query(default=50, le=200),
    min_stars: int = Query(default=5, ge=0),
    category: Optional[RepositoryCategory] = None
):
    """Search GitHub repositories with quality filtering."""
    if not analyzer:
        raise HTTPException(status_code=503, detail="GitHub analyzer not initialized")

    try:
        logger.info("Repository search requested",
                   query=query,
                   max_results=max_results,
                   min_stars=min_stars)

        # Create mining task
        task = MiningTask(
            task_type="discover",
            search_query=query,
            max_repositories=max_results,
            min_stars=min_stars,
            priority=7
        )

        # Save task to database
        await github_db.save_mining_task(task)

        # Execute search in background
        background_tasks.add_task(
            execute_repository_search,
            task.task_id,
            query,
            max_results,
            min_stars
        )

        # For immediate response, return empty list with task info
        return []

    except Exception as e:
        logger.error("Repository search failed", error=str(e), query=query)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.get("/repositories", response_model=List[GitHubRepository])
async def list_repositories(
    category: Optional[RepositoryCategory] = None,
    min_quality_score: float = Query(default=50.0, ge=0.0, le=100.0),
    limit: int = Query(default=50, le=200)
):
    """List repositories with filtering options."""
    try:
        repositories = await github_db.get_repositories_by_quality(
            min_quality_score=min_quality_score,
            limit=limit,
            category=category
        )

        return repositories

    except Exception as e:
        logger.error("Failed to list repositories", error=str(e))
        raise HTTPException(status_code=500, detail=f"Repository listing failed: {str(e)}")


@app.get("/repositories/{repo_id}", response_model=GitHubRepository)
async def get_repository(repo_id: str):
    """Get detailed repository information."""
    try:
        repository = await github_db.get_repository(repo_id)
        if not repository:
            raise HTTPException(status_code=404, detail="Repository not found")

        return repository

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get repository", repo_id=repo_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Repository retrieval failed: {str(e)}")


@app.post("/repositories/{repo_id}/analyze")
@limiter.limit("5/minute")
async def analyze_repository(
    request,
    repo_id: str,
    background_tasks: BackgroundTasks
):
    """Trigger analysis of a specific repository."""
    try:
        repository = await github_db.get_repository(repo_id)
        if not repository:
            raise HTTPException(status_code=404, detail="Repository not found")

        # Create analysis task
        task = MiningTask(
            task_type="analyze",
            repository_id=repo_id,
            priority=8
        )

        await github_db.save_mining_task(task)

        # Execute analysis in background
        background_tasks.add_task(execute_repository_analysis, task.task_id, repo_id)

        return {"message": "Analysis started", "task_id": task.task_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to start repository analysis", repo_id=repo_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Analysis start failed: {str(e)}")


@app.get("/tasks", response_model=List[MiningTask])
async def list_mining_tasks(
    status: Optional[MiningStatus] = None,
    limit: int = Query(default=50, le=200)
):
    """List mining tasks with optional status filtering."""
    try:
        if status:
            # TODO: Implement status filtering in database
            tasks = await github_db.get_pending_tasks(limit)
        else:
            tasks = await github_db.get_pending_tasks(limit)

        return tasks

    except Exception as e:
        logger.error("Failed to list mining tasks", error=str(e))
        raise HTTPException(status_code=500, detail=f"Task listing failed: {str(e)}")


@app.post("/tasks/discovery")
@limiter.limit("3/minute")
async def trigger_discovery(
    request,
    background_tasks: BackgroundTasks,
    max_repositories: int = Query(default=100, le=500)
):
    """Manually trigger repository discovery."""
    try:
        # Create discovery task for each default query
        tasks_created = []

        for query in settings.default_search_queries:
            task = MiningTask(
                task_type="discover",
                search_query=query,
                max_repositories=max_repositories // len(settings.default_search_queries),
                min_stars=settings.min_stars,
                priority=5
            )

            await github_db.save_mining_task(task)
            tasks_created.append(task.task_id)

            # Execute in background
            background_tasks.add_task(
                execute_repository_search,
                task.task_id,
                query,
                task.max_repositories,
                task.min_stars
            )

        logger.info("Manual discovery triggered", tasks_created=len(tasks_created))
        return {"message": f"Discovery started with {len(tasks_created)} tasks",
                "task_ids": tasks_created}

    except Exception as e:
        logger.error("Failed to trigger discovery", error=str(e))
        raise HTTPException(status_code=500, detail=f"Discovery trigger failed: {str(e)}")


async def execute_repository_search(
    task_id: str,
    query: str,
    max_results: int,
    min_stars: int
):
    """Execute repository search task."""
    try:
        # Update task status
        task = MiningTask(
            task_id=task_id,
            task_type="discover",
            search_query=query,
            status=MiningStatus.IN_PROGRESS,
            started_at=datetime.utcnow()
        )
        await github_db.save_mining_task(task)

        # Perform search
        repositories = await analyzer.search_repositories(
            query=query,
            max_results=max_results,
            min_stars=min_stars
        )

        # Save repositories
        high_quality_count = 0
        for repo in repositories:
            await github_db.save_repository(repo)

            if repo.quality_score >= settings.min_quality_score:
                high_quality_count += 1

        # Update task completion
        task.status = MiningStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        task.repositories_found = len(repositories)
        task.high_quality_found = high_quality_count
        task.progress = 1.0

        await github_db.save_mining_task(task)

        logger.info("Repository search completed",
                   task_id=task_id,
                   query=query,
                   found=len(repositories),
                   high_quality=high_quality_count)

    except Exception as e:
        logger.error("Repository search task failed",
                    task_id=task_id,
                    query=query,
                    error=str(e))

        # Update task failure
        task = MiningTask(
            task_id=task_id,
            task_type="discover",
            status=MiningStatus.FAILED,
            error_message=str(e),
            completed_at=datetime.utcnow()
        )
        await github_db.save_mining_task(task)


async def execute_repository_analysis(task_id: str, repo_id: str):
    """Execute repository analysis task."""
    try:
        # Get repository
        repository = await github_db.get_repository(repo_id)
        if not repository:
            raise ValueError(f"Repository {repo_id} not found")

        # Update task status
        task = MiningTask(
            task_id=task_id,
            task_type="analyze",
            repository_id=repo_id,
            status=MiningStatus.IN_PROGRESS,
            started_at=datetime.utcnow()
        )
        await github_db.save_mining_task(task)

        # Perform analysis
        quality_score, quality_grade, content = await analyzer.analyze_repository_quality(repository)

        # Update repository
        repository.quality_score = quality_score
        repository.quality_grade = quality_grade
        repository.last_analyzed = datetime.utcnow()
        repository.mining_status = MiningStatus.COMPLETED

        await github_db.save_repository(repository)
        await github_db.save_repository_content(content)

        # Update task completion
        task.status = MiningStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        task.repositories_analyzed = 1
        task.high_quality_found = 1 if quality_score >= settings.min_quality_score else 0
        task.progress = 1.0

        await github_db.save_mining_task(task)

        logger.info("Repository analysis completed",
                   task_id=task_id,
                   repo_id=repo_id,
                   quality_score=quality_score,
                   quality_grade=quality_grade.value)

    except Exception as e:
        logger.error("Repository analysis task failed",
                    task_id=task_id,
                    repo_id=repo_id,
                    error=str(e))

        # Update task failure
        task = MiningTask(
            task_id=task_id,
            task_type="analyze",
            status=MiningStatus.FAILED,
            error_message=str(e),
            completed_at=datetime.utcnow()
        )
        await github_db.save_mining_task(task)


async def scheduled_discovery():
    """Scheduled repository discovery task."""
    logger.info("Starting scheduled repository discovery")

    try:
        # Create discovery tasks for default queries
        for query in settings.default_search_queries:
            task = MiningTask(
                task_type="discover",
                search_query=query,
                max_repositories=50,  # Smaller batches for scheduled runs
                min_stars=settings.min_stars,
                priority=3  # Lower priority for scheduled tasks
            )

            await github_db.save_mining_task(task)

            # Execute search
            await execute_repository_search(
                task.task_id,
                query,
                task.max_repositories,
                task.min_stars
            )

        logger.info("Scheduled repository discovery completed")

    except Exception as e:
        logger.error("Scheduled discovery failed", error=str(e))


async def scheduled_analysis():
    """Scheduled repository analysis task."""
    logger.info("Starting scheduled repository analysis")

    try:
        # Get repositories that need analysis
        repositories = await github_db.get_repositories_by_quality(
            min_quality_score=0.0,
            limit=20
        )

        # Filter for repositories that haven't been analyzed recently
        cutoff_time = datetime.utcnow() - timedelta(days=7)
        repos_to_analyze = [
            repo for repo in repositories
            if not repo.last_analyzed or repo.last_analyzed < cutoff_time
        ]

        # Create analysis tasks
        for repo in repos_to_analyze[:10]:  # Limit to 10 per scheduled run
            task = MiningTask(
                task_type="analyze",
                repository_id=repo.repo_id,
                priority=2
            )

            await github_db.save_mining_task(task)
            await execute_repository_analysis(task.task_id, repo.repo_id)

        logger.info("Scheduled repository analysis completed",
                   analyzed=len(repos_to_analyze[:10]))

    except Exception as e:
        logger.error("Scheduled analysis failed", error=str(e))


async def scheduled_cleanup():
    """Scheduled cleanup of old data."""
    logger.info("Starting scheduled cleanup")

    try:
        # TODO: Implement cleanup logic
        # - Remove very low quality repositories
        # - Clean up failed/old mining tasks
        # - Archive old knowledge extracts

        logger.info("Scheduled cleanup completed")

    except Exception as e:
        logger.error("Scheduled cleanup failed", error=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=settings.workers
    )