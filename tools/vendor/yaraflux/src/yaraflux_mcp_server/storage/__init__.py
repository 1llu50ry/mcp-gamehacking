"""Storage package for YaraFlux MCP Server.

This package provides a storage abstraction layer that supports both local filesystem
and MinIO (S3-compatible) storage. It handles storing and retrieving YARA rules,
samples, scan results, and general files.
"""

from yaraflux_mcp_server.storage.base import StorageClient, StorageError
from yaraflux_mcp_server.storage.factory import get_storage_client
from yaraflux_mcp_server.storage.local import LocalStorageClient

__all__ = [
    "StorageError",
    "StorageClient",
    "LocalStorageClient",
    "get_storage_client",
]

# Conditionally export MinioStorageClient if available
try:
    from yaraflux_mcp_server.storage.minio import MinioStorageClient

    __all__.append("MinioStorageClient")
except ImportError:
    pass
