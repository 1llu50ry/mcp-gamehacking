#!/usr/bin/env python3
"""
MCP Cheat Engine Server - PyWinAuto Integration Module

This module provides comprehensive access to PyWinAuto functionality
through the MCP Cheat Engine Server for Windows application automation.

PyWinAuto provides:
1. Application management (launch, attach, close)
2. Window discovery and manipulation
3. UI element identification and interaction
4. Cross-framework support (Win32, WPF, Qt, etc.)
5. Property inspection and element hierarchy navigation
6. Reliable element-based automation (vs coordinate-based)

Design Principles:
- Framework-agnostic Windows automation
- Robust element identification strategies
- Enhanced error handling and recovery
- Security controls and process validation
- Integration with existing MCP server architecture
- Comprehensive logging and debugging support
"""

import os
import sys
import time
import logging
import threading
from typing import Dict, Any, List, Optional, Tuple, Union, Callable
from dataclasses import dataclass, field
from pathlib import Path
import base64
import io
import json

# PyWinAuto imports
try:
    import pywinauto
    from pywinauto import Application, Desktop
    from pywinauto.controls.uiawrapper import UIAWrapper
    from pywinauto.controls.hwndwrapper import HwndWrapper
    from pywinauto.findwindows import ElementNotFoundError, WindowNotFoundError
    from pywinauto.timings import TimeoutError
    PYWINAUTO_AVAILABLE = True
except ImportError as e:
    PYWINAUTO_AVAILABLE = False
    print(f"PyWinAuto not available: {e}")

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class ElementInfo:
    """Information about a UI element"""
    automation_id: str = ""
    class_name: str = ""
    name: str = ""
    control_type: str = ""
    enabled: bool = True
    visible: bool = True
    rectangle: Dict[str, int] = field(default_factory=dict)
    properties: Dict[str, Any] = field(default_factory=dict)
    children_count: int = 0
    element_path: str = ""

@dataclass
class WindowInfo:
    """Information about a window"""
    title: str = ""
    class_name: str = ""
    process_id: int = 0
    handle: int = 0
    rectangle: Dict[str, int] = field(default_factory=dict)
    is_visible: bool = True
    is_enabled: bool = True
    framework: str = ""
    children_count: int = 0

@dataclass
class ApplicationInfo:
    """Information about an application"""
    process_id: int = 0
    executable: str = ""
    windows: List[WindowInfo] = field(default_factory=list)
    backend: str = ""
    connected: bool = False

@dataclass
class AutomationResult:
    """Result of an automation operation"""
    success: bool = False
    data: Dict[str, Any] = field(default_factory=dict)
    error: str = ""
    execution_time: float = 0.0

