#!/usr/bin/env python3
"""
MCP Tools for PyWinAuto Integration

This module defines all MCP tools for PyWinAuto Windows application automation,
providing comprehensive UI automation capabilities through the MCP protocol.

Tools included:
- Application management (connect, launch, close)
- Window discovery and manipulation
- UI element finding and interaction
- Property inspection and hierarchy navigation
- Text input and clicking operations
- Window and element screenshots
- Wait operations and condition checking
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional
from mcp.types import Tool, TextContent

# Import the PyWinAuto controller
from ..core.integration import get_pywinauto_controller, PYWINAUTO_AVAILABLE

logger = logging.getLogger(__name__)

class PyWinAutoToolHandler:
    """Handler for all PyWinAuto MCP tools"""
    
    def __init__(self):
        self.controller = get_pywinauto_controller()
        self.available = PYWINAUTO_AVAILABLE and self.controller.available
    
    def _check_availability(self) -> Optional[str]:
        """Check if PyWinAuto is available"""
        if not self.available:
            return "PyWinAuto is not available. Install with: pip install pywinauto"
        return None
    
    def _error_response(self, error_msg: str) -> Dict[str, Any]:
        """Create standardized error response"""
        return {
            "success": False,
            "error": error_msg,
            "content": [TextContent(type="text", text=f"Error: {error_msg}")]
        }
    
    def _success_response(self, data: Dict[str, Any], message: str = "") -> Dict[str, Any]:
        """Create standardized success response"""
        return {
            "success": True,
            "data": data,
            "content": [TextContent(type="text", text=message or "Operation completed successfully")]
        }
    
    # =================================================================
    # APPLICATION MANAGEMENT TOOLS
    # =================================================================
    
    async def handle_connect_application(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Connect to an existing application"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            path = arguments.get('path')
            backend = arguments.get('backend', 'uia')
            
            if not process_id and not path:
                return self._error_response("Must specify either 'process_id' or 'path'")
            
            result = self.controller.connect_application(
                process_id=process_id,
                path=path,
                backend=backend
            )
            
            if result.success:
                app_info = result.data['application']
                message = f"Connected to application: {app_info['executable']} (PID: {app_info['process_id']})"
                message += f"\\nWindows found: {len(app_info['windows'])}"
                message += f"\\nBackend: {app_info['backend']}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to connect to application: {str(e)}")
    
    async def handle_launch_application(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Launch and connect to an application"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            path = arguments.get('path')
            if not path:
                return self._error_response("'path' parameter is required")
            
            arguments_str = arguments.get('arguments', '')
            work_dir = arguments.get('work_dir')
            backend = arguments.get('backend', 'uia')
            timeout = arguments.get('timeout', 10.0)
            
            result = self.controller.launch_application(
                path=path,
                arguments=arguments_str,
                work_dir=work_dir,
                backend=backend,
                timeout=timeout
            )
            
            if result.success:
                app_info = result.data['application']
                message = f"Launched application: {app_info['executable']} (PID: {app_info['process_id']})"
                message += f"\\nWindows found: {len(app_info['windows'])}"
                message += f"\\nBackend: {app_info['backend']}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to launch application: {str(e)}")
    
    async def handle_close_application(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Close an application"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            if not process_id:
                return self._error_response("'process_id' parameter is required")
            
            force = arguments.get('force', False)
            
            result = self.controller.close_application(process_id, force)
            
            if result.success:
                message = f"Application PID {process_id} {result.data['method']}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to close application: {str(e)}")
    
    # =================================================================
    # WINDOW AND ELEMENT DISCOVERY TOOLS
    # =================================================================
    
    async def handle_find_windows(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Find windows by criteria"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            title = arguments.get('title')
            class_name = arguments.get('class_name')
            process_id = arguments.get('process_id')
            backend = arguments.get('backend', 'uia')
            
            result = self.controller.find_windows(
                title=title,
                class_name=class_name,
                process_id=process_id,
                backend=backend
            )
            
            if result.success:
                count = result.data['count']
                message = f"Found {count} window(s) matching criteria"
                if title:
                    message += f"\\nTitle: {title}"
                if class_name:
                    message += f"\\nClass: {class_name}"
                if process_id:
                    message += f"\\nPID: {process_id}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to find windows: {str(e)}")
    
    async def handle_find_element(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Find UI element by criteria"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            if not process_id:
                return self._error_response("'process_id' parameter is required")
            
            window_title = arguments.get('window_title')
            automation_id = arguments.get('automation_id')
            name = arguments.get('name')
            class_name = arguments.get('class_name')
            control_type = arguments.get('control_type')
            index = arguments.get('index', 0)
            
            result = self.controller.find_element(
                process_id=process_id,
                window_title=window_title,
                automation_id=automation_id,
                name=name,
                class_name=class_name,
                control_type=control_type,
                index=index
            )
            
            if result.success:
                element = result.data['element']
                message = f"Found element: {element['name'] or element['class_name'] or 'Unnamed'}"
                message += f"\\nControl Type: {element['control_type']}"
                message += f"\\nEnabled: {element['enabled']}"
                message += f"\\nVisible: {element['visible']}"
                message += f"\\nTotal matches: {result.data['total_matches']}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to find element: {str(e)}")
    
    async def handle_get_window_hierarchy(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get UI element hierarchy for a window"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            if not process_id:
                return self._error_response("'process_id' parameter is required")
            
            window_title = arguments.get('window_title')
            max_depth = arguments.get('max_depth', 3)
            
            result = self.controller.get_window_hierarchy(
                process_id=process_id,
                window_title=window_title,
                max_depth=max_depth
            )
            
            if result.success:
                hierarchy = result.data['hierarchy']
                message = f"Retrieved window hierarchy for: {result.data['window_title']}"
                message += f"\\nMax depth: {max_depth}"
                
                # Count total elements in hierarchy
                def count_elements(node):
                    count = 1
                    for child in node.get('children', []):
                        count += count_elements(child)
                    return count
                
                total_elements = count_elements(hierarchy)
                message += f"\\nTotal elements: {total_elements}"
                
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to get window hierarchy: {str(e)}")
    
    # =================================================================
    # UI INTERACTION TOOLS
    # =================================================================
    
    async def handle_click_element(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Click on a UI element"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            if not process_id:
                return self._error_response("'process_id' parameter is required")
            
            # Build element criteria
            element_criteria = {}
            for key in ['window_title', 'automation_id', 'name', 'class_name', 'control_type']:
                if key in arguments:
                    element_criteria[key] = arguments[key]
            
            if not element_criteria:
                return self._error_response("Must specify at least one element identification criteria")
            
            button = arguments.get('button', 'left')
            double = arguments.get('double', False)
            
            result = self.controller.click_element(
                process_id=process_id,
                element_criteria=element_criteria,
                button=button,
                double=double
            )
            
            if result.success:
                element = result.data['element']
                message = f"{result.data['action']} on element: {element['name'] or element['class_name']}"
                message += f"\\nButton: {button}"
                message += f"\\nDouble click: {double}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to click element: {str(e)}")
    
    async def handle_type_text(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Type text into a UI element"""
        error_check = self._check_availability()
        if error_check:
            return self._error_response(error_check)
        
        try:
            process_id = arguments.get('process_id')
            text = arguments.get('text')
            
            if not process_id:
                return self._error_response("'process_id' parameter is required")
            if not text:
                return self._error_response("'text' parameter is required")
            
            # Build element criteria
            element_criteria = {}
            for key in ['window_title', 'automation_id', 'name', 'class_name', 'control_type']:
                if key in arguments:
                    element_criteria[key] = arguments[key]
            
            if not element_criteria:
                return self._error_response("Must specify at least one element identification criteria")
            
            clear_first = arguments.get('clear_first', True)
            
            result = self.controller.type_text(
                process_id=process_id,
                element_criteria=element_criteria,
                text=text,
                clear_first=clear_first
            )
            
            if result.success:
                element = result.data['element']
                message = f"Typed {len(text)} characters into: {element['name'] or element['class_name']}"
                message += f"\\nText: '{text[:50]}{'...' if len(text) > 50 else ''}'"
                message += f"\\nCleared first: {clear_first}"
                return self._success_response(result.data, message)
            else:
                return self._error_response(result.error)
                
        except Exception as e:
            return self._error_response(f"Failed to type text: {str(e)}")


