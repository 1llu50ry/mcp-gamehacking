#!/usr/bin/env python3
"""
MCP Cheat Engine Server - PyAutoGUI Integration Module

This module provides comprehensive access to all PyAutoGUI functionality
through the MCP Cheat Engine Server, including:

1. Screen automation (screenshots, pixel colors, image recognition)
2. Mouse control (movement, clicking, dragging, scrolling)
3. Keyboard automation (typing, key combinations, hotkeys)
4. Window management and screen utilities
5. Fail-safes and safety features

Design Principles:
- Complete PyAutoGUI API exposure through MCP tools
- Enhanced error handling and logging
- Security controls and validation
- Performance optimizations for image operations
- Integration with existing automation system
"""

import os
import sys
import time
import logging
import threading
from typing import Dict, Any, List, Optional, Tuple, Union
from dataclasses import dataclass, field
from pathlib import Path
import base64
import io

# PyAutoGUI and image processing imports
try:
    import pyautogui
    import PIL.Image
    import cv2
    import numpy as np
    PYAUTOGUI_AVAILABLE = True
except ImportError as e:
    PYAUTOGUI_AVAILABLE = False
    print(f"PyAutoGUI dependencies not available: {e}")

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class ScreenInfo:
    """Screen information structure"""
    width: int
    height: int
    primary_monitor: bool = True
    monitor_count: int = 1
    
@dataclass
class MouseInfo:
    """Mouse position and state information"""
    x: int
    y: int
    timestamp: float = field(default_factory=time.time)

@dataclass
class ImageMatch:
    """Image recognition match result"""
    found: bool
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    confidence: float = 0.0
    center_x: int = 0
    center_y: int = 0
    
    def __post_init__(self):
        if self.found:
            self.center_x = self.x + self.width // 2
            self.center_y = self.y + self.height // 2

