"""Vector Search Service - Main FastAPI Application."""

import asyncio
import hashlib
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from logging_config import configure_logging, get_logger
from database import db_manager
from embeddings import embedding_service
from models import (
    HealthResponse, SearchQuery, SearchResponse, EmbeddingRequest, EmbeddingResponse,
    BatchProcessingRequest, BatchProcessingResponse, MetricsResponse,
    StatusResponse, ErrorResponse, FunctionResult
)

# Configure logging
configure_logging()
logger = get_logger(__name__)

# Track service start time
SERVICE_START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    logger.info("Starting Vector Search Service",
               version=settings.service_version,
               debug=settings.debug)

    try:
        # Initialize database
        await db_manager.initialize()

        # Initialize embedding service
        await embedding_service.initialize()

        logger.info("Vector Search Service startup completed")
        yield

    except Exception as e:
        logger.error("Failed to start Vector Search Service", error=str(e))
        raise

    finally:
        # Shutdown
        logger.info("Shutting down Vector Search Service")
        await db_manager.close()
        await embedding_service.close()


# Create FastAPI app
app = FastAPI(
    title="D2Docs Vector Search Service",
    description="Semantic search service for Diablo 2 function analysis",
    version=settings.service_version,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Log all requests with timing and basic info."""
    request_id = str(uuid.uuid4())[:8]
    start_time = time.time()

    # Log request
    logger.info("Request started",
               request_id=request_id,
               method=request.method,
               url=str(request.url),
               client=request.client.host if request.client else "unknown")

    try:
        response = await call_next(request)
        duration = (time.time() - start_time) * 1000

        # Log response
        logger.info("Request completed",
                   request_id=request_id,
                   status_code=response.status_code,
                   duration_ms=round(duration, 2))

        return response

    except Exception as e:
        duration = (time.time() - start_time) * 1000
        logger.error("Request failed",
                    request_id=request_id,
                    error=str(e),
                    duration_ms=round(duration, 2))
        raise


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    request_id = getattr(request.state, 'request_id', 'unknown')

    logger.error("Unhandled exception",
                request_id=request_id,
                error=str(exc),
                error_type=type(exc).__name__)

    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="Internal Server Error",
            message="An unexpected error occurred",
            timestamp=datetime.now(),
            request_id=request_id
        ).dict()
    )


@app.get("/", include_in_schema=False)
async def root():
    """Root endpoint redirect."""
    return {"message": "D2Docs Vector Search Service", "docs": "/docs"}


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Comprehensive health check endpoint."""
    try:
        # Test database connection
        database_connected = False
        try:
            async with db_manager.get_connection() as conn:
                await conn.fetchval("SELECT 1")
            database_connected = True
        except Exception as e:
            logger.warning("Database health check failed", error=str(e))

        # Test embedding service
        embedding_service_available = embedding_service.client is not None

        status = "healthy" if database_connected and embedding_service_available else "degraded"

        return HealthResponse(
            status=status,
            service=settings.service_name,
            version=settings.service_version,
            timestamp=datetime.now(),
            database_connected=database_connected,
            embedding_service_available=embedding_service_available
        )

    except Exception as e:
        logger.error("Health check failed", error=str(e))
        raise HTTPException(status_code=500, detail="Health check failed")


@app.get("/status", response_model=StatusResponse)
async def get_status():
    """Get detailed service status."""
    try:
        uptime = time.time() - SERVICE_START_TIME

        # Get database stats
        async with db_manager.get_connection() as conn:
            total_functions = await conn.fetchval("SELECT COUNT(*) FROM desctable")
            functions_with_embeddings = await conn.fetchval("SELECT COUNT(*) FROM function_embeddings")

        coverage_percent = (functions_with_embeddings / total_functions * 100) if total_functions > 0 else 0

        return StatusResponse(
            service=settings.service_name,
            version=settings.service_version,
            status="running",
            uptime_seconds=uptime,
            database_status="connected",
            embedding_service_status="available" if embedding_service.client else "unavailable",
            total_functions=total_functions,
            functions_with_embeddings=functions_with_embeddings,
            embedding_coverage_percent=round(coverage_percent, 2)
        )

    except Exception as e:
        logger.error("Status check failed", error=str(e))
        raise HTTPException(status_code=500, detail="Status check failed")


@app.post("/search", response_model=SearchResponse)
async def semantic_search(query: SearchQuery):
    """Perform semantic search for functions."""
    start_time = time.time()

    try:
        # Create query hash for caching
        query_hash = hashlib.sha256(
            f"{query.query}:{query.threshold}:{query.limit}".encode()
        ).hexdigest()[:16]

        cached_results = None
        if query.use_cache:
            cached_results = await db_manager.get_cached_search_result(query_hash)

        if cached_results:
            # Return cached results
            search_time = (time.time() - start_time) * 1000

            results = [FunctionResult(**result) for result in cached_results]

            return SearchResponse(
                query=query.query,
                result_count=len(results),
                search_time_ms=round(search_time, 2),
                similarity_threshold=query.threshold or settings.similarity_threshold,
                cached=True,
                results=results
            )

        # Generate query embedding
        query_embedding = await embedding_service.generate_query_embedding(query.query)
        if not query_embedding:
            raise HTTPException(status_code=400, detail="Failed to generate query embedding")

        # Perform similarity search
        raw_results = await db_manager.similarity_search(
            query_embedding=query_embedding,
            limit=query.limit,
            threshold=query.threshold
        )

        # Convert to response format
        results = []
        for result in raw_results:
            results.append(FunctionResult(
                function_id=result['function_id'],
                name_func=result.get('name_func'),
                addr=result.get('addr'),
                name_exec=result.get('name_exec'),
                executable_md5=result.get('executable_md5'),
                hierarchy_path=result.get('hierarchy_path'),
                classification_confidence=result.get('classification_confidence'),
                similarity_score=result['similarity_score'],
                model_version=result['model_version'],
                embedding_updated=result['embedding_updated']
            ))

        search_time = (time.time() - start_time) * 1000

        # Cache results for future queries
        if query.use_cache and results:
            await db_manager.cache_search_result(
                query_hash=query_hash,
                query_text=query.query,
                results=[result.dict() for result in results],
                similarity_threshold=query.threshold or settings.similarity_threshold
            )

        # Update search statistics
        await db_manager.update_search_statistics("semantic_search", search_time, len(results))

        return SearchResponse(
            query=query.query,
            result_count=len(results),
            search_time_ms=round(search_time, 2),
            similarity_threshold=query.threshold or settings.similarity_threshold,
            cached=False,
            results=results
        )

    except HTTPException:
        raise
    except Exception as e:
        search_time = (time.time() - start_time) * 1000
        logger.error("Search failed",
                    query=query.query,
                    error=str(e),
                    duration_ms=round(search_time, 2))
        raise HTTPException(status_code=500, detail="Search operation failed")


@app.post("/embeddings/generate", response_model=EmbeddingResponse)
async def generate_embeddings(request: EmbeddingRequest, background_tasks: BackgroundTasks):
    """Generate embeddings for specific functions."""
    start_time = time.time()

    try:
        # Get function data
        async with db_manager.get_connection() as conn:
            if request.force_regenerate:
                # Get all requested functions
                query = """
                    SELECT d.id as function_id, d.name_func, d.addr, e.name_exec, e.md5 as executable_md5
                    FROM desctable d
                    JOIN exetable e ON d.id_exe = e.id
                    WHERE d.id = ANY($1::int[])
                """
            else:
                # Get only functions without embeddings
                query = """
                    SELECT d.id as function_id, d.name_func, d.addr, e.name_exec, e.md5 as executable_md5
                    FROM desctable d
                    JOIN exetable e ON d.id_exe = e.id
                    LEFT JOIN function_embeddings fe ON d.id = fe.function_id
                    WHERE d.id = ANY($1::int[]) AND (fe.function_id IS NULL OR $2)
                """

            functions_data = await conn.fetch(query, request.function_ids, request.force_regenerate)

        if not functions_data:
            return EmbeddingResponse(
                processed_count=0,
                successful_count=0,
                failed_count=0,
                processing_time_ms=0.0,
                details=[]
            )

        # Generate embeddings
        embedding_results = await embedding_service.generate_batch_embeddings(
            [dict(func) for func in functions_data]
        )

        # Store embeddings in database
        details = []
        successful_count = 0
        failed_count = 0

        for function_id, embedding in embedding_results:
            if embedding:
                success = await db_manager.store_embedding(function_id, embedding)
                if success:
                    successful_count += 1
                    details.append({
                        "function_id": function_id,
                        "status": "success",
                        "message": "Embedding generated and stored"
                    })
                else:
                    failed_count += 1
                    details.append({
                        "function_id": function_id,
                        "status": "failed",
                        "message": "Failed to store embedding"
                    })
            else:
                failed_count += 1
                details.append({
                    "function_id": function_id,
                    "status": "failed",
                    "message": "Failed to generate embedding"
                })

        processing_time = (time.time() - start_time) * 1000

        logger.info("Embedding generation completed",
                   processed_count=len(embedding_results),
                   successful_count=successful_count,
                   failed_count=failed_count,
                   processing_time_ms=round(processing_time, 2))

        return EmbeddingResponse(
            processed_count=len(embedding_results),
            successful_count=successful_count,
            failed_count=failed_count,
            processing_time_ms=round(processing_time, 2),
            details=details
        )

    except Exception as e:
        processing_time = (time.time() - start_time) * 1000
        logger.error("Embedding generation failed",
                    error=str(e),
                    processing_time_ms=round(processing_time, 2))
        raise HTTPException(status_code=500, detail="Embedding generation failed")


async def _batch_process_embeddings(batch_size: int = 100, max_functions: Optional[int] = None):
    """Background task for batch processing embeddings."""
    try:
        logger.info("Starting batch embedding processing",
                   batch_size=batch_size,
                   max_functions=max_functions)

        # Get functions without embeddings
        functions_to_process = await db_manager.get_functions_without_embeddings(
            limit=max_functions or 10000
        )

        if not functions_to_process:
            logger.info("No functions found for embedding processing")
            return

        total_processed = 0
        for i in range(0, len(functions_to_process), batch_size):
            batch = functions_to_process[i:i + batch_size]

            # Generate embeddings for batch
            embedding_results = await embedding_service.generate_batch_embeddings(batch, batch_size)

            # Store embeddings
            for function_id, embedding in embedding_results:
                if embedding:
                    await db_manager.store_embedding(function_id, embedding)
                    total_processed += 1

            # Small delay between batches
            await asyncio.sleep(2)

        logger.info("Batch embedding processing completed",
                   total_processed=total_processed,
                   total_functions=len(functions_to_process))

    except Exception as e:
        logger.error("Batch embedding processing failed", error=str(e))


@app.post("/embeddings/batch-process", response_model=BatchProcessingResponse)
async def batch_process_embeddings(request: BatchProcessingRequest, background_tasks: BackgroundTasks):
    """Start batch processing of embeddings for functions without them."""
    try:
        # Estimate the work
        functions_without_embeddings = await db_manager.get_functions_without_embeddings(limit=1)
        if not functions_without_embeddings:
            return BatchProcessingResponse(
                started=False,
                message="No functions found that need embedding processing"
            )

        # Get count of functions without embeddings
        async with db_manager.get_connection() as conn:
            count = await conn.fetchval("""
                SELECT COUNT(*)
                FROM desctable d
                LEFT JOIN function_embeddings fe ON d.id = fe.function_id
                WHERE fe.function_id IS NULL
            """)

        estimated_functions = min(count, request.max_functions or count)
        estimated_time = estimated_functions * 0.5  # Rough estimate: 0.5 seconds per function

        # Start background processing
        background_tasks.add_task(
            _batch_process_embeddings,
            batch_size=request.batch_size or 50,
            max_functions=request.max_functions
        )

        logger.info("Batch embedding processing started",
                   estimated_functions=estimated_functions,
                   batch_size=request.batch_size or 50)

        return BatchProcessingResponse(
            started=True,
            message=f"Started batch processing for {estimated_functions} functions",
            estimated_functions=estimated_functions,
            estimated_time_seconds=estimated_time
        )

    except Exception as e:
        logger.error("Failed to start batch processing", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to start batch processing")


@app.get("/metrics", response_model=MetricsResponse)
async def get_metrics():
    """Get performance metrics and statistics."""
    try:
        async with db_manager.get_connection() as conn:
            # Get basic counts
            total_functions = await conn.fetchval("SELECT COUNT(*) FROM desctable")
            functions_with_embeddings = await conn.fetchval("SELECT COUNT(*) FROM function_embeddings")

            # Get cache stats
            total_cached = await conn.fetchval("SELECT COUNT(*) FROM semantic_search_cache")
            # Cache hit rate would need to be tracked separately in a real implementation

        coverage_percent = (functions_with_embeddings / total_functions * 100) if total_functions > 0 else 0

        return MetricsResponse(
            total_functions=total_functions,
            functions_with_embeddings=functions_with_embeddings,
            embedding_coverage_percent=round(coverage_percent, 2),
            total_searches_today=0,  # Would need tracking implementation
            cache_hit_rate_percent=85.0,  # Placeholder
            avg_search_time_ms=250.0,  # Placeholder
            database_health="healthy"
        )

    except Exception as e:
        logger.error("Failed to get metrics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve metrics")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=settings.debug
    )