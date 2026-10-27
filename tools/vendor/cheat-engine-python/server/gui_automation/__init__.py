"""
GUI Automation Module
=====================

GUI automation module for the MCP Cheat Engine Server.

This module provides comprehensive PyAutoGUI integration as part of the 
MCP Cheat Engine Server, offering secure and powerful GUI automation capabilities.

Modules:
--------
- core.integration: Main PyAutoGUI controller and integration
- tools.mcp_tools: MCP tool definitions for PyAutoGUI functionality
- demos: Example usage and demonstration scripts
- tests: Test suites for validation

Usage:
------
from server.gui_automation.core.integration import PyAutoGUIController
from server.gui_automation.tools.mcp_tools import ALL_PYAUTOGUI_TOOLS, PyAutoGUIToolHandler

# Initialize controller
controller = PyAutoGUIController()

# Use MCP tools
from server.gui_automation.tools.mcp_tools import get_pyautogui_controller
gui = get_pyautogui_controller()
"""

# Re-export main components for easy access
from .core.integration import PyAutoGUIController, get_pyautogui_controller, PYAUTOGUI_AVAILABLE
from .tools.mcp_tools import ALL_PYAUTOGUI_TOOLS, PyAutoGUIToolHandler

__version__ = "1.0.0"
__author__ = "MCP Cheat Engine Server"

__all__ = [
    'PyAutoGUIController',
    'get_pyautogui_controller', 
    'PYAUTOGUI_AVAILABLE',
    'ALL_PYAUTOGUI_TOOLS',
    'PyAutoGUIToolHandler'
]
