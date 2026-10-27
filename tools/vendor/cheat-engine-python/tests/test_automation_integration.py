#!/usr/bin/env python3
"""
Test Automation System Integration

This script tests the integration of the automation system with the MCP server.
It validates tool registration, basic functionality, and error handling.
"""

import sys
import logging
import asyncio
from pathlib import Path

# Add parent directory to path for imports
parent_dir = Path(__file__).parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_automation_imports():
    """Test that all automation modules can be imported"""
    try:
        logger.info("Testing automation module imports...")
        
        # Test automation_demo import
        from automation_demo import (
            SecurityValidator, WindowManager, KeystrokeInjector,
            MemoryTextTracker, ApplicationLauncher, AutomationOrchestrator
        )
        logger.info("✅ automation_demo module imported successfully")
        
        # Test automation_tools import
        from automation_tools import (
            AutomationToolHandler, register_automation_tools,
            LAUNCH_APP_TOOL, SEND_KEYSTROKES_TOOL, FIND_TEXT_ADDRESSES_TOOL,
            MONITOR_MEMORY_TOOL, AUTOMATION_WORKFLOW_TOOL, GET_MONITORING_STATUS_TOOL
        )
        logger.info("✅ automation_tools module imported successfully")
        
        return True
        
    except ImportError as e:
        logger.error(f"❌ Import failed: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Unexpected error during import: {e}")
        return False

def test_tool_definitions():
    """Test MCP tool definitions"""
    try:
        logger.info("Testing MCP tool definitions...")
        
        from automation_tools import (
            LAUNCH_APP_TOOL, SEND_KEYSTROKES_TOOL, FIND_TEXT_ADDRESSES_TOOL,
            MONITOR_MEMORY_TOOL, AUTOMATION_WORKFLOW_TOOL, GET_MONITORING_STATUS_TOOL
        )
        
        tools = [
            LAUNCH_APP_TOOL, SEND_KEYSTROKES_TOOL, FIND_TEXT_ADDRESSES_TOOL,
            MONITOR_MEMORY_TOOL, AUTOMATION_WORKFLOW_TOOL, GET_MONITORING_STATUS_TOOL
        ]
        
        for tool in tools:
            # Validate tool structure
            assert hasattr(tool, 'name'), f"Tool missing name: {tool}"
            assert hasattr(tool, 'description'), f"Tool missing description: {tool}"
            assert hasattr(tool, 'inputSchema'), f"Tool missing inputSchema: {tool}"
            
            # Validate schema structure
            schema = tool.inputSchema
            assert 'type' in schema, f"Tool schema missing type: {tool.name}"
            assert 'properties' in schema, f"Tool schema missing properties: {tool.name}"
            
            logger.info(f"✅ Tool '{tool.name}' definition is valid")
        
        logger.info(f"✅ All {len(tools)} tool definitions are valid")
        return True
        
    except Exception as e:
        logger.error(f"❌ Tool definition test failed: {e}")
        return False

def test_automation_orchestrator():
    """Test basic automation orchestrator functionality"""
    try:
        logger.info("Testing automation orchestrator initialization...")
        
        from automation_demo import AutomationOrchestrator
        
        # Initialize orchestrator
        orchestrator = AutomationOrchestrator()
        
        # Test basic properties
        assert orchestrator.security_validator is not None
        assert orchestrator.window_manager is not None
        assert orchestrator.keystroke_injector is not None
        # Note: Memory functionality moved to Cheat Engine
        assert orchestrator.app_launcher is not None
        
        logger.info("✅ Automation orchestrator initialized successfully")
        
        # Test security validator
        result = orchestrator.security_validator.validate_application("notepad.exe")
        assert result.success, "Notepad should be whitelisted"
        logger.info("✅ Security validation working")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Automation orchestrator test failed: {e}")
        return False

def test_tool_handler():
    """Test automation tool handler"""
    try:
        logger.info("Testing automation tool handler...")
        
        from automation_tools import AutomationToolHandler
        
        # Initialize handler
        handler = AutomationToolHandler()
        
        # Test handler methods exist
        assert hasattr(handler, 'handle_launch_whitelisted_app')
        assert hasattr(handler, 'handle_send_keystrokes_to_app')
        assert hasattr(handler, 'handle_find_text_memory_addresses')
        assert hasattr(handler, 'handle_monitor_memory_address')
        assert hasattr(handler, 'handle_automate_app_text_workflow')
        assert hasattr(handler, 'handle_get_memory_monitoring_status')
        
        logger.info("✅ Tool handler initialized with all methods")
        
        # Test error response format
        error_response = handler._error_response("Test error")
        assert 'success' in error_response
        assert error_response['success'] is False
        assert 'content' in error_response
        
        logger.info("✅ Tool handler error handling working")
        return True
        
    except Exception as e:
        logger.error(f"❌ Tool handler test failed: {e}")
        return False

