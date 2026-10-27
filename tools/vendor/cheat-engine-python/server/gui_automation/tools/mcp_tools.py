#!/usr/bin/env python3
"""
MCP Tools for PyAutoGUI Integration

This module defines comprehensive MCP tools that expose all PyAutoGUI functionality
through the MCP Cheat Engine Server, providing complete screen automation capabilities.

Tools Categories:
1. Screen Capture & Analysis (screenshots, pixel colors, image recognition)
2. Mouse Control (movement, clicking, dragging, scrolling)
3. Keyboard Automation (typing, key combinations, hotkeys)
4. Utility Functions (screen info, coordinates validation)
5. Advanced Features (templates, batch operations)
"""

from mcp.types import Tool
from typing import Dict, Any, List, Optional
import logging
import os
import sys
import time

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))

logger = logging.getLogger(__name__)

# ==========================================
# SCREEN CAPTURE & ANALYSIS TOOLS
# ==========================================

SCREENSHOT_TOOL = Tool(
    name="pyautogui_screenshot",
    description="Take a screenshot of the entire screen or a specific region",
    inputSchema={
        "type": "object",
        "properties": {
            "region": {
                "type": "array",
                "items": {"type": "integer"},
                "minItems": 4,
                "maxItems": 4,
                "description": "Optional region [left, top, width, height] to capture. If not provided, captures entire screen",
                "examples": [[100, 100, 800, 600], [0, 0, 1920, 1080]]
            },
            "save_path": {
                "type": "string",
                "description": "Optional file path to save the screenshot",
                "examples": ["screenshot.png", "C:/temp/capture.jpg"]
            }
        }
    }
)

PIXEL_COLOR_TOOL = Tool(
    name="pyautogui_get_pixel_color",
    description="Get the RGB color value of a pixel at specific screen coordinates",
    inputSchema={
        "type": "object",
        "properties": {
            "x": {
                "type": "integer",
                "description": "X coordinate on screen",
                "minimum": 0
            },
            "y": {
                "type": "integer", 
                "description": "Y coordinate on screen",
                "minimum": 0
            }
        },
        "required": ["x", "y"]
    }
)

FIND_IMAGE_TOOL = Tool(
    name="pyautogui_find_image",
    description="Find an image on the screen using template matching",
    inputSchema={
        "type": "object",
        "properties": {
            "image_path": {
                "type": "string",
                "description": "Path to the image file to search for",
                "examples": ["button.png", "C:/images/icon.jpg"]
            },
            "confidence": {
                "type": "number",
                "description": "Confidence level for image matching (0.0 to 1.0)",
                "minimum": 0.0,
                "maximum": 1.0,
                "default": 0.8
            },
            "region": {
                "type": "array",
                "items": {"type": "integer"},
                "minItems": 4,
                "maxItems": 4,
                "description": "Optional search region [left, top, width, height]",
                "examples": [[100, 100, 800, 600]]
            }
        },
        "required": ["image_path"]
    }
)

FIND_ALL_IMAGES_TOOL = Tool(
    name="pyautogui_find_all_images",
    description="Find all instances of an image on the screen",
    inputSchema={
        "type": "object",
        "properties": {
            "image_path": {
                "type": "string",
                "description": "Path to the image file to search for"
            },
            "confidence": {
                "type": "number",
                "description": "Confidence level for image matching (0.0 to 1.0)",
                "minimum": 0.0,
                "maximum": 1.0,
                "default": 0.8
            },
            "region": {
                "type": "array",
                "items": {"type": "integer"},
                "minItems": 4,
                "maxItems": 4,
                "description": "Optional search region [left, top, width, height]"
            }
        },
        "required": ["image_path"]
    }
)

# ==========================================
# MOUSE CONTROL TOOLS
# ==========================================

MOUSE_POSITION_TOOL = Tool(
    name="pyautogui_get_mouse_position",
    description="Get the current mouse cursor position",
    inputSchema={
        "type": "object",
        "properties": {}
    }
)