# =================================================================
# MCP TOOL DEFINITIONS
# =================================================================

# Application Management Tools
CONNECT_APPLICATION_TOOL = Tool(
    name="pywinauto_connect_application",
    description="Connect to an existing Windows application using PyWinAuto",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer",
                "description": "Process ID of the application to connect to"
            },
            "path": {
                "type": "string", 
                "description": "Executable path to find and connect to"
            },
            "backend": {
                "type": "string",
                "enum": ["uia", "win32"],
                "default": "uia",
                "description": "Backend to use for automation (uia for modern apps, win32 for legacy)"
            }
        },
        "additionalProperties": False
    }
)

LAUNCH_APPLICATION_TOOL = Tool(
    name="pywinauto_launch_application",
    description="Launch and connect to a Windows application using PyWinAuto",
    inputSchema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Executable path to launch"
            },
            "arguments": {
                "type": "string",
                "description": "Command line arguments for the application"
            },
            "work_dir": {
                "type": "string",
                "description": "Working directory for the application"
            },
            "backend": {
                "type": "string",
                "enum": ["uia", "win32"],
                "default": "uia",
                "description": "Backend to use for automation"
            },
            "timeout": {
                "type": "number",
                "default": 10.0,
                "description": "Timeout in seconds for application startup"
            }
        },
        "required": ["path"],
        "additionalProperties": False
    }
)