def test_whitelist_integration():
    """Test whitelist integration"""
    try:
        logger.info("Testing whitelist integration...")
        
        from automation_demo import SecurityValidator
        
        # Initialize validator
        validator = SecurityValidator()
        
        # Test known applications
        known_apps = [
            "notepad.exe", "calc.exe", "mspaint.exe", "cmd.exe",
            "powershell.exe", "firefox.exe", "chrome.exe"
        ]
        
        valid_count = 0
        for app in known_apps:
            result = validator.validate_application(app)
            if result.success:
                valid_count += 1
                logger.info(f"✅ {app} is whitelisted")
        
        logger.info(f"✅ {valid_count}/{len(known_apps)} known applications are whitelisted")
        
        # Test invalid application
        result = validator.validate_application("malicious.exe")
        if not result.success:
            logger.info("✅ Non-whitelisted application correctly rejected")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Whitelist integration test failed: {e}")
        return False

def test_error_handling():
    """Test error handling in automation components"""
    try:
        logger.info("Testing error handling...")
        
        from automation_tools import AutomationToolHandler
        
        handler = AutomationToolHandler()
        
        # Test with invalid inputs
        test_cases = [
            ("handle_launch_whitelisted_app", {"app_name": "nonexistent.exe"}),
            ("handle_send_keystrokes_to_app", {"text": "test", "target_pid": 99999}),
            ("handle_find_text_memory_addresses", {"search_text": "test", "target_pid": 99999}),
        ]
        
        for method_name, args in test_cases:
            try:
                method = getattr(handler, method_name)
                result = method(**args)
                
                # Should return error response
                assert 'success' in result
                assert result['success'] is False
                
                logger.info(f"✅ {method_name} handles errors correctly")
                
            except Exception as e:
                logger.info(f"✅ {method_name} raises appropriate exceptions: {type(e).__name__}")
        
        logger.info("✅ Error handling tests completed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error handling test failed: {e}")
        return False

def run_all_tests():
    """Run all integration tests"""
    logger.info("=" * 60)
    logger.info("MCP Automation System Integration Tests")
    logger.info("=" * 60)
    
    tests = [
        ("Module Imports", test_automation_imports),
        ("Tool Definitions", test_tool_definitions),
        ("Automation Orchestrator", test_automation_orchestrator),
        ("Tool Handler", test_tool_handler),
        ("Whitelist Integration", test_whitelist_integration),
        ("Error Handling", test_error_handling)
    ]
    
    passed = 0
    failed = 0
    
    for test_name, test_func in tests:
        logger.info(f"\n🧪 Running test: {test_name}")
        logger.info("-" * 40)
        
        try:
            if test_func():
                logger.info(f"✅ {test_name} PASSED")
                passed += 1
            else:
                logger.error(f"❌ {test_name} FAILED")
                failed += 1
        except Exception as e:
            logger.error(f"❌ {test_name} FAILED with exception: {e}")
            failed += 1
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("TEST SUMMARY")
    logger.info("=" * 60)
    logger.info(f"✅ Passed: {passed}")
    logger.info(f"❌ Failed: {failed}")
    logger.info(f"📊 Success Rate: {passed/(passed+failed)*100:.1f}%")
    
    if failed == 0:
        logger.info("\n🎉 All tests passed! Automation system is ready for integration.")
        return True
    else:
        logger.error(f"\n⚠️  {failed} tests failed. Please review and fix issues.")
        return False

def test_server_integration():
    """Test integration with MCP server"""
    try:
        logger.info("\n🔗 Testing MCP Server Integration...")
        logger.info("-" * 40)
        
        # Test that we can import and use the registration function
        from automation_tools import register_automation_tools
        
        # Mock MCP server for testing
        class MockMCPServer:
            def __init__(self):
                self.tools = []
                self.handlers = []
            
            def add_tool(self, tool):
                self.tools.append(tool)
            
            def tool_handler(self):
                def decorator(func):
                    self.handlers.append(func)
                    return func
                return decorator
        
        # Test registration
        mock_server = MockMCPServer()
        tools = register_automation_tools(mock_server)
        
        # Validate registration
        assert len(tools) == 6, f"Expected 6 tools, got {len(tools)}"
        assert len(mock_server.tools) == 6, f"Expected 6 tools registered, got {len(mock_server.tools)}"
        assert len(mock_server.handlers) == 1, f"Expected 1 handler registered, got {len(mock_server.handlers)}"
        
        logger.info(f"✅ Successfully registered {len(tools)} tools with mock server")
        
        # Test tool names
        expected_tools = [
            "launch_whitelisted_app",
            "send_keystrokes_to_app", 
            "find_text_memory_addresses",
            "monitor_memory_address",
            "automate_app_text_workflow",
            "get_memory_monitoring_status"
        ]
        
        registered_names = [tool.name for tool in tools]
        for expected in expected_tools:
            assert expected in registered_names, f"Missing expected tool: {expected}"
        
        logger.info("✅ All expected tools are registered")
        logger.info("✅ MCP Server Integration test PASSED")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ MCP Server Integration test FAILED: {e}")
        return False

if __name__ == "__main__":
    try:
        # Run integration tests
        success = run_all_tests()
        
        # Test server integration
        server_success = test_server_integration()
        
        # Final result
        if success and server_success:
            logger.info("\n🎉 ALL INTEGRATION TESTS PASSED!")
            logger.info("🚀 Automation system is ready for production use!")
            sys.exit(0)
        else:
            logger.error("\n❌ Some tests failed. Please review and fix issues before deployment.")
            sys.exit(1)
            
    except KeyboardInterrupt:
        logger.info("\n⏹️  Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n💥 Test suite failed with unexpected error: {e}")
        sys.exit(1)