class PyWinAutoController:
    """Main controller for PyWinAuto automation"""
    
    def __init__(self):
        self.available = PYWINAUTO_AVAILABLE
        self.connected_apps: Dict[int, Application] = {}
        self.default_timeout = 10.0
        self.default_retry_interval = 0.5
        self._init_pywinauto()
    
    def _init_pywinauto(self):
        """Initialize PyWinAuto settings"""
        if not self.available:
            return
        
        try:
            # Configure PyWinAuto settings
            pywinauto.timings.Timings.fast()  # Use fast timings
            pywinauto.actionlogger.disable()  # Disable action logging by default
            
            logger.info("PyWinAuto controller initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize PyWinAuto: {e}")
            self.available = False
    
    def _error_result(self, error_msg: str, execution_time: float = 0.0) -> AutomationResult:
        """Create an error result"""
        return AutomationResult(
            success=False,
            error=error_msg,
            execution_time=execution_time
        )
    
    def _success_result(self, data: Dict[str, Any], execution_time: float = 0.0) -> AutomationResult:
        """Create a success result"""
        return AutomationResult(
            success=True,
            data=data,
            execution_time=execution_time
        )
    
    def _check_availability(self) -> Optional[str]:
        """Check if PyWinAuto is available"""
        if not self.available:
            return "PyWinAuto is not available. Install with: pip install pywinauto"
        return None
    
    # =================================================================
    # APPLICATION MANAGEMENT
    # =================================================================
    
    def connect_application(self, process_id: Optional[int] = None, 
                          path: Optional[str] = None,
                          backend: str = "uia") -> AutomationResult:
        """Connect to an existing application
        
        Args:
            process_id: Process ID to connect to
            path: Executable path to find and connect
            backend: Backend to use ('uia', 'win32')
            
        Returns:
            AutomationResult with application info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            app = None
            
            if process_id:
                app = Application(backend=backend).connect(process=process_id)
                app_process_id = process_id
            elif path:
                app = Application(backend=backend).connect(path=path)
                app_process_id = app.process
            else:
                return self._error_result("Must specify either process_id or path", time.time() - start_time)
            
            # Store connected application
            self.connected_apps[app_process_id] = app
            
            # Get application info
            windows = []
            try:
                for window in app.windows():
                    window_info = self._get_window_info(window)
                    windows.append(window_info.__dict__)
            except Exception as e:
                logger.warning(f"Failed to enumerate windows: {e}")
            
            app_info = ApplicationInfo(
                process_id=app_process_id,
                executable=path or f"PID:{app_process_id}",
                windows=windows,
                backend=backend,
                connected=True
            )
            
            return self._success_result({
                "application": app_info.__dict__,
                "message": f"Connected to application PID {app_process_id}"
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to connect to application: {str(e)}", time.time() - start_time)
    
    def launch_application(self, path: str, arguments: str = "", 
                          work_dir: Optional[str] = None,
                          backend: str = "uia",
                          timeout: float = 10.0) -> AutomationResult:
        """Launch and connect to an application
        
        Args:
            path: Executable path to launch
            arguments: Command line arguments
            work_dir: Working directory
            backend: Backend to use ('uia', 'win32')
            timeout: Timeout for application startup
            
        Returns:
            AutomationResult with application info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            # Prepare command line
            cmd_line = path
            if arguments:
                cmd_line += f" {arguments}"
            
            # Launch application
            app = Application(backend=backend).start(
                cmd_line=cmd_line,
                work_dir=work_dir,
                timeout=timeout
            )
            
            app_process_id = app.process
            self.connected_apps[app_process_id] = app
            
            # Wait for main window
            time.sleep(1.0)  # Brief wait for UI to initialize
            
            # Get application info
            windows = []
            try:
                for window in app.windows():
                    window_info = self._get_window_info(window)
                    windows.append(window_info.__dict__)
            except Exception as e:
                logger.warning(f"Failed to enumerate windows: {e}")
            
            app_info = ApplicationInfo(
                process_id=app_process_id,
                executable=path,
                windows=windows,
                backend=backend,
                connected=True
            )
            
            return self._success_result({
                "application": app_info.__dict__,
                "message": f"Launched application: {path} (PID: {app_process_id})"
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to launch application: {str(e)}", time.time() - start_time)
    
    def close_application(self, process_id: int, force: bool = False) -> AutomationResult:
        """Close an application gracefully or forcefully
        
        Args:
            process_id: Process ID of application to close
            force: Whether to force close
            
        Returns:
            AutomationResult with closure info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            if process_id not in self.connected_apps:
                return self._error_result(f"Application PID {process_id} not connected", time.time() - start_time)
            
            app = self.connected_apps[process_id]
            
            if force:
                app.kill()
                method = "force killed"
            else:
                # Try graceful close on main windows
                windows = app.windows()
                for window in windows:
                    try:
                        window.close()
                    except:
                        pass
                method = "gracefully closed"
            
            # Remove from connected apps
            del self.connected_apps[process_id]
            
            return self._success_result({
                "process_id": process_id,
                "method": method,
                "message": f"Application {method} successfully"
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to close application: {str(e)}", time.time() - start_time)
    
    # =================================================================
    # WINDOW AND ELEMENT DISCOVERY
    # =================================================================
    
    def find_windows(self, title: Optional[str] = None,
                    class_name: Optional[str] = None,
                    process_id: Optional[int] = None,
                    backend: str = "uia") -> AutomationResult:
        """Find windows by criteria
        
        Args:
            title: Window title (supports regex)
            class_name: Window class name
            process_id: Process ID
            backend: Backend to use
            
        Returns:
            AutomationResult with list of matching windows
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            desktop = Desktop(backend=backend)
            windows = []
            
            # Build search criteria
            search_criteria = {}
            if title:
                search_criteria['title'] = title
            if class_name:
                search_criteria['class_name'] = class_name
            if process_id:
                search_criteria['process'] = process_id
            
            if search_criteria:
                # Search with specific criteria
                found_windows = desktop.windows(**search_criteria)
            else:
                # Get all windows
                found_windows = desktop.windows()
            
            for window in found_windows:
                try:
                    window_info = self._get_window_info(window)
                    windows.append(window_info.__dict__)
                except Exception as e:
                    logger.warning(f"Failed to get window info: {e}")
            
            return self._success_result({
                "windows": windows,
                "count": len(windows),
                "search_criteria": search_criteria
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to find windows: {str(e)}", time.time() - start_time)
    
    def find_element(self, process_id: int, 
                    window_title: Optional[str] = None,
                    automation_id: Optional[str] = None,
                    name: Optional[str] = None,
                    class_name: Optional[str] = None,
                    control_type: Optional[str] = None,
                    index: int = 0) -> AutomationResult:
        """Find UI element by various criteria
        
        Args:
            process_id: Target application process ID
            window_title: Window title to search within
            automation_id: Automation ID of element
            name: Name of element
            class_name: Class name of element
            control_type: Control type (Button, Edit, etc.)
            index: Index if multiple matches
            
        Returns:
            AutomationResult with element info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            if process_id not in self.connected_apps:
                return self._error_result(f"Application PID {process_id} not connected", time.time() - start_time)
            
            app = self.connected_apps[process_id]
            
            # Find target window
            if window_title:
                window = app.window(title=window_title)
            else:
                windows = app.windows()
                if not windows:
                    return self._error_result("No windows found in application", time.time() - start_time)
                window = windows[0]  # Use first window
            
            # Build element search criteria
            search_criteria = {}
            if automation_id:
                search_criteria['auto_id'] = automation_id
            if name:
                search_criteria['title'] = name
            if class_name:
                search_criteria['class_name'] = class_name
            if control_type:
                search_criteria['control_type'] = control_type
            
            # Find element
            if search_criteria:
                elements = window.descendants(**search_criteria)
            else:
                elements = window.descendants()
            
            if not elements:
                return self._error_result("No elements found matching criteria", time.time() - start_time)
            
            if index >= len(elements):
                return self._error_result(f"Index {index} out of range (found {len(elements)} elements)", time.time() - start_time)
            
            element = elements[index]
            element_info = self._get_element_info(element)
            
            return self._success_result({
                "element": element_info.__dict__,
                "total_matches": len(elements),
                "selected_index": index,
                "search_criteria": search_criteria
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to find element: {str(e)}", time.time() - start_time)
    
    def get_window_hierarchy(self, process_id: int, 
                           window_title: Optional[str] = None,
                           max_depth: int = 3) -> AutomationResult:
        """Get UI element hierarchy for a window
        
        Args:
            process_id: Target application process ID
            window_title: Specific window title
            max_depth: Maximum depth to traverse
            
        Returns:
            AutomationResult with element tree
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            if process_id not in self.connected_apps:
                return self._error_result(f"Application PID {process_id} not connected", time.time() - start_time)
            
            app = self.connected_apps[process_id]
            
            # Find target window
            if window_title:
                window = app.window(title=window_title)
            else:
                windows = app.windows()
                if not windows:
                    return self._error_result("No windows found in application", time.time() - start_time)
                window = windows[0]
            
            # Build hierarchy tree
            def build_tree(element, depth=0):
                if depth > max_depth:
                    return None
                
                element_info = self._get_element_info(element)
                node = element_info.__dict__.copy()
                
                # Get children
                children = []
                try:
                    for child in element.children():
                        child_node = build_tree(child, depth + 1)
                        if child_node:
                            children.append(child_node)
                except:
                    pass
                
                node['children'] = children
                return node
            
            hierarchy = build_tree(window)
            
            return self._success_result({
                "hierarchy": hierarchy,
                "window_title": window_title or "Main Window",
                "max_depth": max_depth
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to get window hierarchy: {str(e)}", time.time() - start_time)
    
    # =================================================================
    # UI INTERACTION
    # =================================================================
    
    def click_element(self, process_id: int,
                     element_criteria: Dict[str, Any],
                     button: str = "left",
                     double: bool = False) -> AutomationResult:
        """Click on a UI element
        
        Args:
            process_id: Target application process ID
            element_criteria: Criteria to find element
            button: Mouse button ('left', 'right', 'middle')
            double: Whether to double-click
            
        Returns:
            AutomationResult with click info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            # Find the element first
            find_result = self.find_element(process_id, **element_criteria)
            if not find_result.success:
                return self._error_result(f"Element not found: {find_result.error}", time.time() - start_time)
            
            app = self.connected_apps[process_id]
            
            # Get the actual element wrapper
            window_title = element_criteria.get('window_title')
            if window_title:
                window = app.window(title=window_title)
            else:
                window = app.windows()[0]
            
            # Re-find element for interaction
            search_criteria = {k: v for k, v in element_criteria.items() if k != 'window_title'}
            elements = window.descendants(**search_criteria)
            
            if not elements:
                return self._error_result("Element no longer found for interaction", time.time() - start_time)
            
            element = elements[0]
            
            # Perform click
            if double:
                element.double_click_input(button=button)
                action = f"double-clicked ({button})"
            else:
                element.click_input(button=button)
                action = f"clicked ({button})"
            
            element_info = self._get_element_info(element)
            
            return self._success_result({
                "action": action,
                "element": element_info.__dict__,
                "button": button,
                "double": double
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to click element: {str(e)}", time.time() - start_time)
    
    def type_text(self, process_id: int,
                 element_criteria: Dict[str, Any],
                 text: str,
                 clear_first: bool = True) -> AutomationResult:
        """Type text into a UI element
        
        Args:
            process_id: Target application process ID
            element_criteria: Criteria to find element
            text: Text to type
            clear_first: Whether to clear existing text
            
        Returns:
            AutomationResult with typing info
        """
        start_time = time.time()
        
        error_check = self._check_availability()
        if error_check:
            return self._error_result(error_check, time.time() - start_time)
        
        try:
            # Find the element first
            find_result = self.find_element(process_id, **element_criteria)
            if not find_result.success:
                return self._error_result(f"Element not found: {find_result.error}", time.time() - start_time)
            
            app = self.connected_apps[process_id]
            
            # Get the actual element wrapper
            window_title = element_criteria.get('window_title')
            if window_title:
                window = app.window(title=window_title)
            else:
                window = app.windows()[0]
            
            # Re-find element for interaction
            search_criteria = {k: v for k, v in element_criteria.items() if k != 'window_title'}
            elements = window.descendants(**search_criteria)
            
            if not elements:
                return self._error_result("Element no longer found for interaction", time.time() - start_time)
            
            element = elements[0]
            
            # Focus element first
            element.set_focus()
            
            # Clear if requested
            if clear_first:
                try:
                    element.select_all()
                    element.type_keys('{DELETE}')
                except:
                    pass
            
            # Type text
            element.type_keys(text)
            
            element_info = self._get_element_info(element)
            
            return self._success_result({
                "text": text,
                "element": element_info.__dict__,
                "cleared_first": clear_first,
                "length": len(text)
            }, time.time() - start_time)
            
        except Exception as e:
            return self._error_result(f"Failed to type text: {str(e)}", time.time() - start_time)
    
    # =================================================================
    # UTILITY METHODS
    # =================================================================
    
    def _get_window_info(self, window) -> WindowInfo:
        """Get information about a window"""
        try:
            rect = window.rectangle()
            return WindowInfo(
                title=getattr(window, 'window_text', lambda: '')() or '',
                class_name=getattr(window, 'class_name', lambda: '')() or '',
                process_id=getattr(window, 'process_id', lambda: 0)() or 0,
                handle=getattr(window, 'handle', 0) or 0,
                rectangle={
                    'left': rect.left,
                    'top': rect.top,
                    'right': rect.right,
                    'bottom': rect.bottom,
                    'width': rect.width(),
                    'height': rect.height()
                },
                is_visible=getattr(window, 'is_visible', lambda: True)(),
                is_enabled=getattr(window, 'is_enabled', lambda: True)(),
                framework=getattr(window, 'backend', 'unknown'),
                children_count=len(getattr(window, 'children', lambda: [])())
            )
        except Exception as e:
            logger.warning(f"Error getting window info: {e}")
            return WindowInfo()
    
    def _get_element_info(self, element) -> ElementInfo:
        """Get information about a UI element"""
        try:
            rect = element.rectangle()
            return ElementInfo(
                automation_id=getattr(element, 'automation_id', lambda: '')() or '',
                class_name=getattr(element, 'class_name', lambda: '')() or '',
                name=getattr(element, 'window_text', lambda: '')() or '',
                control_type=getattr(element, 'control_type', lambda: '')() or '',
                enabled=getattr(element, 'is_enabled', lambda: True)(),
                visible=getattr(element, 'is_visible', lambda: True)(),
                rectangle={
                    'left': rect.left,
                    'top': rect.top,
                    'right': rect.right,
                    'bottom': rect.bottom,
                    'width': rect.width(),
                    'height': rect.height()
                },
                children_count=len(getattr(element, 'children', lambda: [])()),
                element_path=str(element)
            )
        except Exception as e:
            logger.warning(f"Error getting element info: {e}")
            return ElementInfo()


# Global controller instance
_controller_instance = None

def get_pywinauto_controller() -> PyWinAutoController:
    """Get the global PyWinAuto controller instance"""
    global _controller_instance
    if _controller_instance is None:
        _controller_instance = PyWinAutoController()
    return _controller_instance