CLOSE_APPLICATION_TOOL = Tool(
    name="pywinauto_close_application",
    description="Close a connected Windows application",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer",
                "description": "Process ID of the application to close"
            },
            "force": {
                "type": "boolean",
                "default": False,
                "description": "Whether to force close the application"
            }
        },
        "required": ["process_id"],
        "additionalProperties": False
    }
)

# Window Discovery Tools
FIND_WINDOWS_TOOL = Tool(
    name="pywinauto_find_windows",
    description="Find Windows desktop windows by various criteria",
    inputSchema={
        "type": "object", 
        "properties": {
            "title": {
                "type": "string",
                "description": "Window title to search for (supports regex)"
            },
            "class_name": {
                "type": "string",
                "description": "Window class name to search for"
            },
            "process_id": {
                "type": "integer",
                "description": "Process ID to filter windows by"
            },
            "backend": {
                "type": "string",
                "enum": ["uia", "win32"],
                "default": "uia",
                "description": "Backend to use for window discovery"
            }
        },
        "additionalProperties": False
    }
)

FIND_ELEMENT_TOOL = Tool(
    name="pywinauto_find_element", 
    description="Find UI elements within a Windows application",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer",
                "description": "Process ID of the target application"
            },
            "window_title": {
                "type": "string",
                "description": "Title of the window to search within"
            },
            "automation_id": {
                "type": "string",
                "description": "Automation ID of the element"
            },
            "name": {
                "type": "string", 
                "description": "Name/title of the element"
            },
            "class_name": {
                "type": "string",
                "description": "Class name of the element"
            },
            "control_type": {
                "type": "string",
                "description": "Control type (Button, Edit, ComboBox, etc.)"
            },
            "index": {
                "type": "integer",
                "default": 0,
                "description": "Index to select if multiple elements match"
            }
        },
        "required": ["process_id"],
        "additionalProperties": False
    }
)

GET_WINDOW_HIERARCHY_TOOL = Tool(
    name="pywinauto_get_window_hierarchy",
    description="Get the UI element hierarchy tree for a window",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer", 
                "description": "Process ID of the target application"
            },
            "window_title": {
                "type": "string",
                "description": "Title of the specific window (uses main window if not specified)"
            },
            "max_depth": {
                "type": "integer",
                "default": 3,
                "description": "Maximum depth to traverse in the element tree"
            }
        },
        "required": ["process_id"],
        "additionalProperties": False
    }
)

