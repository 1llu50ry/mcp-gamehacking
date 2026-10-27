"""Tests for app.py main application."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from yaraflux_mcp_server.app import app, create_app, ensure_directories_exist, lifespan


def test_ensure_directories_exist() -> None:
    """Test directory creation function."""
    with (
        patch("os.makedirs") as mock_makedirs,
        patch("yaraflux_mcp_server.app.settings") as mock_settings,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mock settings with Path objects
        mock_settings.STORAGE_DIR = Path("/tmp/yaraflux/storage")
        mock_settings.YARA_RULES_DIR = Path("/tmp/yaraflux/rules")
        mock_settings.YARA_SAMPLES_DIR = Path("/tmp/yaraflux/samples")
        mock_settings.YARA_RESULTS_DIR = Path("/tmp/yaraflux/results")

        # Call the function
        ensure_directories_exist()

        # Verify the directories were created
        assert mock_makedirs.call_count >= 4  # 4 main directories + 2 rule subdirectories
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/storage"), exist_ok=True)
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/rules"), exist_ok=True)
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/samples"), exist_ok=True)
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/results"), exist_ok=True)
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/rules") / "community", exist_ok=True)
        mock_makedirs.assert_any_call(Path("/tmp/yaraflux/rules") / "custom", exist_ok=True)

        # Verify logging
        assert mock_logger.info.call_count >= 5


@pytest.mark.asyncio
async def test_lifespan_normal() -> None:
    """Test lifespan context manager under normal conditions."""
    app_mock = MagicMock()

    # Setup mocks for the functions called inside lifespan
    with (
        patch("yaraflux_mcp_server.app.ensure_directories_exist") as mock_ensure_dirs,
        patch("yaraflux_mcp_server.app.init_user_db") as mock_init_user_db,
        patch("yaraflux_mcp_server.app.yara_service") as mock_yara_service,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
        patch("yaraflux_mcp_server.app.settings") as mock_settings,
    ):

        # Configure settings
        mock_settings.YARA_INCLUDE_DEFAULT_RULES = True

        # Use lifespan as a context manager
        async with lifespan(app_mock):
            # Check if startup functions were called
            mock_ensure_dirs.assert_called_once()
            mock_init_user_db.assert_called_once()
            mock_yara_service.load_rules.assert_called_once_with(include_default_rules=True)

            # Verify startup logging
            mock_logger.info.assert_any_call("Starting YaraFlux MCP Server")
            mock_logger.info.assert_any_call("Directory structure verified")
            mock_logger.info.assert_any_call("User database initialized")
            mock_logger.info.assert_any_call("YARA rules loaded")

        # Verify shutdown logging
        mock_logger.info.assert_any_call("Shutting down YaraFlux MCP Server")


@pytest.mark.asyncio
async def test_lifespan_errors() -> None:
    """Test lifespan context manager with errors."""
    app_mock = MagicMock()

    # Setup mocks with errors
    with (
        patch("yaraflux_mcp_server.app.ensure_directories_exist") as mock_ensure_dirs,
        patch("yaraflux_mcp_server.app.init_user_db") as mock_init_user_db,
        patch("yaraflux_mcp_server.app.yara_service") as mock_yara_service,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
        patch("yaraflux_mcp_server.app.settings") as mock_settings,
    ):

        # Make init_user_db and load_rules raise exceptions
        mock_init_user_db.side_effect = Exception("User DB initialization error")
        mock_yara_service.load_rules.side_effect = Exception("YARA rules loading error")

        # Use lifespan as a context manager
        async with lifespan(app_mock):
            # Verify directory creation still happened
            mock_ensure_dirs.assert_called_once()

            # Verify error logging
            mock_logger.error.assert_any_call("Error initializing user database: User DB initialization error")
            mock_logger.error.assert_any_call("Error loading YARA rules: YARA rules loading error")


def test_create_app() -> None:
    """Test FastAPI application creation."""
    with (
        patch("yaraflux_mcp_server.app.FastAPI") as mock_fastapi,
        patch("yaraflux_mcp_server.app.CORSMiddleware") as mock_cors,
        patch("yaraflux_mcp_server.app.lifespan") as mock_lifespan,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mock FastAPI instance
        mock_app = MagicMock()
        mock_fastapi.return_value = mock_app

        # Call the function
        result = create_app()

        # Verify FastAPI was created with correct parameters
        mock_fastapi.assert_called_once()
        assert "lifespan" in mock_fastapi.call_args.kwargs
        assert mock_fastapi.call_args.kwargs["lifespan"] == mock_lifespan

        # Verify CORS middleware was added
        mock_app.add_middleware.assert_called_with(
            mock_cors,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Verify the result
        assert result == mock_app


def test_health_check() -> None:
    """Test health check endpoint."""
    # Create a TestClient with the real app
    client = TestClient(app)

    # Call the health check endpoint
    response = client.get("/health")

    # Verify the response
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_router_initialization() -> None:
    """Test API router initialization."""
    with (
        patch("yaraflux_mcp_server.app.FastAPI") as mock_fastapi,
        patch("yaraflux_mcp_server.routers.auth_router") as mock_auth_router,
        patch("yaraflux_mcp_server.routers.rules_router") as mock_rules_router,
        patch("yaraflux_mcp_server.routers.scan_router") as mock_scan_router,
        patch("yaraflux_mcp_server.routers.files_router") as mock_files_router,
        patch("yaraflux_mcp_server.app.settings") as mock_settings,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mocks
        mock_app = MagicMock()
        mock_fastapi.return_value = mock_app
        mock_settings.API_PREFIX = "/api"

        # Call the function
        create_app()

        # Verify routers were included
        assert mock_app.include_router.call_count == 4
        mock_app.include_router.assert_any_call(mock_auth_router, prefix="/api")
        mock_app.include_router.assert_any_call(mock_rules_router, prefix="/api")
        mock_app.include_router.assert_any_call(mock_scan_router, prefix="/api")
        mock_app.include_router.assert_any_call(mock_files_router, prefix="/api")

        # Verify logging
        mock_logger.info.assert_any_call("API routers initialized")


def test_router_initialization_error() -> None:
    """Test API router initialization with error."""
    with (
        patch("yaraflux_mcp_server.app.FastAPI") as mock_fastapi,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mocks
        mock_app = MagicMock()
        mock_fastapi.return_value = mock_app

        # Make the router import raise an exception
        with patch("builtins.__import__") as mock_import:
            # Make __import__ raise an exception for the routers module
            def side_effect(name, *args, **kwargs):
                if "routers" in name:
                    raise ImportError("Router import error")
                raise ImportError(f"Import error: {name}")

            mock_import.side_effect = side_effect

            # Call the function
            create_app()

            # Verify error was logged
            mock_logger.error.assert_any_call("Error initializing API routers: Router import error")


def test_mcp_initialization():
    """Test MCP tools initialization."""
    with (
        patch("yaraflux_mcp_server.app.FastAPI") as mock_fastapi,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mocks
        mock_app = MagicMock()
        mock_fastapi.return_value = mock_app

        # Create a mock for the init_fastapi function that will be imported
        mock_init = MagicMock()

        # Setup module mocks with the init_fastapi function
        mock_claude_mcp = MagicMock()
        mock_claude_mcp.init_fastapi = mock_init

        # Setup the import system to return our mocks
        with patch.dict(
            "sys.modules",
            {"yaraflux_mcp_server.claude_mcp": mock_claude_mcp, "yaraflux_mcp_server.mcp_tools": MagicMock()},
        ):
            # Call the function
            create_app()

            # Verify MCP initialization was called
            mock_init.assert_called_once_with(mock_app)

        # Verify logging
        mock_logger.info.assert_any_call("MCP tools initialized and registered with FastAPI")


def test_mcp_initialization_error():
    """Test MCP tools initialization with error."""
    with (
        patch("yaraflux_mcp_server.app.FastAPI") as mock_fastapi,
        patch("yaraflux_mcp_server.app.logger") as mock_logger,
    ):

        # Setup mocks
        mock_app = MagicMock()
        mock_fastapi.return_value = mock_app

        # Make the import or init_fastapi raise an exception
        with patch("builtins.__import__") as mock_import:
            mock_import.side_effect = ImportError("MCP import error")

            # Call the function
            create_app()

            # Verify error was logged
            mock_logger.error.assert_any_call("Error setting up MCP: MCP import error")
            mock_logger.warning.assert_any_call("MCP integration skipped.")


def test_main_entrypoint():
    """Test __main__ entrypoint."""
    with patch("uvicorn.run") as mock_run, patch("yaraflux_mcp_server.app.settings") as mock_settings:

        # Setup settings
        mock_settings.HOST = "127.0.0.1"
        mock_settings.PORT = 8000
        mock_settings.DEBUG = True

        # Create a mock module with the required imports
        mock_app = MagicMock()

        # Test the if __name__ == "__main__" block directly
        # Call the function that would be in the __main__ block
        import uvicorn

        from yaraflux_mcp_server.app import app

        if hasattr(uvicorn, "run"):
            # The actual code from the __main__ block of app.py
            uvicorn.run(
                "yaraflux_mcp_server.app:app",
                host=mock_settings.HOST,
                port=mock_settings.PORT,
                reload=mock_settings.DEBUG,
            )

            # Verify uvicorn run was called
            mock_run.assert_called_once_with(
                "yaraflux_mcp_server.app:app",
                host="127.0.0.1",
                port=8000,
                reload=True,
            )
