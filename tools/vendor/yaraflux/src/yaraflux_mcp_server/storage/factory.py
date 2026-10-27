"""Factory for creating storage clients.

This module provides a factory function to create the appropriate storage client
based on the configuration settings.
"""

import logging
from typing import TYPE_CHECKING

from yaraflux_mcp_server.storage.base import StorageClient
from yaraflux_mcp_server.storage.local import LocalStorageClient

# Configure logging
logger = logging.getLogger(__name__)

# Handle conditional imports to avoid circular references
if TYPE_CHECKING:
    from yaraflux_mcp_server.config import settings
else:
    from yaraflux_mcp_server.config import settings


def get_storage_client() -> StorageClient:
    """Get the appropriate storage client based on configuration.

    Returns:
        A StorageClient implementation
    """
    if settings.USE_MINIO:
        try:
            from yaraflux_mcp_server.storage.minio import MinioStorageClient  # pylint: disable=import-outside-toplevel

            logger.info("Using MinIO storage client")
            return MinioStorageClient()
        except (ImportError, ValueError) as e:
            logger.warning(f"Failed to initialize MinIO storage: {str(e)}")
            logger.warning("Falling back to local storage")
            return LocalStorageClient()
        except Exception as e:
            logger.warning(f"Unexpected error initializing MinIO storage: {str(e)}")
            logger.warning("Falling back to local storage")
            return LocalStorageClient()
    else:
        logger.info("Using local storage client")
        return LocalStorageClient()
