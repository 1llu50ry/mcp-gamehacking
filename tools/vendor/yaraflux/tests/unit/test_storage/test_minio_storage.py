"""Tests for the MinIO storage implementation."""

import logging
from unittest.mock import MagicMock, Mock, patch

import pytest
from minio.error import S3Error

from yaraflux_mcp_server.storage import StorageError
from yaraflux_mcp_server.storage.minio import MinioStorageClient


@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_minio_client_init(mock_minio, caplog):
    """Test initialization of MinioStorageClient."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Configure mock settings
        mock_settings.MINIO_ENDPOINT = "localhost:9000"
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"
        mock_settings.MINIO_SECURE = False
        mock_settings.MINIO_BUCKET_RULES = "yaraflux-rules"
        mock_settings.MINIO_BUCKET_SAMPLES = "yaraflux-samples"
        mock_settings.MINIO_BUCKET_RESULTS = "yaraflux-results"

        # Configure mock Minio client
        mock_client = Mock()
        mock_client.bucket_exists.return_value = True
        mock_minio.return_value = mock_client

        # Initialize client
        with caplog.at_level(logging.INFO):
            client = MinioStorageClient()

        # Check Minio client was initialized with correct parameters
        mock_minio.assert_called_once_with(
            endpoint="localhost:9000", access_key="minioadmin", secret_key="minioadmin", secure=False
        )

        # Check bucket names
        assert client.rules_bucket == "yaraflux-rules"
        assert client.samples_bucket == "yaraflux-samples"
        assert client.results_bucket == "yaraflux-results"
        assert client.files_bucket == "yaraflux-files"
        assert client.files_meta_bucket == "yaraflux-files-meta"

        # Check bucket existence was checked
        assert mock_client.bucket_exists.call_count == 5

        # Verify logging
        assert "Initialized MinIO storage" in caplog.text


@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_minio_client_missing_settings(mock_minio):
    """Test MinioStorageClient with missing settings."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Missing endpoint
        mock_settings.MINIO_ENDPOINT = None
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"

        # Should raise ValueError
        with pytest.raises(ValueError, match="MinIO storage requires"):
            MinioStorageClient()


@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_ensure_bucket_exists_create(mock_minio):
    """Test _ensure_bucket_exists creates bucket if it doesn't exist."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Configure mock settings
        mock_settings.MINIO_ENDPOINT = "localhost:9000"
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"
        mock_settings.MINIO_SECURE = False
        mock_settings.MINIO_BUCKET_RULES = "yaraflux-rules"
        mock_settings.MINIO_BUCKET_SAMPLES = "yaraflux-samples"
        mock_settings.MINIO_BUCKET_RESULTS = "yaraflux-results"

        # Configure mock Minio client
        mock_client = Mock()
        mock_client.bucket_exists.return_value = False
        mock_minio.return_value = mock_client

        # Initialize client - should create all buckets
        client = MinioStorageClient()

        # Check bucket_exists was called for all buckets
        assert mock_client.bucket_exists.call_count == 5

        # Check make_bucket was called for all buckets
        assert mock_client.make_bucket.call_count == 5


@patch("yaraflux_mcp_server.storage.minio.MinioStorageClient._ensure_bucket_exists")
@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_ensure_bucket_exists_error(mock_minio, mock_ensure_bucket):
    """Test initialization fails when bucket creation fails."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Configure mock settings
        mock_settings.MINIO_ENDPOINT = "localhost:9000"
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"
        mock_settings.MINIO_SECURE = False
        mock_settings.MINIO_BUCKET_RULES = "yaraflux-rules"
        mock_settings.MINIO_BUCKET_SAMPLES = "yaraflux-samples"
        mock_settings.MINIO_BUCKET_RESULTS = "yaraflux-results"

        # Setup the patched method to raise StorageError
        mock_ensure_bucket.side_effect = StorageError("Failed to create MinIO bucket: Test error")

        # Should raise StorageError
        with pytest.raises(StorageError, match="Failed to create MinIO bucket"):
            MinioStorageClient()


@pytest.mark.parametrize(
    "method_name",
    [
        "get_rule",
        "delete_rule",
        "list_rules",
        "save_sample",
        "get_sample",
        "save_result",
        "get_result",
        "save_file",
        "get_file",
        "list_files",
        "get_file_info",
        "delete_file",
        "extract_strings",
        "get_hex_view",
    ],
)
@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_unimplemented_methods(mock_minio, method_name):
    """Test that unimplemented methods raise NotImplementedError."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Configure mock settings
        mock_settings.MINIO_ENDPOINT = "localhost:9000"
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"
        mock_settings.MINIO_SECURE = False
        mock_settings.MINIO_BUCKET_RULES = "yaraflux-rules"
        mock_settings.MINIO_BUCKET_SAMPLES = "yaraflux-samples"
        mock_settings.MINIO_BUCKET_RESULTS = "yaraflux-results"

        # Configure mock Minio client
        mock_client = Mock()
        mock_client.bucket_exists.return_value = True
        mock_minio.return_value = mock_client

        # Initialize client
        client = MinioStorageClient()

        # Get the method
        method = getattr(client, method_name)

        # Should raise NotImplementedError
        with pytest.raises(NotImplementedError, match="not fully implemented yet"):
            # Call the method with some dummy arguments
            if method_name in ["get_rule", "delete_rule"]:
                method("test.yar")
            elif method_name == "list_rules":
                method()
            elif method_name == "save_sample":
                method("test.bin", b"test")
            elif method_name in ["get_sample", "get_file", "get_file_info", "delete_file", "get_result"]:
                method("test-id")
            elif method_name == "save_result":
                method("test-id", {})
            elif method_name == "save_file":
                method("test.bin", b"test")
            elif method_name == "list_files":
                method()
            elif method_name == "extract_strings":
                method("test-id")
            elif method_name == "get_hex_view":
                method("test-id")


@patch("yaraflux_mcp_server.storage.minio.Minio")
def test_save_rule(mock_minio):
    """Test that save_rule raises NotImplementedError."""
    with patch("yaraflux_mcp_server.storage.minio.settings") as mock_settings:
        # Configure mock settings
        mock_settings.MINIO_ENDPOINT = "localhost:9000"
        mock_settings.MINIO_ACCESS_KEY = "minioadmin"
        mock_settings.MINIO_SECRET_KEY = "minioadmin"
        mock_settings.MINIO_SECURE = False
        mock_settings.MINIO_BUCKET_RULES = "yaraflux-rules"
        mock_settings.MINIO_BUCKET_SAMPLES = "yaraflux-samples"
        mock_settings.MINIO_BUCKET_RESULTS = "yaraflux-results"

        # Configure mock Minio client
        mock_client = Mock()
        mock_client.bucket_exists.return_value = True
        mock_minio.return_value = mock_client

        # Initialize client
        client = MinioStorageClient()

        # Should raise NotImplementedError
        with pytest.raises(NotImplementedError, match="not fully implemented yet"):
            client.save_rule("test.yar", "rule test { condition: true }")