@dataclass
class AutomationResult:
    """Standardized result for PyAutoGUI operations"""
    success: bool
    operation: str
    data: Dict = field(default_factory=dict)
    error: str = ""
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary for JSON serialization"""
        return {
            "success": self.success,
            "operation": self.operation,
            "data": self.data,
            "error": self.error,
            "timestamp": self.timestamp
        }

class PyAutoGUIController:
    """Main controller for PyAutoGUI functionality"""
    
    def __init__(self):
        if not PYAUTOGUI_AVAILABLE:
            raise ImportError("PyAutoGUI and required dependencies are not installed")
        
        # Configure PyAutoGUI settings
        self._configure_pyautogui()
        
        # Initialize state tracking
        self.screen_info = self._get_screen_info()
        self.last_screenshot = None
        self.screenshot_cache = {}
        self.image_templates = {}
        
        logger.info("PyAutoGUI Controller initialized successfully")
    
    def _configure_pyautogui(self):
        """Configure PyAutoGUI with optimal settings"""
        # Set fail-safe (move mouse to corner to abort)
        pyautogui.FAILSAFE = True
        
        # Set pause between actions (0.1 second default)
        pyautogui.PAUSE = 0.1
        
        # Set minimum duration for movements
        pyautogui.MINIMUM_DURATION = 0.05
        
        # Set minimum sleep time
        pyautogui.MINIMUM_SLEEP = 0.05
        
        logger.info("PyAutoGUI configured with safety settings")
    
    def _get_screen_info(self) -> ScreenInfo:
        """Get current screen information"""
        size = pyautogui.size()
        return ScreenInfo(
            width=size.width,
            height=size.height,
            primary_monitor=True,
            monitor_count=1  # PyAutoGUI primarily works with primary monitor
        )
    
    # ==========================================
    # SCREEN CAPTURE AND ANALYSIS
    # ==========================================
    
    def take_screenshot(self, region: Optional[Tuple[int, int, int, int]] = None,
                       save_path: Optional[str] = None) -> AutomationResult:
        """Take a screenshot of the screen or a specific region"""
        try:
            if region:
                # Take screenshot of specific region (left, top, width, height)
                screenshot = pyautogui.screenshot(region=region)
            else:
                # Take full screen screenshot
                screenshot = pyautogui.screenshot()
            
            # Convert to base64 for transport
            img_buffer = io.BytesIO()
            screenshot.save(img_buffer, format='PNG')
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            
            # Save to file if requested
            if save_path:
                screenshot.save(save_path)
            
            # Cache the screenshot
            self.last_screenshot = screenshot
            cache_key = f"screenshot_{int(time.time())}"
            self.screenshot_cache[cache_key] = screenshot
            
            result_data = {
                "image_base64": img_base64,
                "width": screenshot.width,
                "height": screenshot.height,
                "region": region,
                "save_path": save_path,
                "cache_key": cache_key
            }
            
            return AutomationResult(
                success=True,
                operation="take_screenshot",
                data=result_data
            )
            
        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return AutomationResult(
                success=False,
                operation="take_screenshot",
                error=str(e)
            )
    
    def get_pixel_color(self, x: int, y: int) -> AutomationResult:
        """Get the RGB color of a pixel at the specified coordinates"""
        try:
            # Validate coordinates
            if not (0 <= x < self.screen_info.width and 0 <= y < self.screen_info.height):
                raise ValueError(f"Coordinates ({x}, {y}) are outside screen bounds")
            
            # Get pixel color
            pixel_color = pyautogui.pixel(x, y)
            
            # Convert to RGB values
            r, g, b = pixel_color
            hex_color = f"#{r:02x}{g:02x}{b:02x}"
            
            return AutomationResult(
                success=True,
                operation="get_pixel_color",
                data={
                    "x": x,
                    "y": y,
                    "rgb": [r, g, b],
                    "hex": hex_color,
                    "rgb_tuple": pixel_color
                }
            )
            
        except Exception as e:
            logger.error(f"Get pixel color failed: {e}")
            return AutomationResult(
                success=False,
                operation="get_pixel_color",
                error=str(e)
            )
    
    def find_image_on_screen(self, image_path: str, confidence: float = 0.8,
                           region: Optional[Tuple[int, int, int, int]] = None) -> AutomationResult:
        """Find an image on the screen using template matching"""
        try:
            if not os.path.exists(image_path):
                raise FileNotFoundError(f"Image file not found: {image_path}")
            
            # Attempt to locate the image
            try:
                if region:
                    location = pyautogui.locateOnScreen(image_path, confidence=confidence, region=region)
                else:
                    location = pyautogui.locateOnScreen(image_path, confidence=confidence)
                
                if location:
                    # Image found
                    center = pyautogui.center(location)
                    
                    match = ImageMatch(
                        found=True,
                        x=location.left,
                        y=location.top,
                        width=location.width,
                        height=location.height,
                        confidence=confidence,
                        center_x=center.x,
                        center_y=center.y
                    )
                    
                    return AutomationResult(
                        success=True,
                        operation="find_image_on_screen",
                        data={
                            "image_path": image_path,
                            "match": match.__dict__,
                            "region": region,
                            "search_confidence": confidence
                        }
                    )
                else:
                    # Image not found
                    match = ImageMatch(found=False)
                    
                    return AutomationResult(
                        success=True,
                        operation="find_image_on_screen",
                        data={
                            "image_path": image_path,
                            "match": match.__dict__,
                            "region": region,
                            "search_confidence": confidence
                        }
                    )
                    
            except pyautogui.ImageNotFoundException:
                # Image not found exception
                match = ImageMatch(found=False)
                
                return AutomationResult(
                    success=True,
                    operation="find_image_on_screen",
                    data={
                        "image_path": image_path,
                        "match": match.__dict__,
                        "region": region,
                        "search_confidence": confidence
                    }
                )
                
        except Exception as e:
            logger.error(f"Image search failed: {e}")
            return AutomationResult(
                success=False,
                operation="find_image_on_screen",
                error=str(e)
            )
    
    def find_all_images_on_screen(self, image_path: str, confidence: float = 0.8,
                                region: Optional[Tuple[int, int, int, int]] = None) -> AutomationResult:
        """Find all instances of an image on the screen"""
        try:
            if not os.path.exists(image_path):
                raise FileNotFoundError(f"Image file not found: {image_path}")
            
            # Find all matches
            try:
                if region:
                    locations = list(pyautogui.locateAllOnScreen(image_path, confidence=confidence, region=region))
                else:
                    locations = list(pyautogui.locateAllOnScreen(image_path, confidence=confidence))
                
                matches = []
                for location in locations:
                    center = pyautogui.center(location)
                    match = ImageMatch(
                        found=True,
                        x=location.left,
                        y=location.top,
                        width=location.width,
                        height=location.height,
                        confidence=confidence,
                        center_x=center.x,
                        center_y=center.y
                    )
                    matches.append(match.__dict__)
                
                return AutomationResult(
                    success=True,
                    operation="find_all_images_on_screen",
                    data={
                        "image_path": image_path,
                        "matches": matches,
                        "match_count": len(matches),
                        "region": region,
                        "search_confidence": confidence
                    }
                )
                
            except pyautogui.ImageNotFoundException:
                return AutomationResult(
                    success=True,
                    operation="find_all_images_on_screen",
                    data={
                        "image_path": image_path,
                        "matches": [],
                        "match_count": 0,
                        "region": region,
                        "search_confidence": confidence
                    }
                )
                
        except Exception as e:
            logger.error(f"Find all images failed: {e}")
            return AutomationResult(
                success=False,
                operation="find_all_images_on_screen",
                error=str(e)
            )
    
    # ==========================================
    # MOUSE CONTROL
    # ==========================================
    
    def get_mouse_position(self) -> AutomationResult:
        """Get current mouse position"""
        try:
            x, y = pyautogui.position()
            
            mouse_info = MouseInfo(x=x, y=y)
            
            return AutomationResult(
                success=True,
                operation="get_mouse_position",
                data=mouse_info.__dict__
            )
            
        except Exception as e:
            logger.error(f"Get mouse position failed: {e}")
            return AutomationResult(
                success=False,
                operation="get_mouse_position",
                error=str(e)
            )
    
    def move_mouse(self, x: int, y: int, duration: float = 0.5,
                  relative: bool = False) -> AutomationResult:
        """Move mouse to specified coordinates"""
        try:
            if relative:
                # Move relative to current position
                current_x, current_y = pyautogui.position()
                target_x = current_x + x
                target_y = current_y + y
            else:
                target_x, target_y = x, y
            
            # Validate target coordinates
            if not (0 <= target_x < self.screen_info.width and 0 <= target_y < self.screen_info.height):
                raise ValueError(f"Target coordinates ({target_x}, {target_y}) are outside screen bounds")
            
            # Move mouse
            pyautogui.moveTo(target_x, target_y, duration=duration)
            
            return AutomationResult(
                success=True,
                operation="move_mouse",
                data={
                    "target_x": target_x,
                    "target_y": target_y,
                    "duration": duration,
                    "relative": relative,
                    "original_coords": [x, y] if relative else None
                }
            )
            
        except Exception as e:
            logger.error(f"Move mouse failed: {e}")
            return AutomationResult(
                success=False,
                operation="move_mouse",
                error=str(e)
            )
    
    def click_mouse(self, x: Optional[int] = None, y: Optional[int] = None,
                   button: str = 'left', clicks: int = 1, interval: float = 0.0) -> AutomationResult:
        """Click mouse at specified coordinates"""
        try:
            # Validate button
            valid_buttons = ['left', 'right', 'middle']
            if button not in valid_buttons:
                raise ValueError(f"Invalid button '{button}'. Must be one of: {valid_buttons}")
            
            # Click at coordinates or current position
            if x is not None and y is not None:
                # Validate coordinates
                if not (0 <= x < self.screen_info.width and 0 <= y < self.screen_info.height):
                    raise ValueError(f"Coordinates ({x}, {y}) are outside screen bounds")
                
                pyautogui.click(x, y, clicks=clicks, interval=interval, button=button)
                click_position = (x, y)
            else:
                pyautogui.click(clicks=clicks, interval=interval, button=button)
                click_position = pyautogui.position()
            
            return AutomationResult(
                success=True,
                operation="click_mouse",
                data={
                    "position": click_position,
                    "button": button,
                    "clicks": clicks,
                    "interval": interval
                }
            )
            
        except Exception as e:
            logger.error(f"Mouse click failed: {e}")
            return AutomationResult(
                success=False,
                operation="click_mouse",
                error=str(e)
            )
    
    def drag_mouse(self, start_x: int, start_y: int, end_x: int, end_y: int,
                  duration: float = 1.0, button: str = 'left') -> AutomationResult:
        """Drag mouse from start to end coordinates"""
        try:
            # Validate coordinates
            coords_to_check = [(start_x, start_y), (end_x, end_y)]
            for x, y in coords_to_check:
                if not (0 <= x < self.screen_info.width and 0 <= y < self.screen_info.height):
                    raise ValueError(f"Coordinates ({x}, {y}) are outside screen bounds")
            
            # Validate button
            valid_buttons = ['left', 'right', 'middle']
            if button not in valid_buttons:
                raise ValueError(f"Invalid button '{button}'. Must be one of: {valid_buttons}")
            
            # Perform drag operation
            pyautogui.drag(end_x - start_x, end_y - start_y, duration=duration, button=button)
            
            return AutomationResult(
                success=True,
                operation="drag_mouse",
                data={
                    "start_position": [start_x, start_y],
                    "end_position": [end_x, end_y],
                    "duration": duration,
                    "button": button,
                    "distance": ((end_x - start_x)**2 + (end_y - start_y)**2)**0.5
                }
            )
            
        except Exception as e:
            logger.error(f"Mouse drag failed: {e}")
            return AutomationResult(
                success=False,
                operation="drag_mouse",
                error=str(e)
            )
    
    def scroll_mouse(self, clicks: int, x: Optional[int] = None, y: Optional[int] = None) -> AutomationResult:
        """Scroll mouse wheel"""
        try:
            # Scroll at coordinates or current position
            if x is not None and y is not None:
                # Validate coordinates
                if not (0 <= x < self.screen_info.width and 0 <= y < self.screen_info.height):
                    raise ValueError(f"Coordinates ({x}, {y}) are outside screen bounds")
                
                pyautogui.scroll(clicks, x, y)
                scroll_position = (x, y)
            else:
                pyautogui.scroll(clicks)
                scroll_position = pyautogui.position()
            
            return AutomationResult(
                success=True,
                operation="scroll_mouse",
                data={
                    "clicks": clicks,
                    "position": scroll_position,
                    "direction": "up" if clicks > 0 else "down"
                }
            )
            
        except Exception as e:
            logger.error(f"Mouse scroll failed: {e}")
            return AutomationResult(
                success=False,
                operation="scroll_mouse",
                error=str(e)
            )
    
    # ==========================================
    # KEYBOARD CONTROL
    # ==========================================
    
    def type_text(self, text: str, interval: float = 0.0) -> AutomationResult:
        """Type text with specified interval between characters"""
        try:
            pyautogui.typewrite(text, interval=interval)
            
            return AutomationResult(
                success=True,
                operation="type_text",
                data={
                    "text": text,
                    "length": len(text),
                    "interval": interval,
                    "estimated_duration": len(text) * interval
                }
            )
            
        except Exception as e:
            logger.error(f"Type text failed: {e}")
            return AutomationResult(
                success=False,
                operation="type_text",
                error=str(e)
            )
    
    def press_key(self, key: str, presses: int = 1, interval: float = 0.0) -> AutomationResult:
        """Press a key multiple times"""
        try:
            pyautogui.press(key, presses=presses, interval=interval)
            
            return AutomationResult(
                success=True,
                operation="press_key",
                data={
                    "key": key,
                    "presses": presses,
                    "interval": interval
                }
            )
            
        except Exception as e:
            logger.error(f"Press key failed: {e}")
            return AutomationResult(
                success=False,
                operation="press_key",
                error=str(e)
            )
    
    def key_combination(self, keys: List[str]) -> AutomationResult:
        """Press a combination of keys simultaneously"""
        try:
            pyautogui.hotkey(*keys)
            
            return AutomationResult(
                success=True,
                operation="key_combination",
                data={
                    "keys": keys,
                    "combination": "+".join(keys)
                }
            )
            
        except Exception as e:
            logger.error(f"Key combination failed: {e}")
            return AutomationResult(
                success=False,
                operation="key_combination",
                error=str(e)
            )
    
    def hold_key(self, key: str, duration: float = 1.0) -> AutomationResult:
        """Hold a key down for specified duration"""
        try:
            pyautogui.keyDown(key)
            time.sleep(duration)
            pyautogui.keyUp(key)
            
            return AutomationResult(
                success=True,
                operation="hold_key",
                data={
                    "key": key,
                    "duration": duration
                }
            )
            
        except Exception as e:
            logger.error(f"Hold key failed: {e}")
            return AutomationResult(
                success=False,
                operation="hold_key",
                error=str(e)
            )
    
    # ==========================================
    # UTILITY FUNCTIONS
    # ==========================================
    
    def get_screen_info(self) -> AutomationResult:
        """Get detailed screen information"""
        try:
            return AutomationResult(
                success=True,
                operation="get_screen_info",
                data=self.screen_info.__dict__
            )
            
        except Exception as e:
            logger.error(f"Get screen info failed: {e}")
            return AutomationResult(
                success=False,
                operation="get_screen_info",
                error=str(e)
            )
    
    def is_on_screen(self, x: int, y: int) -> AutomationResult:
        """Check if coordinates are on screen"""
        try:
            on_screen = pyautogui.onScreen(x, y)
            
            return AutomationResult(
                success=True,
                operation="is_on_screen",
                data={
                    "x": x,
                    "y": y,
                    "on_screen": on_screen,
                    "screen_width": self.screen_info.width,
                    "screen_height": self.screen_info.height
                }
            )
            
        except Exception as e:
            logger.error(f"Is on screen check failed: {e}")
            return AutomationResult(
                success=False,
                operation="is_on_screen",
                error=str(e)
            )
    
    def set_pause(self, pause_duration: float) -> AutomationResult:
        """Set the pause duration between PyAutoGUI actions"""
        try:
            old_pause = pyautogui.PAUSE
            pyautogui.PAUSE = pause_duration
            
            return AutomationResult(
                success=True,
                operation="set_pause",
                data={
                    "old_pause": old_pause,
                    "new_pause": pause_duration
                }
            )
            
        except Exception as e:
            logger.error(f"Set pause failed: {e}")
            return AutomationResult(
                success=False,
                operation="set_pause",
                error=str(e)
            )
    
    def set_failsafe(self, enabled: bool) -> AutomationResult:
        """Enable or disable PyAutoGUI failsafe"""
        try:
            old_failsafe = pyautogui.FAILSAFE
            pyautogui.FAILSAFE = enabled
            
            return AutomationResult(
                success=True,
                operation="set_failsafe",
                data={
                    "old_failsafe": old_failsafe,
                    "new_failsafe": enabled
                }
            )
            
        except Exception as e:
            logger.error(f"Set failsafe failed: {e}")
            return AutomationResult(
                success=False,
                operation="set_failsafe",
                error=str(e)
            )
    
    # ==========================================
    # ADVANCED FEATURES
    # ==========================================
    
    def create_image_template(self, name: str, x: int, y: int, width: int, height: int) -> AutomationResult:
        """Create an image template from screen region for future recognition"""
        try:
            # Take screenshot of region
            region = (x, y, width, height)
            template_img = pyautogui.screenshot(region=region)
            
            # Save template
            self.image_templates[name] = {
                'image': template_img,
                'region': region,
                'created_at': time.time()
            }
            
            # Convert to base64 for return
            img_buffer = io.BytesIO()
            template_img.save(img_buffer, format='PNG')
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            
            return AutomationResult(
                success=True,
                operation="create_image_template",
                data={
                    "template_name": name,
                    "region": region,
                    "image_base64": img_base64,
                    "width": template_img.width,
                    "height": template_img.height
                }
            )
            
        except Exception as e:
            logger.error(f"Create image template failed: {e}")
            return AutomationResult(
                success=False,
                operation="create_image_template",
                error=str(e)
            )
    
    def find_template_on_screen(self, template_name: str, confidence: float = 0.8) -> AutomationResult:
        """Find a previously created template on the screen"""
        try:
            if template_name not in self.image_templates:
                raise ValueError(f"Template '{template_name}' not found")
            
            template_data = self.image_templates[template_name]
            template_img = template_data['image']
            
            # Save template temporarily for locateOnScreen
            temp_path = f"temp_template_{template_name}.png"
            template_img.save(temp_path)
            
            try:
                # Search for template
                location = pyautogui.locateOnScreen(temp_path, confidence=confidence)
                
                if location:
                    center = pyautogui.center(location)
                    match = ImageMatch(
                        found=True,
                        x=location.left,
                        y=location.top,
                        width=location.width,
                        height=location.height,
                        confidence=confidence,
                        center_x=center.x,
                        center_y=center.y
                    )
                else:
                    match = ImageMatch(found=False)
                
                return AutomationResult(
                    success=True,
                    operation="find_template_on_screen",
                    data={
                        "template_name": template_name,
                        "match": match.__dict__,
                        "search_confidence": confidence
                    }
                )
                
            finally:
                # Clean up temporary file
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                    
        except Exception as e:
            logger.error(f"Find template failed: {e}")
            return AutomationResult(
                success=False,
                operation="find_template_on_screen",
                error=str(e)
            )
    
    def get_available_keys(self) -> AutomationResult:
        """Get list of all available keyboard keys"""
        try:
            # PyAutoGUI key names
            available_keys = [
                # Letters
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
                
                # Numbers
                '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                
                # Function keys
                'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
                
                # Special keys
                'enter', 'return', 'space', 'tab', 'backspace', 'delete', 'esc', 'escape',
                'shift', 'ctrl', 'alt', 'win', 'cmd', 'option',
                
                # Arrow keys
                'up', 'down', 'left', 'right',
                
                # Navigation
                'home', 'end', 'pageup', 'pagedown', 'insert',
                
                # Symbols
                '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=', '+',
                '[', ']', '{', '}', '\\', '|', ';', ':', "'", '"', ',', '.', '<', '>',
                '/', '?', '`', '~',
                
                # Lock keys
                'capslock', 'numlock', 'scrolllock',
                
                # Numpad
                'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
                'add', 'subtract', 'multiply', 'divide', 'decimal'
            ]
            
            # Organize by category
            key_categories = {
                'letters': [k for k in available_keys if k.isalpha() and len(k) == 1],
                'numbers': [k for k in available_keys if k.isdigit()],
                'function_keys': [k for k in available_keys if k.startswith('f') and k[1:].isdigit()],
                'arrow_keys': ['up', 'down', 'left', 'right'],
                'modifier_keys': ['shift', 'ctrl', 'alt', 'win', 'cmd', 'option'],
                'navigation_keys': ['home', 'end', 'pageup', 'pagedown', 'insert'],
                'special_keys': ['enter', 'return', 'space', 'tab', 'backspace', 'delete', 'esc', 'escape'],
                'lock_keys': ['capslock', 'numlock', 'scrolllock'],
                'numpad_keys': [k for k in available_keys if k.startswith('num') or k in ['add', 'subtract', 'multiply', 'divide', 'decimal']],
                'symbols': [k for k in available_keys if not k.isalnum() and len(k) == 1]
            }
            
            return AutomationResult(
                success=True,
                operation="get_available_keys",
                data={
                    "all_keys": available_keys,
                    "categories": key_categories,
                    "total_count": len(available_keys)
                }
            )
            
        except Exception as e:
            logger.error(f"Get available keys failed: {e}")
            return AutomationResult(
                success=False,
                operation="get_available_keys",
                error=str(e)
            )

# Singleton instance for global access
_pyautogui_controller = None

def get_pyautogui_controller() -> PyAutoGUIController:
    """Get the global PyAutoGUI controller instance"""
    global _pyautogui_controller
    if _pyautogui_controller is None:
        _pyautogui_controller = PyAutoGUIController()
    return _pyautogui_controller

# Convenience functions for direct access
def screenshot(region=None, save_path=None):
    """Take a screenshot"""
    return get_pyautogui_controller().take_screenshot(region, save_path)

def pixel(x, y):
    """Get pixel color"""
    return get_pyautogui_controller().get_pixel_color(x, y)

def locate_image(image_path, confidence=0.8, region=None):
    """Find image on screen"""
    return get_pyautogui_controller().find_image_on_screen(image_path, confidence, region)

def mouse_position():
    """Get mouse position"""
    return get_pyautogui_controller().get_mouse_position()

def click(x=None, y=None, button='left', clicks=1):
    """Click mouse"""
    return get_pyautogui_controller().click_mouse(x, y, button, clicks)

def type_text(text, interval=0.0):
    """Type text"""
    return get_pyautogui_controller().type_text(text, interval)

def press(key, presses=1):
    """Press key"""
    return get_pyautogui_controller().press_key(key, presses)

if __name__ == "__main__":
    # Quick test
    if PYAUTOGUI_AVAILABLE:
        controller = PyAutoGUIController()
        print("PyAutoGUI Controller initialized successfully!")
        
        # Test basic functionality
        screen_info = controller.get_screen_info()
        print(f"Screen: {screen_info.data}")
        
        mouse_pos = controller.get_mouse_position()
        print(f"Mouse: {mouse_pos.data}")
    else:
        print("PyAutoGUI not available. Install with: pip install pyautogui pillow opencv-python")
