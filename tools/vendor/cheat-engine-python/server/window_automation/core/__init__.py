"""
Core module exports for PyWinAuto integration
"""

from .integration import (
    PyWinAutoController,
    get_pywinauto_controller,
    PYWINAUTO_AVAILABLE,
    ElementInfo,
    WindowInfo,
    ApplicationInfo,
    AutomationResult
)

__all__ = [
    "PyWinAutoController",
    "get_pywinauto_controller", 
    "PYWINAUTO_AVAILABLE",
    "ElementInfo",
    "WindowInfo", 
    "ApplicationInfo",
    "AutomationResult"
]