MOVE_MOUSE_TOOL = Tool(
    name="pyautogui_move_mouse",
    description="Move the mouse cursor to specific coordinates",
    inputSchema={
        "type": "object",
        "properties": {
            "x": {
                "type": "integer",
                "description": "Target X coordinate"
            },
            "y": {
                "type": "integer",
                "description": "Target Y coordinate"
            },
            "duration": {
                "type": "number",
                "description": "Duration of movement in seconds",
                "minimum": 0.0,
                "default": 0.5
            },
            "relative": {
                "type": "boolean",
                "description": "Whether coordinates are relative to current position",
                "default": False
            }
        },
        "required": ["x", "y"]
    }
)

CLICK_MOUSE_TOOL = Tool(
    name="pyautogui_click_mouse",
    description="Click the mouse at specific coordinates or current position",
    inputSchema={
        "type": "object",
        "properties": {
            "x": {
                "type": "integer",
                "description": "X coordinate to click (optional, uses current position if not provided)"
            },
            "y": {
                "type": "integer",
                "description": "Y coordinate to click (optional, uses current position if not provided)"
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "description": "Mouse button to click",
                "default": "left"
            },
            "clicks": {
                "type": "integer",
                "description": "Number of clicks",
                "minimum": 1,
                "default": 1
            },
            "interval": {
                "type": "number",
                "description": "Interval between clicks in seconds",
                "minimum": 0.0,
                "default": 0.0
            }
        }
    }
)

DRAG_MOUSE_TOOL = Tool(
    name="pyautogui_drag_mouse",
    description="Drag the mouse from start coordinates to end coordinates",
    inputSchema={
        "type": "object",
        "properties": {
            "start_x": {
                "type": "integer",
                "description": "Starting X coordinate"
            },
            "start_y": {
                "type": "integer",
                "description": "Starting Y coordinate"
            },
            "end_x": {
                "type": "integer",
                "description": "Ending X coordinate"
            },
            "end_y": {
                "type": "integer",
                "description": "Ending Y coordinate"
            },
            "duration": {
                "type": "number",
                "description": "Duration of drag operation in seconds",
                "minimum": 0.0,
                "default": 1.0
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "description": "Mouse button to drag with",
                "default": "left"
            }
        },
        "required": ["start_x", "start_y", "end_x", "end_y"]
    }
)

SCROLL_MOUSE_TOOL = Tool(
    name="pyautogui_scroll_mouse",
    description="Scroll the mouse wheel at specific coordinates or current position",
    inputSchema={
        "type": "object",
        "properties": {
            "clicks": {
                "type": "integer",
                "description": "Number of scroll clicks (positive for up, negative for down)"
            },
            "x": {
                "type": "integer",
                "description": "X coordinate to scroll at (optional, uses current position if not provided)"
            },
            "y": {
                "type": "integer",
                "description": "Y coordinate to scroll at (optional, uses current position if not provided)"
            }
        },
        "required": ["clicks"]
    }
)

# ==========================================
# KEYBOARD AUTOMATION TOOLS
# ==========================================

TYPE_TEXT_TOOL = Tool(
    name="pyautogui_type_text",
    description="Type text with optional interval between characters",
    inputSchema={
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Text to type"
            },
            "interval": {
                "type": "number",
                "description": "Interval between characters in seconds",
                "minimum": 0.0,
                "default": 0.0
            }
        },
        "required": ["text"]
    }
)

PRESS_KEY_TOOL = Tool(
    name="pyautogui_press_key",
    description="Press a specific key one or more times",
    inputSchema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Key to press (e.g., 'enter', 'space', 'tab', 'a', 'f1')",
                "examples": ["enter", "space", "tab", "esc", "f1", "ctrl", "shift", "a", "1"]
            },
            "presses": {
                "type": "integer",
                "description": "Number of times to press the key",
                "minimum": 1,
                "default": 1
            },
            "interval": {
                "type": "number",
                "description": "Interval between key presses in seconds",
                "minimum": 0.0,
                "default": 0.0
            }
        },
        "required": ["key"]
    }
)

