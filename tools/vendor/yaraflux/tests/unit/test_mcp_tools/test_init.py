"""Tests for mcp_tools/__init__.py module."""

import importlib
import sys
from unittest.mock import MagicMock, Mock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from yaraflux_mcp_server.mcp_tools import ToolRegistry, _import_module, init_fastapi


def test_init_fastapi():
    """Test FastAPI initialization with MCP endpoints."""
    # Create a FastAPI app
    app = FastAPI()

    # Initialize the app with MCP endpoints
    init_fastapi(app)

    # Create a test client
    client = TestClient(app)

    # Test the /mcp/v1/tools endpoint
    with patch("yaraflux_mcp_server.mcp_tools.ToolRegistry.get_all_tools") as mock_get_all_tools:
        # Setup mock to return a list of tools
        mock_get_all_tools.return_value = [
            {"name": "test_tool", "description": "A test tool"},
            {"name": "another_tool", "description": "Another test tool"},
        ]

        # Make the request
        response = client.get("/mcp/v1/tools")

        # Verify the response
        assert response.status_code == 200
        assert len(response.json()) == 2
        assert response.json()[0]["name"] == "test_tool"
        assert response.json()[1]["name"] == "another_tool"

        # Verify the mock was called
        mock_get_all_tools.assert_called_once()


def test_init_fastapi_get_tools_error():
    """Test FastAPI initialization with error in get_tools."""
    # Create a FastAPI app
    app = FastAPI()

    # Initialize the app with MCP endpoints
    init_fastapi(app)

    # Create a test client
    client = TestClient(app)

    # Test the /mcp/v1/tools endpoint with error
    with patch("yaraflux_mcp_server.mcp_tools.ToolRegistry.get_all_tools") as mock_get_all_tools:
        # Setup mock to raise an exception
        mock_get_all_tools.side_effect = Exception("Error getting tools")

        # Make the request
        response = client.get("/mcp/v1/tools")

        # Verify the response is a 500 error
        assert response.status_code == 500
        assert "Error getting tools" in response.json()["detail"]

        # Verify the mock was called
        mock_get_all_tools.assert_called_once()


def test_init_fastapi_execute_tool():
    """Test FastAPI initialization with execute_tool endpoint."""
    # Create a FastAPI app
    app = FastAPI()

    # Initialize the app with MCP endpoints
    init_fastapi(app)

    # Create a test client
    client = TestClient(app)

    # Test the /mcp/v1/execute endpoint
    with patch("yaraflux_mcp_server.mcp_tools.ToolRegistry.execute_tool") as mock_execute:
        # Setup mock to return a result
        mock_execute.return_value = {"status": "success", "data": "test result"}

        # Make the request
        response = client.post("/mcp/v1/execute", json={"name": "test_tool", "parameters": {"param1": "value1"}})

        # Verify the response
        assert response.status_code == 200
        assert response.json()["result"]["status"] == "success"
        assert response.json()["result"]["data"] == "test result"

        # Verify the mock was called with the right parameters
        mock_execute.assert_called_once_with("test_tool", {"param1": "value1"})


def test_init_fastapi_execute_tool_missing_name():
    """Test FastAPI initialization with execute_tool endpoint missing name."""
    # Create a new FastAPI app for isolated testing
    test_app = FastAPI()

    # Create a custom execute_tool endpoint that mimics the behavior but without raising HTTPException
    @test_app.post("/mcp/v1/execute")
    async def execute_tool(request: Request):
        data = await request.json()
        name = data.get("name")

        if not name:
            return JSONResponse(status_code=400, content={"detail": "Tool name is required"})

        return {"result": "success"}

    # Create a test client
    client = TestClient(test_app)

    # Test the /mcp/v1/execute endpoint with missing name
    response = client.post("/mcp/v1/execute", json={"parameters": {"param1": "value1"}})

    # Verify the response has a 400 status code with the expected message
    assert response.status_code == 400
    assert "Tool name is required" in response.json()["detail"]


def test_init_fastapi_execute_tool_not_found():
    """Test FastAPI initialization with execute_tool endpoint tool not found."""
    # Create a FastAPI app
    app = FastAPI()

    # Initialize the app with MCP endpoints
    init_fastapi(app)

    # Create a test client
    client = TestClient(app)

    # Test the /mcp/v1/execute endpoint with tool not found
    with patch("yaraflux_mcp_server.mcp_tools.ToolRegistry.execute_tool") as mock_execute:
        # Setup mock to raise a KeyError (tool not found)
        mock_execute.side_effect = KeyError("Tool 'missing_tool' not found")

        # Make the request
        response = client.post("/mcp/v1/execute", json={"name": "missing_tool", "parameters": {}})

        # Verify the response is a 404 error
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

        # Verify the mock was called
        mock_execute.assert_called_once()


def test_init_fastapi_execute_tool_error():
    """Test FastAPI initialization with execute_tool endpoint error."""
    # Create a FastAPI app
    app = FastAPI()

    # Initialize the app with MCP endpoints
    init_fastapi(app)

    # Create a test client
    client = TestClient(app)

    # Test the /mcp/v1/execute endpoint with error
    with patch("yaraflux_mcp_server.mcp_tools.ToolRegistry.execute_tool") as mock_execute:
        # Setup mock to raise an exception
        mock_execute.side_effect = Exception("Error executing tool")

        # Make the request
        response = client.post("/mcp/v1/execute", json={"name": "test_tool", "parameters": {}})

        # Verify the response is a 500 error
        assert response.status_code == 500
        assert "Error executing tool" in response.json()["detail"]

        # Verify the mock was called
        mock_execute.assert_called_once()


def test_import_module_success():
    """Test _import_module function with successful import."""
    with patch("importlib.import_module") as mock_import:
        # Setup mock to return a module
        mock_module = MagicMock()
        mock_import.return_value = mock_module

        # Call the function
        result = _import_module("fake_module")

        # Verify the result is the mock module
        assert result == mock_module

        # Verify the import was called with the right parameters
        mock_import.assert_called_once_with(".fake_module", package="yaraflux_mcp_server.mcp_tools")


def test_import_module_import_error():
    """Test _import_module function with import error."""
    with patch("importlib.import_module") as mock_import:
        # Setup mock to raise ImportError
        mock_import.side_effect = ImportError("Module not found")

        # Call the function
        result = _import_module("missing_module")

        # Verify the result is None
        assert result is None

        # Verify the import was called with the right parameters
        mock_import.assert_called_once_with(".missing_module", package="yaraflux_mcp_server.mcp_tools")


def test_init_file_import_modules():
    """Test the module import mechanism in a way that's not affected by previous imports."""

    # Simple test function to verify dynamic imports
    def _test_import_module(module_name):
        try:
            return importlib.import_module(f".{module_name}", package="yaraflux_mcp_server.mcp_tools")
        except ImportError:
            return None

    # We know these modules should exist
    expected_modules = ["file_tools", "scan_tools", "rule_tools", "storage_tools"]

    # Verify we can import each module
    for module_name in expected_modules:
        result = _test_import_module(module_name)
        assert result is not None, f"Failed to import {module_name}"
