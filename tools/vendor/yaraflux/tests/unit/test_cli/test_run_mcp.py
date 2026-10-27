"""Unit tests for the run_mcp module."""

import logging
import os
from unittest.mock import MagicMock, patch

import pytest

from yaraflux_mcp_server.run_mcp import main, setup_environment


@pytest.fixture
def mock_makedirs():
    """Mock os.makedirs function."""
    with patch("os.makedirs") as mock:
        yield mock


@pytest.fixture
def mock_init_user_db():
    """Mock init_user_db function."""
    with patch("yaraflux_mcp_server.run_mcp.init_user_db") as mock:
        yield mock


@pytest.fixture
def mock_yara_service():
    """Mock yara_service."""
    with patch("yaraflux_mcp_server.run_mcp.yara_service") as mock:
        yield mock


@pytest.fixture
def mock_settings():
    """Mock settings."""
    with patch("yaraflux_mcp_server.run_mcp.settings") as mock:
        # Configure paths for directories
        mock.STORAGE_DIR = MagicMock()
        mock.YARA_RULES_DIR = MagicMock()
        mock.YARA_SAMPLES_DIR = MagicMock()
        mock.YARA_RESULTS_DIR = MagicMock()
        # Make sure path joining works in tests
        mock.YARA_RULES_DIR.__truediv__.return_value = "mocked_path"
        mock.YARA_INCLUDE_DEFAULT_RULES = True
        yield mock


@pytest.fixture
def mock_mcp():
    """Mock mcp object."""
    with patch.dict(
        "sys.modules",
        {"yaraflux_mcp_server.mcp_server": MagicMock(), "yaraflux_mcp_server.mcp_server.mcp": MagicMock()},
    ):
        import sys

        mocked_mcp = sys.modules["yaraflux_mcp_server.mcp_server"].mcp
        yield mocked_mcp


class TestSetupEnvironment:
    """Tests for the setup_environment function."""

    def test_directories_creation(self, mock_makedirs, mock_init_user_db, mock_yara_service, mock_settings):
        """Test that all required directories are created."""
        setup_environment()

        # Verify directories are created
        assert mock_makedirs.call_count == 6
        mock_makedirs.assert_any_call(mock_settings.STORAGE_DIR, exist_ok=True)
        mock_makedirs.assert_any_call(mock_settings.YARA_RULES_DIR, exist_ok=True)
        mock_makedirs.assert_any_call(mock_settings.YARA_SAMPLES_DIR, exist_ok=True)
        mock_makedirs.assert_any_call(mock_settings.YARA_RESULTS_DIR, exist_ok=True)
        mock_makedirs.assert_any_call("mocked_path", exist_ok=True)  # community dir
        mock_makedirs.assert_any_call("mocked_path", exist_ok=True)  # custom dir

    def test_user_db_initialization(self, mock_makedirs, mock_init_user_db, mock_yara_service, mock_settings):
        """Test that the user database is initialized."""
        setup_environment()
        mock_init_user_db.assert_called_once()

    def test_yara_rules_loading(self, mock_makedirs, mock_init_user_db, mock_yara_service, mock_settings):
        """Test that YARA rules are loaded."""
        setup_environment()
        mock_yara_service.load_rules.assert_called_once_with(
            include_default_rules=mock_settings.YARA_INCLUDE_DEFAULT_RULES
        )

    def test_user_db_initialization_error(
        self, mock_makedirs, mock_init_user_db, mock_yara_service, mock_settings, caplog
    ):
        """Test error handling for user database initialization."""
        # Simulate an error during database initialization
        mock_init_user_db.side_effect = Exception("Database initialization error")

        # Run with captured logs
        with caplog.at_level(logging.ERROR):
            setup_environment()

        # Verify the error was logged
        assert "Error initializing user database" in caplog.text
        assert "Database initialization error" in caplog.text

        # Verify YARA rules were still loaded despite the error
        mock_yara_service.load_rules.assert_called_once()

    def test_yara_rules_loading_error(self, mock_makedirs, mock_init_user_db, mock_yara_service, mock_settings, caplog):
        """Test error handling for YARA rules loading."""
        # Simulate an error during rule loading
        mock_yara_service.load_rules.side_effect = Exception("Rule loading error")

        # Run with captured logs
        with caplog.at_level(logging.ERROR):
            setup_environment()

        # Verify the error was logged
        assert "Error loading YARA rules" in caplog.text
        assert "Rule loading error" in caplog.text


class TestMain:
    """Tests for the main function."""

    @patch("yaraflux_mcp_server.run_mcp.setup_environment")
    def test_main_function(self, mock_setup_env, mock_mcp, caplog):
        """Test the main function."""
        with caplog.at_level(logging.INFO):
            main()

        # Verify environment setup was called
        mock_setup_env.assert_called_once()

        # Verify MCP server was run
        mock_mcp.run.assert_called_once()

        # Verify log messages
        assert "Starting YaraFlux MCP Server" in caplog.text
        assert "Running MCP server..." in caplog.text

    @patch("yaraflux_mcp_server.run_mcp.setup_environment")
    def test_main_with_import_error(self, mock_setup_env, caplog):
        """Test handling of import errors in main function."""
        # Create a patch that raises an ImportError when trying to import mcp
        with patch.dict("sys.modules", {"yaraflux_mcp_server.mcp_server": None}):
            # This will raise ImportError when trying to import from yaraflux_mcp_server.mcp_server
            with pytest.raises(ImportError):
                main()

        # Verify environment setup was still called
        mock_setup_env.assert_called_once()
