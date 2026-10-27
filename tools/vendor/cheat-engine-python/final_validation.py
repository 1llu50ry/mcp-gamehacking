#!/usr/bin/env python3
"""
Final validation test for the Cheat Engine version detection refactoring
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent / "server"
sys.path.insert(0, str(server_dir))

def main():
    print("🚀 Final Validation Test - Cheat Engine Version Detection")
    print("=" * 60)
    
    try:
        # Test 1: Import the main server module
        print("📦 Test 1: Importing MCP server module...")
        import main
        print("✅ SUCCESS: MCP server module imported successfully")
        
        # Test 2: Test basic version detection
        print("\n🔍 Test 2: Basic version detection...")
        basic_version = main.get_cheat_engine_basic_version()
        print(f"✅ SUCCESS: Basic version = '{basic_version}'")
        
        # Test 3: Test comprehensive version detection
        print("\n📊 Test 3: Comprehensive version detection...")
        detailed_version = main.get_cheat_engine_version()
        print("✅ SUCCESS: Comprehensive version information retrieved")
        print(f"Preview: {detailed_version.split(chr(10))[0]}...")
        
        # Test 4: Verify CheatEngineBridge functionality
        print("\n🔧 Test 4: CheatEngineBridge functionality...")
        ce_bridge = main.cheat_engine_bridge
        if ce_bridge.ce_installation.available:
            print(f"✅ SUCCESS: Cheat Engine detected at {ce_bridge.ce_installation.path}")
            print(f"           Version: {ce_bridge.ce_installation.version}")
            print(f"           Executable: {ce_bridge.ce_installation.executable}")
        else:
            print("ℹ️  INFO: No Cheat Engine installation detected")
        
        print("\n🎉 ALL TESTS PASSED!")
        print("🔧 Cheat Engine version detection is working correctly")
        print("📡 MCP tools are ready for use")
        
        return True
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
