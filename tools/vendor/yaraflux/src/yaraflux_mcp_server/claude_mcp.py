"""
Simplified MCP implementation for Claude Desktop integration.

This module provides a minimal implementation of the Model Context Protocol
that works reliably with Claude Desktop, avoiding dependency on external MCP packages.
This is a wrapper module that now uses the modular mcp_tools package for
better organization and extensibility.
"""

import logging
from typing import Any, Dict, List

from fastapi import FastAPI

# Import from the new modular package
from .mcp_tools import ToolRegistry
from .mcp_tools import init_fastapi as init_fastapi_routes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Re-export key functionality to maintain backwards compatibility
def get_all_tools() -> List[Dict[str, Any]]:
    """Get all registered tools as a list of schema objects."""
    return ToolRegistry.get_all_tools()


def execute_tool(name: str, params: Dict[str, Any]) -> Any:
    """Execute a registered tool with the given parameters."""
    return ToolRegistry.execute_tool(name, params)


def init_fastapi(app: FastAPI) -> FastAPI:
    """Initialize FastAPI routes for MCP."""
    return init_fastapi_routes(app)


# Ensure everything from mcp_tools is initialized

logger.info("Claude MCP initialized with modular tools package")
