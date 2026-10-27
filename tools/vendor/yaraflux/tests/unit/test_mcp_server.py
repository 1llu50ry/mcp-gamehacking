"""Unit tests for mcp_server module."""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from yaraflux_mcp_server.mcp_server import (
    FastMCP,
    get_rule_content,
    get_rules_list,
    initialize_server,
    list_registered_tools,
    register_tools,
    run_server,
)


@pytest.fixture
def mock_mcp():
    """Create a mock MCP server."""
    with patch("yaraflux_mcp_server.mcp_server.mcp") as mock:
        mock_server = MagicMock()
        mock.return_value = mock_server
        mock_server._mcp_server = MagicMock()
        mock_server._mcp_server.run = AsyncMock()
        mock_server._mcp_server.create_initialization_options = MagicMock(return_value={})
        mock_server.on_connect = None
        mock_server.on_disconnect = None
        mock_server.tool = MagicMock()
        mock_server.tool.return_value = lambda x: x  # Decorator that returns the function
        mock_server.resource = MagicMock()
        mock_server.resource.return_value = lambda x: x  # Decorator that returns the function
        mock_server.list_tools = AsyncMock(
            return_value=[
                {"name": "scan_url"},
                {"name": "get_yara_rule"},
            ]
        )
        yield mock_server


@pytest.fixture
def mock_yara_service():
    """Create a mock YARA service."""
    with patch("yaraflux_mcp_server.mcp_server.yara_service") as mock:
        mock.list_rules = MagicMock(
            return_value=[
                MagicMock(name="test_rule1", description="Test rule 1", source="custom"),
                MagicMock(name="test_rule2", description="Test rule 2", source="community"),
            ]
        )
        mock.get_rule = MagicMock(return_value="rule test_rule { condition: true }")
        yield mock


@pytest.fixture
def mock_init_user_db():
    """Mock user database initialization."""
    with patch("yaraflux_mcp_server.mcp_server.init_user_db") as mock:
        yield mock


@pytest.fixture
def mock_os_makedirs():
    """Mock os.makedirs function."""
    with patch("os.makedirs") as mock:
        yield mock


@pytest.fixture
def mock_settings():
    """Mock settings."""
    with patch("yaraflux_mcp_server.mcp_server.settings") as mock:
        # Configure paths for directories
        mock.STORAGE_DIR = MagicMock()
        mock.YARA_RULES_DIR = MagicMock()
        mock.YARA_SAMPLES_DIR = MagicMock()
        mock.YARA_RESULTS_DIR = MagicMock()
        mock.YARA_INCLUDE_DEFAULT_RULES = True
        mock.API_PORT = 8000
        yield mock


@pytest.fixture
def mock_asyncio_run():
    """Mock asyncio.run function."""
    with patch("asyncio.run") as mock:
        yield mock


def test_register_tools():
    """Test registering MCP tools."""
    # Create a fresh mock for this test
    mock_mcp = MagicMock()

    # Patch the mcp instance in the module
    with patch("yaraflux_mcp_server.mcp_server.mcp", mock_mcp):
        # Run the function to register tools
        register_tools()

        # Verify the tool decorator was called the expected number of times
        # 19 tools should be registered as per documentation
        assert mock_mcp.tool.call_count == 19

        # Simplify the verification approach
        # Just check that a call with each expected name was made
        # This is more resistant to changes in the mock structure
        mock_mcp.tool.assert_any_call(name="scan_url")
        mock_mcp.tool.assert_any_call(name="scan_data")
        mock_mcp.tool.assert_any_call(name="get_scan_result")
        mock_mcp.tool.assert_any_call(name="list_yara_rules")
        mock_mcp.tool.assert_any_call(name="get_yara_rule")
        mock_mcp.tool.assert_any_call(name="upload_file")
        mock_mcp.tool.assert_any_call(name="list_files")
        mock_mcp.tool.assert_any_call(name="clean_storage")


def test_initialize_server(mock_os_makedirs, mock_init_user_db, mock_mcp, mock_yara_service, mock_settings):
    """Test server initialization."""
    initialize_server()

    # Verify directories are created
    assert mock_os_makedirs.call_count >= 6  # At least 6 directories

    # Verify user DB is initialized
    mock_init_user_db.assert_called_once()

    # Verify YARA rules are loaded
    mock_yara_service.load_rules.assert_called_once_with(include_default_rules=True)


def test_get_rules_list(mock_yara_service):
    """Test getting rules list resource."""
    # Test with default source
    result = get_rules_list()
    assert "YARA Rules" in result
    assert "test_rule1" in result
    assert "test_rule2" in result

    # Test with custom source
    mock_yara_service.list_rules.reset_mock()
    result = get_rules_list("custom")
    mock_yara_service.list_rules.assert_called_once_with("custom")

    # Test with empty result
    mock_yara_service.list_rules.return_value = []
    result = get_rules_list()
    assert "No YARA rules found" in result

    # Test with exception
    mock_yara_service.list_rules.side_effect = Exception("Test error")
    result = get_rules_list()
    assert "Error getting rules list" in result


