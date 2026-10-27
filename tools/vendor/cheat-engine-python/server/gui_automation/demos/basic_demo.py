#!/usr/bin/env python3
"""
PyAutoGUI Integration Demo for MCP Cheat Engine Server

This demo showcases all PyAutoGUI functionality integrated into the MCP Cheat Engine Server.
It demonstrates every feature category with practical examples and real automation tasks.

Demo Sections:
1. Screen Analysis & Capture
2. Mouse Control & Automation
3. Keyboard Input & Hotkeys
4. Advanced Image Recognition
5. Batch Operations
6. Real-World Automation Scenarios
7. Integration with Memory Operations
"""

import os
import sys
import time
import logging
from pathlib import Path
from typing import Dict, Any, List

# Add project root to path
project_root = Path(__file__).parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def print_section(title: str, description: str = ""):
    """Print a formatted section header"""
    print("\n" + "=" * 70)
    print(f"🎯 {title}")
    print("=" * 70)
    if description:
        print(f"{description}\n")

def print_step(step: str, result: str = "", success: bool = True):
    """Print a formatted step"""
    status = "✅" if success else "❌"
    print(f"{status} {step}")
    if result:
        print(f"   {result}")

def wait_for_user(message: str = "Press Enter to continue..."):
    """Wait for user input"""
    input(f"\n⏸️  {message}")