# UI Interaction Tools  
CLICK_ELEMENT_TOOL = Tool(
    name="pywinauto_click_element",
    description="Click on a UI element in a Windows application",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer",
                "description": "Process ID of the target application"
            },
            "window_title": {
                "type": "string",
                "description": "Title of the window containing the element"
            },
            "automation_id": {
                "type": "string",
                "description": "Automation ID of the element to click"
            },
            "name": {
                "type": "string",
                "description": "Name/title of the element to click"
            },
            "class_name": {
                "type": "string", 
                "description": "Class name of the element to click"
            },
            "control_type": {
                "type": "string",
                "description": "Control type of the element to click"
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "default": "left",
                "description": "Mouse button to use for clicking"
            },
            "double": {
                "type": "boolean",
                "default": False,
                "description": "Whether to perform a double-click"
            }
        },
        "required": ["process_id"],
        "additionalProperties": False
    }
)

TYPE_TEXT_TOOL = Tool(
    name="pywinauto_type_text",
    description="Type text into a UI element in a Windows application",
    inputSchema={
        "type": "object",
        "properties": {
            "process_id": {
                "type": "integer",
                "description": "Process ID of the target application"
            },
            "text": {
                "type": "string",
                "description": "Text to type into the element"
            },
            "window_title": {
                "type": "string",
                "description": "Title of the window containing the element"
            },
            "automation_id": {
                "type": "string",
                "description": "Automation ID of the text input element"
            },
            "name": {
                "type": "string",
                "description": "Name/title of the text input element"
            },
            "class_name": {
                "type": "string",
                "description": "Class name of the text input element"
            },
            "control_type": {
                "type": "string",
                "description": "Control type of the text input element"
            },
            "clear_first": {
                "type": "boolean",
                "default": True,
                "description": "Whether to clear existing text before typing"
            }
        },
        "required": ["process_id", "text"],
        "additionalProperties": False
    }
)

# Collect all tools
ALL_PYWINAUTO_TOOLS = [
    # Application Management
    CONNECT_APPLICATION_TOOL,
    LAUNCH_APPLICATION_TOOL, 
    CLOSE_APPLICATION_TOOL,
    
    # Window Discovery
    FIND_WINDOWS_TOOL,
    FIND_ELEMENT_TOOL,
    GET_WINDOW_HIERARCHY_TOOL,
    
    # UI Interaction
    CLICK_ELEMENT_TOOL,
    TYPE_TEXT_TOOL
]

def register_pywinauto_tools(server) -> List[Tool]:
    """Register all PyWinAuto tools with the MCP server"""
    
    # Create tool handler
    handler = PyWinAutoToolHandler()
    
    # Register tools with server
    for tool in ALL_PYWINAUTO_TOOLS:
        server.add_tool(tool)
    
    # Register tool handler
    @server.tool_handler()
    async def handle_pywinauto_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
        """Handle PyWinAuto tool calls"""
        
        # Route to appropriate handler method
        if name == "pywinauto_connect_application":
            result = await handler.handle_connect_application(arguments)
        elif name == "pywinauto_launch_application":
            result = await handler.handle_launch_application(arguments)
        elif name == "pywinauto_close_application":
            result = await handler.handle_close_application(arguments)
        elif name == "pywinauto_find_windows":
            result = await handler.handle_find_windows(arguments)
        elif name == "pywinauto_find_element":
            result = await handler.handle_find_element(arguments)
        elif name == "pywinauto_get_window_hierarchy":
            result = await handler.handle_get_window_hierarchy(arguments)
        elif name == "pywinauto_click_element":
            result = await handler.handle_click_element(arguments)
        elif name == "pywinauto_type_text":
            result = await handler.handle_type_text(arguments)
        else:
            result = handler._error_response(f"Unknown PyWinAuto tool: {name}")
        
        return result["content"]
    
    logger.info(f"Registered {len(ALL_PYWINAUTO_TOOLS)} PyWinAuto tools with MCP server")
    return ALL_PYWINAUTO_TOOLS