def test_get_rule_content(mock_yara_service):
    """Test getting rule content resource."""
    # Test successful retrieval
    result = get_rule_content("test_rule", "custom")
    assert "```yara" in result
    assert "rule test_rule" in result
    mock_yara_service.get_rule.assert_called_once_with("test_rule", "custom")

    # Test with exception
    mock_yara_service.get_rule.side_effect = Exception("Test error")
    result = get_rule_content("test_rule", "custom")
    assert "Error getting rule content" in result


@pytest.mark.asyncio
async def test_list_registered_tools(mock_mcp):
    """Test listing registered tools."""
    # Create an ImportError context manager to ensure proper patching
    with patch("yaraflux_mcp_server.mcp_server.mcp", mock_mcp):
        # Set up the AsyncMock properly
        mock_mcp.list_tools = AsyncMock()
        mock_mcp.list_tools.return_value = [{"name": "scan_url"}, {"name": "get_yara_rule"}]

        # Now call the function
        tools = await list_registered_tools()

        # Verify the mock was called
        mock_mcp.list_tools.assert_called_once()

        # Verify we got the expected tools from our mock
        assert len(tools) == 2
        assert "scan_url" in tools
        assert "get_yara_rule" in tools

        # Test with exception
        mock_mcp.list_tools.side_effect = Exception("Test error")
        tools = await list_registered_tools()
        assert tools == []


@patch("yaraflux_mcp_server.mcp_server.initialize_server")
@patch("asyncio.run")
def test_run_server_stdio(mock_asyncio_run, mock_initialize, mock_mcp, mock_settings):
    """Test running server with stdio transport."""
    # Create a proper mock for the MCP server
    # We need to provide an async mock for any async function that might be called
    async_run = AsyncMock()

    # Mock list_registered_tools to properly handle async behavior
    mock_list_tools = AsyncMock()
    mock_list_tools.return_value = ["scan_url", "get_yara_rule"]

    with (
        patch("yaraflux_mcp_server.mcp_server.mcp", mock_mcp),
        patch("mcp.server.stdio.stdio_server") as mock_stdio_server,
        patch("yaraflux_mcp_server.mcp_server.list_registered_tools", mock_list_tools),
    ):
        # Set up the mock for stdio server
        mock_stdio_server.return_value.__aenter__.return_value = (MagicMock(), MagicMock())

        # Run the server (it's not an async function, so we don't await it)
        run_server("stdio")

        # Verify initialization
        mock_initialize.assert_called_once()

        # Verify asyncio.run was called
        mock_asyncio_run.assert_called_once()

        # Verify connection handlers were set
        assert mock_mcp.on_connect is not None, "on_connect handler was not set"
        assert mock_mcp.on_disconnect is not None, "on_disconnect handler was not set"


@patch("yaraflux_mcp_server.mcp_server.initialize_server")
@patch("asyncio.run")
def test_run_server_http(mock_asyncio_run, mock_initialize, mock_settings):
    """Test running server with HTTP transport."""
    # Create a clean mock without using the fixture since we need to track attribute setting
    mock_mcp = MagicMock()

    # Create an async mock for list_registered_tools
    mock_list_tools = AsyncMock()
    mock_list_tools.return_value = ["scan_url", "get_yara_rule"]

    # Make asyncio.run just return None instead of trying to run the coroutine
    mock_asyncio_run.return_value = None

    # Patch the MCP module directly
    with (
        patch("yaraflux_mcp_server.mcp_server.mcp", mock_mcp),
        patch("yaraflux_mcp_server.mcp_server.list_registered_tools", mock_list_tools),
    ):

        # Run the server - which will call initialize_server
        run_server("http")

        # Verify initialization was called
        mock_initialize.assert_called_once()

        # Verify asyncio.run was called
        mock_asyncio_run.assert_called_once()

        # Verify handlers were set
        assert mock_mcp.on_connect is not None, "on_connect handler was not set"
        assert mock_mcp.on_disconnect is not None, "on_disconnect handler was not set"


@patch("yaraflux_mcp_server.mcp_server.initialize_server")
@patch("asyncio.run")
def test_run_server_exception(mock_asyncio_run, mock_initialize, mock_mcp):
    """Test exception handling during server run."""
    # Simulate an exception during initialization
    mock_initialize.side_effect = Exception("Test error")

    # Check that the exception is propagated
    with pytest.raises(Exception, match="Test error"):
        run_server()