KEY_COMBINATION_TOOL = Tool(
    name="pyautogui_key_combination",
    description="Press a combination of keys simultaneously (hotkeys)",
    inputSchema={
        "type": "object",
        "properties": {
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of keys to press simultaneously",
                "examples": [["ctrl", "c"], ["ctrl", "shift", "n"], ["alt", "tab"], ["win", "r"]]
            }
        },
        "required": ["keys"]
    }
)

HOLD_KEY_TOOL = Tool(
    name="pyautogui_hold_key",
    description="Hold a key down for a specified duration",
    inputSchema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Key to hold down"
            },
            "duration": {
                "type": "number",
                "description": "Duration to hold the key in seconds",
                "minimum": 0.0,
                "default": 1.0
            }
        },
        "required": ["key"]
    }
)

# ==========================================
# UTILITY & CONFIGURATION TOOLS
# ==========================================

SCREEN_INFO_TOOL = Tool(
    name="pyautogui_get_screen_info",
    description="Get detailed information about the screen (resolution, size)",
    inputSchema={
        "type": "object",
        "properties": {}
    }
)

CHECK_ON_SCREEN_TOOL = Tool(
    name="pyautogui_is_on_screen",
    description="Check if given coordinates are within screen bounds",
    inputSchema={
        "type": "object",
        "properties": {
            "x": {
                "type": "integer",
                "description": "X coordinate to check"
            },
            "y": {
                "type": "integer",
                "description": "Y coordinate to check"
            }
        },
        "required": ["x", "y"]
    }
)

SET_PAUSE_TOOL = Tool(
    name="pyautogui_set_pause",
    description="Set the pause duration between PyAutoGUI actions",
    inputSchema={
        "type": "object",
        "properties": {
            "pause_duration": {
                "type": "number",
                "description": "Pause duration in seconds between actions",
                "minimum": 0.0,
                "default": 0.1
            }
        },
        "required": ["pause_duration"]
    }
)

SET_FAILSAFE_TOOL = Tool(
    name="pyautogui_set_failsafe",
    description="Enable or disable PyAutoGUI failsafe (emergency stop by moving mouse to corner)",
    inputSchema={
        "type": "object",
        "properties": {
            "enabled": {
                "type": "boolean",
                "description": "Whether to enable failsafe",
                "default": True
            }
        },
        "required": ["enabled"]
    }
)

GET_AVAILABLE_KEYS_TOOL = Tool(
    name="pyautogui_get_available_keys",
    description="Get a list of all available keyboard keys that can be used with PyAutoGUI",
    inputSchema={
        "type": "object",
        "properties": {}
    }
)

# ==========================================
# ADVANCED FEATURE TOOLS
# ==========================================

CREATE_TEMPLATE_TOOL = Tool(
    name="pyautogui_create_image_template",
    description="Create an image template from a screen region for future recognition",
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name for the template"
            },
            "x": {
                "type": "integer",
                "description": "X coordinate of region"
            },
            "y": {
                "type": "integer",
                "description": "Y coordinate of region"
            },
            "width": {
                "type": "integer",
                "description": "Width of region"
            },
            "height": {
                "type": "integer",
                "description": "Height of region"
            }
        },
        "required": ["name", "x", "y", "width", "height"]
    }
)

FIND_TEMPLATE_TOOL = Tool(
    name="pyautogui_find_template",
    description="Find a previously created image template on the screen",
    inputSchema={
        "type": "object",
        "properties": {
            "template_name": {
                "type": "string",
                "description": "Name of the template to find"
            },
            "confidence": {
                "type": "number",
                "description": "Confidence level for template matching",
                "minimum": 0.0,
                "maximum": 1.0,
                "default": 0.8
            }
        },
        "required": ["template_name"]
    }
)

# ==========================================
# BATCH OPERATION TOOLS
# ==========================================

