"""
PyWinAuto Integration Module for MCP Cheat Engine Server
=======================================================

This module provides comprehensive PyWinAuto integration for Windows application
automation through the MCP Cheat Engine Server.

Key Features:
- Application lifecycle management (launch, attach, close)
- Window and UI element discovery and manipulation
- Framework-agnostic automation (Win32, WPF, Qt, etc.)
- Element-based interaction (more reliable than coordinate-based)
- Advanced UI navigation and property inspection
- Integration with MCP server architecture

Components:
- core.integration: Main PyWinAuto controller and automation engine
- tools.mcp_tools: MCP tool definitions for Claude Desktop integration
- demos: Example scripts and usage demonstrations
- tests: Comprehensive testing suite

Usage:
    from server.window_automation import get_pywinauto_controller
    
    controller = get_pywinauto_controller()
    if controller.available:
        app = controller.connect_application("notepad.exe")
        window = controller.find_window(app, title="Untitled - Notepad")
        controller.type_text(window, "Hello PyWinAuto!")
"""

from .core.integration import (
    PyWinAutoController,
    get_pywinauto_controller,
    PYWINAUTO_AVAILABLE
)

from .tools.mcp_tools import (
    ALL_PYWINAUTO_TOOLS,
    PyWinAutoToolHandler
)

__version__ = "1.0.0"
__author__ = "MCP Cheat Engine Server"

__all__ = [
    # Core integration
    "PyWinAutoController",
    "get_pywinauto_controller", 
    "PYWINAUTO_AVAILABLE",
    
    # MCP tools
    "ALL_PYWINAUTO_TOOLS",
    "PyWinAutoToolHandler",
    
    # Version info
    "__version__",
    "__author__"
]
