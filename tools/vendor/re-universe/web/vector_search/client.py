"""Vector Search Service Client for Django Integration."""

import asyncio
import aiohttp
import logging
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin
import json
from django.conf import settings

logger = logging.getLogger(__name__)


class VectorSearchClient:
    """Client for communicating with the Vector Search Service."""

    def __init__(self, base_url: str = None):
        self.base_url = base_url or getattr(settings, 'VECTOR_SEARCH_URL', 'http://vector-search:8090')
        self.timeout = getattr(settings, 'VECTOR_SEARCH_TIMEOUT', 30)
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.timeout)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()

    def _get_session(self) -> aiohttp.ClientSession:
        """Get or create session for synchronous calls."""
        if not self.session:
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            )
        return self.session

    async def health_check(self) -> Dict[str, Any]:
        """Check if the vector search service is healthy."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/health')

            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug("Vector search health check successful", extra={'response': data})
                    return data
                else:
                    logger.warning(f"Vector search health check failed with status {response.status}")
                    return {"status": "unhealthy", "error": f"HTTP {response.status}"}

        except Exception as e:
            logger.error(f"Vector search health check failed: {str(e)}")
            return {"status": "unhealthy", "error": str(e)}

    async def search(
        self,
        query: str,
        limit: int = 20,
        threshold: float = 0.7,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """Perform semantic search for functions."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/search')

            payload = {
                "query": query,
                "limit": limit,
                "threshold": threshold,
                "use_cache": use_cache
            }

            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Vector search completed: {data.get('result_count', 0)} results in {data.get('search_time_ms', 0):.2f}ms")
                    return data
                else:
                    error_data = await response.json() if response.content_type == 'application/json' else {}
                    logger.error(f"Vector search failed with status {response.status}: {error_data}")
                    return {"error": f"Search failed with status {response.status}", "details": error_data}

        except Exception as e:
            logger.error(f"Vector search request failed: {str(e)}")
            return {"error": str(e)}

    async def generate_embeddings(self, function_ids: List[int], force_regenerate: bool = False) -> Dict[str, Any]:
        """Generate embeddings for specific functions."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/embeddings/generate')

            payload = {
                "function_ids": function_ids,
                "force_regenerate": force_regenerate
            }

            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Embedding generation completed: {data.get('successful_count', 0)}/{data.get('processed_count', 0)} successful")
                    return data
                else:
                    error_data = await response.json() if response.content_type == 'application/json' else {}
                    logger.error(f"Embedding generation failed with status {response.status}: {error_data}")
                    return {"error": f"Embedding generation failed with status {response.status}", "details": error_data}

        except Exception as e:
            logger.error(f"Embedding generation request failed: {str(e)}")
            return {"error": str(e)}

    async def batch_process_embeddings(self, batch_size: int = 50, max_functions: int = None) -> Dict[str, Any]:
        """Start batch processing of embeddings."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/embeddings/batch-process')

            payload = {
                "batch_size": batch_size,
                "max_functions": max_functions
            }

            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Batch processing started: {data.get('message', 'Unknown status')}")
                    return data
                else:
                    error_data = await response.json() if response.content_type == 'application/json' else {}
                    logger.error(f"Batch processing failed with status {response.status}: {error_data}")
                    return {"error": f"Batch processing failed with status {response.status}", "details": error_data}

        except Exception as e:
            logger.error(f"Batch processing request failed: {str(e)}")
            return {"error": str(e)}

    async def get_metrics(self) -> Dict[str, Any]:
        """Get vector search service metrics."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/metrics')

            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    error_data = await response.json() if response.content_type == 'application/json' else {}
                    logger.error(f"Metrics request failed with status {response.status}: {error_data}")
                    return {"error": f"Metrics request failed with status {response.status}", "details": error_data}

        except Exception as e:
            logger.error(f"Metrics request failed: {str(e)}")
            return {"error": str(e)}

    async def get_status(self) -> Dict[str, Any]:
        """Get detailed service status."""
        try:
            session = self._get_session()
            url = urljoin(self.base_url, '/status')

            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    error_data = await response.json() if response.content_type == 'application/json' else {}
                    logger.error(f"Status request failed with status {response.status}: {error_data}")
                    return {"error": f"Status request failed with status {response.status}", "details": error_data}

        except Exception as e:
            logger.error(f"Status request failed: {str(e)}")
            return {"error": str(e)}


# Synchronous wrapper functions for Django views
def sync_vector_search(query: str, limit: int = 20, threshold: float = 0.7, use_cache: bool = True) -> Dict[str, Any]:
    """Synchronous wrapper for vector search."""
    async def _search():
        async with VectorSearchClient() as client:
            return await client.search(query, limit, threshold, use_cache)

    try:
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_search())
    except RuntimeError:
        # Create new event loop if none exists
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_search())
        finally:
            loop.close()


def sync_health_check() -> Dict[str, Any]:
    """Synchronous wrapper for health check."""
    async def _health_check():
        async with VectorSearchClient() as client:
            return await client.health_check()

    try:
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_health_check())
    except RuntimeError:
        # Create new event loop if none exists
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_health_check())
        finally:
            loop.close()


def sync_get_metrics() -> Dict[str, Any]:
    """Synchronous wrapper for metrics."""
    async def _get_metrics():
        async with VectorSearchClient() as client:
            return await client.get_metrics()

    try:
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_get_metrics())
    except RuntimeError:
        # Create new event loop if none exists
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_get_metrics())
        finally:
            loop.close()


def sync_generate_embeddings(function_ids: List[int], force_regenerate: bool = False) -> Dict[str, Any]:
    """Synchronous wrapper for embedding generation."""
    async def _generate_embeddings():
        async with VectorSearchClient() as client:
            return await client.generate_embeddings(function_ids, force_regenerate)

    try:
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_generate_embeddings())
    except RuntimeError:
        # Create new event loop if none exists
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_generate_embeddings())
        finally:
            loop.close()