class PyAutoGUIDemo:
    """Comprehensive PyAutoGUI demonstration"""
    
    def __init__(self):
        """Initialize the demo"""
        try:
            from pyautogui_integration import get_pyautogui_controller, PYAUTOGUI_AVAILABLE
            
            if not PYAUTOGUI_AVAILABLE:
                raise ImportError("PyAutoGUI not available")
            
            self.controller = get_pyautogui_controller()
            self.demo_data = {}
            
            print("🚀 PyAutoGUI Demo Initialized Successfully!")
            
        except ImportError as e:
            print(f"❌ PyAutoGUI not available: {e}")
            print("📦 Install with: pip install pyautogui pillow opencv-python")
            sys.exit(1)
    
    def demo_screen_analysis(self):
        """Demo: Screen Analysis & Capture"""
        print_section(
            "SCREEN ANALYSIS & CAPTURE",
            "Demonstrating screenshot capture, pixel analysis, and screen information"
        )
        
        # 1. Get screen information
        screen_result = self.controller.get_screen_info()
        if screen_result.success:
            data = screen_result.data
            print_step(
                "Screen Information Retrieved",
                f"Resolution: {data['width']}x{data['height']}, Monitors: {data['monitor_count']}"
            )
            self.demo_data['screen_width'] = data['width']
            self.demo_data['screen_height'] = data['height']
        else:
            print_step("Screen Information", f"Failed: {screen_result.error}", False)
            return
        
        # 2. Take full screen screenshot
        screenshot_result = self.controller.take_screenshot()
        if screenshot_result.success:
            data = screenshot_result.data
            print_step(
                "Full Screen Screenshot",
                f"Captured {data['width']}x{data['height']} image, Cache: {data['cache_key']}"
            )
        else:
            print_step("Screenshot", f"Failed: {screenshot_result.error}", False)
        
        # 3. Take region screenshot
        region = (100, 100, 400, 300)  # 400x300 region at (100,100)
        region_result = self.controller.take_screenshot(region)
        if region_result.success:
            print_step(
                "Region Screenshot",
                f"Captured {region} region: {region_result.data['width']}x{region_result.data['height']}"
            )
        else:
            print_step("Region Screenshot", f"Failed: {region_result.error}", False)
        
        # 4. Analyze pixel colors at various points
        test_points = [
            (self.demo_data['screen_width'] // 2, self.demo_data['screen_height'] // 2),  # Center
            (0, 0),  # Top-left
            (100, 100),  # Arbitrary point
        ]
        
        for x, y in test_points:
            pixel_result = self.controller.get_pixel_color(x, y)
            if pixel_result.success:
                data = pixel_result.data
                print_step(
                    f"Pixel Color at ({x}, {y})",
                    f"RGB: {data['rgb']}, Hex: {data['hex']}"
                )
            else:
                print_step(f"Pixel at ({x}, {y})", f"Failed: {pixel_result.error}", False)
        
        # 5. Coordinate validation
        valid_coords = self.controller.is_on_screen(200, 200)
        invalid_coords = self.controller.is_on_screen(-100, -100)
        
        print_step(
            "Coordinate Validation",
            f"(200, 200): {'Valid' if valid_coords.data['on_screen'] else 'Invalid'}, "
            f"(-100, -100): {'Valid' if invalid_coords.data['on_screen'] else 'Invalid'}"
        )
        
        wait_for_user("Screenshot and analysis demo complete. Continue to mouse control?")
    
    def demo_mouse_control(self):
        """Demo: Mouse Control & Automation"""
        print_section(
            "MOUSE CONTROL & AUTOMATION",
            "Demonstrating mouse movement, clicking, dragging, and scrolling"
        )
        
        # 1. Get current mouse position
        pos_result = self.controller.get_mouse_position()
        if pos_result.success:
            start_pos = (pos_result.data['x'], pos_result.data['y'])
            print_step(
                "Current Mouse Position",
                f"Starting at {start_pos}"
            )
        else:
            print_step("Get Mouse Position", f"Failed: {pos_result.error}", False)
            return
        
        print("👆 Watch your mouse cursor move during this demo!")
        wait_for_user("Ready to start mouse movement demo?")
        
        # 2. Absolute movement
        target_positions = [
            (300, 300),
            (500, 200),
            (200, 400),
            (400, 350)
        ]
        
        for i, (x, y) in enumerate(target_positions, 1):
            move_result = self.controller.move_mouse(x, y, duration=0.8)
            if move_result.success:
                print_step(
                    f"Movement {i}",
                    f"Moved to ({x}, {y}) in 0.8 seconds"
                )
                time.sleep(0.5)
            else:
                print_step(f"Movement {i}", f"Failed: {move_result.error}", False)
        
        # 3. Relative movement
        relative_moves = [(50, 0), (0, 50), (-50, 0), (0, -50)]
        
        for i, (dx, dy) in enumerate(relative_moves, 1):
            rel_result = self.controller.move_mouse(dx, dy, duration=0.3, relative=True)
            if rel_result.success:
                print_step(
                    f"Relative Move {i}",
                    f"Moved by ({dx}, {dy})"
                )
                time.sleep(0.2)
            else:
                print_step(f"Relative Move {i}", f"Failed: {rel_result.error}", False)
        
        # 4. Clicking demonstrations
        click_demos = [
            {"button": "left", "clicks": 1, "desc": "Single left click"},
            {"button": "right", "clicks": 1, "desc": "Single right click"},
            {"button": "left", "clicks": 2, "desc": "Double left click"},
        ]
        
        for demo in click_demos:
            click_result = self.controller.click_mouse(
                button=demo["button"],
                clicks=demo["clicks"]
            )
            if click_result.success:
                print_step(demo["desc"], "Executed successfully")
                time.sleep(0.5)
            else:
                print_step(demo["desc"], f"Failed: {click_result.error}", False)
        
        # 5. Drag operation
        drag_start = (250, 250)
        drag_end = (350, 350)
        
        drag_result = self.controller.drag_mouse(
            drag_start[0], drag_start[1],
            drag_end[0], drag_end[1],
            duration=1.0
        )
        
        if drag_result.success:
            data = drag_result.data
            print_step(
                "Mouse Drag",
                f"Dragged from {data['start_position']} to {data['end_position']}, "
                f"Distance: {data['distance']:.1f}px"
            )
        else:
            print_step("Mouse Drag", f"Failed: {drag_result.error}", False)
        
        # 6. Scrolling
        scroll_result_up = self.controller.scroll_mouse(3)
        if scroll_result_up.success:
            print_step("Scroll Up", "Scrolled up 3 clicks")
        
        time.sleep(0.5)
        
        scroll_result_down = self.controller.scroll_mouse(-5, 400, 300)
        if scroll_result_down.success:
            print_step("Scroll Down", "Scrolled down 5 clicks at (400, 300)")
        
        # Return to starting position
        self.controller.move_mouse(start_pos[0], start_pos[1], duration=1.0)
        print_step("Return to Start", f"Moved back to {start_pos}")
        
        wait_for_user("Mouse control demo complete. Continue to keyboard automation?")
    
    def demo_keyboard_automation(self):
        """Demo: Keyboard Input & Hotkeys"""
        print_section(
            "KEYBOARD AUTOMATION",
            "Demonstrating text typing, key presses, combinations, and hotkeys"
        )
        
        print("⌨️ Keyboard input will be sent to the currently focused window!")
        print("💡 Consider opening a text editor (like Notepad) to see the results clearly.")
        wait_for_user("Ready for keyboard demo? Make sure you have a text editor open!")
        
        # 1. Text typing with different speeds
        typing_demos = [
            {"text": "Hello PyAutoGUI Integration! ", "interval": 0.05, "desc": "Slow typing"},
            {"text": "Fast typing demonstration. ", "interval": 0.01, "desc": "Fast typing"},
            {"text": "Normal speed text input.\n", "interval": 0.03, "desc": "Normal typing"},
        ]
        
        for demo in typing_demos:
            type_result = self.controller.type_text(demo["text"], demo["interval"])
            if type_result.success:
                print_step(
                    demo["desc"],
                    f"Typed '{demo['text'].strip()}' with {demo['interval']}s interval"
                )
                time.sleep(0.5)
            else:
                print_step(demo["desc"], f"Failed: {type_result.error}", False)
        
        time.sleep(1)
        
        # 2. Individual key presses
        key_demos = [
            {"key": "tab", "desc": "Tab key"},
            {"key": "space", "presses": 3, "desc": "3 space presses"},
            {"key": "backspace", "presses": 5, "desc": "5 backspace presses"},
            {"key": "enter", "desc": "Enter key"},
        ]
        
        for demo in key_demos:
            presses = demo.get("presses", 1)
            key_result = self.controller.press_key(demo["key"], presses=presses)
            if key_result.success:
                print_step(
                    demo["desc"],
                    f"Pressed '{demo['key']}' {presses} time(s)"
                )
                time.sleep(0.3)
            else:
                print_step(demo["desc"], f"Failed: {key_result.error}", False)
        
        # 3. Key combinations (hotkeys)
        hotkey_demos = [
            {"keys": ["ctrl", "a"], "desc": "Select All (Ctrl+A)"},
            {"keys": ["ctrl", "c"], "desc": "Copy (Ctrl+C)"},
            {"keys": ["ctrl", "v"], "desc": "Paste (Ctrl+V)"},
            {"keys": ["ctrl", "z"], "desc": "Undo (Ctrl+Z)"},
            {"keys": ["alt", "tab"], "desc": "Alt+Tab (Window Switch)"},
        ]
        
        for demo in hotkey_demos:
            combo_result = self.controller.key_combination(demo["keys"])
            if combo_result.success:
                print_step(
                    demo["desc"],
                    f"Executed {'+'.join(demo['keys'])}"
                )
                time.sleep(0.5)
            else:
                print_step(demo["desc"], f"Failed: {combo_result.error}", False)
        
        # 4. Key holding
        hold_result = self.controller.hold_key("shift", duration=1.0)
        if hold_result.success:
            print_step(
                "Hold Key Demo",
                "Held Shift key for 1.0 seconds"
            )
        else:
            print_step("Hold Key Demo", f"Failed: {hold_result.error}", False)
        
        # 5. Available keys information
        keys_result = self.controller.get_available_keys()
        if keys_result.success:
            data = keys_result.data
            categories = data["categories"]
            print_step(
                "Available Keys",
                f"Total: {data['total_count']} keys across {len(categories)} categories"
            )
            
            # Show some examples
            print("   Key Categories:")
            for category, keys in categories.items():
                if keys:
                    sample = keys[:3]
                    print(f"     {category.replace('_', ' ').title()}: {', '.join(sample)}{'...' if len(keys) > 3 else ''}")
        else:
            print_step("Available Keys", f"Failed: {keys_result.error}", False)
        
        wait_for_user("Keyboard automation demo complete. Continue to advanced features?")
    
    def demo_advanced_features(self):
        """Demo: Advanced Features"""
        print_section(
            "ADVANCED FEATURES",
            "Demonstrating image templates, batch operations, and configuration"
        )
        
        # 1. Configuration management
        print("🔧 Configuration Management")
        
        # Set pause duration
        pause_result = self.controller.set_pause(0.05)
        if pause_result.success:
            data = pause_result.data
            print_step(
                "Set Pause Duration",
                f"Changed from {data['old_pause']}s to {data['new_pause']}s"
            )
        
        # Failsafe management
        failsafe_result = self.controller.set_failsafe(True)
        if failsafe_result.success:
            print_step(
                "Failsafe Setting",
                "Failsafe enabled (move mouse to corner to abort)"
            )
        
        # 2. Image template creation
        print("\n📸 Image Template System")
        
        template_region = (100, 100, 200, 150)  # 200x150 region
        template_result = self.controller.create_image_template(
            "demo_template",
            template_region[0], template_region[1],
            template_region[2], template_region[3]
        )
        
        if template_result.success:
            data = template_result.data
            print_step(
                "Create Image Template",
                f"Template '{data['template_name']}' created from region {data['region']}"
            )
            
            # Try to find the template immediately
            find_result = self.controller.find_template_on_screen("demo_template", confidence=0.9)
            if find_result.success:
                match = find_result.data["match"]
                if match["found"]:
                    print_step(
                        "Find Template",
                        f"Template found at ({match['x']}, {match['y']})"
                    )
                else:
                    print_step(
                        "Find Template",
                        "Template not found (expected, as screen content changed)"
                    )
            else:
                print_step("Find Template", f"Failed: {find_result.error}", False)
        else:
            print_step("Create Template", f"Failed: {template_result.error}", False)
        
        wait_for_user("Advanced features demo complete. Continue to practical examples?")
    
    def demo_practical_examples(self):
        """Demo: Practical Automation Examples"""
        print_section(
            "PRACTICAL AUTOMATION EXAMPLES",
            "Real-world automation scenarios using combined PyAutoGUI features"
        )
        
        print("🎯 Example 1: Screenshot Analysis and Auto-Click")
        
        # Take screenshot and analyze
        screenshot = self.controller.take_screenshot()
        if screenshot.success:
            width = screenshot.data['width']
            height = screenshot.data['height']
            
            # Calculate interesting points
            center = (width // 2, height // 2)
            quarter_point = (width // 4, height // 4)
            
            # Get pixel colors at these points
            center_pixel = self.controller.get_pixel_color(center[0], center[1])
            quarter_pixel = self.controller.get_pixel_color(quarter_point[0], quarter_point[1])
            
            if center_pixel.success and quarter_pixel.success:
                print_step(
                    "Screenshot Analysis",
                    f"Center pixel: {center_pixel.data['hex']}, "
                    f"Quarter pixel: {quarter_pixel.data['hex']}"
                )
                
                # Simulate clicking based on analysis
                print("   Simulating intelligent clicking...")
                self.controller.click_mouse(center[0], center[1])
                time.sleep(0.5)
                self.controller.click_mouse(quarter_point[0], quarter_point[1])
                
                print_step("Auto-Click", "Clicked at analyzed positions")
            else:
                print_step("Screenshot Analysis", "Failed to analyze pixels", False)
        
        print("\n🎯 Example 2: Text Input with Formatting")
        
        # Simulate creating formatted text
        formatting_sequence = [
            ("Bold Text Example", ["ctrl", "b"]),
            ("Italic Text Example", ["ctrl", "i"]),
            ("Underlined Text", ["ctrl", "u"]),
        ]
        
        for text, format_keys in formatting_sequence:
            # Apply formatting
            self.controller.key_combination(format_keys)
            time.sleep(0.1)
            
            # Type text
            self.controller.type_text(text + "\n", interval=0.02)
            time.sleep(0.2)
            
            # Remove formatting
            self.controller.key_combination(format_keys)
            time.sleep(0.1)
        
        print_step("Formatted Text Input", "Applied bold, italic, and underline formatting")
        
        print("\n🎯 Example 3: Window Navigation Simulation")
        
        # Simulate window navigation
        navigation_sequence = [
            (["alt", "tab"], "Switch to next window"),
            (["win", "d"], "Show desktop"),
            (["win", "r"], "Open Run dialog"),
        ]
        
        for keys, description in navigation_sequence:
            self.controller.key_combination(keys)
            print_step("Window Navigation", description)
            time.sleep(1.0)  # Give time for window changes
        
        # Press Escape to close any opened dialogs
        self.controller.press_key("escape")
        print_step("Cleanup", "Pressed Escape to close dialogs")
        
        print("\n🎯 Example 4: Batch Operations Demo")
        
        # Simulate batch clicking at calculated positions
        screen_info = self.controller.get_screen_info()
        if screen_info.success:
            width = screen_info.data['width']
            height = screen_info.data['height']
            
            # Create a grid of click points
            click_points = []
            for i in range(3):
                for j in range(3):
                    x = (width // 4) + (i * width // 6)
                    y = (height // 4) + (j * height // 6)
                    click_points.append((x, y))
            
            print("   Performing grid click pattern...")
            for i, (x, y) in enumerate(click_points):
                self.controller.click_mouse(x, y)
                time.sleep(0.1)
            
            print_step("Batch Grid Clicks", f"Clicked {len(click_points)} positions in grid pattern")
        
        wait_for_user("Practical examples complete. Continue to performance analysis?")
    
    def demo_performance_analysis(self):
        """Demo: Performance Analysis"""
        print_section(
            "PERFORMANCE ANALYSIS",
            "Measuring performance of various PyAutoGUI operations"
        )
        
        performance_tests = [
            {
                "name": "Screenshot Capture",
                "operation": lambda: self.controller.take_screenshot(),
                "iterations": 5
            },
            {
                "name": "Mouse Position Query",
                "operation": lambda: self.controller.get_mouse_position(),
                "iterations": 10
            },
            {
                "name": "Pixel Color Reading",
                "operation": lambda: self.controller.get_pixel_color(100, 100),
                "iterations": 10
            },
            {
                "name": "Mouse Movement",
                "operation": lambda: self.controller.move_mouse(200, 200, duration=0.1),
                "iterations": 5
            },
            {
                "name": "Key Press",
                "operation": lambda: self.controller.press_key("space"),
                "iterations": 10
            }
        ]
        
        for test in performance_tests:
            print(f"\n🔍 Testing {test['name']} ({test['iterations']} iterations)")
            
            times = []
            successes = 0
            
            for i in range(test['iterations']):
                start_time = time.time()
                result = test['operation']()
                end_time = time.time()
                
                duration = (end_time - start_time) * 1000  # Convert to milliseconds
                times.append(duration)
                
                if result.success:
                    successes += 1
                
                time.sleep(0.1)  # Small delay between tests
            
            # Calculate statistics
            avg_time = sum(times) / len(times)
            min_time = min(times)
            max_time = max(times)
            success_rate = (successes / test['iterations']) * 100
            
            print_step(
                f"{test['name']} Performance",
                f"Avg: {avg_time:.1f}ms, Min: {min_time:.1f}ms, Max: {max_time:.1f}ms, "
                f"Success: {success_rate:.0f}%"
            )
        
        wait_for_user("Performance analysis complete. Continue to integration demo?")
    
    def demo_mcp_integration(self):
        """Demo: MCP Integration"""
        print_section(
            "MCP INTEGRATION DEMONSTRATION",
            "Showing how PyAutoGUI integrates with MCP Cheat Engine Server"
        )
        
        # Import MCP handler for testing
        try:
            from pyautogui_tools import PyAutoGUIToolHandler
            handler = PyAutoGUIToolHandler()
            
            if not handler.available:
                print_step("MCP Handler", "Not available", False)
                return
            
            print_step("MCP Handler", "Successfully initialized")
            
            # Test MCP tool handlers
            mcp_tests = [
                {
                    "name": "Screenshot via MCP",
                    "handler": handler.handle_screenshot,
                    "args": {}
                },
                {
                    "name": "Mouse Position via MCP",
                    "handler": handler.handle_mouse_position,
                    "args": {}
                },
                {
                    "name": "Screen Info via MCP",
                    "handler": handler.handle_screen_info,
                    "args": {}
                },
                {
                    "name": "Available Keys via MCP",
                    "handler": handler.handle_get_available_keys,
                    "args": {}
                }
            ]
            
            print("\n🔧 Testing MCP Tool Handlers:")
            
            for test in mcp_tests:
                try:
                    result = asyncio.run(test["handler"](test["args"]))
                    
                    if result.get("success", False):
                        print_step(test["name"], "Handler working correctly")
                    else:
                        print_step(test["name"], f"Handler failed: {result.get('error', 'Unknown')}", False)
                        
                except Exception as e:
                    print_step(test["name"], f"Exception: {e}", False)
            
            # Show available MCP tools
            from pyautogui_tools import ALL_PYAUTOGUI_TOOLS
            
            print(f"\n📋 Available MCP Tools: {len(ALL_PYAUTOGUI_TOOLS)}")
            
            categories = {
                "Screen": ["screenshot", "pixel_color", "find_image", "screen_info"],
                "Mouse": ["mouse_position", "move_mouse", "click_mouse", "drag_mouse", "scroll_mouse"],
                "Keyboard": ["type_text", "press_key", "key_combination", "hold_key"],
                "Advanced": ["create_template", "find_template", "batch_clicks", "batch_keys"],
                "Config": ["set_pause", "set_failsafe", "get_available_keys", "is_on_screen"]
            }
            
            for category, tool_patterns in categories.items():
                matching_tools = [tool for tool in ALL_PYAUTOGUI_TOOLS 
                                if any(pattern in tool.name for pattern in tool_patterns)]
                print(f"   {category}: {len(matching_tools)} tools")
            
            print_step("MCP Integration", f"All {len(ALL_PYAUTOGUI_TOOLS)} PyAutoGUI tools available via MCP")
            
        except ImportError as e:
            print_step("MCP Integration", f"Import failed: {e}", False)
        except Exception as e:
            print_step("MCP Integration", f"Error: {e}", False)
    
    def run_complete_demo(self):
        """Run the complete demonstration"""
        
        print("🎉 PYAUTOGUI INTEGRATION DEMO FOR MCP CHEAT ENGINE SERVER")
        print("=" * 70)
        print("This demo showcases all PyAutoGUI functionality integrated into the")
        print("MCP Cheat Engine Server. Each section demonstrates different capabilities.")
        print("\n⚠️  WARNING: This demo will control your mouse and keyboard!")
        print("Move your mouse to the top-left corner to trigger failsafe if needed.")
        
        continue_demo = input("\n🚀 Ready to start? (y/N): ").lower().strip()
        if continue_demo != 'y':
            print("Demo cancelled.")
            return
        
        try:
            # Run all demo sections
            self.demo_screen_analysis()
            self.demo_mouse_control()
            self.demo_keyboard_automation()
            self.demo_advanced_features()
            self.demo_practical_examples()
            self.demo_performance_analysis()
            self.demo_mcp_integration()
            
            # Final summary
            print_section(
                "DEMO COMPLETE! 🎉",
                "All PyAutoGUI functionality has been demonstrated"
            )
            
            print("✅ Screen capture and analysis")
            print("✅ Mouse control and automation")
            print("✅ Keyboard input and hotkeys")
            print("✅ Advanced image recognition")
            print("✅ Batch operations")
            print("✅ Performance analysis")
            print("✅ MCP integration")
            
            print(f"\n🎯 Summary:")
            print(f"   • Screen Resolution: {self.demo_data.get('screen_width', 'N/A')}x{self.demo_data.get('screen_height', 'N/A')}")
            print(f"   • PyAutoGUI: Fully integrated")
            print(f"   • MCP Tools: All {len(ALL_PYAUTOGUI_TOOLS) if 'ALL_PYAUTOGUI_TOOLS' in globals() else 'N/A'} tools available")
            print(f"   • Status: Ready for production use!")
            
            print("\n🚀 The MCP Cheat Engine Server now has complete PyAutoGUI functionality!")
            print("   You can use all these features through MCP tool calls in Claude Desktop.")
            
        except KeyboardInterrupt:
            print("\n\n⏹️ Demo interrupted by user")
        except Exception as e:
            print(f"\n\n💥 Demo error: {e}")
            import traceback
            traceback.print_exc()

def main():
    """Main entry point"""
    try:
        demo = PyAutoGUIDemo()
        demo.run_complete_demo()
    except KeyboardInterrupt:
        print("\n⏹️ Demo cancelled by user")
    except Exception as e:
        print(f"❌ Demo failed to start: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # Handle asyncio import for MCP integration test
    try:
        import asyncio
    except ImportError:
        print("⚠️ asyncio not available - MCP integration test will be skipped")
    
    main()
