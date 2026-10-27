"""Database connection and operations for Vector Search Service."""

import asyncio
import asyncpg
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
from datetime import datetime, timedelta

from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class DatabaseManager:
    """Manages database connections and vector search operations."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def initialize(self) -> None:
        """Initialize database connection pool."""
        try:
            # Debug logging
            logger.info("Attempting database connection",
                       host=settings.db_host,
                       port=settings.db_port,
                       database=settings.db_name,
                       user=settings.db_user,
                       password_set=bool(settings.db_password))

            self.pool = await asyncpg.create_pool(
                settings.database_url,
                min_size=1,
                max_size=10,
                command_timeout=settings.query_timeout,
                server_settings={
                    'application_name': f'{settings.service_name}-{settings.service_version}'
                }
            )
            logger.info("Database connection pool initialized",
                       host=settings.db_host,
                       database=settings.db_name)

            # Test pgvector availability
            await self._test_vector_extension()

        except Exception as e:
            logger.error("Failed to initialize database", error=str(e))
            raise

    async def close(self) -> None:
        """Close database connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed")

    async def _test_vector_extension(self) -> None:
        """Test that pgvector extension is available."""
        async with self.get_connection() as conn:
            try:
                result = await conn.fetchval(
                    "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
                )
                if result:
                    logger.info("pgvector extension verified", version=result)
                else:
                    raise Exception("pgvector extension not found")
            except Exception as e:
                logger.error("pgvector extension test failed", error=str(e))
                raise

    @asynccontextmanager
    async def get_connection(self):
        """Get database connection from pool."""
        if not self.pool:
            raise Exception("Database pool not initialized")

        conn = await self.pool.acquire()
        try:
            yield conn
        finally:
            await self.pool.release(conn)

    async def store_embedding(self, function_id: int, embedding: List[float], model_version: str = None) -> bool:
        """Store function embedding in database."""
        if model_version is None:
            model_version = settings.embedding_model

        start_time = datetime.now()

        try:
            async with self.get_connection() as conn:
                # Convert embedding to pgvector format
                vector_str = '[' + ','.join(map(str, embedding)) + ']'

                await conn.execute("""
                    INSERT INTO function_embeddings (function_id, embedding, model_version, created_at, updated_at)
                    VALUES ($1, $2::vector, $3, $4, $4)
                    ON CONFLICT (function_id)
                    DO UPDATE SET
                        embedding = EXCLUDED.embedding,
                        model_version = EXCLUDED.model_version,
                        updated_at = EXCLUDED.updated_at
                """, function_id, vector_str, model_version, datetime.now())

                duration = (datetime.now() - start_time).total_seconds() * 1000
                logger.info("Stored function embedding",
                          function_id=function_id,
                          model=model_version,
                          duration_ms=round(duration, 2))
                return True

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds() * 1000
            logger.error("Failed to store embedding",
                        function_id=function_id,
                        error=str(e),
                        duration_ms=round(duration, 2))
            return False

    async def similarity_search(
        self,
        query_embedding: List[float],
        limit: int = None,
        threshold: float = None
    ) -> List[Dict[str, Any]]:
        """Perform vector similarity search."""
        if limit is None:
            limit = settings.max_results
        if threshold is None:
            threshold = settings.similarity_threshold

        start_time = datetime.now()
        query_vector = '[' + ','.join(map(str, query_embedding)) + ']'

        try:
            async with self.get_connection() as conn:
                query = """
                    SELECT
                        fe.function_id,
                        d.name_func,
                        d.addr,
                        e.name_exec,
                        e.md5 as executable_md5,
                        get_function_hierarchy_path(fe.function_id) as hierarchy_path,
                        fh.classification_confidence,
                        1 - (fe.embedding <=> $1::vector) as similarity_score,
                        fe.model_version,
                        fe.updated_at as embedding_updated
                    FROM function_embeddings fe
                    JOIN desctable d ON fe.function_id = d.id
                    JOIN exetable e ON d.id_exe = e.id
                    LEFT JOIN d2_function_hierarchy fh ON fe.function_id = fh.function_id
                    WHERE 1 - (fe.embedding <=> $1::vector) >= $2
                    ORDER BY fe.embedding <=> $1::vector
                    LIMIT $3
                """

                rows = await conn.fetch(query, query_vector, threshold, limit)
                results = [dict(row) for row in rows]

                duration = (datetime.now() - start_time).total_seconds() * 1000
                logger.info("Similarity search completed",
                          query_type="vector_similarity",
                          result_count=len(results),
                          threshold=threshold,
                          duration_ms=round(duration, 2))

                return results

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds() * 1000
            logger.error("Similarity search failed",
                        error=str(e),
                        duration_ms=round(duration, 2))
            return []

    async def get_functions_without_embeddings(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get functions that don't have embeddings yet."""
        try:
            async with self.get_connection() as conn:
                query = """
                    SELECT
                        d.id as function_id,
                        d.name_func,
                        d.addr,
                        e.name_exec,
                        e.md5 as executable_md5
                    FROM desctable d
                    JOIN exetable e ON d.id_exe = e.id
                    LEFT JOIN function_embeddings fe ON d.id = fe.function_id
                    WHERE fe.function_id IS NULL
                    ORDER BY d.id
                    LIMIT $1
                """

                rows = await conn.fetch(query, limit)
                results = [dict(row) for row in rows]

                logger.info("Retrieved functions without embeddings",
                          count=len(results))
                return results

        except Exception as e:
            logger.error("Failed to get functions without embeddings", error=str(e))
            return []

    async def cache_search_result(
        self,
        query_hash: str,
        query_text: str,
        results: List[Dict[str, Any]],
        similarity_threshold: float
    ) -> bool:
        """Cache search results for future queries."""
        try:
            async with self.get_connection() as conn:
                import json
                expires_at = datetime.now() + timedelta(seconds=settings.cache_ttl)

                await conn.execute("""
                    INSERT INTO semantic_search_cache
                    (query_hash, query_text, results, similarity_threshold, model_version, result_count, expires_at)
                    VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
                    ON CONFLICT (query_hash)
                    DO UPDATE SET
                        results = EXCLUDED.results,
                        result_count = EXCLUDED.result_count,
                        expires_at = EXCLUDED.expires_at,
                        created_at = NOW()
                """, query_hash, query_text, json.dumps(results),
                similarity_threshold, settings.embedding_model, len(results), expires_at)

                logger.debug("Cached search results",
                           query_hash=query_hash,
                           result_count=len(results))
                return True

        except Exception as e:
            logger.error("Failed to cache search results",
                        query_hash=query_hash,
                        error=str(e))
            return False

    async def get_cached_search_result(self, query_hash: str) -> Optional[List[Dict[str, Any]]]:
        """Retrieve cached search results."""
        try:
            async with self.get_connection() as conn:
                row = await conn.fetchrow("""
                    SELECT results, created_at
                    FROM semantic_search_cache
                    WHERE query_hash = $1 AND expires_at > NOW()
                """, query_hash)

                if row:
                    logger.info("Cache hit for search query",
                               query_hash=query_hash,
                               cached_at=row['created_at'])
                    return row['results']

                return None

        except Exception as e:
            logger.error("Failed to retrieve cached results",
                        query_hash=query_hash,
                        error=str(e))
            return None

    async def update_search_statistics(self, query_type: str, duration_ms: float, result_count: int) -> None:
        """Update search performance statistics."""
        try:
            # This could be expanded to store detailed performance metrics
            # For now, just log the statistics
            logger.info("Search statistics",
                       query_type=query_type,
                       duration_ms=duration_ms,
                       result_count=result_count,
                       performance_metric=True)

        except Exception as e:
            logger.error("Failed to update search statistics", error=str(e))


# Global database manager instance
db_manager = DatabaseManager()