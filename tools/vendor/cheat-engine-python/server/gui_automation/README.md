# PyAutoGUI Integration Module

This module provides comprehensive PyAutoGUI integration for the MCP Cheat Engine Server, offering secure and powerful GUI automation capabilities as part of the server.

## 📁 Package Structure

```
pyautogui/
├── __init__.py                    # Main package exports
├── core/
│   ├── __init__.py               # Core module exports
│   └── integration.py            # Main PyAutoGUI controller and integration
├── tools/
│   ├── __init__.py               # Tools module exports
│   └── mcp_tools.py              # MCP tool definitions (25 tools)
├── demos/
│   ├── __init__.py               # Demos module exports
│   ├── basic_demo.py             # Basic automation demonstration
│   ├── notepad_demo.py           # Notepad automation example
│   └── simple_demo.py            # Simple usage example
├── tests/
│   ├── __init__.py               # Tests module exports
│   ├── test_integration.py       # Comprehensive integration tests
│   └── test_simple.py            # Simple validation tests
└── README.md                     # This file
```

## 🚀 Quick Start

### Basic Usage

```python
from server.pyautogui.core.integration import PyAutoGUIController, get_pyautogui_controller

# Method 1: Direct controller
controller = PyAutoGUIController()

# Method 2: Factory function
controller = get_pyautogui_controller()

# Take a screenshot
result = controller.screenshot()
if result.success:
    print(f"Screenshot saved: {result.data}")

# Type text
result = controller.type_text("Hello World!", interval=0.1)
if result.success:
    print("Text typed successfully")

# Move mouse
result = controller.move_mouse(500, 300, duration=1.0)
if result.success:
    print("Mouse moved successfully")
```

### MCP Integration

```python
from server.pyautogui.tools.mcp_tools import ALL_PYAUTOGUI_TOOLS, PyAutoGUIToolHandler

# Get all available MCP tools
print(f"Available tools: {len(ALL_PYAUTOGUI_TOOLS)}")

# Create MCP tool handler
handler = PyAutoGUIToolHandler()

# Use tools through MCP interface
if handler.available:
    result = handler.handle_screenshot({})
    print(f"Screenshot result: {result}")
```

## 🛠️ Available MCP Tools

The package provides **25 comprehensive MCP tools** organized in categories:

### Screen Capture & Analysis
- `pyautogui_screenshot` - Take screenshots
- `pyautogui_get_pixel_color` - Get pixel colors
- `pyautogui_find_image` - Find images on screen
- `pyautogui_find_all_images` - Find all image instances

### Mouse Control
- `pyautogui_get_mouse_position` - Get mouse position
- `pyautogui_move_mouse` - Move mouse cursor
- `pyautogui_click_mouse` - Click mouse buttons
- `pyautogui_drag_mouse` - Drag operations
- `pyautogui_scroll_mouse` - Mouse wheel scrolling

### Keyboard Automation
- `pyautogui_type_text` - Type text with timing
- `pyautogui_press_key` - Press individual keys
- `pyautogui_key_combination` - Key combinations/hotkeys
- `pyautogui_hold_key` - Hold keys for duration

### Utility & Configuration
- `pyautogui_get_screen_info` - Screen information
- `pyautogui_is_on_screen` - Coordinate validation
- `pyautogui_set_pause` - Configure timing
- `pyautogui_set_failsafe` - Safety controls
- `pyautogui_get_available_keys` - List available keys

### Advanced Features
- `pyautogui_create_image_template` - Create templates
- `pyautogui_find_template` - Find templates

### Batch Operations
- `pyautogui_batch_clicks` - Multiple click sequences
- `pyautogui_batch_keys` - Multiple key sequences

## 🔒 Security Features

- **Process Validation**: Operations validated against whitelisted applications
- **Fail-safe Controls**: Emergency stop mechanisms
- **Input Sanitization**: Safe handling of user inputs
- **Error Handling**: Comprehensive error reporting
- **Resource Monitoring**: Memory and performance tracking

