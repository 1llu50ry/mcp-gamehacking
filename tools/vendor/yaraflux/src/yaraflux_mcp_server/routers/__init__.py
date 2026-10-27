"""API routers for YaraFlux MCP Server."""

from yaraflux_mcp_server.routers.auth import router as auth_router
from yaraflux_mcp_server.routers.files import router as files_router
from yaraflux_mcp_server.routers.rules import router as rules_router
from yaraflux_mcp_server.routers.scan import router as scan_router

__all__ = ["auth_router", "rules_router", "scan_router", "files_router"]
