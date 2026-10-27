"""Unit tests for the storage factory module."""

import logging
import sys
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.storage.base import StorageClient
from yaraflux_mcp_server.storage.factory import get_storage_client
from yaraflux_mcp_server.storage.local import LocalStorageClient


@pytest.fixture
def mock_settings():
    """Mock settings for testing."""
    with patch("yaraflux_mcp_server.storage.factory.settings") as mock_settings:
        yield mock_settings


class TestStorageFactory:
    """Tests for the storage factory."""

    def test_get_local_storage_client(self, mock_settings):
        """Test getting a local storage client."""
        mock_settings.USE_MINIO = False

        # Get the storage client
        client = get_storage_client()

        # Should be a LocalStorageClient
        assert isinstance(client, LocalStorageClient)
        assert isinstance(client, StorageClient)  # Should also be a StorageClient

    def test_get_minio_storage_client(self, mock_settings):
        """Test getting a MinIO storage client."""
        # Configure MinIO settings
        mock_settings.USE_MINIO = True
        mock_settings.MINIO_ENDPOINT = "test-endpoint"
        mock_settings.MINIO_ACCESS_KEY = "test-access-key"
        mock_settings.MINIO_SECRET_KEY = "test-secret-key"
        mock_settings.MINIO_BUCKET = "test-bucket"

        mock_minio_client = MagicMock()

        # Need to patch the correct import location that's used during runtime
        with patch("yaraflux_mcp_server.storage.minio.MinioStorageClient", return_value=mock_minio_client):

            # We also need to modify the import itself to return our mock
            # rather than trying to import the actual minio module
            with patch.dict("sys.modules", {"minio": MagicMock()}):

                # Get the storage client
                client = get_storage_client()

                # Should be the mocked MinioStorageClient
                assert client is mock_minio_client

    def test_minio_import_error_fallback(self, mock_settings):
        """Test fallback to local storage when MinIO import fails."""
        mock_settings.USE_MINIO = True

        # Mock an ImportError when importing MinioStorageClient
        with patch(
            "yaraflux_mcp_server.storage.factory.MinioStorageClient",
            side_effect=ImportError("No module named 'minio'"),
            create=True,
        ):

            # Get the storage client
            client = get_storage_client()

            # Should fallback to LocalStorageClient
            assert isinstance(client, LocalStorageClient)

    def test_minio_value_error_fallback(self, mock_settings):
        """Test fallback to local storage when MinIO initialization fails with ValueError."""
        mock_settings.USE_MINIO = True

        # Mock a ValueError when instantiating MinioStorageClient
        with patch(
            "yaraflux_mcp_server.storage.factory.MinioStorageClient",
            side_effect=ValueError("Invalid MinIO configuration"),
            create=True,
        ):

            # Get the storage client
            client = get_storage_client()

            # Should fallback to LocalStorageClient
            assert isinstance(client, LocalStorageClient)

    def test_minio_generic_error_fallback(self, mock_settings):
        """Test fallback to local storage when MinIO initialization fails with any exception."""
        mock_settings.USE_MINIO = True

        # Mock a generic Exception when instantiating MinioStorageClient
        with patch(
            "yaraflux_mcp_server.storage.factory.MinioStorageClient",
            side_effect=Exception("Unexpected error"),
            create=True,
        ):

            # Get the storage client
            client = get_storage_client()

            # Should fallback to LocalStorageClient
            assert isinstance(client, LocalStorageClient)

    def test_logger_messages(self, mock_settings, caplog):
        """Test that appropriate log messages are generated."""
        with caplog.at_level(logging.INFO):
            # Test local storage
            mock_settings.USE_MINIO = False
            get_storage_client()
            assert "Using local storage client" in caplog.text

            caplog.clear()

            # Test MinIO storage
            mock_settings.USE_MINIO = True
            with patch("yaraflux_mcp_server.storage.factory.MinioStorageClient", create=True):
                get_storage_client()
                assert "Using MinIO storage client" in caplog.text

            caplog.clear()

            # Test fallback log messages
            mock_settings.USE_MINIO = True
            with patch(
                "yaraflux_mcp_server.storage.factory.MinioStorageClient",
                side_effect=ImportError("No module named 'minio'"),
                create=True,
            ):
                get_storage_client()
                assert "Failed to initialize MinIO storage" in caplog.text
                assert "Falling back to local storage" in caplog.text
