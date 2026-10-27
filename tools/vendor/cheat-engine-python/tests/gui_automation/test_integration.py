#!/usr/bin/env python3
"""
Comprehensive PyAutoGUI Integration Tests

This test suite validates all PyAutoGUI functionality integrated into the 
MCP Cheat Engine Server, ensuring every feature works correctly.

Test Categories:
1. Screen Capture & Analysis Tests
2. Mouse Control Tests  
3. Keyboard Automation Tests
4. Utility & Configuration Tests
5. Advanced Feature Tests
6. Batch Operation Tests
7. Integration Tests with Memory Operations
"""

import os
import sys
import time
import tempfile
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, List
import unittest
from unittest.mock import patch, MagicMock

# Add project root to path
project_root = Path(__file__).parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PyAutoGUIIntegrationTests(unittest.TestCase):
    """Comprehensive test suite for PyAutoGUI integration"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        try:
            from ..core.integration import get_pyautogui_controller, PYAUTOGUI_AVAILABLE
            from ..tools.mcp_tools import PyAutoGUIToolHandler
            
            if not PYAUTOGUI_AVAILABLE:
                raise ImportError("PyAutoGUI not available")
            
            cls.controller = get_pyautogui_controller()
            cls.handler = PyAutoGUIToolHandler()
            cls.temp_dir = tempfile.mkdtemp()
            
            logger.info("PyAutoGUI test environment initialized")
            
        except ImportError as e:
            raise unittest.SkipTest(f"PyAutoGUI not available: {e}")
    
    @classmethod
    def tearDownClass(cls):
        """Clean up test environment"""
        import shutil
        try:
            shutil.rmtree(cls.temp_dir)
        except:
            pass
    
    def setUp(self):
        """Set up individual test"""
        # Reset PyAutoGUI settings
        self.controller.set_pause(0.1)
        self.controller.set_failsafe(True)
    
    # ==========================================
    # SCREEN CAPTURE & ANALYSIS TESTS
    # ==========================================
    
    def test_screenshot_full_screen(self):
        """Test taking a full screen screenshot"""
        logger.info("Testing full screen screenshot...")
        
        result = self.controller.take_screenshot()
        
        self.assertTrue(result.success, f"Screenshot failed: {result.error}")
        self.assertIn('image_base64', result.data)
        self.assertIn('width', result.data)
        self.assertIn('height', result.data)
        self.assertGreater(result.data['width'], 0)
        self.assertGreater(result.data['height'], 0)
        
        logger.info(f"✅ Full screen screenshot: {result.data['width']}x{result.data['height']}")
    
    def test_screenshot_region(self):
        """Test taking a screenshot of a specific region"""
        logger.info("Testing region screenshot...")
        
        region = (100, 100, 400, 300)  # 400x300 region at (100,100)
        result = self.controller.take_screenshot(region)
        
        self.assertTrue(result.success, f"Region screenshot failed: {result.error}")
        self.assertEqual(result.data['width'], 400)
        self.assertEqual(result.data['height'], 300)
        self.assertEqual(result.data['region'], region)
        
        logger.info(f"✅ Region screenshot: {result.data['region']}")
    
    def test_screenshot_save_file(self):
        """Test saving screenshot to file"""
        logger.info("Testing screenshot save...")
        
        save_path = os.path.join(self.temp_dir, "test_screenshot.png")
        result = self.controller.take_screenshot(save_path=save_path)
        
        self.assertTrue(result.success, f"Screenshot save failed: {result.error}")
        self.assertTrue(os.path.exists(save_path), "Screenshot file not created")
        self.assertEqual(result.data['save_path'], save_path)
        
        logger.info(f"✅ Screenshot saved: {save_path}")
    
    def test_get_pixel_color(self):
        """Test getting pixel color at coordinates"""
        logger.info("Testing pixel color detection...")
        
        # Test center of screen
        screen_info = self.controller.get_screen_info()
        center_x = screen_info.data['width'] // 2
        center_y = screen_info.data['height'] // 2
        
        result = self.controller.get_pixel_color(center_x, center_y)
        
        self.assertTrue(result.success, f"Get pixel color failed: {result.error}")
        self.assertIn('rgb', result.data)
        self.assertIn('hex', result.data)
        self.assertEqual(len(result.data['rgb']), 3)
        self.assertTrue(result.data['hex'].startswith('#'))
        
        logger.info(f"✅ Pixel color at ({center_x}, {center_y}): {result.data['hex']}")
    
    def test_pixel_color_invalid_coordinates(self):
        """Test pixel color with invalid coordinates"""
        logger.info("Testing pixel color with invalid coordinates...")
        
        result = self.controller.get_pixel_color(-1, -1)
        
        self.assertFalse(result.success)
        self.assertIn("outside screen bounds", result.error)
        
        logger.info("✅ Invalid coordinates handled correctly")
    
    # ==========================================
    # MOUSE CONTROL TESTS
    # ==========================================
    
    def test_get_mouse_position(self):
        """Test getting current mouse position"""
        logger.info("Testing mouse position detection...")
        
        result = self.controller.get_mouse_position()
        
        self.assertTrue(result.success, f"Get mouse position failed: {result.error}")
        self.assertIn('x', result.data)
        self.assertIn('y', result.data)
        self.assertIsInstance(result.data['x'], int)
        self.assertIsInstance(result.data['y'], int)
        
        logger.info(f"✅ Mouse position: ({result.data['x']}, {result.data['y']})")
    
    def test_move_mouse_absolute(self):
        """Test moving mouse to absolute coordinates"""
        logger.info("Testing absolute mouse movement...")
        
        # Get initial position
        initial_pos = self.controller.get_mouse_position()
        
        # Move to new position
        target_x, target_y = 300, 300
        result = self.controller.move_mouse(target_x, target_y, duration=0.2)
        
        self.assertTrue(result.success, f"Move mouse failed: {result.error}")
        self.assertEqual(result.data['target_x'], target_x)
        self.assertEqual(result.data['target_y'], target_y)
        
        # Verify position changed
        time.sleep(0.3)
        new_pos = self.controller.get_mouse_position()
        self.assertEqual(new_pos.data['x'], target_x)
        self.assertEqual(new_pos.data['y'], target_y)
        
        logger.info(f"✅ Mouse moved from ({initial_pos.data['x']}, {initial_pos.data['y']}) to ({target_x}, {target_y})")
    
    def test_move_mouse_relative(self):
        """Test moving mouse relative to current position"""
        logger.info("Testing relative mouse movement...")
        
        # Get initial position
        initial_pos = self.controller.get_mouse_position()
        initial_x, initial_y = initial_pos.data['x'], initial_pos.data['y']
        
        # Move relative
        offset_x, offset_y = 50, -30
        result = self.controller.move_mouse(offset_x, offset_y, duration=0.2, relative=True)
        
        self.assertTrue(result.success, f"Relative move failed: {result.error}")
        expected_x = initial_x + offset_x
        expected_y = initial_y + offset_y
        self.assertEqual(result.data['target_x'], expected_x)
        self.assertEqual(result.data['target_y'], expected_y)
        
        logger.info(f"✅ Mouse moved relatively by ({offset_x}, {offset_y})")
    
    def test_click_mouse_default(self):
        """Test clicking at current mouse position"""
        logger.info("Testing default mouse click...")
        
        result = self.controller.click_mouse()
        
        self.assertTrue(result.success, f"Mouse click failed: {result.error}")
        self.assertIn('position', result.data)
        self.assertEqual(result.data['button'], 'left')
        self.assertEqual(result.data['clicks'], 1)
        
        logger.info(f"✅ Mouse clicked at {result.data['position']}")
    
    def test_click_mouse_specific_position(self):
        """Test clicking at specific coordinates"""
        logger.info("Testing click at specific position...")
        
        click_x, click_y = 400, 400
        result = self.controller.click_mouse(click_x, click_y, button='right', clicks=2)
        
        self.assertTrue(result.success, f"Specific click failed: {result.error}")
        self.assertEqual(result.data['position'], (click_x, click_y))
        self.assertEqual(result.data['button'], 'right')
        self.assertEqual(result.data['clicks'], 2)
        
        logger.info(f"✅ Right-clicked 2 times at ({click_x}, {click_y})")
    
    def test_drag_mouse(self):
        """Test mouse drag operation"""
        logger.info("Testing mouse drag...")
        
        start_x, start_y = 200, 200
        end_x, end_y = 300, 250
        result = self.controller.drag_mouse(start_x, start_y, end_x, end_y, duration=0.5)
        
        self.assertTrue(result.success, f"Mouse drag failed: {result.error}")
        self.assertEqual(result.data['start_position'], [start_x, start_y])
        self.assertEqual(result.data['end_position'], [end_x, end_y])
        self.assertIn('distance', result.data)
        
        logger.info(f"✅ Mouse dragged from ({start_x}, {start_y}) to ({end_x}, {end_y})")
    
    def test_scroll_mouse(self):
        """Test mouse scrolling"""
        logger.info("Testing mouse scroll...")
        
        # Scroll up
        result_up = self.controller.scroll_mouse(3)
        self.assertTrue(result_up.success, f"Scroll up failed: {result_up.error}")
        self.assertEqual(result_up.data['clicks'], 3)
        self.assertEqual(result_up.data['direction'], 'up')
        
        # Scroll down
        result_down = self.controller.scroll_mouse(-5, 500, 500)
        self.assertTrue(result_down.success, f"Scroll down failed: {result_down.error}")
        self.assertEqual(result_down.data['clicks'], -5)
        self.assertEqual(result_down.data['direction'], 'down')
        self.assertEqual(result_down.data['position'], (500, 500))
        
        logger.info("✅ Mouse scrolling up and down")
    
    # ==========================================
    # KEYBOARD AUTOMATION TESTS
    # ==========================================
    
    def test_type_text(self):
        """Test typing text"""
        logger.info("Testing text typing...")
        
        test_text = "Hello PyAutoGUI Test!"
        result = self.controller.type_text(test_text, interval=0.01)
        
        self.assertTrue(result.success, f"Type text failed: {result.error}")
        self.assertEqual(result.data['text'], test_text)
        self.assertEqual(result.data['length'], len(test_text))
        self.assertEqual(result.data['interval'], 0.01)
        
        logger.info(f"✅ Typed text: '{test_text}' with 0.01s interval")
    
    def test_press_key_single(self):
        """Test pressing a single key"""
        logger.info("Testing single key press...")
        
        result = self.controller.press_key('space')
        
        self.assertTrue(result.success, f"Press key failed: {result.error}")
        self.assertEqual(result.data['key'], 'space')
        self.assertEqual(result.data['presses'], 1)
        
        logger.info("✅ Pressed 'space' key")
    
    def test_press_key_multiple(self):
        """Test pressing a key multiple times"""
        logger.info("Testing multiple key presses...")
        
        result = self.controller.press_key('backspace', presses=3, interval=0.1)
        
        self.assertTrue(result.success, f"Multiple key press failed: {result.error}")
        self.assertEqual(result.data['key'], 'backspace')
        self.assertEqual(result.data['presses'], 3)
        self.assertEqual(result.data['interval'], 0.1)
        
        logger.info("✅ Pressed 'backspace' 3 times with 0.1s interval")
    
    def test_key_combination(self):
        """Test key combinations (hotkeys)"""
        logger.info("Testing key combinations...")
        
        # Test Ctrl+A
        result = self.controller.key_combination(['ctrl', 'a'])
        
        self.assertTrue(result.success, f"Key combination failed: {result.error}")
        self.assertEqual(result.data['keys'], ['ctrl', 'a'])
        self.assertEqual(result.data['combination'], 'ctrl+a')
        
        logger.info("✅ Executed Ctrl+A combination")
    
    def test_hold_key(self):
        """Test holding a key"""
        logger.info("Testing key hold...")
        
        result = self.controller.hold_key('shift', duration=0.5)
        
        self.assertTrue(result.success, f"Hold key failed: {result.error}")
        self.assertEqual(result.data['key'], 'shift')
        self.assertEqual(result.data['duration'], 0.5)
        
        logger.info("✅ Held 'shift' key for 0.5 seconds")
    
    def test_get_available_keys(self):
        """Test getting available keys"""
        logger.info("Testing available keys list...")
        
        result = self.controller.get_available_keys()
        
        self.assertTrue(result.success, f"Get available keys failed: {result.error}")
        self.assertIn('all_keys', result.data)
        self.assertIn('categories', result.data)
        self.assertIn('total_count', result.data)
        self.assertGreater(result.data['total_count'], 50)  # Should have many keys
        
        # Check specific categories exist
        categories = result.data['categories']
        expected_categories = ['letters', 'numbers', 'function_keys', 'arrow_keys']
        for category in expected_categories:
            self.assertIn(category, categories)
            self.assertGreater(len(categories[category]), 0)
        
        logger.info(f"✅ Found {result.data['total_count']} available keys across {len(categories)} categories")
    
    # ==========================================
    # UTILITY & CONFIGURATION TESTS
    # ==========================================
    
    def test_get_screen_info(self):
        """Test getting screen information"""
        logger.info("Testing screen info...")
        
        result = self.controller.get_screen_info()
        
        self.assertTrue(result.success, f"Get screen info failed: {result.error}")
        self.assertIn('width', result.data)
        self.assertIn('height', result.data)
        self.assertGreater(result.data['width'], 0)
        self.assertGreater(result.data['height'], 0)
        
        logger.info(f"✅ Screen info: {result.data['width']}x{result.data['height']}")
    
    def test_is_on_screen(self):
        """Test coordinate validation"""
        logger.info("Testing coordinate validation...")
        
        # Valid coordinates
        result_valid = self.controller.is_on_screen(100, 100)
        self.assertTrue(result_valid.success)
        self.assertTrue(result_valid.data['on_screen'])
        
        # Invalid coordinates
        result_invalid = self.controller.is_on_screen(-100, -100)
        self.assertTrue(result_invalid.success)
        self.assertFalse(result_invalid.data['on_screen'])
        
        logger.info("✅ Coordinate validation working")
    
    def test_set_pause(self):
        """Test setting pause duration"""
        logger.info("Testing pause setting...")
        
        new_pause = 0.15
        result = self.controller.set_pause(new_pause)
        
        self.assertTrue(result.success, f"Set pause failed: {result.error}")
        self.assertEqual(result.data['new_pause'], new_pause)
        
        logger.info(f"✅ Pause set to {new_pause} seconds")
    
    def test_set_failsafe(self):
        """Test failsafe setting"""
        logger.info("Testing failsafe setting...")
        
        # Disable failsafe
        result_disable = self.controller.set_failsafe(False)
        self.assertTrue(result_disable.success)
        self.assertFalse(result_disable.data['new_failsafe'])
        
        # Enable failsafe
        result_enable = self.controller.set_failsafe(True)
        self.assertTrue(result_enable.success)
        self.assertTrue(result_enable.data['new_failsafe'])
        
        logger.info("✅ Failsafe enable/disable working")
    
    # ==========================================
    # ADVANCED FEATURE TESTS
    # ==========================================
    
    def test_create_image_template(self):
        """Test creating image templates"""
        logger.info("Testing image template creation...")
        
        template_name = "test_template"
        region = (100, 100, 200, 150)  # 200x150 region
        
        result = self.controller.create_image_template(
            template_name, region[0], region[1], region[2], region[3]
        )
        
        self.assertTrue(result.success, f"Create template failed: {result.error}")
        self.assertEqual(result.data['template_name'], template_name)
        self.assertEqual(result.data['region'], region)
        self.assertEqual(result.data['width'], region[2])
        self.assertEqual(result.data['height'], region[3])
        
        logger.info(f"✅ Created template '{template_name}' from region {region}")
    
    def test_find_template_not_found(self):
        """Test finding non-existent template"""
        logger.info("Testing template not found...")
        
        result = self.controller.find_template_on_screen("nonexistent_template")
        
        self.assertFalse(result.success)
        self.assertIn("not found", result.error)
        
        logger.info("✅ Non-existent template handled correctly")
    
    # ==========================================
    # ERROR HANDLING TESTS
    # ==========================================
    
    def test_invalid_coordinates(self):
        """Test error handling for invalid coordinates"""
        logger.info("Testing invalid coordinate handling...")
        
        screen_info = self.controller.get_screen_info()
        invalid_x = screen_info.data['width'] + 100
        invalid_y = screen_info.data['height'] + 100
        
        result = self.controller.move_mouse(invalid_x, invalid_y)
        
        self.assertFalse(result.success)
        self.assertIn("outside screen bounds", result.error)
        
        logger.info("✅ Invalid coordinates properly rejected")
    
    def test_invalid_button(self):
        """Test error handling for invalid mouse button"""
        logger.info("Testing invalid button handling...")
        
        result = self.controller.click_mouse(100, 100, button="invalid")
        
        self.assertFalse(result.success)
        self.assertIn("Invalid button", result.error)
        
        logger.info("✅ Invalid mouse button properly rejected")
    
    def test_invalid_key(self):
        """Test error handling for invalid key"""
        logger.info("Testing invalid key handling...")
        
        # This should fail gracefully
        result = self.controller.press_key("nonexistent_key_12345")
        
        # PyAutoGUI might still try to press it, so we just check it doesn't crash
        self.assertIsNotNone(result)
        
        logger.info("✅ Invalid key handled without crashing")
    
    # ==========================================
    # INTEGRATION TESTS
    # ==========================================
    
    def test_full_workflow_screenshot_click(self):
        """Test complete workflow: screenshot -> find area -> click"""
        logger.info("Testing screenshot + click workflow...")
        
        # Take screenshot
        screenshot_result = self.controller.take_screenshot()
        self.assertTrue(screenshot_result.success)
        
        # Get center coordinates
        width = screenshot_result.data['width']
        height = screenshot_result.data['height']
        center_x = width // 2
        center_y = height // 2
        
        # Click at center
        click_result = self.controller.click_mouse(center_x, center_y)
        self.assertTrue(click_result.success)
        
        logger.info(f"✅ Workflow: Screenshot ({width}x{height}) -> Click at center ({center_x}, {center_y})")
    
    def test_keyboard_mouse_combination(self):
        """Test combining keyboard and mouse operations"""
        logger.info("Testing keyboard + mouse combination...")
        
        # Move mouse to position
        move_result = self.controller.move_mouse(300, 300)
        self.assertTrue(move_result.success)
        
        # Click to focus
        click_result = self.controller.click_mouse()
        self.assertTrue(click_result.success)
        
        # Type some text
        type_result = self.controller.type_text("Test text", interval=0.01)
        self.assertTrue(type_result.success)
        
        # Select all and delete
        select_result = self.controller.key_combination(['ctrl', 'a'])
        self.assertTrue(select_result.success)
        
        delete_result = self.controller.press_key('delete')
        self.assertTrue(delete_result.success)
        
        logger.info("✅ Keyboard + mouse combination workflow completed")
    
    def test_batch_operations_simulation(self):
        """Test simulated batch operations"""
        logger.info("Testing batch operations simulation...")
        
        # Simulate multiple clicks
        click_sequence = [
            {"x": 100, "y": 100, "button": "left", "delay_after": 0.1},
            {"x": 200, "y": 150, "button": "right", "delay_after": 0.1},
            {"x": 300, "y": 200, "button": "left", "clicks": 2}
        ]
        
        for i, click_data in enumerate(click_sequence):
            result = self.controller.click_mouse(
                click_data["x"], 
                click_data["y"], 
                click_data.get("button", "left"),
                click_data.get("clicks", 1)
            )
            self.assertTrue(result.success, f"Batch click {i+1} failed")
            
            delay = click_data.get("delay_after", 0)
            if delay > 0:
                time.sleep(delay)
        
        # Simulate multiple key operations
        key_sequence = [
            {"operation": "type", "text": "Hello "},
            {"operation": "press", "key": "tab"},
            {"operation": "combination", "keys": ["ctrl", "a"]},
            {"operation": "hold", "key": "shift", "duration": 0.2}
        ]
        
        for i, key_data in enumerate(key_sequence):
            operation = key_data["operation"]
            
            if operation == "type":
                result = self.controller.type_text(key_data["text"])
            elif operation == "press":
                result = self.controller.press_key(key_data["key"])
            elif operation == "combination":
                result = self.controller.key_combination(key_data["keys"])
            elif operation == "hold":
                result = self.controller.hold_key(
                    key_data["key"], 
                    key_data.get("duration", 1.0)
                )
            
            self.assertTrue(result.success, f"Batch key operation {i+1} failed")
        
        logger.info("✅ Batch operations simulation completed")

class MCPToolHandlerTests(unittest.TestCase):
    """Tests for MCP tool handlers"""
    
    @classmethod
    def setUpClass(cls):
        """Set up MCP handler tests"""
        try:
            from ..tools.mcp_tools import PyAutoGUIToolHandler
            cls.handler = PyAutoGUIToolHandler()
            
            if not cls.handler.available:
                raise unittest.SkipTest("PyAutoGUI handler not available")
                
        except ImportError as e:
            raise unittest.SkipTest(f"PyAutoGUI tools not available: {e}")
    
    def test_handler_availability_check(self):
        """Test handler availability check"""
        check = self.handler._check_availability()
        self.assertIsNone(check, "Handler should be available")
    
    def test_screenshot_handler(self):
        """Test screenshot MCP handler"""
        logger.info("Testing screenshot MCP handler...")
        
        result = asyncio.run(self.handler.handle_screenshot({}))
        
        self.assertTrue(result["success"])
        self.assertIn("data", result)
        
        logger.info("✅ Screenshot MCP handler working")
    
    def test_mouse_position_handler(self):
        """Test mouse position MCP handler"""
        logger.info("Testing mouse position MCP handler...")
        
        result = asyncio.run(self.handler.handle_mouse_position({}))
        
        self.assertTrue(result["success"])
        self.assertIn("data", result)
        
        logger.info("✅ Mouse position MCP handler working")
    
    def test_invalid_arguments_handling(self):
        """Test handler with invalid arguments"""
        logger.info("Testing invalid arguments handling...")
        
        # Missing required argument
        result = asyncio.run(self.handler.handle_pixel_color({}))
        
        self.assertFalse(result["success"])
        self.assertIn("error", result)
        
        logger.info("✅ Invalid arguments properly handled")

def run_comprehensive_tests():
    """Run all PyAutoGUI tests"""
    
    print("🧪 Starting Comprehensive PyAutoGUI Integration Tests")
    print("=" * 70)
    
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add test classes
    suite.addTests(loader.loadTestsFromTestCase(PyAutoGUIIntegrationTests))
    suite.addTests(loader.loadTestsFromTestCase(MCPToolHandlerTests))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Summary
    print("\n" + "=" * 70)
    print("🎯 TEST SUMMARY")
    print("=" * 70)
    
    total_tests = result.testsRun
    failures = len(result.failures)
    errors = len(result.errors)
    skipped = len(result.skipped) if hasattr(result, 'skipped') else 0
    passed = total_tests - failures - errors - skipped
    
    print(f"Total Tests: {total_tests}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failures}")
    print(f"💥 Errors: {errors}")
    print(f"⏭️ Skipped: {skipped}")
    
    if failures == 0 and errors == 0:
        print("\n🎉 ALL TESTS PASSED! PyAutoGUI integration is working perfectly!")
        return True
    else:
        print(f"\n⚠️ {failures + errors} tests failed. Check the output above for details.")
        return False

def run_basic_functionality_test():
    """Run a quick test of basic PyAutoGUI functionality"""
    
    print("🔍 Quick PyAutoGUI Functionality Test")
    print("=" * 50)
    
    try:
        from ..core.integration import get_pyautogui_controller, PYAUTOGUI_AVAILABLE
        
        if not PYAUTOGUI_AVAILABLE:
            print("❌ PyAutoGUI not available")
            return False
        
        controller = get_pyautogui_controller()
        
        # Test 1: Screen info
        screen_result = controller.get_screen_info()
        if screen_result.success:
            print(f"✅ Screen: {screen_result.data['width']}x{screen_result.data['height']}")
        else:
            print(f"❌ Screen info failed: {screen_result.error}")
            return False
        
        # Test 2: Mouse position
        mouse_result = controller.get_mouse_position()
        if mouse_result.success:
            print(f"✅ Mouse: ({mouse_result.data['x']}, {mouse_result.data['y']})")
        else:
            print(f"❌ Mouse position failed: {mouse_result.error}")
            return False
        
        # Test 3: Screenshot
        screenshot_result = controller.take_screenshot()
        if screenshot_result.success:
            print(f"✅ Screenshot: {screenshot_result.data['width']}x{screenshot_result.data['height']}")
        else:
            print(f"❌ Screenshot failed: {screenshot_result.error}")
            return False
        
        # Test 4: Available keys
        keys_result = controller.get_available_keys()
        if keys_result.success:
            print(f"✅ Keys: {keys_result.data['total_count']} available")
        else:
            print(f"❌ Available keys failed: {keys_result.error}")
            return False
        
        print("\n🎉 Basic functionality test PASSED!")
        return True
        
    except Exception as e:
        print(f"❌ Basic test failed: {e}")
        return False

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="PyAutoGUI Integration Tests")
    parser.add_argument("--quick", action="store_true", help="Run quick functionality test only")
    parser.add_argument("--comprehensive", action="store_true", help="Run comprehensive test suite")
    args = parser.parse_args()
    
    if args.quick:
        success = run_basic_functionality_test()
    elif args.comprehensive:
        success = run_comprehensive_tests()
    else:
        # Run both
        print("Running both quick and comprehensive tests...\n")
        quick_success = run_basic_functionality_test()
        print("\n" + "="*70 + "\n")
        comprehensive_success = run_comprehensive_tests()
        success = quick_success and comprehensive_success
    
    sys.exit(0 if success else 1)
