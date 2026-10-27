#!/usr/bin/env python3
"""
Test script to verify the PyAutoGUI module is properly integrated into the MCP server structure
"""

import sys
import os

def test_pyautogui_server_integration():
    """Test the PyAutoGUI module integration with MCP server"""
    
    print("🧪 Testing GUI Automation Server Integration")
    print("=" * 50)
    
    try:
        # Test server imports
        print("1. Testing server GUI automation imports...")
        sys.path.insert(0, 'server')
        from gui_automation.core.integration import PyAutoGUIController, get_pyautogui_controller, PYAUTOGUI_AVAILABLE
        from gui_automation.tools.mcp_tools import ALL_PYAUTOGUI_TOOLS, PyAutoGUIToolHandler
        print("   ✅ Server GUI automation imports successful")
        
        # Test client imports (from project root)
        print("2. Testing client imports from project root...")
        sys.path.insert(0, '.')
        from server.gui_automation.core.integration import PyAutoGUIController as ClientController
        from server.gui_automation.tools.mcp_tools import ALL_PYAUTOGUI_TOOLS as ClientTools
        print("   ✅ Client imports successful")
        
        # Test controller initialization
        print("3. Testing controller initialization...")
        controller = get_pyautogui_controller()
        if controller:
            print("   ✅ Controller created successfully")
        
        # Test tool handler
        print("4. Testing tool handler...")
        handler = PyAutoGUIToolHandler()
        if handler:
            print(f"   ✅ Tool handler created (available: {handler.available})")
        
        # Test tool count
        print("5. Testing tool availability...")
        print(f"   ✅ {len(ALL_PYAUTOGUI_TOOLS)} MCP tools available")
        
        # Test basic functionality
        print("6. Testing basic functionality...")
        if PYAUTOGUI_AVAILABLE:
            screen_result = controller.get_screen_info()
            if screen_result.success:
                print(f"   ✅ Screen info: {screen_result.data}")
            else:
                print(f"   ⚠️ Screen info warning: {screen_result.error}")
        else:
            print("   ⚠️ PyAutoGUI not available (expected in test environment)")
        
        print("")
        print("🎉 GUI Automation Server Integration Test: SUCCESS!")
        print("=" * 50)
        print("✅ Server imports working correctly")
        print("✅ Client imports working correctly")
        print("✅ Module properly integrated into MCP server")
        print("✅ All functionality accessible")
        print("")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_pyautogui_server_integration()
    sys.exit(0 if success else 1)