BATCH_CLICKS_TOOL = Tool(
    name="pyautogui_batch_clicks",
    description="Perform multiple click operations in sequence",
    inputSchema={
        "type": "object",
        "properties": {
            "click_sequence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                        "clicks": {"type": "integer", "minimum": 1, "default": 1},
                        "delay_after": {"type": "number", "minimum": 0.0, "default": 0.5}
                    },
                    "required": ["x", "y"]
                },
                "description": "Sequence of click operations to perform"
            }
        },
        "required": ["click_sequence"]
    }
)

BATCH_KEYS_TOOL = Tool(
    name="pyautogui_batch_keys",
    description="Perform multiple keyboard operations in sequence",
    inputSchema={
        "type": "object",
        "properties": {
            "key_sequence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "operation": {"type": "string", "enum": ["type", "press", "combination", "hold"]},
                        "text": {"type": "string", "description": "Text to type (for 'type' operation)"},
                        "key": {"type": "string", "description": "Key to press (for 'press' or 'hold' operations)"},
                        "keys": {"type": "array", "items": {"type": "string"}, "description": "Keys for combination (for 'combination' operation)"},
                        "duration": {"type": "number", "minimum": 0.0, "description": "Duration for hold operation"},
                        "delay_after": {"type": "number", "minimum": 0.0, "default": 0.2}
                    },
                    "required": ["operation"]
                },
                "description": "Sequence of keyboard operations to perform"
            }
        },
        "required": ["key_sequence"]
    }
)

# Comprehensive list of all PyAutoGUI tools
ALL_PYAUTOGUI_TOOLS = [
    # Screen capture & analysis
    SCREENSHOT_TOOL,
    PIXEL_COLOR_TOOL,
    FIND_IMAGE_TOOL,
    FIND_ALL_IMAGES_TOOL,
    
    # Mouse control
    MOUSE_POSITION_TOOL,
    MOVE_MOUSE_TOOL,
    CLICK_MOUSE_TOOL,
    DRAG_MOUSE_TOOL,
    SCROLL_MOUSE_TOOL,
    
    # Keyboard automation
    TYPE_TEXT_TOOL,
    PRESS_KEY_TOOL,
    KEY_COMBINATION_TOOL,
    HOLD_KEY_TOOL,
    
    # Utility & configuration
    SCREEN_INFO_TOOL,
    CHECK_ON_SCREEN_TOOL,
    SET_PAUSE_TOOL,
    SET_FAILSAFE_TOOL,
    GET_AVAILABLE_KEYS_TOOL,
    
    # Advanced features
    CREATE_TEMPLATE_TOOL,
    FIND_TEMPLATE_TOOL,
    
    # Batch operations
    BATCH_CLICKS_TOOL,
    BATCH_KEYS_TOOL
]

