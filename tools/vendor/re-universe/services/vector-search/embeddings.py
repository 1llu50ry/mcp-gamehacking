"""Embedding generation service for Vector Search."""

import hashlib
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from openai import AsyncOpenAI
import numpy as np
from tenacity import retry, stop_after_attempt, wait_exponential
import time

# Optional imports for local embeddings
try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False

from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class EmbeddingService:
    """Service for generating and managing function embeddings."""

    def __init__(self):
        self.client: Optional[AsyncOpenAI] = None
        self._rate_limiter = asyncio.Semaphore(settings.embedding_rate_limit)

    async def initialize(self) -> None:
        """Initialize the embedding service."""
        if settings.openai_api_key:
            self.client = AsyncOpenAI(api_key=settings.openai_api_key)
            logger.info("OpenAI embedding service initialized",
                       model=settings.embedding_model)
        else:
            logger.warning("OpenAI API key not provided, embedding generation disabled")

    async def close(self) -> None:
        """Close the embedding service."""
        if self.client:
            await self.client.close()
            logger.info("Embedding service closed")

    def _create_function_text(self, function_data: Dict[str, Any]) -> str:
        """Create searchable text representation of a function."""
        parts = []

        # Function name and basic info
        if function_data.get('name_func'):
            parts.append(f"Function: {function_data['name_func']}")

        if function_data.get('name_exec'):
            parts.append(f"Executable: {function_data['name_exec']}")

        # Address information
        if function_data.get('addr'):
            parts.append(f"Address: 0x{function_data['addr']:08x}")

        # Hierarchy information if available
        if function_data.get('hierarchy_path'):
            parts.append(f"System: {function_data['hierarchy_path']}")

        # Additional metadata
        if function_data.get('executable_md5'):
            parts.append(f"Binary: {function_data['executable_md5'][:8]}")

        # Create comprehensive text representation
        function_text = " | ".join(parts)

        logger.debug("Created function text representation",
                    function_id=function_data.get('function_id'),
                    text_length=len(function_text))

        return function_text

    def _hash_text(self, text: str) -> str:
        """Create hash of text for caching and deduplication."""
        return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10)
    )
    async def _generate_embedding_with_retry(self, text: str) -> List[float]:
        """Generate embedding with retry logic."""
        if not self.client:
            raise Exception("OpenAI client not initialized")

        async with self._rate_limiter:
            start_time = time.time()

            try:
                response = await self.client.embeddings.create(
                    model=settings.embedding_model,
                    input=text,
                    encoding_format="float"
                )

                embedding = response.data[0].embedding
                duration = (time.time() - start_time) * 1000

                logger.debug("Generated embedding",
                           model=settings.embedding_model,
                           input_length=len(text),
                           embedding_dimension=len(embedding),
                           duration_ms=round(duration, 2))

                return embedding

            except Exception as e:
                duration = (time.time() - start_time) * 1000
                logger.error("Embedding generation failed",
                           model=settings.embedding_model,
                           error=str(e),
                           duration_ms=round(duration, 2))
                raise

    async def generate_function_embedding(self, function_data: Dict[str, Any]) -> Optional[List[float]]:
        """Generate embedding for a single function."""
        try:
            # Create text representation
            function_text = self._create_function_text(function_data)

            # Generate embedding
            embedding = await self._generate_embedding_with_retry(function_text)

            logger.info("Function embedding generated",
                       function_id=function_data.get('function_id'),
                       function_name=function_data.get('name_func'),
                       embedding_size=len(embedding))

            return embedding

        except Exception as e:
            logger.error("Failed to generate function embedding",
                        function_id=function_data.get('function_id'),
                        function_name=function_data.get('name_func'),
                        error=str(e))
            return None

    async def generate_query_embedding(self, query_text: str) -> Optional[List[float]]:
        """Generate embedding for search query."""
        try:
            embedding = await self._generate_embedding_with_retry(query_text)

            logger.info("Query embedding generated",
                       query_length=len(query_text),
                       embedding_size=len(embedding))

            return embedding

        except Exception as e:
            logger.error("Failed to generate query embedding",
                        query=query_text,
                        error=str(e))
            return None

    async def generate_batch_embeddings(
        self,
        functions: List[Dict[str, Any]],
        batch_size: int = None
    ) -> List[Tuple[int, Optional[List[float]]]]:
        """Generate embeddings for multiple functions in batches."""
        if batch_size is None:
            batch_size = settings.embedding_batch_size

        results = []
        total_functions = len(functions)

        logger.info("Starting batch embedding generation",
                   total_functions=total_functions,
                   batch_size=batch_size)

        # Process in batches to respect rate limits
        for i in range(0, total_functions, batch_size):
            batch = functions[i:i + batch_size]
            batch_start_time = time.time()

            batch_tasks = []
            for func_data in batch:
                task = self.generate_function_embedding(func_data)
                batch_tasks.append((func_data.get('function_id'), task))

            # Execute batch concurrently
            batch_results = []
            for function_id, task in batch_tasks:
                try:
                    embedding = await task
                    batch_results.append((function_id, embedding))
                except Exception as e:
                    logger.error("Batch embedding failed",
                               function_id=function_id,
                               error=str(e))
                    batch_results.append((function_id, None))

            results.extend(batch_results)

            batch_duration = (time.time() - batch_start_time) * 1000
            batch_num = (i // batch_size) + 1
            total_batches = (total_functions + batch_size - 1) // batch_size

            logger.info("Batch embedding completed",
                       batch_number=batch_num,
                       total_batches=total_batches,
                       batch_size=len(batch),
                       successful_embeddings=sum(1 for _, emb in batch_results if emb is not None),
                       batch_duration_ms=round(batch_duration, 2))

            # Small delay between batches to be respectful to API limits
            if i + batch_size < total_functions:
                await asyncio.sleep(1)

        successful_count = sum(1 for _, embedding in results if embedding is not None)
        logger.info("Batch embedding generation completed",
                   total_processed=len(results),
                   successful_embeddings=successful_count,
                   success_rate=f"{(successful_count/len(results)*100):.1f}%")

        return results


# Global embedding service instance
embedding_service = EmbeddingService()