## 📚 Examples

### Screen Automation

```python
from server.pyautogui.core.integration import get_pyautogui_controller

controller = get_pyautogui_controller()

# Take a screenshot of a specific region
result = controller.screenshot(region=[100, 100, 800, 600])
if result.success:
    print(f"Region screenshot: {result.data}")

# Find an image
result = controller.find_image("button.png", confidence=0.8)
if result.success:
    print(f"Image found at: {result.data}")
```

### Mouse Control

```python
# Get current mouse position
pos_result = controller.get_mouse_position()
print(f"Mouse at: {pos_result.data}")

# Move to specific coordinates with smooth motion
move_result = controller.move_mouse(500, 300, duration=2.0)

# Click at current position
click_result = controller.click_mouse(button="left", clicks=2)

# Drag operation
drag_result = controller.drag_mouse(100, 100, 200, 200, duration=1.5)
```

### Keyboard Automation

```python
# Type text with character delay
type_result = controller.type_text("Hello World!", interval=0.05)

# Press individual keys
key_result = controller.press_key("enter", presses=1)

# Key combinations
combo_result = controller.key_combination(["ctrl", "c"])

# Hold key for duration
hold_result = controller.hold_key("shift", duration=2.0)
```

## 🧪 Testing

Run the test suite:

```python
# Quick validation test
python pyautogui/tests/test_simple.py

# Comprehensive integration test
python pyautogui/tests/test_integration.py
```

## 🎮 Demos

Explore the demo scripts:

```python
# Basic demonstration
python pyautogui/demos/basic_demo.py

# Notepad automation
python pyautogui/demos/notepad_demo.py

# Simple usage example
python pyautogui/demos/simple_demo.py
```

## 🔧 Configuration

### Safety Settings

```python
from pyautogui.core.integration import PyAutoGUIController

# Configure safety settings
controller = PyAutoGUIController()
controller.set_failsafe(True)  # Enable emergency stop
controller.set_pause(0.1)      # Set default pause between actions
```

### Screen Information

```python
# Get screen details
screen_info = controller.get_screen_info()
print(f"Screen size: {screen_info.data}")

# Check if coordinates are valid
valid = controller.is_on_screen(1000, 500)
print(f"Coordinates valid: {valid.data}")
```

## 📈 Performance

- **Optimized Image Operations**: Efficient template matching and image recognition
- **Configurable Timing**: Adjustable delays and intervals for precise control
- **Memory Management**: Efficient resource usage and cleanup
- **Background Operations**: Non-blocking operations where appropriate

## 🔗 Integration with MCP Server

The PyAutoGUI package integrates seamlessly with the MCP Cheat Engine Server:

1. **Automatic Registration**: All tools are automatically registered with the MCP server
2. **Secure Execution**: All operations go through security validation
3. **Comprehensive Logging**: Full audit trail of all operations
4. **Error Recovery**: Robust error handling and recovery mechanisms

## 📖 API Reference

### Core Classes

- **`PyAutoGUIController`**: Main automation controller
- **`PyAutoGUIToolHandler`**: MCP tool handler
- **`OperationResult`**: Standard result wrapper

### Key Methods

- **Screen Operations**: `screenshot()`, `get_pixel_color()`, `find_image()`
- **Mouse Operations**: `move_mouse()`, `click_mouse()`, `drag_mouse()`
- **Keyboard Operations**: `type_text()`, `press_key()`, `key_combination()`
- **Utility Operations**: `get_screen_info()`, `is_on_screen()`

## 🤝 Contributing

The PyAutoGUI package is part of the MCP Cheat Engine Server project. When contributing:

1. Maintain security standards
2. Add comprehensive tests
3. Update documentation
4. Follow the existing code patterns

## 📄 License

This package is part of the MCP Cheat Engine Server project and follows the same licensing terms.

---

**Ready for Production** ✅  
Complete PyAutoGUI automation solution with security, performance, and ease of use.