# Tool handler class for MCP integration
class PyAutoGUIToolHandler:
    """Handler for all PyAutoGUI MCP tools"""
    
    def __init__(self):
        try:
            from ..core.integration import get_pyautogui_controller
            self.controller = get_pyautogui_controller()
            self.available = True
        except Exception as e:
            logger.error(f"Failed to initialize PyAutoGUI controller: {e}")
            self.available = False
    
    def _check_availability(self):
        """Check if PyAutoGUI is available"""
        if not self.available:
            return {
                "success": False,
                "error": "PyAutoGUI is not available. Please install: pip install pyautogui pillow opencv-python"
            }
        return None
    
    # Screen capture & analysis handlers
    async def handle_screenshot(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle screenshot tool"""
        check = self._check_availability()
        if check:
            return check
        
        region = arguments.get("region")
        save_path = arguments.get("save_path")
        
        if region and len(region) == 4:
            region = tuple(region)
        
        result = self.controller.take_screenshot(region, save_path)
        return result.to_dict()
    
    async def handle_pixel_color(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle pixel color tool"""
        check = self._check_availability()
        if check:
            return check
        
        try:
            x = arguments["x"]
            y = arguments["y"]
        except KeyError as e:
            return {
                "success": False,
                "error": f"Missing required argument: {e}",
                "operation": "get_pixel_color",
                "data": {},
                "timestamp": time.time()
            }
        
        result = self.controller.get_pixel_color(x, y)
        return result.to_dict()
    
    async def handle_find_image(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle find image tool"""
        check = self._check_availability()
        if check:
            return check
        
        image_path = arguments["image_path"]
        confidence = arguments.get("confidence", 0.8)
        region = arguments.get("region")
        
        if region and len(region) == 4:
            region = tuple(region)
        
        result = self.controller.find_image_on_screen(image_path, confidence, region)
        return result.to_dict()
    
    async def handle_find_all_images(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle find all images tool"""
        check = self._check_availability()
        if check:
            return check
        
        image_path = arguments["image_path"]
        confidence = arguments.get("confidence", 0.8)
        region = arguments.get("region")
        
        if region and len(region) == 4:
            region = tuple(region)
        
        result = self.controller.find_all_images_on_screen(image_path, confidence, region)
        return result.to_dict()
    
    # Mouse control handlers
    async def handle_mouse_position(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle mouse position tool"""
        check = self._check_availability()
        if check:
            return check
        
        result = self.controller.get_mouse_position()
        return result.to_dict()
    
    async def handle_move_mouse(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle move mouse tool"""
        check = self._check_availability()
        if check:
            return check
        
        x = arguments["x"]
        y = arguments["y"]
        duration = arguments.get("duration", 0.5)
        relative = arguments.get("relative", False)
        
        result = self.controller.move_mouse(x, y, duration, relative)
        return result.to_dict()
    
    async def handle_click_mouse(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle click mouse tool"""
        check = self._check_availability()
        if check:
            return check
        
        x = arguments.get("x")
        y = arguments.get("y")
        button = arguments.get("button", "left")
        clicks = arguments.get("clicks", 1)
        interval = arguments.get("interval", 0.0)
        
        result = self.controller.click_mouse(x, y, button, clicks, interval)
        return result.to_dict()
    
    async def handle_drag_mouse(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle drag mouse tool"""
        check = self._check_availability()
        if check:
            return check
        
        start_x = arguments["start_x"]
        start_y = arguments["start_y"]
        end_x = arguments["end_x"]
        end_y = arguments["end_y"]
        duration = arguments.get("duration", 1.0)
        button = arguments.get("button", "left")
        
        result = self.controller.drag_mouse(start_x, start_y, end_x, end_y, duration, button)
        return result.to_dict()
    
    async def handle_scroll_mouse(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle scroll mouse tool"""
        check = self._check_availability()
        if check:
            return check
        
        clicks = arguments["clicks"]
        x = arguments.get("x")
        y = arguments.get("y")
        
        result = self.controller.scroll_mouse(clicks, x, y)
        return result.to_dict()
    
    # Keyboard automation handlers
    async def handle_type_text(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle type text tool"""
        check = self._check_availability()
        if check:
            return check
        
        text = arguments["text"]
        interval = arguments.get("interval", 0.0)
        
        result = self.controller.type_text(text, interval)
        return result.to_dict()
    
    async def handle_press_key(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle press key tool"""
        check = self._check_availability()
        if check:
            return check
        
        key = arguments["key"]
        presses = arguments.get("presses", 1)
        interval = arguments.get("interval", 0.0)
        
        result = self.controller.press_key(key, presses, interval)
        return result.to_dict()
    
    async def handle_key_combination(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle key combination tool"""
        check = self._check_availability()
        if check:
            return check
        
        keys = arguments["keys"]
        
        result = self.controller.key_combination(keys)
        return result.to_dict()
    
    async def handle_hold_key(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle hold key tool"""
        check = self._check_availability()
        if check:
            return check
        
        key = arguments["key"]
        duration = arguments.get("duration", 1.0)
        
        result = self.controller.hold_key(key, duration)
        return result.to_dict()
    
    # Utility & configuration handlers
    async def handle_screen_info(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle screen info tool"""
        check = self._check_availability()
        if check:
            return check
        
        result = self.controller.get_screen_info()
        return result.to_dict()
    
    async def handle_is_on_screen(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle is on screen tool"""
        check = self._check_availability()
        if check:
            return check
        
        x = arguments["x"]
        y = arguments["y"]
        
        result = self.controller.is_on_screen(x, y)
        return result.to_dict()
    
    async def handle_set_pause(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle set pause tool"""
        check = self._check_availability()
        if check:
            return check
        
        pause_duration = arguments["pause_duration"]
        
        result = self.controller.set_pause(pause_duration)
        return result.to_dict()
    
    async def handle_set_failsafe(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle set failsafe tool"""
        check = self._check_availability()
        if check:
            return check
        
        enabled = arguments["enabled"]
        
        result = self.controller.set_failsafe(enabled)
        return result.to_dict()
    
    async def handle_get_available_keys(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle get available keys tool"""
        check = self._check_availability()
        if check:
            return check
        
        result = self.controller.get_available_keys()
        return result.to_dict()
    
    # Advanced feature handlers
    async def handle_create_template(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle create template tool"""
        check = self._check_availability()
        if check:
            return check
        
        name = arguments["name"]
        x = arguments["x"]
        y = arguments["y"]
        width = arguments["width"]
        height = arguments["height"]
        
        result = self.controller.create_image_template(name, x, y, width, height)
        return result.to_dict()
    
    async def handle_find_template(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle find template tool"""
        check = self._check_availability()
        if check:
            return check
        
        template_name = arguments["template_name"]
        confidence = arguments.get("confidence", 0.8)
        
        result = self.controller.find_template_on_screen(template_name, confidence)
        return result.to_dict()
    
    # Batch operation handlers
    async def handle_batch_clicks(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle batch clicks tool"""
        check = self._check_availability()
        if check:
            return check
        
        import time
        click_sequence = arguments["click_sequence"]
        results = []
        
        for i, click_data in enumerate(click_sequence):
            x = click_data["x"]
            y = click_data["y"]
            button = click_data.get("button", "left")
            clicks = click_data.get("clicks", 1)
            delay_after = click_data.get("delay_after", 0.5)
            
            result = self.controller.click_mouse(x, y, button, clicks)
            results.append({
                "step": i + 1,
                "operation": result.to_dict(),
                "coordinates": [x, y],
                "button": button
            })
            
            if delay_after > 0:
                time.sleep(delay_after)
        
        return {
            "success": True,
            "operation": "batch_clicks",
            "data": {
                "total_clicks": len(click_sequence),
                "results": results
            },
            "timestamp": time.time()
        }
    
    async def handle_batch_keys(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle batch keys tool"""
        check = self._check_availability()
        if check:
            return check
        
        import time
        key_sequence = arguments["key_sequence"]
        results = []
        
        for i, key_data in enumerate(key_sequence):
            operation = key_data["operation"]
            delay_after = key_data.get("delay_after", 0.2)
            
            if operation == "type":
                text = key_data.get("text", "")
                result = self.controller.type_text(text)
            elif operation == "press":
                key = key_data.get("key", "")
                result = self.controller.press_key(key)
            elif operation == "combination":
                keys = key_data.get("keys", [])
                result = self.controller.key_combination(keys)
            elif operation == "hold":
                key = key_data.get("key", "")
                duration = key_data.get("duration", 1.0)
                result = self.controller.hold_key(key, duration)
            else:
                result = type('', (), {})()  # Create empty object
                result.to_dict = lambda: {"success": False, "error": f"Unknown operation: {operation}"}
            
            results.append({
                "step": i + 1,
                "operation": result.to_dict(),
                "input": key_data
            })
            
            if delay_after > 0:
                time.sleep(delay_after)
        
        return {
            "success": True,
            "operation": "batch_keys",
            "data": {
                "total_operations": len(key_sequence),
                "results": results
            },
            "timestamp": time.time()
        }

if __name__ == "__main__":
    print(f"PyAutoGUI MCP Tools: {len(ALL_PYAUTOGUI_TOOLS)} tools defined")
    for tool in ALL_PYAUTOGUI_TOOLS:
        print(f"  - {tool.name}: {tool.description}")
